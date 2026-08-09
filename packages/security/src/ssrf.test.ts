import { describe, expect, test } from 'bun:test';
import { type FetchLike, SsrfBlockedError, type SsrfPolicy, createSsrfGuard } from './ssrf';

const ALLOWED = ['ht.getimpala.ai', 'accounts.google.com', 'sandbox.partner.example'];

/** A resolver backed by a fixed table; anything unlisted fails to resolve. */
function resolverFor(table: Record<string, string[]>) {
  return async (hostname: string) => {
    const found = table[hostname];
    if (!found) throw new Error('NXDOMAIN');
    return found;
  };
}

const publicDns = resolverFor({
  'ht.getimpala.ai': ['203.0.114.10'],
  'accounts.google.com': ['142.250.72.174'],
  'sandbox.partner.example': ['93.184.216.34'],
  'evil.example': ['203.0.114.99'],
});

function guardWith(
  overrides: Partial<SsrfPolicy> = {},
  fetchImpl: FetchLike = async () => new Response('ok'),
  resolve = publicDns,
) {
  return createSsrfGuard({ allowedHosts: ALLOWED, ...overrides }, { resolve, fetch: fetchImpl });
}

async function expectBlocked(promise: Promise<unknown>, reasonPart: string) {
  try {
    await promise;
    throw new Error('expected the request to be blocked');
  } catch (error) {
    expect(error).toBeInstanceOf(SsrfBlockedError);
    expect((error as SsrfBlockedError).reason).toContain(reasonPart);
  }
}

describe('allowlist', () => {
  test('permits an allowlisted host over https', async () => {
    const url = await guardWith().assertAllowed('https://ht.getimpala.ai/v1/chat');
    expect(url.hostname).toBe('ht.getimpala.ai');
  });

  test('refuses a host that is not named', async () => {
    await expectBlocked(guardWith().assertAllowed('https://evil.example/'), 'not on the allowlist');
  });

  test('matches hosts case-insensitively and ignores the FQDN dot', async () => {
    await expect(guardWith().assertAllowed('https://HT.GetImpala.AI/v1')).resolves.toBeDefined();
    await expect(guardWith().assertAllowed('https://ht.getimpala.ai./v1')).resolves.toBeDefined();
  });

  test('does not match by suffix — a lookalike domain is refused', async () => {
    // The classic mistake: endsWith("getimpala.ai") would accept this.
    await expectBlocked(
      guardWith().assertAllowed('https://ht.getimpala.ai.evil.example/'),
      'not on the allowlist',
    );
    await expectBlocked(
      guardWith().assertAllowed('https://notht.getimpala.ai/'),
      'not on the allowlist',
    );
  });

  test('a userinfo prefix cannot disguise the real host', async () => {
    // https://ht.getimpala.ai@evil.example/ actually targets evil.example.
    await expectBlocked(
      guardWith().assertAllowed('https://ht.getimpala.ai@evil.example/'),
      'credentials in URL',
    );
  });
});

describe('scheme and credentials', () => {
  test('refuses http, file and gopher', async () => {
    const guard = guardWith();
    await expectBlocked(guard.assertAllowed('http://ht.getimpala.ai/'), 'protocol http:');
    await expectBlocked(guard.assertAllowed('file:///etc/passwd'), 'protocol file:');
    await expectBlocked(guard.assertAllowed('gopher://ht.getimpala.ai/'), 'protocol gopher:');
  });

  test('refuses embedded credentials', async () => {
    await expectBlocked(
      guardWith().assertAllowed('https://user:pass@ht.getimpala.ai/'),
      'credentials in URL',
    );
  });

  test('refuses a malformed URL', async () => {
    await expectBlocked(guardWith().assertAllowed('not-a-url'), 'malformed URL');
  });
});

