import { z } from 'zod';
import { untrustedBlock } from '../prompt';
import { createGatewayModel } from '../provider';
import { generateStructured } from '../structured';
import type { MatchResult } from './matching';
import { type TieredGatewayConfig, gatewayConfigForTier } from './provider';
import { type ClaimCategory, type ReadinessClaim, computeReadinessScore } from './readiness';

/**
 * The three Gateway agent passes (mandate extraction, opportunity readiness,
 * match narration) that ship Thursday — see the addendum's "explicitly
 * deferred" list for what does NOT (Country/Financial/Red-Team as separate
 * passes, a second-model challenger review). Each pass is a single
 * schema-constrained call (via generateStructured — a forced tool call, the one
 * structured mechanism the production gateway honors), never free-form text the caller has
 * to parse — the AI SDK retries on a schema mismatch, so the caller always
 * gets a typed, validated object or a thrown error, never a guess.
 *
 * Untrusted text (an investor's own narrative, an opportunity submitter's free
 * text) is still wrapped with `untrustedBlock` before it reaches the model —
 * the same discipline as the chat agent, even though the stakes here are lower
 * than ingested partner statements.
 */

// ---------------------------------------------------------------------------
// Pass 1: mandate extraction. Never guesses a field it cannot support — see
// doc §42.20, "never silently guess missing fields." The caller shows the
// investor this draft to confirm/edit before `gatewayMandateSchema` saves it.
// ---------------------------------------------------------------------------

export const mandateExtractionSchema = z.object({
  countries: z.array(z.string()).default([]),
  sectors: z.array(z.string()).default([]),
  minCheckMinor: z.number().int().nonnegative().nullable(),
  maxCheckMinor: z.number().int().nonnegative().nullable(),
  stagePreferences: z.array(z.string()).default([]),
  riskAppetite: z.enum(['low', 'medium', 'high']).nullable(),
  horizonYears: z.number().int().nonnegative().nullable(),
  targetReturnPct: z.number().nonnegative().nullable(),
  liquidityNeed: z.enum(['low', 'medium', 'high']).nullable(),
  boardInvolvement: z.boolean().nullable(),
  impactPreference: z.boolean().nullable(),
  currency: z.enum(['USD', 'JMD', 'TTD', 'GYD', 'BBD', 'XCD', 'BSD']).nullable(),
  /** Fields the narrative did not say enough to confidently fill in. */
  missingFields: z.array(z.string()).default([]),
});
export type MandateExtraction = z.infer<typeof mandateExtractionSchema>;

export function buildMandateExtractionPrompt(narrative: string): string {
  return [
    "Extract a structured investor mandate from the investor's own description below.",
    'For every field you cannot confidently determine from the text, set it to null',
    '(or an empty array) and add its name to missingFields. Never invent a number or a',
    'preference the investor did not state — an incomplete draft the investor can fill',
    'in is correct; a confident guess is not.',
    '',
    untrustedBlock('investor_mandate_narrative', narrative),
  ].join('\n');
}

export interface ExtractMandateArgs {
  gateway: TieredGatewayConfig;
  narrative: string;
}

export async function extractMandate(args: ExtractMandateArgs): Promise<MandateExtraction> {
  return generateStructured({
    model: createGatewayModel(gatewayConfigForTier(args.gateway, 'general')),
    schema: mandateExtractionSchema,
    prompt: buildMandateExtractionPrompt(args.narrative),
  });
}

// ---------------------------------------------------------------------------
// Pass 2: opportunity readiness. The model extracts claims and labels each
// one's evidence trust (a real judgment call); the aggregate readinessScore is
// then computed by the pure `computeReadinessScore` in ./readiness.ts — the
// model never outputs the final number directly.
// ---------------------------------------------------------------------------

const claimCategorySchema = z.enum(['financial', 'legal', 'market', 'team', 'other']);
const evidenceStatusSchema = z.enum([
  'verified',
  'partially_verified',
  'self_reported',
  'unverified',
  'contradicted',
]);

export const opportunityAssessmentSchema = z.object({
  claims: z
    .array(
      z.object({
        category: claimCategorySchema.nullable(),
        label: z.string(),
        value: z.string(),
        evidenceStatus: evidenceStatusSchema,
        evidenceDetail: z.string().nullable(),
      }),
    )
    .default([]),
});
export type OpportunityAssessment = z.infer<typeof opportunityAssessmentSchema>;

export interface OpportunitySummary {
  name: string;
  country: string;
  sector: string;
  stage: string;
  summary: string;
  useOfFunds?: string | null;
  exitAssumptions?: string | null;
}

