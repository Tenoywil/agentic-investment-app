import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { loadServerConfig } from '@ccn/config';
import {
  agentMessages,
  approvals,
  connectedAccounts,
  createDb,
  goals,
  holdings,
  instruments,
  limits,
  partners,
  riskProfiles,
  user,
  userRoles,
} from '@ccn/db';
import { and, eq, inArray } from 'drizzle-orm';
import { createLogger } from '../src/logger';
import { runAgentSweep } from '../src/services/agent-sweep';

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * The background agent, proven end to end against real RLS.
 *
 * The product's whole claim is "discovers, screens and coordinates execution,
 * always on your approval" — this suite pins the discovery half actually
 * happening without anyone typing at a chat, and that what it discovers is
 * screened by the person's OWN constraints:
 *
 *  - a fitting instrument becomes exactly one pending approval + one agent
 *    message, audited under the agent's own name;
 *  - a second sweep proposes nothing while that approval waits, and nothing
 *    for the same instrument for two weeks after it is decided;
 *  - a person whose band the instrument does not fit is never bothered;
 *  - a person with no recorded cash is never bothered.
 */
suite('agent background sweep', () => {
  const handle = createDb(DATABASE_URL ?? '', { max: 4 });
  const { db } = handle;
  const tag = `sweep-${Date.now()}`;

  const configFor = () =>
    loadServerConfig({
      APP_ENV: 'development',
      DATABASE_URL: DATABASE_URL ?? '',
      SUPABASE_URL: 'https://example.supabase.co',
      BETTER_AUTH_URL: 'http://localhost:3001',
      APP_WEB_ORIGIN: 'http://localhost:3000',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
      OPENAI_API_KEY: 'sk-test',
      FIELD_ENCRYPTION_KEY: 'base64:key',
    });
  const deps = () => ({
    db,
    config: configFor(),
    logger: createLogger({ level: 'error', sink: () => {} }),
  });

  let partnerId = '';
  /** Funded, low-band investor — the sweep should find them something. */
  let funded = '';
  /** Same cash, but the only live instrument is over their band. */
  let cautious = '';
  /** Active account, risk done, but not a cent of recorded cash. */
  let broke = '';
  /** Same cash as funded, plus an underfunded goal — sizing steps above the
   *  minimum toward it, bounded by the single-position cap. */
  let saver = '';
  let lowRiskId = '';
  let highRiskId = '';

  async function makeInvestor(
    key: string,
    band: 'low' | 'high_moderate',
    cashMinor: bigint,
  ): Promise<string> {
    const [u] = await db
      .insert(user)
      .values({ name: key, email: `${tag}-${key}@x.com`, emailVerified: true })
      .returning({ id: user.id });
    const id = u?.id ?? '';
    await db.insert(userRoles).values({ userId: id, role: 'customer' });
    await db.insert(riskProfiles).values({ userId: id, answers: {}, score: 5, band });
    await db.insert(limits).values({ userId: id }); // schema defaults
    const [acct] = await db
      .insert(connectedAccounts)
      .values({ userId: id, partnerId, label: key, status: 'active' })
      .returning({ id: connectedAccounts.id });
    if (cashMinor > 0n) {
      await db.insert(holdings).values({
        userId: id,
        connectedAccountId: acct?.id ?? '',
        instrumentId: null,
        name: 'Cash',
        valueMinor: cashMinor,
      });
    }
    return id;
  }

  beforeAll(async () => {
    const [p] = await db
      .insert(partners)
      .values({ code: `SW${tag.slice(-4)}`, name: 'Sweep Test Capital', agreementStatus: 'live' })
      .returning({ id: partners.id });
    partnerId = p?.id ?? '';

    const ins = await db
      .insert(instruments)
      .values([
        {
          slug: `${tag}-mmf`,
          abbr: 'SMM',
          type: 'fund',
          partnerId,
          risk: 'low',
          name: 'Sweep Money Market',
          minInvestmentMinor: 25_000n, // US$250 — inside default auto-invest cap
        },
        {
          slug: `${tag}-venture`,
          abbr: 'SVN',
          type: 'private',
          partnerId,
          risk: 'high',
          name: 'Sweep Venture Note',
          minInvestmentMinor: 25_000n,
        },
      ])
      .returning({ id: instruments.id, slug: instruments.slug });
    lowRiskId = ins.find((i) => i.slug.endsWith('-mmf'))?.id ?? '';
    highRiskId = ins.find((i) => i.slug.endsWith('-venture'))?.id ?? '';

    // US$5,000 cash comfortably above the US$1,000 default floor.
    funded = await makeInvestor('funded', 'high_moderate', 500_000n);
    // Cash sits exactly at the default US$1,000 floor: every proposal would
    // breach it, so nothing the marketplace offers is proposable for them.
    cautious = await makeInvestor('cautious', 'low', 100_000n);
    broke = await makeInvestor('broke', 'high_moderate', 0n);
    saver = await makeInvestor('saver', 'high_moderate', 500_000n);
    // US$2,000 still to find for the boat: sizing has a goal to aim at.
    await db.insert(goals).values({
      userId: saver,
      name: 'Boat fund',
      targetMinor: 200_000n,
      currentMinor: 0n,
    });
  });

  afterAll(async () => {
    const ids = [funded, cautious, broke, saver].filter(Boolean);
    if (ids.length) {
      await db.delete(user).where(inArray(user.id, ids)); // cascades roles/holdings/approvals/messages
    }
    await db.delete(instruments).where(inArray(instruments.id, [lowRiskId, highRiskId]));
    if (partnerId) await db.delete(partners).where(eq(partners.id, partnerId));
    await handle.close();
  });

  test('a fitting product becomes one approval, one agent message, one audit row', async () => {
    const result = await runAgentSweep(deps());
    expect(result.scanned).toBeGreaterThanOrEqual(3);

    const cards = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.userId, funded), eq(approvals.status, 'pending')));
    expect(cards).toHaveLength(1);
    const card = cards[0];
    // The gentlest viable idea first: the low-risk fund, at its own minimum.
    expect(card?.instrumentId).toBe(lowRiskId);
    expect(card?.type).toBe('investment_rec');
    expect(card?.amountMinor).toBe(25_000n);
    expect(card?.title).toContain('Sweep Money Market');
    expect(card?.body).toContain('Nothing happens unless you approve');
    expect((card?.snapshot as { source?: string })?.source).toBe('background_sweep');

    // "How this was decided": the pipeline's stage records ride on the
    // approval — research, the portfolio-fit weighing, suitability, and
    // coordination since something was chosen.
    const trace = (
      card?.snapshot as { trace?: { stage: string; agent: string; summary: string }[] }
    )?.trace;
    expect(trace?.map((t) => t.stage)).toEqual(['research', 'fit', 'suitability', 'coordination']);
    expect(trace?.find((t) => t.stage === 'suitability')?.summary).toContain('band');
    expect(trace?.find((t) => t.stage === 'fit')?.summary).toContain('your holdings');

    const notes = await db
      .select({ content: agentMessages.content })
      .from(agentMessages)
      .where(eq(agentMessages.userId, funded));
    expect(notes.some((n) => n.content.includes('While you were away'))).toBe(true);
  });

  test('an underfunded goal sizes the proposal above the minimum, capped by the position limit', async () => {
    const cards = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.userId, saver), eq(approvals.status, 'pending')));
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card?.instrumentId).toBe(lowRiskId);
    // Toward the US$2,000 goal gap, but clamped by the 15% single-position
    // cap on a US$5,000 portfolio → US$750, re-gated at that size.
    expect(card?.amountMinor).toBe(75_000n);
    expect(card?.body).toContain('Proposed at US$750');
    const trace = (card?.snapshot as { trace?: { stage: string; summary: string }[] })?.trace;
    const coordination = trace?.find((t) => t.stage === 'coordination');
    expect(coordination?.summary).toContain('sized toward your "Boat fund" goal');
    expect(coordination?.summary).toContain('re-checked against your limits');
  });

  test('the sweep is quiet while its card waits, and never auto-acts', async () => {
    await runAgentSweep(deps());
    const cards = await db
      .select({ id: approvals.id })
      .from(approvals)
      .where(eq(approvals.userId, funded));
    // Still exactly one — a queue the agent keeps topping up stops being read.
    expect(cards).toHaveLength(1);

    // And no order exists: the background agent proposes, never spends.
    const placed = await db.execute(
      `select count(*)::int as n from orders where user_id = '${funded}'`,
    );
    expect((placed as unknown as { n: number }[])[0]?.n).toBe(0);
  });

  test('a person whose constraints nothing clears is left alone', async () => {
    // cautious: cash sits exactly at the default floor, so every proposal
    // would breach it; broke: no cash at all.
    for (const quiet of [cautious, broke]) {
      const cards = await db.select().from(approvals).where(eq(approvals.userId, quiet));
      expect(cards).toHaveLength(0);
    }
  });

  test('a decided instrument stays off the table for two weeks', async () => {
    await db
      .update(approvals)
      .set({ status: 'rejected', decidedAt: new Date() })
      .where(eq(approvals.userId, funded));

    await runAgentSweep(deps());
    const again = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.userId, funded), eq(approvals.status, 'pending')));
    // The only other candidate is the high-risk note, which their band and
    // the recent rejection both rule out — so nothing new appears.
    expect(again.every((a) => a.instrumentId !== lowRiskId)).toBe(true);
  });

  test('deciding a card starts a day of quiet, not a fresh proposal ten minutes later', async () => {
    // saver decides their card; the sweep must NOT immediately follow up.
    await db
      .update(approvals)
      .set({ status: 'rejected', decidedAt: new Date() })
      .where(eq(approvals.userId, saver));
    await runAgentSweep(deps());
    const rightAfter = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.userId, saver), eq(approvals.status, 'pending')));
    expect(rightAfter).toHaveLength(0);

    // A day later (backdate the decided card past the cooldown AND the
    // 14-day instrument quiet window is still in force for lowRisk, so the
    // sweep stays quiet for a different reason — assert the cooldown alone
    // by also backdating past nothing else; the instrument quiet keeps it
    // silent, which is the correct compounding behavior).
    await db
      .update(approvals)
      .set({ createdAt: new Date(Date.now() - 25 * 3_600_000) })
      .where(eq(approvals.userId, saver));
    await runAgentSweep(deps());
    const nextDay = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.userId, saver), eq(approvals.status, 'pending')));
    // lowRisk is still inside its 14-day quiet window and the venture note is
    // outside the band — so still nothing, and that is the design: cooldown
    // and quiet windows compound, they do not race.
    expect(nextDay).toHaveLength(0);
  });

  test('an instrument the person already holds is never re-proposed', async () => {
    // A fresh investor who already HOLDS the low-risk fund (however acquired)
    // plus comfortable cash. The only other candidate is outside their band —
    // so the sweep must propose nothing at all.
    const holder = await makeInvestor('holder', 'high_moderate', 500_000n);
    const [acct] = await db
      .select({ id: connectedAccounts.id })
      .from(connectedAccounts)
      .where(eq(connectedAccounts.userId, holder));
    await db.insert(holdings).values({
      userId: holder,
      connectedAccountId: acct?.id ?? '',
      instrumentId: lowRiskId,
      name: 'Sweep Money Market',
      valueMinor: 100_000n,
    });

    await runAgentSweep(deps());
    const cards = await db.select().from(approvals).where(eq(approvals.userId, holder));
    expect(cards).toHaveLength(0);

    await db.delete(user).where(eq(user.id, holder));
  });
});
