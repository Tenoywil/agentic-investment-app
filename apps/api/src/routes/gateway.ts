import {
  type MandateProfile,
  type MatchWeights,
  type OpportunityProfile,
  assessOpportunity,
  extractMandate,
  narrateMatch,
  score,
} from '@ccn/agent';
import {
  gatewayAgentRuns,
  gatewayClaims,
  gatewayDeals,
  gatewayEvidence,
  gatewayIntroductionRequests,
  gatewayMatches,
  gatewayOpportunities,
  investorMandates,
} from '@ccn/db';
import {
  gatewayEventForGuardrailDecision,
  gatewayIntroductionDecisionSchema,
  gatewayIntroductionRequestSchema,
  gatewayMandateNarrativeSchema,
  gatewayMandateSchema,
  gatewayOpportunitySchema,
  nextGatewayStatus,
  nextIntroductionStatus,
} from '@ccn/domain';
import { evaluate } from '@ccn/gateway-guardrail';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps, AppEnv, TenantContext } from '../context';
import { withTenant } from '../context';
import { auditAppend } from '../db-fns';
import type { rateLimit } from '../middleware';
import { requireAuth } from '../middleware';
import { createOutboundGuard } from '../security';
import type { RateLimitClass } from '../security';
import { buildGuardrailInput, loadOpportunity } from '../services/gateway-gate';

type Limit = (name: RateLimitClass) => ReturnType<typeof rateLimit>;

const REVIEW_ROLES = ['analyst', 'compliance', 'admin'];
const hasReviewRole = (tenant: TenantContext) => tenant.roles.some((r) => REVIEW_ROLES.includes(r));

/** The row a write just produced is never actually missing — this only
 *  satisfies `noUncheckedIndexedAccess`, the same role db-fns.ts's
 *  `firstRow` plays for the SECURITY DEFINER functions. */
function firstOrThrow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (!row) throw new Error(`expected a row after writing ${what}`);
  return row;
}

/**
 * The Gateway surface: investor mandate → opportunity evidence/readiness →
 * deterministic matching → human-gated introduction → deal record. Same
 * shape as routes/orders.ts and routes/approvals.ts — requireAuth, a single
 * withTenant transaction per request, Zod at the boundary, auditAppend on
 * every state change. See packages/gateway-guardrail (the decision) and
 * @ccn/agent's gateway/matching.ts (the score) for the pure modules this
 * seam feeds; the LLM narrates, it never invents either number.
 *
 * `/gateway/review` (an analyst UI) is explicitly deferred past Thursday —
 * the routes below are real and fully tested regardless, exercised via the
 * integration suite and direct authenticated calls.
 */
