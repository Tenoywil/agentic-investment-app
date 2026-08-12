import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { loadServerConfig } from '@ccn/config';
import { createDb, partners, session, user, userRoles } from '@ccn/db';
import { eq, inArray } from 'drizzle-orm';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth';
import { createLogger } from '../src/logger';

/**
 * The customer/institution split, proven at the HTTP boundary.
 *
 * CCN is two products behind one sign-in and a user must never reach the other
 * one. Before this, the separation ran one way only: `/api/console/*` checked
 * for `partner_operator`, but every customer route carried `requireAuth` alone,
 * so an operator could read the entire customer product. Nothing caught it
 * because nothing tested it.
 *
 * The last case is the important one — it enumerates the live routing table
 * rather than a hand-written list of paths, so a route added next week is
 * covered automatically instead of quietly shipping unguarded.
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

suite('customer / institution surface split', () => {
  const handle = createDb(DATABASE_URL ?? '', { max: 4 });
  const { db } = handle;
  const tag = `split-${Date.now()}`;

  // Built lazily: `describe.skip` still evaluates this callback, so an eager
  // loadServerConfig would throw on the empty DATABASE_URL in the no-DB CI job.
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

  /** A user with the given roles, a live session, and its signed cookie. */
  async function makeUser(
    key: string,
    roles: { role: 'customer' | 'partner_operator'; partnerId?: string | undefined }[],
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

    await makeUser('customerOnly', [{ role: 'customer' }]);
    await makeUser('operatorOnly', [{ role: 'partner_operator', partnerId: sag?.id }]);
    await makeUser('bothRoles', [
      { role: 'customer' },
      { role: 'partner_operator', partnerId: sag?.id },
    ]);
    // Deliberately no roles: provisioning grants `customer` on first request.
    await makeUser('noRoles', []);
    // An operator with no partner binding must fail closed to the customer side.
    await makeUser('unboundOperator', [{ role: 'partner_operator' }]);
  });

  afterAll(async () => {
    const all = Object.values(ids);
    if (all.length > 0) {
      await db.delete(session).where(inArray(session.userId, all));
      await db.delete(userRoles).where(inArray(userRoles.userId, all));
      await db.delete(user).where(inArray(user.id, all));
    }
    await handle.client.end({ timeout: 5 });
  });

  const CUSTOMER_ROUTE = '/api/portfolio';
  const CONSOLE_ROUTE = '/api/console/kpis';

  test.each([
    ['customerOnly', 'customer', 200, 403],
    ['operatorOnly', 'institution', 403, 200],
    ['bothRoles', 'institution', 403, 200],
    ['noRoles', 'customer', 200, 403],
    ['unboundOperator', 'customer', 200, 403],
  ] as const)('%s → %s surface', async (key, surface, customerStatus, consoleStatus) => {
    const a = app();
    const me = await a.request('/api/me', { headers: { cookie: cookies[key] ?? '' } });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { surface: string }).surface).toBe(surface);

    const cust = await a.request(CUSTOMER_ROUTE, { headers: { cookie: cookies[key] ?? '' } });
    expect(cust.status).toBe(customerStatus);

    const cons = await a.request(CONSOLE_ROUTE, { headers: { cookie: cookies[key] ?? '' } });
    expect(cons.status).toBe(consoleStatus);
  });

  test('no cookie is 401 everywhere', async () => {
    const a = app();
    for (const path of ['/api/me', CUSTOMER_ROUTE, CONSOLE_ROUTE]) {
      expect((await a.request(path)).status).toBe(401);
    }
  });

  test('every /api route rejects the wrong surface', async () => {
    const a = app();
    // Enumerate the real routing table so a route added later is covered without
    // anyone remembering to extend a list here.
    const paths = [
      ...new Set(
        a.routes
          .map((r) => r.path)
          .filter((p) => p.startsWith('/api/'))
          .filter((p) => !p.startsWith('/api/auth'))
          .filter((p) => !p.includes('*') && !p.includes(':')),
      ),
    ];
    expect(paths.length).toBeGreaterThan(5);

    for (const path of paths) {
      const isConsole = path.startsWith('/api/console');
      // /api/me is intentionally reachable by both surfaces — it is how the
      // client learns which one it is on.
      if (path === '/api/me') continue;

      const wrong = isConsole ? 'customerOnly' : 'operatorOnly';
      const res = await a.request(path, { headers: { cookie: cookies[wrong] ?? '' } });
      expect(
        [401, 403, 404, 405].includes(res.status),
        `${path} allowed the wrong surface (${res.status})`,
      ).toBe(true);
    }
  });
});
