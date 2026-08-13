import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { loadServerConfig } from '@ccn/config';
import { createDb, session, user } from '@ccn/db';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import { createAuth, resolveAuthBaseUrl } from '../src/auth';
import { createLogger } from '../src/logger';

/**
 * The authenticated path through sessionMiddleware -> requireAuth, end to end:
 * a real signed Better Auth cookie against a real session row, resolving to a
 * real tenant scope.
 *
 * This existed as a gap for a long time and a production outage came through
 * it: every other suite reaches past auth by calling withTenant directly, and
 * app.test.ts only ever asserts the 401, so nothing anywhere proved a VALID
 * cookie is actually accepted. A change to cookie naming or attributes could
 * (and did) log every user out in production with a green test suite.
 *
 * The production case matters as much as the development one because
 * `useSecureCookies` flips the cookie's name (`__Secure-` prefix) — a cookie
 * minted under one setting is invisible under the other, and the failure is
 * silent: the server simply sees no session and answers 401.
 *
 * Runs only against a migrated Postgres (export DATABASE_URL locally; CI
 * provides one).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

const SECRET = 'x'.repeat(32);

function baseConfig(overrides: Record<string, string>) {
  return loadServerConfig({
    DATABASE_URL: DATABASE_URL ?? '',
    SUPABASE_URL: 'https://example.supabase.co',
    BETTER_AUTH_SECRET: SECRET,
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    OPENAI_API_KEY: 'sk-test',
    FIELD_ENCRYPTION_KEY: 'base64:key',
    ...overrides,
  });
}

/**
 * Reproduce Better Auth's signed-cookie format: HMAC-SHA256 the token with the
 * auth secret, append it after a dot, then URL-encode the pair. Inlined rather
 * than imported from `better-call` (a transitive dependency) so the test breaks
 * loudly if the real format ever diverges, instead of silently tracking it.
 */
async function signCookie(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return encodeURIComponent(`${value}.${b64}`);
}

suite('authenticated session', () => {
  const handle = createDb(DATABASE_URL ?? '', { max: 4 });
  const { db } = handle;
  const tag = `authsession-${Date.now()}`;

  let userId = '';
  const token = `${tag}-token`;

  beforeAll(async () => {
    const rows = await db
      .insert(user)
      .values({ name: 'Session User', email: `${tag}@x.com`, emailVerified: true })
      .returning({ id: user.id });
    userId = rows[0]?.id ?? '';

    await db.insert(session).values({
      userId,
      token,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
  });

  afterAll(async () => {
    await db.delete(session).where(eq(session.userId, userId));
    await db.delete(user).where(eq(user.id, userId));
    await handle.client.end({ timeout: 5 });
  });

  function appFor(config: ReturnType<typeof baseConfig>) {
    const logger = createLogger({ level: 'error', sink: () => {} });
    return createApp({ db, auth: createAuth(db, config), config, logger });
  }

  test('a valid signed cookie authenticates (development cookie name)', async () => {
    const config = baseConfig({
      APP_ENV: 'development',
      BETTER_AUTH_URL: 'http://localhost:3001',
      APP_WEB_ORIGIN: 'http://localhost:3000',
    });
    const app = appFor(config);
    const cookie = `ccn.session_token=${await signCookie(token, SECRET)}`;

    const res = await app.request('/api/me', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: { id: userId } });
  });

  test('a valid signed cookie authenticates (production __Secure- cookie name)', async () => {
    const config = baseConfig({
      APP_ENV: 'production',
      BETTER_AUTH_URL: 'https://app.example.com',
      APP_WEB_ORIGIN: 'https://app.example.com',
    });
    const app = appFor(config);
    const cookie = `__Secure-ccn.session_token=${await signCookie(token, SECRET)}`;

    const res = await app.request('/api/me', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: { id: userId } });
  });

  test('the unprefixed cookie is NOT accepted in production', async () => {
    // The exact production failure: a cookie minted while useSecureCookies was
    // off is invisible once it is on. Pinned so the asymmetry stays deliberate.
    const config = baseConfig({
      APP_ENV: 'production',
      BETTER_AUTH_URL: 'https://app.example.com',
      APP_WEB_ORIGIN: 'https://app.example.com',
    });
    const app = appFor(config);
    const cookie = `ccn.session_token=${await signCookie(token, SECRET)}`;

    const res = await app.request('/api/me', { headers: { cookie } });
    expect(res.status).toBe(401);
  });

  test('a tampered signature is rejected', async () => {
    const config = baseConfig({
      APP_ENV: 'development',
      BETTER_AUTH_URL: 'http://localhost:3001',
      APP_WEB_ORIGIN: 'http://localhost:3000',
    });
    const app = appFor(config);
    const cookie = `ccn.session_token=${await signCookie(token, 'y'.repeat(32))}`;

    const res = await app.request('/api/me', { headers: { cookie } });
    expect(res.status).toBe(401);
  });
});

/**
 * The baseURL invariant, tested without a database.
 *
 * `baseURL` decides where Google sends the browser back and therefore which
 * domain the session cookie belongs to. In production the browser is always on
 * the web origin, because /api/* is proxied there — so pointing it at the API's
 * own hostname sets the cookie on a domain the web app cannot read, and every
 * request after a successful sign-in is anonymous. That is not a hypothetical:
 * it is the shape of the outage this test exists to prevent.
 */
describe('auth baseURL resolution', () => {
  const base = {
    APP_WEB_ORIGIN: 'https://app.example.com',
    BETTER_AUTH_URL: 'https://api.example.com',
  } as unknown as Parameters<typeof resolveAuthBaseUrl>[0];

  test('production ignores a BETTER_AUTH_URL that is not the web origin', () => {
    const r = resolveAuthBaseUrl({ ...base, APP_ENV: 'production' });
    expect(r.baseURL).toBe('https://app.example.com');
    expect(r.overridden).toBe(true);
  });

  test('production leaves a matching value alone', () => {
    const r = resolveAuthBaseUrl({
      ...base,
      APP_ENV: 'production',
      BETTER_AUTH_URL: 'https://app.example.com',
    });
    expect(r.baseURL).toBe('https://app.example.com');
    expect(r.overridden).toBe(false);
  });

  test('development keeps them separate — dev talks to the API directly, unproxied', () => {
    const r = resolveAuthBaseUrl({ ...base, APP_ENV: 'development' });
    expect(r.baseURL).toBe('https://api.example.com');
    expect(r.overridden).toBe(false);
  });
});
