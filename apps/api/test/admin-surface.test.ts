import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { loadServerConfig } from '@ccn/config';
import { createDb, holdings, partners, session, user, userRoles, withRls } from '@ccn/db';
import { eq, inArray, sql } from 'drizzle-orm';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth';
import { createLogger } from '../src/logger';

/**
 * Administration, proven at the HTTP boundary and at the database.
 *
 * `admin` is the only role that reads across tenants, so it is the one role
 * whose blast radius is the whole network. Two things therefore have to hold,
 * and neither is provable by reading the handlers:
 *
 *  1. Nobody but an administrator reaches /api/admin/*.
 *  2. An administrator can read every tenant and write none of them. The
 *     migration grants SELECT only, so the write refusal comes from Postgres
 *     rather than from a handler remembering not to — which is the version of
 *     that guarantee worth having.
 *
 * Runs only against a migrated Postgres (export DATABASE_URL locally; CI
 * provides one).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

const SECRET = 'x'.repeat(32);

async function signCookie(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return encodeURIComponent(`${value}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`);
}

suite('administration surface', () => {
  const handle = createDb(DATABASE_URL ?? '', { max: 4 });
  const { db } = handle;
  const tag = `admin-${Date.now()}`;

  const configFor = () =>
    loadServerConfig({
      APP_ENV: 'development',
      DATABASE_URL: DATABASE_URL ?? '',
      SUPABASE_URL: 'https://example.supabase.co',
      BETTER_AUTH_URL: 'http://localhost:3001',
      APP_WEB_ORIGIN: 'http://localhost:3000',
      BETTER_AUTH_SECRET: SECRET,
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
      OPENAI_API_KEY: 'sk-test',
      FIELD_ENCRYPTION_KEY: 'base64:key',
    });

  function app() {
    const config = configFor();
    return createApp({
      db,
      auth: createAuth(db, config),
      config,
      logger: createLogger({ level: 'error', sink: () => {} }),
    });
  }

  const ids: Record<string, string> = {};
  const cookies: Record<string, string> = {};

  async function makeUser(
    key: string,
    roles: { role: 'customer' | 'partner_operator' | 'admin'; partnerId?: string | undefined }[],
  ) {
    const [row] = await db
      .insert(user)
      .values({ name: key, email: `${tag}-${key}@x.com`, emailVerified: true })
      .returning({ id: user.id });
    const id = row?.id ?? '';
    ids[key] = id;
    for (const r of roles) {
      await db
        .insert(userRoles)
        .values({ userId: id, role: r.role, partnerId: r.partnerId ?? null })
        .onConflictDoNothing();
    }
    const token = `${tag}-${key}-token`;
    await db
      .insert(session)
      .values({ userId: id, token, expiresAt: new Date(Date.now() + 3_600_000) });
    cookies[key] = `ccn.session_token=${await signCookie(token, SECRET)}`;
  }

  beforeAll(async () => {
    await db
      .insert(partners)
      .values({ code: 'SAG', name: 'Sagicor Investments' })
      .onConflictDoNothing({ target: partners.code });
    const [sag] = await db
      .select({ id: partners.id })
      .from(partners)
      .where(eq(partners.code, 'SAG'));

    await makeUser('admin', [{ role: 'admin' }]);
    await makeUser('customer', [{ role: 'customer' }]);
    await makeUser('operator', [{ role: 'partner_operator', partnerId: sag?.id }]);
  });

  afterAll(async () => {
    const made = Object.values(ids).filter(Boolean);
    if (made.length > 0) await db.delete(user).where(inArray(user.id, made));
    await handle.client.end();
  });

  const get = (path: string, who?: string) =>
    app().request(path, { headers: who ? { cookie: cookies[who] ?? '' } : {} });

  test('an administrator resolves to the admin surface', async () => {
    const res = await get('/api/me', 'admin');
    expect(res.status).toBe(200);
    expect((await res.json()).surface).toBe('admin');
  });

  test.each([
    ['/api/admin/overview'],
    ['/api/admin/investors'],
    ['/api/admin/partners'],
    ['/api/admin/products'],
    ['/api/admin/orders'],
    ['/api/admin/audit'],
  ])('%s answers an administrator', async (path) => {
    const res = await get(path, 'admin');
    expect(res.status).toBe(200);
  });

  test.each([
    ['customer', 403],
    ['operator', 403],
  ])('a %s is refused the administration surface', async (who, status) => {
    expect((await get('/api/admin/overview', who)).status).toBe(status);
    expect((await get('/api/admin/investors', who)).status).toBe(status);
  });

  test('no cookie is 401, not 403', async () => {
    expect((await get('/api/admin/overview')).status).toBe(401);
  });

  /**
   * The point of the surface: an administrator sees rows belonging to people
   * who are not them. A guard that returned only the caller's own data would
   * pass every status-code test above and be useless.
   */
  test('an administrator reads across tenants', async () => {
    const res = await get('/api/admin/investors?limit=500', 'admin');
    const { investors } = (await res.json()) as { investors: { id: string }[] };
    const seen = new Set(investors.map((i) => i.id));
    expect(seen.has(ids.customer ?? '')).toBe(true);
    expect(seen.has(ids.operator ?? '')).toBe(true);
    expect(investors.length).toBeGreaterThan(1);
  });

  /**
   * The one write this surface has. Roles decide which product a person sees,
   * so the endpoint takes the whole set: "make this person an operator for SAG"
   * is one intention, not two edits with a window in between where they hold
   * both surfaces or neither.
   */
  const putRoles = (target: string, body: unknown, who = 'admin') =>
    app().request(`/api/admin/investors/${target}/roles`, {
      method: 'PUT',
      headers: { cookie: cookies[who] ?? '', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  test('an administrator grants and revokes an operator role', async () => {
    const target = ids.customer ?? '';
    const granted = await putRoles(target, {
      roles: ['customer', 'partner_operator'],
      partnerCode: 'SAG',
    });
    expect(granted.status).toBe(200);
    const after = (await granted.json()) as { roles: { role: string; partnerId: string | null }[] };
    const op = after.roles.find((r) => r.role === 'partner_operator');
    expect(op).toBeDefined();
    expect(op?.partnerId).toBeTruthy();

    const revoked = await putRoles(target, { roles: ['customer'] });
    expect(revoked.status).toBe(200);
    const back = (await revoked.json()) as { roles: { role: string }[] };
    expect(back.roles.map((r) => r.role)).toEqual(['customer']);
  });

  /**
   * The property the whole surface rests on: there is no path to becoming an
   * administrator except the environment variable, so a compromised admin
   * account cannot promote a second one. Refused by the API, and by the policy
   * underneath it.
   */
  test('an administrator cannot grant admin', async () => {
    const res = await putRoles(ids.customer ?? '', { roles: ['admin'] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('ADMIN_EMAILS');
  });

  test('an administrator cannot edit their own roles', async () => {
    const res = await putRoles(ids.admin ?? '', { roles: ['customer'] });
    expect(res.status).toBe(400);
  });

  /** An operator with no partner resolves to the customer surface, which would
   *  read as the grant having silently failed. */
  test('partner_operator without a resolvable partner is refused', async () => {
    expect((await putRoles(ids.customer ?? '', { roles: ['partner_operator'] })).status).toBe(400);
    expect(
      (await putRoles(ids.customer ?? '', { roles: ['partner_operator'], partnerCode: 'NOPE' }))
        .status,
    ).toBe(400);
  });

  test('a customer cannot change anyone’s roles', async () => {
    expect((await putRoles(ids.operator ?? '', { roles: ['customer'] }, 'customer')).status).toBe(
      403,
    );
  });

  /** A role change that leaves no trace would defeat the point of the surface. */
  test('a role change is written to the audit trail', async () => {
    const target = ids.operator ?? '';
    await putRoles(target, { roles: ['customer'] });
    const res = await app().request(`/api/admin/investors/${target}/activity`, {
      headers: { cookie: cookies.admin ?? '' },
    });
    expect(res.status).toBe(200);
    const { entries } = (await res.json()) as { entries: { action: string }[] };
    expect(entries.some((e) => e.action === 'user_roles.changed')).toBe(true);
  });

  /**
   * The catalog load. A freshly migrated database has no partners, and with
   * none there is no institution side of the product at all — so this is the
   * one thing an administrator has to be able to do on a new deployment, where
   * nobody has a shell to run the seed from.
   */
  const loadReference = (who = 'admin') =>
    app().request('/api/admin/reference-data', {
      method: 'POST',
      headers: { cookie: cookies[who] ?? '' },
    });

  test('an administrator loads the catalog, and twice is the same as once', async () => {
    const first = await loadReference();
    expect(first.status).toBe(200);
    const a = (await first.json()) as Record<string, number>;
    expect(a.partners).toBeGreaterThan(0);
    expect(a.instruments).toBeGreaterThan(0);

    const second = await loadReference();
    expect(second.status).toBe(200);
    // Idempotent: partners upsert on their code, everything else conflicts to
    // nothing, so pressing the button twice cannot duplicate the network.
    expect(await second.json()).toEqual(a);
  });

  test.each([['customer'], ['operator']])('a %s cannot load the catalog', async (who) => {
    expect((await loadReference(who)).status).toBe(403);
  });

  test('loading the catalog is written to the audit trail', async () => {
    await loadReference();
    const res = await get('/api/admin/audit?limit=200', 'admin');
    const { entries } = (await res.json()) as { entries: { action: string }[] };
    expect(entries.some((e) => e.action === 'reference_data.loaded')).toBe(true);
  });

  /**
   * The catalog is network-wide reference data, so 0010 opens it to `admin`
   * alone. Anyone else is refused by the policy rather than by a handler — the
   * version of that guarantee that survives a future route.
   */
  test('a customer cannot write the catalog at the database', async () => {
    const attempt = withRls(
      db,
      { userId: ids.customer ?? '', appRole: 'customer', dbRole: 'ccn_app' },
      (tx) => tx.insert(partners).values({ code: 'GK', name: 'Not allowed' }),
    );
    await expect(attempt).rejects.toThrow();
  });

  /**
   * Onboarding a partner. Until `partners.code` stopped being a database enum
   * this was impossible without a migration and a deploy — for the most
   * ordinary commercial event the company has. These prove the new code is
   * genuinely open (a code the enum never contained) and still constrained.
   */
  const onboard = (body: unknown, who = 'admin') =>
    app().request('/api/admin/partners', {
      method: 'POST',
      headers: { cookie: cookies[who] ?? '', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const NEW_CODE = `T${String(Date.now()).slice(-6)}`;

  test('an administrator onboards a partner the enum never contained', async () => {
    const res = await onboard({
      code: NEW_CODE,
      name: 'Test Capital Partners',
      kind: 'Brokerage',
      regulator: 'FSC_BARBADOS',
      agreementStatus: 'sandbox',
      residency: 'Barbados',
    });
    expect(res.status).toBe(201);
    const { partner } = (await res.json()) as { partner: Record<string, unknown> };
    expect(partner.code).toBe(NEW_CODE);
    expect(partner.regulator).toBe('FSC_BARBADOS');
    expect(partner.agreementStatus).toBe('sandbox');

    // And it is immediately usable as the thing partners exist for: something
    // an operator can be bound to.
    const granted = await putRoles(ids.customer ?? '', {
      roles: ['partner_operator'],
      partnerCode: NEW_CODE,
    });
    expect(granted.status).toBe(200);
    await putRoles(ids.customer ?? '', { roles: ['customer'] });
  });

  test('a code is unique, and shaped', async () => {
    expect((await onboard({ code: NEW_CODE, name: 'Someone else' })).status).toBe(400);
    // Too short, punctuation, too long, leading digit.
    for (const code of ['', 'x', 'A-B', 'WAYTOOLONGCODE', '1ST']) {
      expect((await onboard({ code, name: 'Test' })).status).toBe(400);
    }
  });

  /**
   * Typing it in lower case is not a mistake worth refusing — the constraint is
   * on what gets stored, and a code is uppercase there. Pinned because the form
   * uppercases as you type and the server must agree with it.
   */
  test('a code typed in lower case is stored upper case', async () => {
    const lower = `q${String(Date.now()).slice(-5)}`;
    const res = await onboard({ code: lower, name: 'Case Test' });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { partner: { code: string } }).partner.code).toBe(
      lower.toUpperCase(),
    );
  });

  test('a partner needs a name, a real regulator and a real agreement', async () => {
    expect((await onboard({ code: 'ZZTOP', name: '' })).status).toBe(400);
    expect((await onboard({ code: 'ZZTOP', name: 'Test', regulator: 'FSC_MARS' })).status).toBe(
      400,
    );
    expect((await onboard({ code: 'ZZTOP', name: 'Test', agreementStatus: 'maybe' })).status).toBe(
      400,
    );
  });

  test.each([['customer'], ['operator']])('a %s cannot onboard a partner', async (who) => {
    expect((await onboard({ code: 'ZZTOP', name: 'Test' }, who)).status).toBe(403);
  });

  /**
   * New code against a database that never got the migration.
   *
   * This is not hypothetical: production ran the onboarding form against a
   * database missing 0010's grant and answered a 500 with a stack trace, which
   * tells an administrator standing in front of the screen nothing. Postgres
   * knows exactly what is wrong; the surface should say it.
   *
   * The grant is revoked and restored around the assertion, so the rest of the
   * suite sees the database it expects either way.
   */
  test('a missing grant is reported as a pending migration, not a 500', async () => {
    // Unique per run: a code left behind by an earlier run would be refused as
    // a duplicate before the write is ever attempted, and the test would pass
    // or fail for a reason that has nothing to do with grants.
    const code = `M${String(Date.now()).slice(-6)}`;
    await db.execute(sql`REVOKE INSERT ON TABLE partners FROM ccn_app`);
    try {
      const res = await onboard({ code, name: 'Test' });
      expect(res.status).toBe(503);
      expect((await res.json()).error).toContain('missing a migration');
    } finally {
      await db.execute(sql`GRANT INSERT ON TABLE partners TO ccn_app`);
    }
    // And the same request succeeds once the grant is back, so the check is
    // reading the grant rather than anything about the request itself.
    expect((await onboard({ code, name: 'Test' })).status).toBe(201);
  });

  test('an administrator corrects a partner, and the agreement change is audited', async () => {
    const list = await get('/api/admin/partners', 'admin');
    const { partners: rows } = (await list.json()) as { partners: { id: string; code: string }[] };
    const target = rows.find((p) => p.code === NEW_CODE);
    expect(target).toBeDefined();

    const res = await app().request(`/api/admin/partners/${target?.id}`, {
      method: 'PUT',
      headers: { cookie: cookies.admin ?? '', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test Capital', agreementStatus: 'live' }),
    });
    expect(res.status).toBe(200);
    const { partner } = (await res.json()) as { partner: Record<string, unknown> };
    expect(partner.name).toBe('Test Capital');
    expect(partner.agreementStatus).toBe('live');
    // A code is an identity: correcting the record must not rewrite it.
    expect(partner.code).toBe(NEW_CODE);

    const audit = await get('/api/admin/audit?limit=200', 'admin');
    const { entries } = (await audit.json()) as { entries: { action: string }[] };
    expect(entries.some((e) => e.action === 'partner.onboarded')).toBe(true);
    expect(entries.some((e) => e.action === 'partner.changed')).toBe(true);
  });

  /**
   * Read-only everywhere else, enforced by the database rather than by
   * convention. 0008 grants admin SELECT and 0009/0010 open exactly two things
   * — a person's roles and the catalog — so this fails at the policy, which is
   * the guarantee that survives someone adding a handler here later without
   * reading the comment at the top of the file.
   */
  test('an administrator cannot write another tenant’s rows', async () => {
    const victim = ids.customer ?? '';
    const attempt = withRls(
      db,
      { userId: ids.admin ?? '', appRole: 'admin', dbRole: 'ccn_app' },
      (tx) =>
        tx.insert(holdings).values({
          userId: victim,
          connectedAccountId: victim, // never reached; the policy refuses first
          name: 'inserted by an admin',
          valueMinor: 1n,
          currency: 'USD',
        }),
    );
    await expect(attempt).rejects.toThrow();

    const rows = await db.select().from(holdings).where(eq(holdings.userId, victim));
    expect(rows.length).toBe(0);
  });
});
