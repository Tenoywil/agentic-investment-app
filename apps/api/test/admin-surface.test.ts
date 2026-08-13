import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { loadServerConfig } from '@ccn/config';
import { createDb, holdings, partners, session, user, userRoles, withRls } from '@ccn/db';
import { eq, inArray } from 'drizzle-orm';
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
   * Read-only, enforced by the database rather than by convention. The
   * migration grants admin SELECT and nothing else, so this fails at the
   * policy — which is the guarantee that survives someone adding a handler
   * here later without reading the comment at the top of the file.
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
