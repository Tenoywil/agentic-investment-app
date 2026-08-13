import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { type LanguageModel, extractReasoningMiddleware, wrapLanguageModel } from 'ai';

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

/**
 * MiniMax's models are reasoning models, and they emit their working inside
 * `<think>` tags in the ordinary content stream. The OpenAI-compatible protocol
 * has no field for that, so the provider cannot separate it and every token of
 * it arrives as assistant text.
 *
 * On screen that read as the agent thinking out loud at the customer:
 *
 *   <think> The user is asking for the best income deal. I should search for
 *   income-generating opportunities... </think> <think> No bonds returned. Let
 *   me try funds... </think>
 *
 * — several hundred words of hedging and dead ends, in a product whose whole
 * claim is that a licensed, suitability-aware agent is answering. This strips
 * the tags out of the text stream and routes their contents to the `reasoning`
 * part, which nothing renders.
 *
 * It is applied here rather than at each call site so no future caller can
 * forget it, and it is harmless against a model that emits no `<think>` at all.
 */
const REASONING_TAG = 'think';

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
  return wrapLanguageModel({
    model: provider(cfg.model),
    middleware: extractReasoningMiddleware({ tagName: REASONING_TAG }),
  });
}
