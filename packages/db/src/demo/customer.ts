import { eq } from 'drizzle-orm';
import type { Database } from '../client';
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
 */
export async function seedDemoCustomer(db: Database, userId: string): Promise<void> {
  // Reference data the block below joins against. Seeded separately by the CLI;
  // absent rows simply leave a holding unlinked rather than failing.
  const partnerRows = await db.select({ id: partners.id, code: partners.code }).from(partners);
  const partnerIdByCode = new Map(partnerRows.map((p) => [p.code as string, p.id]));
  const instrumentRows = await db
    .select({ id: instruments.id, slug: instruments.slug })
    .from(instruments);
  const instrumentIdBySlug = new Map(instrumentRows.map((i) => [i.slug, i.id]));

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
        { name: 'USD Chequing', value: 1000, ret: '—', slug: null },
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
        { name: 'USD Savings', value: 1150, ret: '—', slug: null },
      ],
    },
  ];
  for (const acc of accounts) {
    const partnerId = partnerIdByCode.get(acc.code);
    if (!partnerId) continue;
    const [account] = await db
      .insert(connectedAccounts)
      .values({ userId, partnerId, label: acc.label })
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

  await db.insert(approvals).values([
    {
      userId,
      type: 'investment_rec',
      status: 'pending',
      instrumentId: instrumentIdBySlug.get('sagrex') ?? null,
      title: 'Put your GOJ coupon to work',
      body: 'US$412 settles Friday. Reinvesting into the Real Estate X Fund is projected to lift blended yield to about 6.9%. Sagicor executes.',
      amountMinor: usd(412),
      snapshot: { rec: 'reinvest', opp: 'sagrex' },
    },
    {
      userId,
      type: 'fund_transfer',
      status: 'pending',
      instrumentId: instrumentIdBySlug.get('ncbmm') ?? null,
      title: 'US$2,150 earning nothing',
      body: 'Sweep your USD cash into the NCB Money Market Fund, projected ~US$110/yr at the current rate, same-day access. NCB executes.',
      amountMinor: usd(2150),
      snapshot: { rec: 'idle', opp: 'ncbmm' },
    },
  ]);

  await db.insert(agentMessages).values([
    {
      userId,
      role: 'agent',
      content:
        'Good afternoon, Marcus. Your portfolio is up 6.8% this year and everything is within your limits.',
    },
    {
      userId,
      role: 'agent',
      content:
        'Two things could use a look: a GOJ coupon settling Friday, and US$2,150 sitting idle.',
    },
    { userId, role: 'user', content: 'What about the idle cash?' },
    {
      userId,
      role: 'agent',
      content:
        'Your US$2,150 is earning nothing. Moving it to the NCB Money Market Fund adds about US$110/yr with same-day access. Want me to prepare it?',
    },
  ]);
}
