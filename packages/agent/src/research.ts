import { generateObject } from 'ai';
import { z } from 'zod';
import { ResponseCache } from './cache';
import { type TieredGatewayConfig, gatewayConfigForTier } from './gateway/provider';
import { untrustedBlock } from './prompt';
import { createGatewayModel } from './provider';

/**
 * The Research agent's real half: a per-INSTRUMENT deep dive, run once per
 * asset and shared across every investor — not once per user, which is the
 * single most important cost decision in the background pipeline. The word
 * "research" on the product's screens used to mean "sort by risk, then by
 * minimum"; this module makes it mean what an analyst means.
 *
 * Same discipline as the Gateway's readiness pass (gateway/orchestrator.ts):
 * the model extracts discrete CLAIMS about the issuer and the asset and labels
 * how well each is supported — a genuine judgment call — while the aggregate
 * confidence number is computed HERE in pure arithmetic. The model never
 * invents the final score, and a contradiction is a veto, not a discount.
 *
 * Free text about an instrument (description, agent notes — and one day,
 * issuer documents and news) is untrusted input and enters the prompt only
 * through `untrustedBlock`.
 */

// ---------------------------------------------------------------------------
// The claims pass
// ---------------------------------------------------------------------------

/** What a careful analyst asks about a public instrument, as categories. */
const researchCategorySchema = z.enum([
  'issuer', // who stands behind it, who regulates them, track record
  'returns', // what actually backs the stated yield/metric
  'liquidity', // term, exit, what happens at maturity
  'costs', // minimums, fees, FX exposure
  'market', // the market it sits in, concentration risks
  'other',
]);
export type ResearchClaimCategory = z.infer<typeof researchCategorySchema>;

const evidenceStatusSchema = z.enum([
  'verified',
  'partially_verified',
  'self_reported',
  'unverified',
  'contradicted',
]);
export type ResearchEvidenceStatus = z.infer<typeof evidenceStatusSchema>;

export const instrumentResearchSchema = z.object({
  claims: z
    .array(
      z.object({
        category: researchCategorySchema.nullable(),
        label: z.string(),
        value: z.string(),
        evidenceStatus: evidenceStatusSchema,
        evidenceDetail: z.string().nullable(),
      }),
    )
    .default([]),
});
export type InstrumentResearch = z.infer<typeof instrumentResearchSchema>;
export type ResearchClaim = InstrumentResearch['claims'][number];

/** Everything we know about an instrument, as loaded from reference data.
 *  Free-text fields are untrusted; the prompt builder quarantines them. */
export interface InstrumentFacts {
  instrumentId: string;
  name: string;
  type: string | null;
  region: string | null;
  risk: string | null;
  term: string | null;
  currency: string;
  minInvestment: string;
  metricLabel: string | null;
  metric: string | null;
  partnerName: string | null;
  regulator: string | null;
  description: string | null;
  agentNote: string | null;
}

