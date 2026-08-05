import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

/**
 * The AI gateway (Impala, OpenAI-compatible). Config-driven — baseURL, apiKey and
 * model id all come from the environment (packages/config), so swapping MiniMax
 * for another gateway model is an env change, never a code change. The team key
 * is never in source.
 */
export interface GatewayConfig {
  baseURL: string;
  apiKey: string;
  model: string;
}

/** Create a language model bound to the gateway. */
export function createGatewayModel(cfg: GatewayConfig): LanguageModel {
  const provider = createOpenAICompatible({
    name: 'impala',
    baseURL: cfg.baseURL,
    apiKey: cfg.apiKey,
  });
  return provider(cfg.model);
}
