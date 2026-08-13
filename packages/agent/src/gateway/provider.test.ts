import { describe, expect, test } from 'bun:test';
import { type TieredGatewayConfig, gatewayConfigForTier } from './provider';

const BASE: TieredGatewayConfig = {
  baseURL: 'https://gateway.example/v1',
  apiKey: 'sk-test',
  defaultModel: 'gpt-4o-mini',
};

describe('gatewayConfigForTier', () => {
  test('falls back to defaultModel when no tier override is set', () => {
    expect(gatewayConfigForTier(BASE, 'high').model).toBe('gpt-4o-mini');
    expect(gatewayConfigForTier(BASE, 'general').model).toBe('gpt-4o-mini');
    expect(gatewayConfigForTier(BASE, 'low').model).toBe('gpt-4o-mini');
  });

  test('an explicit tier override wins for that tier only', () => {
    const cfg: TieredGatewayConfig = { ...BASE, models: { high: 'big-model' } };
    expect(gatewayConfigForTier(cfg, 'high').model).toBe('big-model');
    expect(gatewayConfigForTier(cfg, 'general').model).toBe('gpt-4o-mini');
  });

  test('a blank tier override (empty string) still falls back, not an empty model id', () => {
    const cfg: TieredGatewayConfig = { ...BASE, models: { low: '   ' } };
    expect(gatewayConfigForTier(cfg, 'low').model).toBe('gpt-4o-mini');
  });

  test('carries baseURL/apiKey/fetch through unchanged', async () => {
    const fetchStub = (async () => new Response('ok')) as NonNullable<TieredGatewayConfig['fetch']>;
    const cfg: TieredGatewayConfig = { ...BASE, fetch: fetchStub };
    const resolved = gatewayConfigForTier(cfg, 'general');
    expect(resolved.baseURL).toBe(BASE.baseURL);
    expect(resolved.apiKey).toBe(BASE.apiKey);
    expect(resolved.fetch).toBe(fetchStub);
  });

  test('omits fetch entirely when none was provided', () => {
    const resolved = gatewayConfigForTier(BASE, 'general');
    expect('fetch' in resolved).toBe(false);
  });
});