export function buildInstrumentResearchPrompt(facts: InstrumentFacts): string {
  const structured = [
    `Name: ${facts.name}`,
    facts.type ? `Type: ${facts.type}` : null,
    facts.region ? `Region: ${facts.region}` : null,
    facts.risk ? `Listed risk rating: ${facts.risk}` : null,
    facts.term ? `Term: ${facts.term}` : null,
    `Currency: ${facts.currency}`,
    `Minimum investment: ${facts.minInvestment}`,
    facts.metricLabel && facts.metric ? `${facts.metricLabel}: ${facts.metric}` : null,
    facts.partnerName ? `Executing partner: ${facts.partnerName}` : null,
    facts.regulator ? `Regulator: ${facts.regulator}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return [
    'Research the investment product below the way a careful analyst would, and',
    'extract its factual claims: issuer (who stands behind it and who regulates',
    'them), returns (what actually backs the stated yield or metric), liquidity',
    '(term, early exit, what happens at maturity), costs (minimums, fees, currency',
    'exposure), market, or other. For EACH claim, label how well the available',
    'text supports it:',
    '- verified: an independent, checkable source is cited',
    '- partially_verified: some support, but not fully independent or complete',
    "- self_reported: only the product's own assertion, no supporting detail",
    '- unverified: mentioned but with no support at all',
    '- contradicted: the text contradicts itself or another claim',
    'Label thin support honestly as self_reported or unverified — never upgrade a',
    'claim because the number sounds plausible, and never invent a claim the text',
    'does not make. A short honest list beats a long confident one.',
    '',
    structured,
    '',
    facts.description ? untrustedBlock('instrument_description', facts.description) : '',
    facts.agentNote ? untrustedBlock('instrument_agent_note', facts.agentNote) : '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

// ---------------------------------------------------------------------------
// Deterministic confidence — the model labels, arithmetic scores.
// ---------------------------------------------------------------------------

/** Per-status contribution, mirroring gateway/readiness.ts: contradicted is
 *  negative because one contradiction should drag the score down hard — and
 *  it is ALSO a hard veto downstream regardless of the number. */
const STATUS_WEIGHT: Record<ResearchEvidenceStatus, number> = {
  verified: 1,
  partially_verified: 0.6,
  self_reported: 0.3,
  unverified: 0.1,
  contradicted: -1,
};

/** Categories a public instrument's research should cover before the agent
 *  leans on it. Missing ones are NAMED, never silently imputed. */
export const REQUIRED_RESEARCH_CATEGORIES: readonly ResearchClaimCategory[] = [
  'issuer',
  'returns',
  'liquidity',
];

export interface ResearchConfidence {
  /** 0-100, clamped. */
  confidence: number;
  criticalMissingItems: string[];
  hasContradictedEvidence: boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function computeResearchConfidence(claims: readonly ResearchClaim[]): ResearchConfidence {
  const hasContradictedEvidence = claims.some((c) => c.evidenceStatus === 'contradicted');
  const average =
    claims.length === 0
      ? 0
      : claims.reduce((sum, c) => sum + STATUS_WEIGHT[c.evidenceStatus], 0) / claims.length;
  const confidence = Math.round(clamp(average, 0, 1) * 100);

  const present = new Set(
    claims.map((c) => c.category).filter((c): c is ResearchClaimCategory => c !== null),
  );
  const criticalMissingItems = REQUIRED_RESEARCH_CATEGORIES.filter((c) => !present.has(c)).map(
    (c) => `no ${c} evidence found`,
  );

  return { confidence, criticalMissingItems, hasContradictedEvidence };
}

/** The dossier: what research concluded about one instrument, ready to share
 *  across every user's pipeline run. */
export interface InstrumentDossier extends ResearchConfidence {
  instrumentId: string;
  claims: ResearchClaim[];
}

export function aggregateResearch(
  instrumentId: string,
  claims: ResearchClaim[],
): InstrumentDossier {
  return { instrumentId, claims, ...computeResearchConfidence(claims) };
}

// ---------------------------------------------------------------------------
// The live pass + the shared dossier cache
// ---------------------------------------------------------------------------

export interface ResearchInstrumentArgs {
  gateway: TieredGatewayConfig;
  facts: InstrumentFacts;
}

/** The judgment-heavy pass — runs on the `high` tier, rarely, cached widely. */
export async function researchInstrument(args: ResearchInstrumentArgs): Promise<InstrumentDossier> {
  const { object } = await generateObject({
    model: createGatewayModel(gatewayConfigForTier(args.gateway, 'high')),
    schema: instrumentResearchSchema,
    prompt: buildInstrumentResearchPrompt(args.facts),
  });
  return aggregateResearch(args.facts.instrumentId, object.claims);
}

/** A research function the pipeline can call per candidate. Null means
 *  "research unavailable" — the pipeline degrades, it never fabricates. */
export type ResearchFn = (facts: InstrumentFacts) => Promise<InstrumentDossier | null>;

export interface CachedResearchOptions {
  /** How long a dossier stays fresh. A changed fact set re-researches sooner. */
  ttlMs: number;
  /** The uncached pass — injectable so tests never touch a live model. */
  research?: (facts: InstrumentFacts) => Promise<InstrumentDossier>;
  gateway?: TieredGatewayConfig;
  /** Reads the clock — injectable for tests. */
  now?: () => number;
  onError?: (facts: InstrumentFacts, error: unknown) => void;
}

interface CacheEntry {
  factsKey: string;
  freshUntil: number;
  dossier: Promise<InstrumentDossier | null>;
}

/**
 * Wrap a research pass in the shared per-instrument dossier cache. Keyed by
 * instrument id and invalidated when the facts change or the TTL lapses.
 * Concurrent callers share one in-flight promise, so a sweep over N users
 * researches each instrument at most once per window. A failed pass is NOT
 * cached — the next tick retries — and resolves to null so the caller
 * degrades instead of fabricating.
 */
export function createCachedResearch(options: CachedResearchOptions): ResearchFn {
  const pass =
    options.research ??
    ((facts: InstrumentFacts) => {
      const gateway = options.gateway;
      if (!gateway) throw new Error('createCachedResearch needs either `research` or `gateway`');
      return researchInstrument({ gateway, facts });
    });
  const now = options.now ?? Date.now;
  const entries = new Map<string, CacheEntry>();

  return (facts) => {
    const factsKey = ResponseCache.key(facts);
    const existing = entries.get(facts.instrumentId);
    if (existing && existing.factsKey === factsKey && existing.freshUntil > now()) {
      return existing.dossier;
    }

    const dossier = Promise.resolve()
      .then(() => pass(facts))
      .catch((error): null => {
        // Do not cache the failure: drop the entry so the next window retries.
        if (entries.get(facts.instrumentId)?.factsKey === factsKey) {
          entries.delete(facts.instrumentId);
        }
        options.onError?.(facts, error);
        return null;
      });
    entries.set(facts.instrumentId, { factsKey, freshUntil: now() + options.ttlMs, dossier });
    return dossier;
  };
}
