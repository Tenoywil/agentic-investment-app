import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { loadServerConfig } from '@ccn/config';
import {
  connectedAccounts,
  createDb,
  holdings,
  instruments,
  partners,
  session,
  user,
} from '@ccn/db';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth';
import { createLogger } from '../src/logger';

/**
 * GET /api/portfolio, driven through the real authenticated stack.
 *
 * The allocation breakdown specifically: the home and portfolio screens used to
 * render a hardcoded array of percentages, which on a live account meant showing
 * a signed-in user an invented breakdown of their own money. It is now derived
 * from holdings joined to their instrument, so it needs a test that would fail
 * if it silently reverted to constants — a screen reading plausible-but-fake
 * numbers is not something a build or a typecheck can catch.
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

suite('portfolio allocation', () => {
  const handle = createDb(DATABASE_URL ?? '', { max: 4 });
  const { db } = handle;
  const tag = `portfolio-${Date.now()}`;
  const token = `${tag}-token`;

  let userId = '';
  let cookie = '';

  // Built lazily, not at describe-body scope: `describe.skip` still evaluates
  // its callback, so an eager loadServerConfig would throw on the empty
  // DATABASE_URL in the no-database CI job and error the whole suite.
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

  beforeAll(async () => {
    const [u] = await db
      .insert(user)
      .values({ name: 'Portfolio User', email: `${tag}@x.com`, emailVerified: true })
      .returning({ id: user.id });
    userId = u?.id ?? '';
    await db.insert(session).values({
      userId,
      token,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    cookie = `ccn.session_token=${await signCookie(token, SECRET)}`;

    await db
      .insert(partners)
      .values({ code: 'NCB', name: 'National Commercial Bank' })
      .onConflictDoNothing({ target: partners.code });
    const [p] = await db.select({ id: partners.id }).from(partners).where(eq(partners.code, 'NCB'));

    const [acct] = await db
      .insert(connectedAccounts)
      .values({ userId, partnerId: p?.id ?? '', label: 'NCB' })
      .returning({ id: connectedAccounts.id });

    const [bond] = await db
      .insert(instruments)
      .values({
        slug: `${tag}-bond`,
        abbr: 'BND',
        type: 'bond',
        partnerId: p?.id ?? '',
        risk: 'low',
        name: 'Test Bond',
        minInvestmentMinor: 1_000n,
        blocked: false,
      })
      .returning({ id: instruments.id });

    const [eq_] = await db
      .insert(instruments)
      .values({
        slug: `${tag}-equity`,
        abbr: 'EQT',
        type: 'equity',
        partnerId: p?.id ?? '',
        risk: 'high',
        name: 'Test Equity',
        minInvestmentMinor: 1_000n,
        blocked: false,
      })
      .returning({ id: instruments.id });

    // 750 bond + 250 equity = 1000 total -> 75% / 25%.
    await db.insert(holdings).values([
      {
        userId,
        connectedAccountId: acct?.id ?? '',
        instrumentId: bond?.id ?? null,
        name: 'Bond position',
        valueMinor: 75_000n,
      },
      {
        userId,
        connectedAccountId: acct?.id ?? '',
        instrumentId: eq_?.id ?? null,
        name: 'Equity position',
        valueMinor: 25_000n,
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(holdings).where(eq(holdings.userId, userId));
    await db.delete(connectedAccounts).where(eq(connectedAccounts.userId, userId));
    await db.delete(session).where(eq(session.userId, userId));
    await db.delete(user).where(eq(user.id, userId));
    await handle.client.end({ timeout: 5 });
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

  test('allocation is derived from real holdings, not a constant', async () => {
    const res = await app().request('/api/portfolio', { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      allocation: { type: string; label: string; pct: number }[];
    };

    const byType = Object.fromEntries(body.allocation.map((a) => [a.type, a]));
    expect(byType.bond?.pct).toBe(75);
    expect(byType.equity?.pct).toBe(25);
    expect(byType.bond?.label).toBe('Fixed income');
    expect(byType.equity?.label).toBe('Equities');
  });

  test('allocation is sorted by value, largest first', async () => {
    const res = await app().request('/api/portfolio', { headers: { cookie } });
    const body = (await res.json()) as { allocation: { pct: number }[] };
    const pcts = body.allocation.map((a) => a.pct);
    expect(pcts).toEqual([...pcts].sort((a, b) => b - a));
  });

  test('another user sees none of these holdings (RLS)', async () => {
    const otherTag = `${tag}-other`;
    const [other] = await db
      .insert(user)
      .values({ name: 'Other', email: `${otherTag}@x.com`, emailVerified: true })
      .returning({ id: user.id });
    const otherToken = `${otherTag}-token`;
    await db.insert(session).values({
      userId: other?.id ?? '',
      token: otherToken,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const res = await app().request('/api/portfolio', {
      headers: { cookie: `ccn.session_token=${await signCookie(otherToken, SECRET)}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { allocation: unknown[]; netWorthMinor: string };
    expect(body.allocation).toEqual([]);
    expect(body.netWorthMinor).toBe('0');

    await db.delete(session).where(eq(session.userId, other?.id ?? ''));
    await db.delete(user).where(eq(user.id, other?.id ?? ''));
  });
});