describe('DNS resolution', () => {
  test('refuses an allowlisted host that resolves to loopback', async () => {
    const guard = guardWith({}, undefined, resolverFor({ 'ht.getimpala.ai': ['127.0.0.1'] }));
    await expectBlocked(guard.assertAllowed('https://ht.getimpala.ai/'), 'non-public address');
  });

  test('refuses an allowlisted host that resolves to cloud metadata', async () => {
    const guard = guardWith({}, undefined, resolverFor({ 'ht.getimpala.ai': ['169.254.169.254'] }));
    await expectBlocked(guard.assertAllowed('https://ht.getimpala.ai/'), '169.254.169.254');
  });

  test('refuses when ANY resolved address is private (split-horizon answer)', async () => {
    const guard = guardWith(
      {},
      undefined,
      resolverFor({ 'ht.getimpala.ai': ['203.0.114.10', '10.0.0.5'] }),
    );
    await expectBlocked(guard.assertAllowed('https://ht.getimpala.ai/'), 'non-public address');
  });

  test('refuses an empty or failing resolution', async () => {
    const empty = guardWith({}, undefined, resolverFor({ 'ht.getimpala.ai': [] }));
    await expectBlocked(empty.assertAllowed('https://ht.getimpala.ai/'), 'no addresses');

    const failing = guardWith({}, undefined, resolverFor({}));
    await expectBlocked(failing.assertAllowed('https://ht.getimpala.ai/'), 'could not resolve');
  });

  test('an allowlisted literal IP must still be public', async () => {
    const guard = createSsrfGuard(
      { allowedHosts: ['127.0.0.1', '203.0.114.10'] },
      { resolve: publicDns, fetch: async () => new Response('ok') },
    );
    await expectBlocked(guard.assertAllowed('https://127.0.0.1/'), 'not a public address');
    await expect(guard.assertAllowed('https://203.0.114.10/')).resolves.toBeDefined();
  });
});

describe('redirects', () => {
  const redirectTo = (location: string, status = 302) =>
    new Response(null, { status, headers: { location } });

  test('follows an allowlisted redirect', async () => {
    let calls = 0;
    const guard = guardWith({}, async (input) => {
      calls++;
      return String(input).includes('/start')
        ? redirectTo('https://accounts.google.com/done')
        : new Response('landed');
    });
    const response = await guard.fetch('https://ht.getimpala.ai/start');
    expect(await response.text()).toBe('landed');
    expect(calls).toBe(2);
  });

  test('refuses a redirect that leaves the allowlist', async () => {
    const guard = guardWith({}, async () => redirectTo('https://evil.example/steal'));
    await expectBlocked(guard.fetch('https://ht.getimpala.ai/start'), 'not on the allowlist');
  });

  test('refuses a redirect to a private address', async () => {
    const guard = guardWith(
      {},
      async () => redirectTo('https://sandbox.partner.example/internal'),
      resolverFor({
        'ht.getimpala.ai': ['203.0.114.10'],
        'sandbox.partner.example': ['192.168.1.1'],
      }),
    );
    await expectBlocked(guard.fetch('https://ht.getimpala.ai/start'), 'non-public address');
  });

  test('refuses a redirect to a non-https scheme', async () => {
    const guard = guardWith({}, async () => redirectTo('http://ht.getimpala.ai/downgrade'));
    await expectBlocked(guard.fetch('https://ht.getimpala.ai/start'), 'protocol http:');
  });

  test('resolves a relative redirect against the current hop', async () => {
    const seen: string[] = [];
    const guard = guardWith({}, async (input) => {
      const url = String(input);
      seen.push(url);
      return url.endsWith('/start') ? redirectTo('/v2/next') : new Response('landed');
    });
    await guard.fetch('https://ht.getimpala.ai/start');
    expect(seen[1]).toBe('https://ht.getimpala.ai/v2/next');
  });

  test('stops at the redirect cap instead of looping forever', async () => {
    const guard = guardWith({ maxRedirects: 2 }, async () =>
      redirectTo('https://ht.getimpala.ai/loop'),
    );
    await expectBlocked(guard.fetch('https://ht.getimpala.ai/loop'), 'exceeded 2 redirects');
  });

  test('a redirect without a Location header is returned as-is', async () => {
    const guard = guardWith({}, async () => new Response(null, { status: 302 }));
    const response = await guard.fetch('https://ht.getimpala.ai/x');
    expect(response.status).toBe(302);
  });

  test.each([301, 302, 303, 307, 308])('follows a %i redirect', async (status) => {
    let hops = 0;
    const guard = guardWith({}, async () => {
      hops++;
      return hops === 1
        ? redirectTo('https://accounts.google.com/ok', status)
        : new Response('landed');
    });
    expect(await (await guard.fetch('https://ht.getimpala.ai/start')).text()).toBe('landed');
  });
});

describe('allowPrivate (local development only)', () => {
  test('permits http and loopback when explicitly enabled', async () => {
    const guard = createSsrfGuard(
      { allowedHosts: ['localhost'], allowPrivate: true },
      { resolve: resolverFor({}), fetch: async () => new Response('ok') },
    );
    await expect(guard.assertAllowed('http://localhost:3001/health')).resolves.toBeDefined();
  });

  test('still enforces the allowlist', async () => {
    const guard = createSsrfGuard(
      { allowedHosts: ['localhost'], allowPrivate: true },
      { resolve: resolverFor({}), fetch: async () => new Response('ok') },
    );
    await expectBlocked(guard.assertAllowed('http://evil.example/'), 'not on the allowlist');
  });
});
