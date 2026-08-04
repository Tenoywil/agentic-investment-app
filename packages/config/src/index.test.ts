import { expect, describe as group, test } from 'bun:test';
import { describe, loadServerConfig } from './index';

const valid: Record<string, string> = {
  APP_ENV: 'development',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/ccn',
  SUPABASE_URL: 'https://example.supabase.co',
  BETTER_AUTH_URL: 'http://localhost:3001',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  OPENAI_API_KEY: 'sk-test',
  FIELD_ENCRYPTION_KEY: 'base64:key',
};

group('loadServerConfig', () => {
  test('parses a valid environment and applies defaults', () => {
    const cfg = loadServerConfig(valid);
    expect(cfg.OPENAI_BASE_URL).toBe('https://ht.getimpala.ai/v1');
    expect(cfg.AI_MODEL).toBe('MiniMax');
    expect(cfg.SUPABASE_STORAGE_BUCKET).toBe('ccn-private');
  });

  test('throws with a readable report on a short auth secret', () => {
    expect(() => loadServerConfig({ ...valid, BETTER_AUTH_SECRET: 'short' })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  test('throws when a required secret is missing', () => {
    const { OPENAI_API_KEY, ...missing } = valid;
    expect(() => loadServerConfig(missing)).toThrow(/OPENAI_API_KEY/);
  });

  test('describe() redacts secret values', () => {
    const view = describe(loadServerConfig(valid));
    expect(view.OPENAI_API_KEY).toBe('***');
    expect(view.BETTER_AUTH_SECRET).toBe('***');
    expect(view.OPENAI_BASE_URL).toBe('https://ht.getimpala.ai/v1');
  });
});