export function buildOpportunityAssessmentPrompt(opportunity: OpportunitySummary): string {
  const text = [
    `Name: ${opportunity.name}`,
    `Country: ${opportunity.country}`,
    `Sector: ${opportunity.sector}`,
    `Stage: ${opportunity.stage}`,
    `Summary: ${opportunity.summary}`,
    opportunity.useOfFunds ? `Use of funds: ${opportunity.useOfFunds}` : null,
    opportunity.exitAssumptions ? `Exit assumptions: ${opportunity.exitAssumptions}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return [
    'Read the submitted opportunity below and extract its factual claims — financial',
    '(revenue, margins, capital sought), legal (structure, jurisdiction), market',
    '(size, competition), team (track record), or other. For EACH claim, label how',
    "well the opportunity's own text supports it:",
    '- verified: an independent, checkable source is cited',
    '- partially_verified: some support, but not fully independent or complete',
    "- self_reported: only the submitter's own assertion, no supporting detail",
    '- unverified: mentioned but with no support at all',
    '- contradicted: the text contradicts itself or an accompanying claim',
    'A claim with thin or no support should be labeled honestly as self_reported or',
    'unverified, not upgraded because the number sounds plausible.',
    '',
    untrustedBlock('submitted_opportunity', text),
  ].join('\n');
}

export interface AssessOpportunityArgs {
  gateway: TieredGatewayConfig;
  opportunity: OpportunitySummary;
}

export interface AssessOpportunityResult {
  claims: OpportunityAssessment['claims'];
  readinessScore: number;
  criticalMissingItems: string[];
  hasContradictedEvidence: boolean;
}

/** Pure glue between the model's per-claim labels and the deterministic score
 *  — split out from `assessOpportunity` so it's testable without a live model. */
export function aggregateAssessment(
  claims: OpportunityAssessment['claims'],
): AssessOpportunityResult {
  const readinessClaims: ReadinessClaim[] = claims.map((c) => ({
    category: c.category as ClaimCategory | null,
    evidenceStatus: c.evidenceStatus,
  }));
  const readiness = computeReadinessScore(readinessClaims);

  return {
    claims,
    readinessScore: readiness.score,
    criticalMissingItems: readiness.criticalMissingItems,
    hasContradictedEvidence: readiness.hasContradictedEvidence,
  };
}

/** The most consequential judgment of the three passes — runs on the `high` tier. */
export async function assessOpportunity(
  args: AssessOpportunityArgs,
): Promise<AssessOpportunityResult> {
  const object = await generateStructured({
    model: createGatewayModel(gatewayConfigForTier(args.gateway, 'high')),
    schema: opportunityAssessmentSchema,
    prompt: buildOpportunityAssessmentPrompt(args.opportunity),
  });
  return aggregateAssessment(object.claims);
}

// ---------------------------------------------------------------------------
// Pass 3: match narration. The score and component scores are already
// computed (packages/agent/src/gateway/matching.ts#score) — this pass only
// explains them in plain language. It cannot change the number.
// ---------------------------------------------------------------------------

export const matchNarrationSchema = z.object({
  reasons: z.array(z.string()).default([]),
  concerns: z.array(z.string()).default([]),
});
export type MatchNarration = z.infer<typeof matchNarrationSchema>;

export interface NarrateMatchArgs {
  gateway: TieredGatewayConfig;
  mandateSummary: string;
  opportunity: OpportunitySummary;
  match: MatchResult;
}

export function buildMatchNarrationPrompt(args: NarrateMatchArgs): string {
  const componentLines = Object.entries(args.match.componentScores)
    .map(([k, v]) => `- ${k}: ${(v * 100).toFixed(0)}/100`)
    .join('\n');

  return [
    `An investor's mandate was scored against an opportunity by a fixed formula.`,
    `Overall match: ${(args.match.score * 100).toFixed(0)}/100. Component scores:`,
    componentLines,
    '',
    'Write 1-4 short reasons this is a good match (highest-scoring components first)',
    'and 0-3 short concerns (lowest-scoring components, if materially low). Do NOT',
    'restate the raw scores or invent any number — describe what they mean in plain',
    'language for an investor 35 and older. You cannot change the score.',
    '',
    untrustedBlock('investor_mandate_summary', args.mandateSummary),
    untrustedBlock('opportunity_summary', args.opportunity.summary),
  ].join('\n');
}

/** Cheapest of the three passes — runs on the `low` tier. */
export async function narrateMatch(args: NarrateMatchArgs): Promise<MatchNarration> {
  return generateStructured({
    model: createGatewayModel(gatewayConfigForTier(args.gateway, 'low')),
    schema: matchNarrationSchema,
    prompt: buildMatchNarrationPrompt(args),
  });
}
