import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { loadServerConfig } from '@ccn/config';
import { auditLog, createDb, limits, session, user } from '@ccn/db';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createAuth } from '../src/auth';
import type { AppEnv } from '../src/context';
import { createLogger } from '../src/logger';
import { bigintSafeJson, sessionMiddleware } from '../src/middleware';
import { limitsRoutes, parseLimitsUpdate } from '../src/routes/limits';

/**
 * GET/PUT /api/limits — the guardrail policy the deterministic Limits Engine
 * reads on every proposal.
 *
 * This route is what stops the agent screen's toggles from being decorative:
 * they used to mutate React state over a client-side constant while the server
 * enforced whatever was in the `limits` table, so the switches could disagree
 * with the rules being applied to real money and nothing in the product would
 * say so. The cases below are the ones a screenshot can't catch — the defaults
 * a brand-new account sees, that a write actually lands, that it is audited
 * with before/after, and that one user cannot read or move another's limits.
 *
 * Mounted here directly: `apps/api/src/app.ts` does not yet route
 * `/api/limits`, so this suite composes the same middleware chain (session ->
 * requireAuth -> routes) around the router under test.
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

interface LimitsBody {
  limits: {
    autoInvestCapMinor: string;
    autoInvestEnabled: boolean;
    cashFloorMinor: string;
    cashFloorEnabled: boolean;
    fxSpreadMaxBps: number;
    requireApprovalAboveMinor: string;
    singlePositionMaxPct: number;
    dailyCapMinor: string | null;
    dailyCapEnabled: boolean;
  };
  updatedAt: string | null;
  source: 'saved' | 'defaults';
}

describe('parseLimitsUpdate', () => {
  test('accepts minor units as digit strings and as integers', () => {
    const parsed = parseLimitsUpdate({ autoInvestCapMinor: '75000', cashFloorMinor: 2500 });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.autoInvestCapMinor).toBe(75_000n);
      expect(parsed.value.cashFloorMinor).toBe(2_500n);
    }
  });

  test('rejects floats, negatives and non-numeric strings', () => {
    for (const bad of [1.5, -1, 'lots', {}]) {
      expect(parseLimitsUpdate({ autoInvestCapMinor: bad }).ok).toBe(false);
    }
  });

  test('rejects amounts that cannot be represented safely or stored as bigint', () => {
    expect(parseLimitsUpdate({ autoInvestCapMinor: Number.MAX_SAFE_INTEGER + 1 }).ok).toBe(false);
    expect(parseLimitsUpdate({ autoInvestCapMinor: '9223372036854775808' }).ok).toBe(false);
    expect(parseLimitsUpdate({ autoInvestCapMinor: '9223372036854775807' }).ok).toBe(true);
  });

  test('rejects an out-of-range percentage and spread', () => {
    expect(parseLimitsUpdate({ singlePositionMaxPct: 0 }).ok).toBe(false);
    expect(parseLimitsUpdate({ singlePositionMaxPct: 101 }).ok).toBe(false);
    expect(parseLimitsUpdate({ fxSpreadMaxBps: -1 }).ok).toBe(false);
    expect(parseLimitsUpdate({ singlePositionMaxPct: 15 }).ok).toBe(true);
  });

  test('rejects a body with nothing recognised in it', () => {
    expect(parseLimitsUpdate({}).ok).toBe(false);
    expect(parseLimitsUpdate({ nonsense: true }).ok).toBe(false);
    expect(parseLimitsUpdate(null).ok).toBe(false);
    expect(parseLimitsUpdate([1]).ok).toBe(false);
  });

  test('accepts a null daily cap (clearing it) but not a garbled one', () => {
    const cleared = parseLimitsUpdate({ dailyCapMinor: null });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.value.dailyCapMinor).toBeNull();
    expect(parseLimitsUpdate({ dailyCapMinor: 'none' }).ok).toBe(false);
  });
});

suite('GET/PUT /api/limits', () => {
  const handle = createDb(DATABASE_URL ?? '', { max: 4 });
  const { db } = handle;
  const tag = `limits-${Date.now()}`;

  let userId = '';
  let otherId = '';
  let cookie = '';
  let otherCookie = '';

  // Built lazily: describe.skip still evaluates its callback, so an eager
  // loadServerConfig would throw on the empty DATABASE_URL in the no-database
  // CI job and error the whole suite.
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

  /**
   * The route under test behind the real session middleware. app.ts is the
   * composition root and does not mount /api/limits yet; when it does, this
   * mirrors the chain it will sit in.
   */
  function app() {
    const config = configFor();
    const deps = {
      db,
      auth: createAuth(db, config),
      config,
      logger: createLogger({ level: 'error', sink: () => {} }),
    };
    const api = new Hono<AppEnv>();
    api.use('*', bigintSafeJson());
    api.use('/api/*', sessionMiddleware(deps));
    api.route('/api/limits', limitsRoutes(deps));
    return api;
  }

  beforeAll(async () => {
    const users = await db
      .insert(user)
      .values([
        { name: 'Limits One', email: `${tag}-1@x.com`, emailVerified: true },
        { name: 'Limits Two', email: `${tag}-2@x.com`, emailVerified: true },
      ])
      .returning({ id: user.id });
    userId = users[0]?.id ?? '';
    otherId = users[1]?.id ?? '';

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db.insert(session).values([
      { userId, token: `${tag}-1-token`, expiresAt },
      { userId: otherId, token: `${tag}-2-token`, expiresAt },
    ]);
    cookie = `ccn.session_token=${await signCookie(`${tag}-1-token`, SECRET)}`;
    otherCookie = `ccn.session_token=${await signCookie(`${tag}-2-token`, SECRET)}`;
  });

  afterAll(async () => {
    for (const id of [userId, otherId]) {
      await db.delete(limits).where(eq(limits.userId, id));
      await db.delete(session).where(eq(session.userId, id));
      await db.delete(user).where(eq(user.id, id));
    }
    await handle.close();
  });

  test('rejects an anonymous caller', async () => {
    expect((await app().request('/api/limits')).status).toBe(401);
    const put = await app().request('/api/limits', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ autoInvestEnabled: false }),
    });
    expect(put.status).toBe(401);
  });

  test('a user with no row gets the engine defaults, labelled as defaults', async () => {
    const res = await app().request('/api/limits', { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as LimitsBody;

    expect(body.source).toBe('defaults');
    expect(body.updatedAt).toBeNull();
    // Money is bigint minor units, serialised as strings.
    expect(body.limits.autoInvestCapMinor).toBe('50000');
    expect(body.limits.cashFloorMinor).toBe('100000');
    expect(body.limits.requireApprovalAboveMinor).toBe('100000');
    expect(body.limits.fxSpreadMaxBps).toBe(30);
    expect(body.limits.singlePositionMaxPct).toBe(15);
    expect(body.limits.dailyCapMinor).toBeNull();
    expect(body.limits.dailyCapEnabled).toBe(false);
  });

  test('a partial update persists, and only the fields sent change', async () => {
    const res = await app().request('/api/limits', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ autoInvestCapMinor: '250000', fxSpreadEnabled: false }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as LimitsBody;
    expect(body.source).toBe('saved');
    expect(body.updatedAt).not.toBeNull();
    expect(body.limits.autoInvestCapMinor).toBe('250000');
    // Untouched rules keep the values the engine was already applying.
    expect(body.limits.cashFloorMinor).toBe('100000');
    expect(body.limits.cashFloorEnabled).toBe(true);

    const after = (await (
      await app().request('/api/limits', { headers: { cookie } })
    ).json()) as LimitsBody;
    expect(after.limits.autoInvestCapMinor).toBe('250000');
    expect(after.source).toBe('saved');

    // And the row the Limits Engine reads actually moved.
    const [row] = await db.select().from(limits).where(eq(limits.userId, userId));
    expect(row?.autoInvestCapMinor).toBe(250_000n);
    expect(row?.fxSpreadEnabled).toBe(false);
  });

  test('a write appends an audit row carrying before and after', async () => {
    await app().request('/api/limits', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ singlePositionMaxPct: 25 }),
    });

    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.userId, userId), eq(auditLog.action, 'limits.updated')));
    const entry = rows.at(-1);
    expect(entry).toBeDefined();
    expect(entry?.entityType).toBe('limits');
    expect(entry?.entityId).toBe(userId);
    const detail = entry?.detail as {
      changed: string[];
      before: { singlePositionMaxPct: number };
      after: { singlePositionMaxPct: number };
    };
    expect(detail.changed).toEqual(['singlePositionMaxPct']);
    expect(detail.before.singlePositionMaxPct).toBe(15);
    expect(detail.after.singlePositionMaxPct).toBe(25);
  });

  test('enabling the daily cap without an amount is refused', async () => {
    const res = await app().request('/api/limits', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ dailyCapEnabled: true }),
    });
    expect(res.status).toBe(400);

    const [row] = await db.select().from(limits).where(eq(limits.userId, userId));
    expect(row?.dailyCapEnabled).toBe(false);
  });

  test('an invalid amount is refused before it reaches the database', async () => {
    const res = await app().request('/api/limits', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ autoInvestCapMinor: -5 }),
    });
    expect(res.status).toBe(400);
    const [row] = await db.select().from(limits).where(eq(limits.userId, userId));
    expect(row?.autoInvestCapMinor).toBe(250_000n);
  });

  test('another user neither sees nor inherits these limits (RLS)', async () => {
    const res = await app().request('/api/limits', { headers: { cookie: otherCookie } });
    const body = (await res.json()) as LimitsBody;
    expect(body.source).toBe('defaults');
    expect(body.limits.autoInvestCapMinor).toBe('50000');

    // Their own write creates their own row and leaves the first user's alone.
    await app().request('/api/limits', {
      method: 'PUT',
      headers: { cookie: otherCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ autoInvestCapMinor: '1' }),
    });
    const [mine] = await db.select().from(limits).where(eq(limits.userId, userId));
    expect(mine?.autoInvestCapMinor).toBe(250_000n);
  });
});
