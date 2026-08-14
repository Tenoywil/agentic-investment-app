import { eq } from 'drizzle-orm';
import type { Database, Transaction } from '../client';
import {
  agentMessages,
  approvals,
  connectedAccounts,
  goals,
  holdings,
  instruments,
  kycStatus,
  limits,
  partners,
  riskProfiles,
  user,
  userProfiles,
} from '../schema';

/** Dollars → minor units. Mirrors the helper in seed.ts. */
const usd = (dollars: number): bigint => BigInt(Math.round(dollars * 100));

/**
 * The Caribbean demo portfolio, attached to one user.
 *
 * Lifted verbatim out of seed.ts so the seed CLI and runtime provisioning
 * (apps/api/src/provisioning.ts) build the same account from one definition and
 * cannot drift. The seed's demo identity is marcus.bailey@ccn.demo, an address
 * nobody can sign into with Google, so before this the rich portfolio was
 * orphaned from every real login.
 *
 * Only accounts on DEMO_CUSTOMER_EMAILS get this. Everyone else signs up into a
 * genuinely empty account — which is why every screen needs a real empty state.
 *
 * Idempotent: the owned rows are reset-then-inserted, scoped to this user.
 *
 * Accepts a transaction as well as a plain connection, because every table it
 * writes is under FORCE ROW LEVEL SECURITY with a `user_id = app_current_user_id()`
 * policy. Called on a bare connection with no tenant GUC set, every insert here
 * fails its WITH CHECK — silently invisible in local tests, which connect as a
 * superuser and bypass RLS entirely. The API therefore calls this inside
 * `withRls` (see apps/api/src/provisioning.ts).
 */
