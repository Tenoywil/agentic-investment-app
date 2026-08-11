/**
 * The Gateway compliance guardrail — the deterministic choke point every
 * opportunity passes through before it can be approved/published or an
 * introduction can proceed. Mirrors `@ccn/limits-engine`'s shape exactly (pure,
 * ordered checks, first decision wins, exhaustively tested) but for the
 * introduction/evidence flow instead of the order flow.
 *
 * Vocabulary: `allow | allow_with_disclosure | human_review | block` — this is
 * the Caribbean Capital Gateway handoff doc's compliance-agent vocabulary,
 * ported 1:1 because it already matches how `@ccn/limits-engine` was independently
 * designed (`auto_act | requires_approval | blocked`), plus the one state that
 * doc named and CCN didn't yet have: an explicit "allowed, but disclose this" tier.
 *
 * This module makes the decision; it never explains it in prose — that's the
 * agent's match-narration pass. No LLM call, no I/O, no clock: every input is
 * data the caller assembles from already-loaded rows.
 */

export type GuardrailDecisionCode =
  | 'ready'
  | 'mandate_incomplete'
  | 'evidence_contradicted'
  | 'jurisdiction_not_permitted'
  | 'sector_not_permitted'
  | 'critical_items_outstanding'
  | 'readiness_below_review_threshold'
  | 'readiness_below_disclosure_threshold';

/**
 * Config-driven policy — never hardcoded thresholds. `readinessDisclosureThreshold`
 * must be <= `readinessAllowThreshold`; the gap between them is the disclosure band.
 */
export interface GuardrailPolicy {
  permittedJurisdictions: readonly string[];
  permittedSectors: readonly string[];
  /** At or above this readiness score, and clear of every other check: allow. */
  readinessAllowThreshold: number;
  /** Below this readiness score: needs a human decision, not just a disclosure. */
  readinessDisclosureThreshold: number;
  /** When false, mandate/KYC completeness is not checked (e.g. a public listing pass). */
  requireInvestorReady: boolean;
}

export interface GuardrailOpportunity {
  jurisdiction: string;
  sector: string;
  /** 0–100, from the readiness assessment. */
  readinessScore: number;
  criticalMissingItems: readonly string[];
  /** True iff any linked evidence row has verification = 'contradicted'. */
  hasContradictedEvidence: boolean;
}

export interface GuardrailInvestor {
  mandateComplete: boolean;
  kycComplete: boolean;
}

export interface GuardrailInput {
  policy: GuardrailPolicy;
  opportunity: GuardrailOpportunity;
  investor: GuardrailInvestor;
}

export type GuardrailDecision =
  | { decision: 'allow'; code: 'ready' }
  | {
      decision: 'allow_with_disclosure';
      code: GuardrailDecisionCode;
      disclosures: string[];
    }
  | { decision: 'human_review'; code: GuardrailDecisionCode; reasons: string[] }
  | { decision: 'block'; code: GuardrailDecisionCode; reasons: string[] };

const block = (code: GuardrailDecisionCode, reasons: string[]): GuardrailDecision => ({
  decision: 'block',
  code,
  reasons,
});
const review = (code: GuardrailDecisionCode, reasons: string[]): GuardrailDecision => ({
  decision: 'human_review',
  code,
  reasons,
});
const disclose = (code: GuardrailDecisionCode, disclosures: string[]): GuardrailDecision => ({
  decision: 'allow_with_disclosure',
  code,
  disclosures,
});

/**
 * Evaluate an opportunity for approval/publication or for an introduction
 * request. Checks run in this fixed order; the first that decides wins:
 *
 *   1. investor mandate/KYC incomplete   → block   (nothing to evaluate against yet)
 *   2. any evidence contradicted         → block   (integrity failure, not a judgment call)
 *   3. jurisdiction not permitted        → block   (config-driven allowlist)
 *   4. sector not permitted              → block   (config-driven allowlist)
 *   5. critical items still missing      → human_review (a person decides if it's ready)
 *   6. readiness below review threshold  → human_review
 *   7. readiness below allow threshold   → allow_with_disclosure (proceed, flagged)
 *   8. otherwise                         → allow
 */
export function evaluate(input: GuardrailInput): GuardrailDecision {
  const { policy, opportunity, investor } = input;

  if (policy.requireInvestorReady && (!investor.mandateComplete || !investor.kycComplete)) {
    const reasons: string[] = [];
    if (!investor.mandateComplete) reasons.push('Investor mandate is incomplete');
    if (!investor.kycComplete) reasons.push('Investor KYC is incomplete');
    return block('mandate_incomplete', reasons);
  }

  if (opportunity.hasContradictedEvidence) {
    return block('evidence_contradicted', [
      'One or more claims are contradicted by evidence on file',
    ]);
  }

  if (!policy.permittedJurisdictions.includes(opportunity.jurisdiction)) {
    return block('jurisdiction_not_permitted', [
      `${opportunity.jurisdiction} is not on the permitted jurisdiction list`,
    ]);
  }

  if (!policy.permittedSectors.includes(opportunity.sector)) {
    return block('sector_not_permitted', [
      `${opportunity.sector} is not on the permitted sector list`,
    ]);
  }

  if (opportunity.criticalMissingItems.length > 0) {
    return review(
      'critical_items_outstanding',
      opportunity.criticalMissingItems.map((item) => `Missing: ${item}`),
    );
  }

  if (opportunity.readinessScore < policy.readinessDisclosureThreshold) {
    return review('readiness_below_review_threshold', [
      `Readiness score ${opportunity.readinessScore} is below the review threshold of ${policy.readinessDisclosureThreshold}`,
    ]);
  }

  if (opportunity.readinessScore < policy.readinessAllowThreshold) {
    return disclose('readiness_below_disclosure_threshold', [
      `Readiness score is ${opportunity.readinessScore}/100 — some information could not be independently verified`,
    ]);
  }

  return { decision: 'allow', code: 'ready' };
}
