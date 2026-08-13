import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

/**
 * The AI gateway (MiniMax's OpenAI-compatible API). Config-driven — baseURL,
 * apiKey and model id all come from the environment (packages/config), so
 * swapping the model, or the provider entirely for anything OpenAI-compatible,
 * is an env change and never a code change. The key is never in source.
 */
export interface GatewayConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  /**
   * Outbound transport. The API injects the SSRF-guarded fetch here, so gateway
   * traffic is subject to the same allowlist and private-address checks as every
   * other egress — a redirect or a poisoned base URL cannot reach internal hosts.
   * Defaults to global fetch for tests and local tooling.
   */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

/** Create a language model bound to the gateway. */
export function createGatewayModel(cfg: GatewayConfig): LanguageModel {
  const provider = createOpenAICompatible({
    name: 'minimax',
    baseURL: cfg.baseURL,
    apiKey: cfg.apiKey,
    ...(cfg.fetch
      ? { fetch: ((input, init) => cfg.fetch?.(String(input), init)) as typeof globalThis.fetch }
      : {}),
  });
  return provider(cfg.model);
}
