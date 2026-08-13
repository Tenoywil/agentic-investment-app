import { describe, expect, test } from 'bun:test';
import { REDACTED, redact, redactString } from './redact';

/*
 * Credential-shaped fixtures are assembled at runtime rather than written as
 * literals. They are fake either way, but a literal that *looks* like a real key
 * trips secret scanners (gitleaks, GitGuardian) on every commit forever, and a
 * scanner that cries wolf in tests is one people learn to ignore.
 */
const fakeGatewayKey = ['sk', 'abcdef1234567890'].join('-');
const fakeJwt = [
  Buffer.from('{"alg":"HS256"}').toString('base64url'),
  Buffer.from('{"sub":"1234567890"}').toString('base64url'),
  'dBjftJeZ4CVPmB92K27uhbUJU1p1r',
].join('.');

describe('redactString', () => {
  test('masks a gateway key', () => {
    expect(redactString(`using ${fakeGatewayKey} now`)).toBe(`using ${REDACTED} now`);
  });

  /**
   * The exact shape that reached a production log: the AI gateway rejected a
   * token and echoed it back inside the error message. It carries no `sk-`
   * prefix — a bare hex string — so no value pattern matched, and it was inside
   * a message rather than a field, so the by-key pass never saw it.
   */
  test('masks a bare token echoed back in an upstream error message', () => {
    const bare = 'a1a1957038511'.concat('46cb074767731c17b62927d64322d8417f87e664f1ee0a7a93f');
    const message = `Authentication Error, Invalid proxy server token passed. key=${bare}, not found in db`;
    const out = redactString(message);
    expect(out).not.toContain(bare);
    expect(out).toContain(`key=${REDACTED}`);
    // The rest of the message has to survive — it is the diagnosis.
    expect(out).toContain('not found in db');
  });

  test('masks credential assignments whatever they are called', () => {
    const value = 'abcdef0123456789abcdef';
    for (const name of ['token', 'api_key', 'apiKey', 'secret', 'password']) {
      expect(redactString(`${name}=${value}`)).toBe(`${name}=${REDACTED}`);
      expect(redactString(`${name}: ${value}`)).toBe(`${name}: ${REDACTED}`);
    }
  });

  /**
   * The audit chain's SHA-256 hashes are logged on purpose and are not secret.
   * A blanket "long hex run" rule would have masked them, which is why the rule
   * matches the assignment and not the value.
   */
  test('leaves audit-chain hashes alone', () => {
    const hash = 'e3b0c44298fc1c149afbf4c8996fb924'.concat('27ae41e4649b934ca495991b7852b855');
    expect(redactString(`chain head ${hash} verified`)).toBe(`chain head ${hash} verified`);
  });

  test('masks a JWT', () => {
    // Sanity-check the fixture really is JWT-shaped before asserting on it.
    expect(fakeJwt.startsWith('eyJ')).toBe(true);
    expect(redactString(`token=${fakeJwt}`)).toBe(`token=${REDACTED}`);
  });

  test('masks bearer and basic auth headers, keeping the scheme', () => {
    expect(redactString('Authorization: Bearer abcdef123456789')).toBe(
      `Authorization: Bearer ${REDACTED}`,
    );
    expect(redactString('Basic dXNlcjpwYXNzd29yZA==')).toBe(`Basic ${REDACTED}`);
  });

  test('masks the password in a connection URL but keeps the host', () => {
    expect(redactString('postgres://ccn:s3cret@db.example:5432/ccn')).toBe(
      `postgres://ccn:${REDACTED}@db.example:5432/ccn`,
    );
  });

  test('masks email addresses', () => {
    expect(redactString('contact marcus.bailey@example.com today')).toBe(
      `contact ${REDACTED} today`,
    );
  });

  test('masks long digit runs (account and card numbers)', () => {
    expect(redactString('card 4111111111111111')).toBe(`card ${REDACTED}`);
    expect(redactString('acct 4111 1111 1111 1111')).toBe(`acct ${REDACTED}`);
  });

  test('leaves ordinary text and short numbers alone', () => {
    expect(redactString('order settled T+2 for US$1,000')).toBe('order settled T+2 for US$1,000');
    expect(redactString('yield 6.25% across 47 holdings')).toBe('yield 6.25% across 47 holdings');
  });
});

describe('redact', () => {
  test('masks sensitive keys regardless of value', () => {
    const out = redact({
      route: '/api/orders',
      authorization: 'anything at all',
      password: 'hunter2',
      apiKey: 'plain',
      sessionToken: 'x',
    }) as Record<string, unknown>;

    expect(out.route).toBe('/api/orders');
    expect(out.authorization).toBe(REDACTED);
    expect(out.password).toBe(REDACTED);
    expect(out.apiKey).toBe(REDACTED);
    expect(out.sessionToken).toBe(REDACTED);
  });

  test('matches key names across casing and separators', () => {
    const out = redact({
      API_KEY: 'a',
      'private-key': 'b',
      DateOfBirth: 'c',
      account_number: 'd',
    }) as Record<string, unknown>;
    expect(Object.values(out)).toEqual([REDACTED, REDACTED, REDACTED, REDACTED]);
  });

  test('masks direct identifiers (PII minimization)', () => {
    const out = redact({
      ssn: '111-22-3333',
      passport: 'X1234',
      phone: '+1 876 555 0100',
    }) as Record<string, unknown>;
    expect(Object.values(out)).toEqual([REDACTED, REDACTED, REDACTED]);
  });

  test('recurses into nested objects and arrays', () => {
    const out = redact({
      request: { headers: { cookie: 'sid=abc' }, path: '/api/agent' },
      items: [{ secret: 'x' }, { ok: 'keep' }],
    }) as {
      request: { headers: Record<string, unknown>; path: string };
      items: Record<string, unknown>[];
    };

    expect(out.request.headers.cookie).toBe(REDACTED);
    expect(out.request.path).toBe('/api/agent');
    expect(out.items[0]?.secret).toBe(REDACTED);
    expect(out.items[1]?.ok).toBe('keep');
  });

  test('masks value-shaped secrets even under an innocuous key', () => {
    const out = redact({ message: `call failed with ${fakeGatewayKey}` }) as Record<string, string>;
    expect(out.message).toBe(`call failed with ${REDACTED}`);
  });

  test('serializes errors with a redacted message', () => {
    const out = redact(new Error(`bad key ${fakeGatewayKey}`)) as {
      name: string;
      message: string;
    };
    expect(out.name).toBe('Error');
    expect(out.message).toBe(`bad key ${REDACTED}`);
  });

  test('handles cycles without hanging', () => {
    const node: Record<string, unknown> = { name: 'root' };
    node.self = node;
    const out = redact(node) as Record<string, unknown>;
    expect(out.name).toBe('root');
    expect(out.self).toBe('[circular]');
  });

  test('does not mutate the input', () => {
    const input = { password: 'hunter2', nested: { token: 'abc' } };
    redact(input);
    expect(input.password).toBe('hunter2');
    expect(input.nested.token).toBe('abc');
  });

  test('passes primitives through', () => {
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
  });
});
