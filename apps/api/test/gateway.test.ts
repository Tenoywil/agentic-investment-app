import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type MandateProfile, type OpportunityProfile, score } from '@ccn/agent';
import {
  createDb,
  gatewayClaims,
  gatewayDeals,
  gatewayEvidence,
  gatewayIntroductionRequests,
  gatewayMatches,
  gatewayOpportunities,
  investorMandates,
  user,
  userRoles,
  withRls,
} from '@ccn/db';
import {
  gatewayEventForGuardrailDecision,
  nextGatewayStatus,
  nextIntroductionStatus,
} from '@ccn/domain';
import { evaluate } from '@ccn/gateway-guardrail';
import { eq } from 'drizzle-orm';
import { buildGuardrailInput, loadOpportunity } from '../src/services/gateway-gate';

/**
 * End-to-end Gateway tests against a migrated Postgres (CI provides one; locally,
 * export DATABASE_URL) — the full vertical slice: mandate -> opportunity ->
 * (simulated) assess -> submit-for-approval across all 4 guardrail branches ->
 * match -> request-introduction -> analyst approve -> deal, plus RLS cross-tenant
 * denial. Same style as trading.test.ts: exercise the real schema/RLS/pure
 * engines directly via withRls, the same seam routes/gateway.ts's handlers use,
 * rather than faking a Better Auth session over HTTP (no test in this repo does
 * that — see apps/api/test/app.test.ts).
 *
 * The two LLM passes (mandate extraction, readiness assessment) are simulated by
 * writing their expected output directly, mirroring how apps/api/test never
 * calls the live agent gateway either (agent-eval is a separate, gated suite) —
 * their pure logic is covered without a network call in
 * packages/agent/src/gateway/{readiness,orchestrator}.test.ts.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;
const APP = 'ccn_app';

suite('gateway: mandate -> opportunity -> guardrail -> match -> introduction -> deal', () => {
  const handle = createDb(DATABASE_URL ?? '', { max: 6 });
  const { db } = handle;
  const tag = `gw-${Date.now()}`;

  let investorA = '';
  let investorB = '';
  let analyst = '';

  beforeAll(async () => {
    const rows = await db
      .insert(user)
      .values([
        { name: 'Investor A', email: `${tag}-a@x.com`, emailVerified: true },
        { name: 'Investor B', email: `${tag}-b@x.com`, emailVerified: true },
        { name: 'Analyst', email: `${tag}-analyst@x.com`, emailVerified: true },
      ])
      .returning({ id: user.id });
    investorA = rows[0]?.id ?? '';
    investorB = rows[1]?.id ?? '';
    analyst = rows[2]?.id ?? '';
    await db.insert(userRoles).values({ userId: analyst, role: 'analyst' });
  });

  afterAll(async () => {
    await handle.close();
  });

  // -------------------------------------------------------------------
  // Mandate
  // -------------------------------------------------------------------

  test('investor A saves a mandate', async () => {
    const [row] = await withRls(db, { userId: investorA, dbRole: APP }, (tx) =>
      tx
        .insert(investorMandates)
        .values({
          userId: investorA,
          countries: ['Jamaica'],
          sectors: ['Renewable Energy'],
          minCheckMinor: 10_000_00n,
          maxCheckMinor: 500_000_00n,
          riskAppetite: 'medium',
          horizonYears: 5,
          targetReturnPct: '12',
          liquidityNeed: 'low',
        })
        .returning(),
    );
    expect(row?.userId).toBe(investorA);
  });

  test('investor B cannot read investor A mandate (RLS)', async () => {
    const rows = await withRls(db, { userId: investorB, dbRole: APP }, (tx) =>
      tx.select().from(investorMandates).where(eq(investorMandates.userId, investorA)),
    );
    expect(rows).toHaveLength(0);
  });

  // -------------------------------------------------------------------
  // Opportunity submission + visibility
  // -------------------------------------------------------------------

  const submitOpportunity = async (overrides: {
    name: string;
    country?: string;
    sector?: string;
  }) => {
    const [row] = await withRls(db, { userId: investorA, dbRole: APP }, (tx) =>
      tx
        .insert(gatewayOpportunities)
        .values({
          submittedBy: investorA,
          name: overrides.name,
          country: overrides.country ?? 'Jamaica',
          sector: overrides.sector ?? 'Renewable Energy',
          stage: 'Growth',
          investmentType: 'Equity',
          capitalSoughtMinor: 250_000_00n,
          targetReturnPct: '14',
          horizonYears: 6,
          riskRating: 'medium',
          liquidity: 'low',
          summary: `${overrides.name} — expanding a community solar cooperative.`,
        })
        .returning(),
    );
    return row?.id ?? '';
  };

  let opportunityId = '';

  test('an opportunity is submitted with status submitted', async () => {
    opportunityId = await submitOpportunity({ name: 'Solar Co-op Expansion' });
    const [row] = await withRls(db, { userId: investorA, dbRole: APP }, (tx) =>
      tx.select().from(gatewayOpportunities).where(eq(gatewayOpportunities.id, opportunityId)),
    );
    expect(row?.status).toBe('submitted');
  });

  test('a submitted (not yet approved) opportunity is invisible to a different investor', async () => {
    const rows = await withRls(db, { userId: investorB, dbRole: APP }, (tx) =>
      tx.select().from(gatewayOpportunities).where(eq(gatewayOpportunities.id, opportunityId)),
    );
    expect(rows).toHaveLength(0);
  });

  test('an analyst sees the submitted opportunity regardless of submitter', async () => {
    const rows = await withRls(db, { userId: analyst, appRole: 'analyst', dbRole: APP }, (tx) =>
      tx.select().from(gatewayOpportunities).where(eq(gatewayOpportunities.id, opportunityId)),
    );
    expect(rows).toHaveLength(1);
  });

  // -------------------------------------------------------------------
  // Assess (simulated agent output) -> guardrail, all 4 branches
  // -------------------------------------------------------------------

  /** Writes the shape POST /opportunities/:id/assess would write, then moves
   *  submitted -> assessed via the same domain state machine the route uses. */
  const simulateAssess = async (
    id: string,
    readinessScore: number,
    criticalMissingItems: string[] = [],
  ) => {
    await withRls(db, { userId: investorA, dbRole: APP }, async (tx) => {
      const next = nextGatewayStatus('submitted', 'assess');
      await tx
        .update(gatewayOpportunities)
        .set({ status: next, readinessScore, criticalMissingItems })
        .where(eq(gatewayOpportunities.id, id));
    });
  };

  const submitForApproval = async (id: string) => {
    return withRls(db, { userId: investorA, dbRole: APP }, async (tx) => {
      const loaded = await loadOpportunity(tx, id);
      if (!loaded) throw new Error('opportunity missing');
      const input = await buildGuardrailInput(tx, loaded);
      const decision = evaluate(input);
      const event = gatewayEventForGuardrailDecision(decision.decision);
      const nextStatus = nextGatewayStatus(loaded.status, event);
      const disclosures = decision.decision === 'allow_with_disclosure' ? decision.disclosures : [];
      const [row] = await tx
        .update(gatewayOpportunities)
        .set({ status: nextStatus, guardrailCode: decision.code, disclosures })
        .where(eq(gatewayOpportunities.id, id))
        .returning();
      return { decision, opportunity: row };
    });
  };

  test('branch: allow — high readiness, permitted jurisdiction/sector -> approved', async () => {
    await simulateAssess(opportunityId, 90);
    const { decision, opportunity } = await submitForApproval(opportunityId);
    expect(decision.decision).toBe('allow');
    expect(opportunity?.status).toBe('approved');
    expect(opportunity?.disclosures).toEqual([]);
  });

  test('branch: allow_with_disclosure — readiness between the two thresholds', async () => {
    const id = await submitOpportunity({ name: 'Mid-readiness Deal' });
    await simulateAssess(id, 70);
    const { decision, opportunity } = await submitForApproval(id);
    expect(decision.decision).toBe('allow_with_disclosure');
    expect(opportunity?.status).toBe('approved');
    expect(opportunity?.disclosures.length).toBeGreaterThan(0);
  });

  test('branch: human_review — critical items outstanding outranks a high score', async () => {
    const id = await submitOpportunity({ name: 'Missing Team Evidence Deal' });
    await simulateAssess(id, 95, ['no team evidence provided']);
    const { decision, opportunity } = await submitForApproval(id);
    expect(decision.decision).toBe('human_review');
    expect(opportunity?.status).toBe('pending_review');
  });

  test('branch: block — jurisdiction not on the permitted list', async () => {
    const id = await submitOpportunity({ name: 'Out of Corridor Deal', country: 'Nowhereland' });
    await simulateAssess(id, 95);
    const { decision, opportunity } = await submitForApproval(id);
    expect(decision.decision).toBe('block');
    expect(decision.decision === 'block' && decision.code).toBe('jurisdiction_not_permitted');
    expect(opportunity?.status).toBe('rejected');
  });

  test('branch: block — contradicted evidence found via the real claims/evidence join', async () => {
    const id = await submitOpportunity({ name: 'Contradicted Evidence Deal' });
    await withRls(db, { userId: investorA, dbRole: APP }, async (tx) => {
      const [claim] = await tx
        .insert(gatewayClaims)
        .values({ opportunityId: id, category: 'financial', label: 'Revenue', value: 'disputed' })
        .returning();
      if (!claim) throw new Error('claim missing');
      await tx
        .insert(gatewayEvidence)
        .values({ claimId: claim.id, status: 'contradicted', source: 'test' });
    });
    await simulateAssess(id, 95);
    const { decision } = await submitForApproval(id);
    expect(decision.decision).toBe('block');
    expect(decision.decision === 'block' && decision.code).toBe('evidence_contradicted');
  });

  // -------------------------------------------------------------------
  // Matching, introduction, analyst approval, deal
  // -------------------------------------------------------------------

  let matchId = '';

  test('a deterministic match is scored and stored for investor A against the approved opportunity', async () => {
    const mandate: MandateProfile = {
      countries: ['Jamaica'],
      sectors: ['Renewable Energy'],
      minCheckMinor: 10_000_00n,
      maxCheckMinor: 500_000_00n,
      stagePreferences: [],
      riskAppetite: 'medium',
      horizonYears: 5,
      targetReturnPct: 12,
      liquidityNeed: 'low',
      boardInvolvement: false,
      impactPreference: false,
    };
    const opportunity: OpportunityProfile = {
      country: 'Jamaica',
      sector: 'Renewable Energy',
      capitalSoughtMinor: 250_000_00n,
      stage: 'Growth',
      riskRating: 'medium',
      horizonYears: 6,
      targetReturnPct: 14,
      liquidity: 'low',
      offersBoardSeat: false,
      hasImpactFocus: false,
    };
    const result = score(mandate, opportunity);
    expect(result.score).toBeGreaterThan(0.5);

    const [row] = await withRls(db, { userId: investorA, dbRole: APP }, (tx) =>
      tx
        .insert(gatewayMatches)
        .values({
          userId: investorA,
          opportunityId,
          score: result.score.toString(),
          componentScores: result.componentScores,
          usedSemanticProxy: result.usedSemanticProxy,
        })
        .returning(),
    );
    matchId = row?.id ?? '';
    expect(matchId).not.toBe('');
  });

  test('investor B cannot see investor A match (RLS)', async () => {
    const rows = await withRls(db, { userId: investorB, dbRole: APP }, (tx) =>
      tx.select().from(gatewayMatches).where(eq(gatewayMatches.id, matchId)),
    );
    expect(rows).toHaveLength(0);
  });

  let introductionId = '';

  test('investor A requests an introduction', async () => {
    const [row] = await withRls(db, { userId: investorA, dbRole: APP }, (tx) =>
      tx
        .insert(gatewayIntroductionRequests)
        .values({ matchId, userId: investorA, opportunityId })
        .returning(),
    );
    introductionId = row?.id ?? '';
    expect(row?.status).toBe('requested');
  });

  test('investor B cannot see investor A introduction request (RLS)', async () => {
    const rows = await withRls(db, { userId: investorB, dbRole: APP }, (tx) =>
      tx
        .select()
        .from(gatewayIntroductionRequests)
        .where(eq(gatewayIntroductionRequests.id, introductionId)),
    );
    expect(rows).toHaveLength(0);
  });

  test('the analyst sees the introduction request in the review queue', async () => {
    const rows = await withRls(db, { userId: analyst, appRole: 'analyst', dbRole: APP }, (tx) =>
      tx
        .select()
        .from(gatewayIntroductionRequests)
        .where(eq(gatewayIntroductionRequests.id, introductionId)),
    );
    expect(rows).toHaveLength(1);
  });

  test('the analyst approves the introduction, creating a deal', async () => {
    const { introduction, deal } = await withRls(
      db,
      { userId: analyst, appRole: 'analyst', dbRole: APP },
      async (tx) => {
        const [existing] = await tx
          .select()
          .from(gatewayIntroductionRequests)
          .where(eq(gatewayIntroductionRequests.id, introductionId));
        if (!existing) throw new Error('introduction missing');
        const nextStatus = nextIntroductionStatus(existing.status, 'approve');
        const [updated] = await tx
          .update(gatewayIntroductionRequests)
          .set({ status: nextStatus, decidedBy: analyst, decidedAt: new Date() })
          .where(eq(gatewayIntroductionRequests.id, introductionId))
          .returning();
        const [newDeal] = await tx
          .insert(gatewayDeals)
          .values({ introductionRequestId: introductionId, userId: existing.userId, opportunityId })
          .returning();
        return { introduction: updated, deal: newDeal };
      },
    );
    expect(introduction?.status).toBe('approved');
    expect(deal?.stage).toBe('intro');
  });

  test('investor A can read the resulting deal; investor B cannot (RLS)', async () => {
    const asA = await withRls(db, { userId: investorA, dbRole: APP }, (tx) =>
      tx.select().from(gatewayDeals).where(eq(gatewayDeals.opportunityId, opportunityId)),
    );
    expect(asA).toHaveLength(1);

    const asB = await withRls(db, { userId: investorB, dbRole: APP }, (tx) =>
      tx.select().from(gatewayDeals).where(eq(gatewayDeals.opportunityId, opportunityId)),
    );
    expect(asB).toHaveLength(0);
  });
});