export function gatewayRoutes(deps: AppDeps, limit: Limit): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const outbound = createOutboundGuard(deps.config);
  app.use('*', requireAuth(deps));

  const gatewayConfig = () => ({
    baseURL: deps.config.OPENAI_BASE_URL,
    apiKey: deps.config.OPENAI_API_KEY,
    defaultModel: deps.config.AI_MODEL,
    models: {
      high: deps.config.GATEWAY_MODEL_HIGH,
      general: deps.config.GATEWAY_MODEL_GENERAL,
      low: deps.config.GATEWAY_MODEL_LOW,
    },
    fetch: outbound.fetch,
  });

  // ---------------------------------------------------------------------
  // Mandate: NL extraction (agent, not saved) then structured confirm-and-save.
  // ---------------------------------------------------------------------

  app.post('/mandate/extract', limit('agent'), async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const parsed = gatewayMandateNarrativeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);

    const gateway = gatewayConfig();
    let extraction: Awaited<ReturnType<typeof extractMandate>>;
    try {
      extraction = await extractMandate({ gateway, narrative: parsed.data.narrative });
    } catch {
      return c.json({ error: 'the agent is temporarily unavailable' }, 502);
    }

    await withTenant(deps, tenant, (tx) =>
      tx.insert(gatewayAgentRuns).values({
        userId: tenant.user.id,
        pass: 'mandate_extraction',
        tier: 'general',
        model: gateway.models.general || deps.config.AI_MODEL,
        input: { narrative: parsed.data.narrative },
        output: extraction,
      }),
    );

    return c.json({ extraction });
  });

  app.post('/mandate', limit('orders'), async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const parsed = gatewayMandateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);
    const d = parsed.data;

    const mandate = await withTenant(deps, tenant, async (tx) => {
      const fields = {
        countries: d.countries,
        sectors: d.sectors,
        minCheckMinor: d.minCheckMinor,
        maxCheckMinor: d.maxCheckMinor,
        stagePreferences: d.stagePreferences,
        riskAppetite: d.riskAppetite,
        horizonYears: d.horizonYears,
        targetReturnPct: d.targetReturnPct.toString(),
        liquidityNeed: d.liquidityNeed,
        boardInvolvement: d.boardInvolvement,
        impactPreference: d.impactPreference,
        currency: d.currency,
      };
      const [row] = await tx
        .insert(investorMandates)
        .values({ userId: tenant.user.id, ...fields })
        .onConflictDoUpdate({
          target: investorMandates.userId,
          set: { ...fields, updatedAt: new Date() },
        })
        .returning();
      await auditAppend(tx, {
        actorType: 'user',
        actorId: tenant.user.id,
        userId: tenant.user.id,
        partnerId: null,
        action: 'gateway.mandate.saved',
        entityType: 'investor_mandate',
        entityId: tenant.user.id,
        detail: {},
      });
      return row;
    });
    return c.json({ mandate });
  });

  app.get('/mandate', limit('read'), async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const [mandate] = await withTenant(deps, tenant, (tx) =>
      tx.select().from(investorMandates).where(eq(investorMandates.userId, tenant.user.id)),
    );
    return c.json({ mandate: mandate ?? null });
  });

  // ---------------------------------------------------------------------
  // Opportunities: submit, list, detail, readiness assessment, guardrail gate.
  // ---------------------------------------------------------------------

  app.post('/opportunities', limit('orders'), async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const parsed = gatewayOpportunitySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);
    const d = parsed.data;

    const opportunity = await withTenant(deps, tenant, async (tx) => {
      const row = firstOrThrow(
        await tx
          .insert(gatewayOpportunities)
          .values({
            submittedBy: tenant.user.id,
            name: d.name,
            country: d.country,
            sector: d.sector,
            stage: d.stage,
            investmentType: d.investmentType,
            capitalSoughtMinor: d.capitalSoughtMinor,
            currency: d.currency,
            valuationMinor: d.valuationMinor ?? null,
            useOfFunds: d.useOfFunds ?? null,
            targetReturnPct: d.targetReturnPct.toString(),
            horizonYears: d.horizonYears,
            riskRating: d.riskRating,
            liquidity: d.liquidity,
            offersBoardSeat: d.offersBoardSeat,
            hasImpactFocus: d.hasImpactFocus,
            exitAssumptions: d.exitAssumptions ?? null,
            summary: d.summary,
          })
          .returning(),
        'gateway_opportunities',
      );
      await auditAppend(tx, {
        actorType: 'user',
        actorId: tenant.user.id,
        userId: tenant.user.id,
        partnerId: null,
        action: 'gateway.opportunity.submitted',
        entityType: 'gateway_opportunity',
        entityId: row.id,
        detail: { name: d.name },
      });
      return row;
    });
    return c.json({ opportunity }, 201);
  });

  app.get('/opportunities', limit('read'), async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const rows = await withTenant(deps, tenant, (tx) =>
      tx.select().from(gatewayOpportunities).orderBy(desc(gatewayOpportunities.createdAt)),
    );
    return c.json({ opportunities: rows });
  });

  app.get('/opportunities/:id', limit('read'), async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const id = c.req.param('id');
    const result = await withTenant(deps, tenant, async (tx) => {
      const [opportunity] = await tx
        .select()
        .from(gatewayOpportunities)
        .where(eq(gatewayOpportunities.id, id));
      if (!opportunity) return null;
      const claims = await tx
        .select()
        .from(gatewayClaims)
        .where(eq(gatewayClaims.opportunityId, id));
      const claimIds = claims.map((cl) => cl.id);
      const evidence =
        claimIds.length === 0
          ? []
          : await tx
              .select()
              .from(gatewayEvidence)
              .where(inArray(gatewayEvidence.claimId, claimIds));
      return { opportunity, claims, evidence };
    });
    if (!result) return c.json({ error: 'opportunity not found' }, 404);
    return c.json(result);
  });

  app.post('/opportunities/:id/assess', limit('agent'), async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const id = c.req.param('id');

    const loaded = await withTenant(deps, tenant, (tx) => loadOpportunity(tx, id));
    if (!loaded) return c.json({ error: 'opportunity not found' }, 404);
    if (loaded.status !== 'submitted') {
      return c.json({ error: `opportunity is ${loaded.status}, not submitted` }, 409);
    }
    if (loaded.submittedBy !== tenant.user.id && !hasReviewRole(tenant)) {
      return c.json({ error: 'not permitted to assess this opportunity' }, 403);
    }

    const [full] = await withTenant(deps, tenant, (tx) =>
      tx.select().from(gatewayOpportunities).where(eq(gatewayOpportunities.id, id)),
    );
    if (!full) return c.json({ error: 'opportunity not found' }, 404);

    let assessment: Awaited<ReturnType<typeof assessOpportunity>>;
    const gateway = gatewayConfig();
    try {
      assessment = await assessOpportunity({
        gateway,
        opportunity: {
          name: full.name,
          country: full.country,
          sector: full.sector,
          stage: full.stage,
          summary: full.summary,
          useOfFunds: full.useOfFunds,
          exitAssumptions: full.exitAssumptions,
        },
      });
    } catch {
      return c.json({ error: 'the agent is temporarily unavailable' }, 502);
    }

    const opportunity = await withTenant(deps, tenant, async (tx) => {
      for (const claim of assessment.claims) {
        const claimRow = firstOrThrow(
          await tx
            .insert(gatewayClaims)
            .values({
              opportunityId: id,
              category: claim.category,
              label: claim.label,
              value: claim.value,
            })
            .returning(),
          'gateway_claims',
        );
        await tx.insert(gatewayEvidence).values({
          claimId: claimRow.id,
          status: claim.evidenceStatus,
          source: 'readiness_assessment_pass',
          detail: claim.evidenceDetail,
        });
      }
      const nextStatus = nextGatewayStatus(loaded.status, 'assess');
      const [row] = await tx
        .update(gatewayOpportunities)
        .set({
          status: nextStatus,
          readinessScore: assessment.readinessScore,
          criticalMissingItems: assessment.criticalMissingItems,
          updatedAt: new Date(),
        })
        .where(eq(gatewayOpportunities.id, id))
        .returning();
      await tx.insert(gatewayAgentRuns).values({
        opportunityId: id,
        pass: 'readiness_assessment',
        tier: 'high',
        model: gateway.models.high || deps.config.AI_MODEL,
        input: { name: full.name, summary: full.summary },
        output: assessment,
      });
      await auditAppend(tx, {
        actorType: 'user',
        actorId: tenant.user.id,
        userId: loaded.submittedBy,
        partnerId: null,
        action: 'gateway.opportunity.assessed',
        entityType: 'gateway_opportunity',
        entityId: id,
        detail: {
          readinessScore: assessment.readinessScore,
          hasContradictedEvidence: assessment.hasContradictedEvidence,
        },
      });
      return row;
    });

    return c.json({ opportunity, assessment });
  });

  app.post('/opportunities/:id/submit-for-approval', limit('orders'), async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const id = c.req.param('id');

    const result = await withTenant(deps, tenant, async (tx) => {
      const loaded = await loadOpportunity(tx, id);
      if (!loaded) return { status: 404 as const, body: { error: 'opportunity not found' } };
      if (loaded.status !== 'assessed') {
        return {
          status: 409 as const,
          body: { error: `opportunity is ${loaded.status}, not assessed` },
        };
      }
      if (loaded.submittedBy !== tenant.user.id && !hasReviewRole(tenant)) {
        return {
          status: 403 as const,
          body: { error: 'not permitted to submit this opportunity' },
        };
      }

      const input = await buildGuardrailInput(tx, loaded);
      const decision = evaluate(input);
      const event = gatewayEventForGuardrailDecision(decision.decision);
      const nextStatus = nextGatewayStatus(loaded.status, event);
      const disclosures = decision.decision === 'allow_with_disclosure' ? decision.disclosures : [];

      const [opportunity] = await tx
        .update(gatewayOpportunities)
        .set({
          status: nextStatus,
          guardrailCode: decision.code,
          disclosures,
          updatedAt: new Date(),
        })
        .where(eq(gatewayOpportunities.id, id))
        .returning();

      await auditAppend(tx, {
        actorType: 'user',
        actorId: tenant.user.id,
        userId: loaded.submittedBy,
        partnerId: null,
        action: 'gateway.opportunity.guardrail_evaluated',
        entityType: 'gateway_opportunity',
        entityId: id,
        detail: { decision: decision.decision, code: decision.code },
      });

      return { status: 200 as const, body: { decision, opportunity } };
    });
    return c.json(result.body, result.status);
  });

  // ---------------------------------------------------------------------
  // Matches: deterministic scoring against the caller's own mandate, then an
  // optional narration pass. Never cross-tenant — always the caller's mandate.
  // ---------------------------------------------------------------------

  app.get('/matches', limit('read'), async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);

    const result = await withTenant(deps, tenant, async (tx) => {
      const [mandateRow] = await tx
        .select()
        .from(investorMandates)
        .where(eq(investorMandates.userId, tenant.user.id));
      if (!mandateRow)
        return { status: 409 as const, body: { error: 'no investor mandate on file' } };

      const opportunities = await tx
        .select()
        .from(gatewayOpportunities)
        .where(eq(gatewayOpportunities.status, 'approved'));

      const mandate: MandateProfile = {
        countries: mandateRow.countries,
        sectors: mandateRow.sectors,
        minCheckMinor: mandateRow.minCheckMinor,
        maxCheckMinor: mandateRow.maxCheckMinor,
        stagePreferences: mandateRow.stagePreferences,
        riskAppetite: mandateRow.riskAppetite,
        horizonYears: mandateRow.horizonYears,
        targetReturnPct: Number(mandateRow.targetReturnPct),
        liquidityNeed: mandateRow.liquidityNeed,
        boardInvolvement: mandateRow.boardInvolvement,
        impactPreference: mandateRow.impactPreference,
      };

      const matches = [];
      for (const opp of opportunities) {
        const profile: OpportunityProfile = {
          country: opp.country,
          sector: opp.sector,
          capitalSoughtMinor: opp.capitalSoughtMinor,
          stage: opp.stage,
          riskRating: opp.riskRating,
          horizonYears: opp.horizonYears,
          targetReturnPct: Number(opp.targetReturnPct),
          liquidity: opp.liquidity,
          offersBoardSeat: opp.offersBoardSeat,
          hasImpactFocus: opp.hasImpactFocus,
        };
        const result = score(mandate, profile);
        const [row] = await tx
          .insert(gatewayMatches)
          .values({
            userId: tenant.user.id,
            opportunityId: opp.id,
            score: result.score.toString(),
            componentScores: result.componentScores,
            usedSemanticProxy: result.usedSemanticProxy,
          })
          .onConflictDoUpdate({
            target: [gatewayMatches.userId, gatewayMatches.opportunityId],
            set: {
              score: result.score.toString(),
              componentScores: result.componentScores,
              usedSemanticProxy: result.usedSemanticProxy,
              updatedAt: new Date(),
            },
          })
          .returning();
        matches.push({ ...row, opportunity: opp });
      }
      matches.sort((a, b) => Number(b.score) - Number(a.score));
      return { status: 200 as const, body: { matches } };
    });
    return c.json(result.body, result.status);
  });

  app.post('/matches/:id/narrate', limit('agent'), async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const id = c.req.param('id');

    const loaded = await withTenant(deps, tenant, async (tx) => {
      const [match] = await tx
        .select()
        .from(gatewayMatches)
        .where(and(eq(gatewayMatches.id, id), eq(gatewayMatches.userId, tenant.user.id)));
      if (!match) return null;
      const [mandateRow] = await tx
        .select()
        .from(investorMandates)
        .where(eq(investorMandates.userId, tenant.user.id));
      const [opportunity] = await tx
        .select()
        .from(gatewayOpportunities)
        .where(eq(gatewayOpportunities.id, match.opportunityId));
      return { match, mandateRow, opportunity };
    });
    if (!loaded || !loaded.mandateRow || !loaded.opportunity) {
      return c.json({ error: 'match not found' }, 404);
    }
    const { match: existingMatch, mandateRow, opportunity } = loaded;

    const gateway = gatewayConfig();
    let narration: Awaited<ReturnType<typeof narrateMatch>>;
    try {
      narration = await narrateMatch({
        gateway,
        mandateSummary: `Countries: ${mandateRow.countries.join(', ') || 'any'}; sectors: ${mandateRow.sectors.join(', ') || 'any'}; risk: ${mandateRow.riskAppetite}.`,
        opportunity: {
          name: opportunity.name,
          country: opportunity.country,
          sector: opportunity.sector,
          stage: opportunity.stage,
          summary: opportunity.summary,
        },
        match: {
          score: Number(existingMatch.score),
          componentScores: existingMatch.componentScores as MatchWeights,
          usedSemanticProxy: existingMatch.usedSemanticProxy,
        },
      });
    } catch {
      return c.json({ error: 'the agent is temporarily unavailable' }, 502);
    }

    const match = await withTenant(deps, tenant, async (tx) => {
      const [row] = await tx
        .update(gatewayMatches)
        .set({ reasons: narration.reasons, concerns: narration.concerns, updatedAt: new Date() })
        .where(eq(gatewayMatches.id, id))
        .returning();
      await tx.insert(gatewayAgentRuns).values({
        opportunityId: opportunity.id,
        userId: tenant.user.id,
        pass: 'match_narration',
        tier: 'low',
        model: gateway.models.low || deps.config.AI_MODEL,
        input: { matchId: id },
        output: narration,
      });
      return row;
    });
    return c.json({ match });
  });

  app.post('/matches/:id/request-introduction', limit('orders'), async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const id = c.req.param('id');
    const parsed = gatewayIntroductionRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success)
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);

    const result = await withTenant(deps, tenant, async (tx) => {
      const [match] = await tx
        .select()
        .from(gatewayMatches)
        .where(and(eq(gatewayMatches.id, id), eq(gatewayMatches.userId, tenant.user.id)));
      if (!match) return { status: 404 as const, body: { error: 'match not found' } };

      const introduction = firstOrThrow(
        await tx
          .insert(gatewayIntroductionRequests)
          .values({
            matchId: match.id,
            userId: tenant.user.id,
            opportunityId: match.opportunityId,
            note: parsed.data.note ?? null,
          })
          .returning(),
        'gateway_introduction_requests',
      );
      await auditAppend(tx, {
        actorType: 'user',
        actorId: tenant.user.id,
        userId: tenant.user.id,
        partnerId: null,
        action: 'gateway.introduction.requested',
        entityType: 'gateway_introduction_request',
        entityId: introduction.id,
        detail: { opportunityId: match.opportunityId },
      });
      return { status: 201 as const, body: { introduction } };
    });
    return c.json(result.body, result.status);
  });

  // ---------------------------------------------------------------------
  // Introductions: the investor's own list, and the analyst decision path.
  // ---------------------------------------------------------------------

  app.get('/introductions', limit('read'), async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const rows = await withTenant(deps, tenant, (tx) =>
      tx
        .select()
        .from(gatewayIntroductionRequests)
        .where(eq(gatewayIntroductionRequests.userId, tenant.user.id))
        .orderBy(desc(gatewayIntroductionRequests.createdAt)),
    );
    return c.json({ introductions: rows });
  });

  app.get('/admin/review-queue', limit('read'), async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    if (!hasReviewRole(tenant)) return c.json({ error: 'analyst role required' }, 403);
    const result = await withTenant(deps, tenant, async (tx) => {
      const opportunities = await tx
        .select()
        .from(gatewayOpportunities)
        .where(eq(gatewayOpportunities.status, 'pending_review'))
        .orderBy(desc(gatewayOpportunities.updatedAt));
      const introductions = await tx
        .select()
        .from(gatewayIntroductionRequests)
        .where(eq(gatewayIntroductionRequests.status, 'requested'))
        .orderBy(desc(gatewayIntroductionRequests.createdAt));
      return { opportunities, introductions };
    });
    return c.json(result);
  });

  app.post('/introductions/:id/approve', limit('orders'), async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    if (!hasReviewRole(tenant)) return c.json({ error: 'analyst role required' }, 403);
    const id = c.req.param('id');
    const parsed = gatewayIntroductionDecisionSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!parsed.success)
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);

    const result = await withTenant(deps, tenant, async (tx) => {
      const [introduction] = await tx
        .select()
        .from(gatewayIntroductionRequests)
        .where(eq(gatewayIntroductionRequests.id, id));
      if (!introduction) return { status: 404 as const, body: { error: 'introduction not found' } };
      if (introduction.status !== 'requested') {
        return {
          status: 409 as const,
          body: { error: `introduction already ${introduction.status}` },
        };
      }

      const nextStatus = nextIntroductionStatus(introduction.status, 'approve');
      const [updated] = await tx
        .update(gatewayIntroductionRequests)
        .set({
          status: nextStatus,
          decidedBy: tenant.user.id,
          decidedAt: new Date(),
          decisionReason: parsed.data.reason ?? null,
          updatedAt: new Date(),
        })
        .where(eq(gatewayIntroductionRequests.id, id))
        .returning();

      const deal = firstOrThrow(
        await tx
          .insert(gatewayDeals)
          .values({
            introductionRequestId: introduction.id,
            userId: introduction.userId,
            opportunityId: introduction.opportunityId,
          })
          .returning(),
        'gateway_deals',
      );

      await auditAppend(tx, {
        actorType: 'user',
        actorId: tenant.user.id,
        userId: introduction.userId,
        partnerId: null,
        action: 'gateway.introduction.approved',
        entityType: 'gateway_introduction_request',
        entityId: introduction.id,
        detail: { dealId: deal.id },
      });

      return { status: 200 as const, body: { introduction: updated, deal } };
    });
    return c.json(result.body, result.status);
  });

  app.post('/introductions/:id/reject', limit('orders'), async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    if (!hasReviewRole(tenant)) return c.json({ error: 'analyst role required' }, 403);
    const id = c.req.param('id');
    const parsed = gatewayIntroductionDecisionSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!parsed.success)
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);

    const result = await withTenant(deps, tenant, async (tx) => {
      const [introduction] = await tx
        .select()
        .from(gatewayIntroductionRequests)
        .where(eq(gatewayIntroductionRequests.id, id));
      if (!introduction) return { status: 404 as const, body: { error: 'introduction not found' } };
      if (introduction.status !== 'requested') {
        return {
          status: 409 as const,
          body: { error: `introduction already ${introduction.status}` },
        };
      }

      const nextStatus = nextIntroductionStatus(introduction.status, 'reject');
      const [updated] = await tx
        .update(gatewayIntroductionRequests)
        .set({
          status: nextStatus,
          decidedBy: tenant.user.id,
          decidedAt: new Date(),
          decisionReason: parsed.data.reason ?? null,
          updatedAt: new Date(),
        })
        .where(eq(gatewayIntroductionRequests.id, id))
        .returning();

      await auditAppend(tx, {
        actorType: 'user',
        actorId: tenant.user.id,
        userId: introduction.userId,
        partnerId: null,
        action: 'gateway.introduction.rejected',
        entityType: 'gateway_introduction_request',
        entityId: introduction.id,
        detail: parsed.data.reason ? { reason: parsed.data.reason } : {},
      });

      return { status: 200 as const, body: { introduction: updated } };
    });
    return c.json(result.body, result.status);
  });

  return app;
}
