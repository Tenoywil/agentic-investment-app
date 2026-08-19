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
    expect(cfg.OPENAI_BASE_URL).toBe('https://api.minimax.io/v1');
    expect(cfg.AI_MODEL).toBe('MiniMax-M2');
    expect(cfg.SUPABASE_STORAGE_BUCKET).toBe('ccn-private');
    expect(cfg.PARTNER_WEBHOOK_ALLOWED_HOSTS).toEqual([]);
    expect(cfg.PARTNER_WEBHOOK_TIMEOUT_MS).toBe(5_000);
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

  test('accepts MINIMAX_SECRET as an alias for the gateway key', () => {
    const { OPENAI_API_KEY, ...rest } = valid;
    const cfg = loadServerConfig({ ...rest, MINIMAX_SECRET: 'sk-minimax' });
    expect(cfg.OPENAI_API_KEY).toBe('sk-minimax');
  });

  test('an explicit OPENAI_API_KEY wins over MINIMAX_SECRET', () => {
    const cfg = loadServerConfig({ ...valid, MINIMAX_SECRET: 'sk-alias' });
    expect(cfg.OPENAI_API_KEY).toBe('sk-test');
  });

  test('does not mutate the caller env when applying the alias', () => {
    const { OPENAI_API_KEY, ...rest } = valid;
    const env = { ...rest, MINIMAX_SECRET: 'sk-minimax' };
    loadServerConfig(env);
    expect('OPENAI_API_KEY' in env).toBe(false);
  });

  test('describe() redacts secret values', () => {
    const view = describe(loadServerConfig(valid));
    expect(view.OPENAI_API_KEY).toBe('***');
    expect(view.BETTER_AUTH_SECRET).toBe('***');
    expect(view.OPENAI_BASE_URL).toBe('https://api.minimax.io/v1');
  });

  test('gateway tier overrides default to empty (fall back to AI_MODEL downstream)', () => {
    const cfg = loadServerConfig(valid);
    expect(cfg.GATEWAY_MODEL_HIGH).toBe('');
    expect(cfg.GATEWAY_MODEL_GENERAL).toBe('');
    expect(cfg.GATEWAY_MODEL_LOW).toBe('');
  });

  test('gateway tier overrides are honored when set', () => {
    const cfg = loadServerConfig({ ...valid, GATEWAY_MODEL_HIGH: 'big-model' });
    expect(cfg.GATEWAY_MODEL_HIGH).toBe('big-model');
  });

  test('normalizes an exact partner webhook host allowlist', () => {
    const cfg = loadServerConfig({
      ...valid,
      PARTNER_WEBHOOK_ALLOWED_HOSTS: 'Hooks.Example.com., events.bank.example, hooks.example.com',
    });
    expect(cfg.PARTNER_WEBHOOK_ALLOWED_HOSTS).toEqual(['hooks.example.com', 'events.bank.example']);
  });

  test('rejects webhook host entries that smuggle URL syntax', () => {
    for (const value of [
      'https://hooks.example.com',
      'hooks.example.com/path',
      'user@hooks.example.com',
      'hooks.example.com:443',
    ]) {
      expect(() => loadServerConfig({ ...valid, PARTNER_WEBHOOK_ALLOWED_HOSTS: value })).toThrow(
        /PARTNER_WEBHOOK_ALLOWED_HOSTS/,
      );
    }
  });

  test('bounds the partner webhook timeout', () => {
    expect(() => loadServerConfig({ ...valid, PARTNER_WEBHOOK_TIMEOUT_MS: '0' })).toThrow(
      /PARTNER_WEBHOOK_TIMEOUT_MS/,
    );
    expect(() => loadServerConfig({ ...valid, PARTNER_WEBHOOK_TIMEOUT_MS: '15001' })).toThrow(
      /PARTNER_WEBHOOK_TIMEOUT_MS/,
    );
    expect(
      loadServerConfig({ ...valid, PARTNER_WEBHOOK_TIMEOUT_MS: '500' }).PARTNER_WEBHOOK_TIMEOUT_MS,
    ).toBe(500);
  });
});