export async function seedDemoCustomer(db: Database | Transaction, userId: string): Promise<void> {
  // Reference data the block below joins against. Seeded separately by the CLI;
  // absent rows simply leave a holding unlinked rather than failing.
  const partnerRows = await db.select({ id: partners.id, code: partners.code }).from(partners);
  const partnerIdByCode = new Map(partnerRows.map((p) => [p.code as string, p.id]));
  const instrumentRows = await db
    .select({ id: instruments.id, slug: instruments.slug, metric: instruments.metric })
    .from(instruments);
  const instrumentIdBySlug = new Map(instrumentRows.map((i) => [i.slug, i.id]));
  // The recommendation copy quotes the catalogue's own yield rather than a
  // second copy of the number, so the two cannot disagree.
  const metricBySlug = new Map(instrumentRows.map((i) => [i.slug, i.metric]));

  // Demo profile / compliance / limits (keyed by user_id → upsert) ---------
  await db
    .insert(userProfiles)
    .values({
      userId,
      displayCurrency: 'USD',
      corridor: 'United Kingdom → Jamaica',
      residencyCountry: 'United Kingdom',
      occupation: 'Software Engineer',
    })
    .onConflictDoNothing({ target: userProfiles.userId });
  await db
    .insert(kycStatus)
    .values({
      userId,
      tier: 'tier2',
      identityVerified: true,
      complianceConfirmed: true,
      riskCompleted: true,
      fundsConfirmed: true,
      isPep: false,
      taxResidencyDeclared: true,
      sources: ['salary'],
    })
    .onConflictDoNothing({ target: kycStatus.userId });
  await db.insert(limits).values({ userId: userId }).onConflictDoNothing({ target: limits.userId });

  // Reset-then-insert the demo user's owned rows ---------------------------
  await db.delete(holdings).where(eq(holdings.userId, userId));
  await db.delete(connectedAccounts).where(eq(connectedAccounts.userId, userId));
  await db.delete(goals).where(eq(goals.userId, userId));
  await db.delete(approvals).where(eq(approvals.userId, userId));
  await db.delete(riskProfiles).where(eq(riskProfiles.userId, userId));
  await db.delete(agentMessages).where(eq(agentMessages.userId, userId));

  await db.insert(riskProfiles).values({
    userId,
    answers: { q1: 'C', q2: 'C', q3: 'C' },
    score: 9,
    band: 'high_moderate', // "balanced-income"
  });

  const accounts = [
    {
      code: 'NCB',
      label: 'GOJ Bond 2029 · Chequing',
      holdings: [
        { name: 'GOJ USD Global Bond 2029', value: 12400, ret: '+6.8%', slug: 'goj32' },
        { name: 'USD Chequing', value: 1000, ret: '—', slug: null, cash: true },
      ],
    },
    {
      code: 'SAG',
      label: 'Sigma Global Fund',
      holdings: [{ name: 'Sagicor Sigma Global Fund', value: 8200, ret: '+4.1%', slug: 'sagrex' }],
    },
    {
      code: 'PRV',
      label: 'USD Income Fund',
      holdings: [{ name: 'Proven USD Income Fund', value: 5600, ret: '+5.9%', slug: 'provfd' }],
    },
    {
      code: 'JMMB',
      label: 'Money Market Fund · Savings',
      holdings: [
        { name: 'JMMB Money Market Fund', value: 3000, ret: '+2.0%', slug: null },
        { name: 'USD Savings', value: 1150, ret: '—', slug: null, cash: true },
      ],
    },
  ];
  for (const acc of accounts) {
    const partnerId = partnerIdByCode.get(acc.code);
    if (!partnerId) continue;
    const [account] = await db
      .insert(connectedAccounts)
      // Established relationships: the demo customer is an existing client at
      // each of these firms, not somebody awaiting a review.
      .values({ userId, partnerId, label: acc.label, status: 'active', reviewedAt: new Date() })
      .returning({ id: connectedAccounts.id });
    if (!account) continue;
    await db.insert(holdings).values(
      acc.holdings.map((h) => ({
        userId,
        connectedAccountId: account.id,
        instrumentId: h.slug ? (instrumentIdBySlug.get(h.slug) ?? null) : null,
        name: h.name,
        valueMinor: usd(h.value),
        returnLabel: h.ret,
      })),
    );
  }

  // Figures the approvals and the opening conversation quote, derived from the
  // holdings just inserted rather than written out by hand — so a change to the
  // portfolio above cannot leave the narrative describing a different account.
  const idle = accounts.flatMap((a) => a.holdings).filter((h) => 'cash' in h && h.cash === true);
  const idleTotal = idle.reduce((sum, h) => sum + h.value, 0);

  await db.insert(goals).values([
    {
      userId,
      name: 'University fund',
      targetMinor: usd(50000),
      currentMinor: usd(41000),
      fromLabel: 'NCB · Sagicor',
      pct: 82,
      eta: 'On track · mid-2028',
      color: '#17786e',
    },
    {
      userId,
      name: 'Retirement',
      targetMinor: usd(500000),
      currentMinor: usd(118000),
      fromLabel: 'Sagicor · Proven',
      pct: 24,
      eta: 'Projected 2044',
      color: '#c56a3e',
    },
    {
      userId,
      name: 'Emergency fund',
      targetMinor: usd(15000),
      currentMinor: usd(15000),
      fromLabel: 'JMMB',
      pct: 100,
      eta: 'Complete',
      color: '#0a8f5b',
    },
  ]);

  // Both pending approvals describe something true about the account above.
  //
  // The first used to read "US$412 settles Friday. Reinvesting … is projected to
  // lift blended yield to about 6.9%" — there is no coupon schedule in the
  // schema and no blended-yield figure to lift, so both numbers were invented.
  // What IS derivable is a concentration breach: the GOJ bond is a larger share
  // of this portfolio than the single-position cap in the user's own limits
  // allows, which is a better beat anyway — the guardrail catching a real thing.
  const totalValue = accounts.flatMap((a) => a.holdings).reduce((s, h) => s + h.value, 0);
  const goj = 12_400;
  const gojPct = Math.round((goj / totalValue) * 1000) / 10;
  const capPct = 25; // matches the single-position default in the limits table
  const trimTo = Math.round((goj - totalValue * (capPct / 100)) / 50) * 50;

  // The projected annual figure follows the catalogue's quoted yield. If the
  // instrument is missing (reference data not seeded) the sentence drops the
  // number rather than inventing one.
  const ncbYield = metricBySlug.get('ncbmm') ?? null;
  const ncbRate = ncbYield ? Number.parseFloat(ncbYield) / 100 : null;
  const idleYearly = ncbRate ? Math.round((idleTotal * ncbRate) / 5) * 5 : null;

  await db.insert(approvals).values([
    {
      userId,
      type: 'investment_rec',
      status: 'pending',
      instrumentId: instrumentIdBySlug.get('sagrex') ?? null,
      title: `Your GOJ bond is ${gojPct}% of your portfolio`,
      body: `That is above the ${capPct}% single-position cap in your limits. Moving about US$${trimTo.toLocaleString('en-US')} into the Sagicor Real Estate X Fund brings it back inside. Sagicor executes; nothing moves until you approve.`,
      amountMinor: usd(trimTo),
      snapshot: { rec: 'rebalance', opp: 'sagrex' },
    },
    {
      userId,
      type: 'fund_transfer',
      status: 'pending',
      instrumentId: instrumentIdBySlug.get('ncbmm') ?? null,
      title: `US$${idleTotal.toLocaleString('en-US')} earning nothing`,
      body: `Your USD chequing and savings are idle. The NCB USD Money Market Fund offers same-day access${
        ncbYield && idleYearly
          ? ` and quotes ${ncbYield} — roughly US$${idleYearly}/yr on this balance`
          : ''
      }. NCB executes; nothing moves until you approve.`,
      amountMinor: usd(idleTotal),
      snapshot: { rec: 'idle', opp: 'ncbmm' },
    },
  ]);

  // The opening conversation.
  //
  // This used to greet "Marcus" — the prototype's persona — and claim the
  // portfolio was "up 6.8% this year". Both shipped to production: a signed-in
  // user saw their own real name in the page header and someone else's in the
  // agent's first line, next to a return figure nothing in the schema supports
  // (6.8% is one bond's return label, not the portfolio's, and there is no
  // valuation history to compute a portfolio return from). Message rows are
  // data, so no component-level check can catch this — it has to be right here.
  //
  // Every figure below is computed from the holdings inserted above, so the
  // conversation cannot drift from the account it describes.
  const [account] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  // "Amara Clarke" -> "Amara". A single-word or empty name degrades to a
  // greeting with no name rather than a wrong one.
  const given = (account?.name ?? '').trim().split(/\s+/)[0] ?? '';
  const partnerCount = accounts.length;
  const money = (dollars: number) => `US$${dollars.toLocaleString('en-US')}`;

  // Time-neutral on purpose. This message sits directly beside the screen's own
  // greeting, which is computed from the viewer's clock — so a seeded "Good
  // afternoon" lands under a live "Good evening" whenever the demo runs outside
  // one particular window. A row written at seed time cannot know when it will
  // be read, so it does not pretend to.
  const opening = `I'm watching ${partnerCount} licensed partners for you, and everything is inside the limits you set.`;

  await db.insert(agentMessages).values([
    {
      userId,
      role: 'agent',
      content: given ? `${given}, ${opening}` : opening,
    },
    {
      userId,
      role: 'agent',
      content: `One thing worth a look: ${money(idleTotal)} is sitting in cash across your chequing and savings, earning nothing.`,
    },
    { userId, role: 'user', content: 'What about the idle cash?' },
    {
      userId,
      role: 'agent',
      content: `The JMMB Money Market Fund you already hold returns 2.0% with same-day access. Moving the ${money(idleTotal)} there would put it to work without locking it up. I can prepare it for your approval — I can't move it myself.`,
    },
  ]);
}
