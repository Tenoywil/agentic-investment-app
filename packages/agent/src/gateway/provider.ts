import type { GatewayConfig } from '../provider';

/**
 * The Gateway's tiered model gateway — a real gap vs. `../provider.ts`'s single
 * `GatewayConfig` (one model for every call). Each orchestrator pass picks the
 * tier its judgment calls warrant: `high` for the readiness-assessment pass
 * (labeling evidence trust is the most consequential call), `general` for
 * mandate extraction, `low` for match narration (explaining an already-computed
 * score is cheap). Still config-driven — GATEWAY_MODEL_HIGH/GENERAL/LOW env
 * vars — and every tier falls back to `AI_MODEL` when unset, so a deployment
 * that only sets `AI_MODEL` keeps working unchanged.
 */
export type GatewayModelTier = 'high' | 'general' | 'low';

export interface TieredGatewayConfig {
  baseURL: string;
  apiKey: string;
  /** AI_MODEL — the fallback for any tier left unset. */
  defaultModel: string;
  models?: Partial<Record<GatewayModelTier, string>>;
  fetch?: GatewayConfig['fetch'];
}

/** Resolve one tier to a concrete `GatewayConfig`, ready for `createGatewayModel`. */
export function gatewayConfigForTier(
  cfg: TieredGatewayConfig,
  tier: GatewayModelTier,
): GatewayConfig {
  const model = cfg.models?.[tier]?.trim() || cfg.defaultModel;
  return {
    baseURL: cfg.baseURL,
    apiKey: cfg.apiKey,
    model,
    ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
  };
}
