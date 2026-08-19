import { describe, expect, test } from 'bun:test';
import { loadServerConfig } from '@ccn/config';
import { createDb } from '@ccn/db';
import { Hono } from 'hono';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth';
import { type LogRecord, createLogger } from '../src/logger';
import { bigintSafeJson } from '../src/middleware';

/**
 * App-surface tests that don't require a live database: the public probe, the
 * unauthenticated rejection, and the hardening middleware (request id, structured
 * logging, rate limiting) which all run before any query.
 */
const config = loadServerConfig({
  APP_ENV: 'development',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/ccn',
  SUPABASE_URL: 'https://example.supabase.co',
  BETTER_AUTH_URL: 'http://localhost:3001',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  OPENAI_API_KEY: 'sk-test',
  FIELD_ENCRYPTION_KEY: 'base64:key',
});

/** Build an app whose log records are captured rather than printed. */
function appWithCapturedLogs() {
  const records: LogRecord[] = [];
  const { db } = createDb(config.DATABASE_URL);
  const logger = createLogger({ level: 'debug', sink: (record) => records.push(record) });
  const app = createApp({ db, auth: createAuth(db, config), config, logger });
  return { app, records };
}

describe('api app', () => {
  test('GET /health is public and ok', async () => {
    const { app } = appWithCapturedLogs();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });

  test('GET /api/me requires authentication', async () => {
    const { app } = appWithCapturedLogs();
    const res = await app.request('/api/me');
    expect(res.status).toBe(401);
  });

  test('keeps migration and deployment details out of public errors', async () => {
    const { app, records } = appWithCapturedLogs();
    app.get('/test/database-behind', () => {
      throw Object.assign(new Error('function partner_webhook_upsert does not exist'), {
        code: '42883',
      });
    });

    const res = await app.request('/test/database-behind');
    const body = (await res.json()) as { error: string; code: string; reference: string };
    const requestId = res.headers.get('x-request-id');
    if (!requestId) throw new Error('response did not include a request id');

    expect(res.status).toBe(503);
    expect(body.code).toBe('service_temporarily_unavailable');
    expect(body.reference).toBe(requestId);
    expect(body.error).toContain(body.reference);
    expect(body.error).not.toMatch(/database|migration|deploy|environment|CCN/i);
    expect(records.some((record) => record.message.includes('migration'))).toBe(true);
  });

  test('unexpected failures use safe public copy and a traceable reference', async () => {
    const { app, records } = appWithCapturedLogs();
    app.get('/test/unexpected-error', () => {
      throw new Error('sensitive internal detail');
    });

    const res = await app.request('/test/unexpected-error');
    const body = (await res.json()) as { error: string; code: string; reference: string };
    const requestId = res.headers.get('x-request-id');
    if (!requestId) throw new Error('response did not include a request id');

    expect(res.status).toBe(500);
    expect(body.code).toBe('request_failed');
    expect(body.reference).toBe(requestId);
    expect(body.error).toContain(body.reference);
    expect(body.error).not.toContain('sensitive internal detail');
    expect(records.some((record) => record.message === 'unhandled error')).toBe(true);
  });
});

describe('request correlation', () => {
  test('every response carries a unique x-request-id', async () => {
    const { app } = appWithCapturedLogs();
    const first = await app.request('/health');
    const second = await app.request('/health');

    const a = first.headers.get('x-request-id');
    const b = second.headers.get('x-request-id');
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });

  test('an inbound request id is not trusted', async () => {
    const { app } = appWithCapturedLogs();
    const res = await app.request('/health', { headers: { 'x-request-id': 'attacker-supplied' } });
    expect(res.headers.get('x-request-id')).not.toBe('attacker-supplied');
  });

  test('logs one structured line per request with status and duration', async () => {
    const { app, records } = appWithCapturedLogs();
    await app.request('/health');

    const line = records.find((record) => record.message === 'request');
    expect(line).toBeDefined();
    expect(line?.level).toBe('info');
    expect(line?.status).toBe(200);
    expect(line?.method).toBe('GET');
    expect(typeof line?.requestId).toBe('string');
    expect(typeof line?.durationMs).toBe('number');
  });
});

describe('bigintSafeJson', () => {
  // A regression test for a real bug: Drizzle's bigint-mode money columns
  // (moneyMinor) come back as native JS BigInt, and Hono's c.json() calls raw
  // JSON.stringify, which throws on BigInt — confirmed by reproducing it
  // against real gateway_opportunities rows before this fix existed. Every
  // route that returns a raw money-bearing row (orders, approvals, the
  // console's order list, every Gateway mandate/opportunity/match endpoint)
  // depends on this middleware to not 500.
  const app = new Hono();
  app.use('*', bigintSafeJson());
  app.get('/plain-bigint', (c) => c.json({ amountMinor: 123_456_789_012_345n }));
  app.get('/nested', (c) =>
    c.json({
      opportunity: { capitalSoughtMinor: 25_000_00n, name: 'Solar Co-op' },
      matches: [{ score: '0.87', opportunity: { valuationMinor: null } }],
    }),
  );
  app.get('/no-bigint', (c) => c.json({ ok: true, count: 3, tag: 'x' }));

  test('a top-level bigint is stringified, not thrown', async () => {
    const res = await app.request('/plain-bigint');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ amountMinor: '123456789012345' });
  });

  test('bigints nested in objects and arrays are all stringified', async () => {
    const res = await app.request('/nested');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      opportunity: { capitalSoughtMinor: '2500000', name: 'Solar Co-op' },
      matches: [{ score: '0.87', opportunity: { valuationMinor: null } }],
    });
  });

  test('a response with no bigints is unaffected', async () => {
    const res = await app.request('/no-bigint');
    expect(await res.json()).toEqual({ ok: true, count: 3, tag: 'x' });
  });
});

describe('rate limiting', () => {
  test('auth routes refuse a flood with 429 and Retry-After', async () => {
    const { app } = appWithCapturedLogs();
    // The auth bucket is capacity 10; the 11th within the same instant is refused.
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await app.request('/api/auth/anything');
      statuses.push(res.status);
    }
    const limited = statuses.filter((status) => status === 429);
    expect(limited.length).toBeGreaterThan(0);

    const res = await app.request('/api/auth/anything');
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await res.json()).toMatchObject({ error: 'rate limit exceeded' });
  });

  test('the health probe is never rate limited', async () => {
    const { app } = appWithCapturedLogs();
    for (let i = 0; i < 50; i++) {
      expect((await app.request('/health')).status).toBe(200);
    }
  });

  test('separate route classes hold independent budgets', async () => {
    const { app } = appWithCapturedLogs();
    // Exhaust auth (capacity 10)...
    for (let i = 0; i < 12; i++) await app.request('/api/auth/anything');
    expect((await app.request('/api/auth/anything')).status).toBe(429);

    // ...the portfolio budget is untouched, so this is an auth failure, not a 429.
    expect((await app.request('/api/portfolio')).status).not.toBe(429);
  });
});
