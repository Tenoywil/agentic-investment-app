import { describe, expect, test } from 'bun:test';
import { loadServerConfig } from '@ccn/config';
import { createDb } from '@ccn/db';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth';

/**
 * App-surface tests that don't require a live database: /health is public, and
 * /api/me rejects an unauthenticated request before any query runs.
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
const { db } = createDb(config.DATABASE_URL);
const app = createApp({ db, auth: createAuth(db, config), config });

describe('api app', () => {
  test('GET /health is public and ok', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });

  test('GET /api/me requires authentication', async () => {
    const res = await app.request('/api/me');
    expect(res.status).toBe(401);
  });
});
