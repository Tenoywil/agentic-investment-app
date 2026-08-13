import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  createDb,
  goals,
  instruments,
  kycFunnelStages,
  kycStatus,
  partnerKpis,
  partners,
  planningProducts,
  productListings,
  riskProfiles,
  user,
  withRls,
} from '@ccn/db';
import { eq } from 'drizzle-orm';

/**
 * Live-data screens added alongside Gateway: opportunities, planning, onboarding,
 * and the console's remaining tabs. Each reuses an existing table (all seeded in
 * Phase 1-2), so these tests exercise the RLS scoping and the state each route
 * writes, not new schema. Runs only against a migrated Postgres (export
 * DATABASE_URL locally; CI provides one).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;
const APP = 'ccn_app';

suite('screens: opportunities, planning, onboarding, console tabs', () => {
  const handle = createDb(DATABASE_URL ?? '', { max: 6 });
  const { db } = handle;
  const tag = `screens-${Date.now()}`;

  let u1 = '';
  let u2 = '';
  let ncbId = '';
  let sagId = '';

  beforeAll(async () => {
    await db
      .insert(partners)
      .values([
        { code: 'NCB', name: 'National Commercial Bank' },
        { code: 'SAG', name: 'Sagicor Investments' },
      ])
      .onConflictDoNothing({ target: partners.code });
    const prows = await db.select({ id: partners.id, code: partners.code }).from(partners);
    ncbId = prows.find((p) => p.code === 'NCB')?.id ?? '';
    sagId = prows.find((p) => p.code === 'SAG')?.id ?? '';

    const users = await db
      .insert(user)
      .values([
        { name: 'Screens One', email: `${tag}-1@x.com`, emailVerified: true },
        { name: 'Screens Two', email: `${tag}-2@x.com`, emailVerified: true },
      ])
      .returning({ id: user.id });
    u1 = users[0]?.id ?? '';
    u2 = users[1]?.id ?? '';

    await db.insert(instruments).values([
      {
        slug: `${tag}-open`,
        abbr: 'OPN',
        type: 'bond',
        partnerId: ncbId,
        risk: 'low',
        name: 'Open Bond',
        minInvestmentMinor: 10_000n,
        blocked: false,
      },
      {
        slug: `${tag}-blocked`,
        abbr: 'BLK',
        type: 'private',
        partnerId: ncbId,
        risk: 'high',
        name: 'Screened-out Note',
        minInvestmentMinor: 2_500_000n,
        blocked: true,
        blockReasons: ['too large for a single position'],
      },
    ]);
    await db
      .insert(planningProducts)
      .values({ code: `${tag}-LI`, title: 'Life insurance', status: 'recommended' })
      .onConflictDoNothing({ target: planningProducts.code });
  });

  afterAll(async () => {
    await handle.close();
  });

  test('opportunities: instruments list includes the blocked one with its reasons', async () => {
    const rows = await withRls(db, { dbRole: APP }, (tx) =>
      tx
        .select({
          slug: instruments.slug,
          blocked: instruments.blocked,
          blockReasons: instruments.blockReasons,
        })
        .from(instruments)
        .where(eq(instruments.partnerId, ncbId)),
    );
    const blocked = rows.find((r) => r.slug === `${tag}-blocked`);
    expect(blocked?.blocked).toBe(true);
    expect(blocked?.blockReasons).toContain('too large for a single position');
    expect(rows.some((r) => r.slug === `${tag}-open`)).toBe(true);
  });

  test('planning: a goal is scoped to its owner, invisible to another user', async () => {
    await withRls(db, { userId: u1, dbRole: APP }, (tx) =>
      tx.insert(goals).values({ userId: u1, name: 'University fund', targetMinor: 5_000_000n }),
    );
    const mine = await withRls(db, { userId: u1, dbRole: APP }, (tx) =>
      tx.select().from(goals).where(eq(goals.userId, u1)),
    );
    expect(mine.some((g) => g.name === 'University fund')).toBe(true);

    const theirs = await withRls(db, { userId: u2, dbRole: APP }, (tx) =>
      tx.select().from(goals).where(eq(goals.userId, u1)),
    );
    expect(theirs).toHaveLength(0);
  });

  test('planning: the products catalog is shared reference data', async () => {
    const rows = await withRls(db, { userId: u1, dbRole: APP }, (tx) =>
      tx
        .select()
        .from(planningProducts)
        .where(eq(planningProducts.code, `${tag}-LI`)),
    );
    expect(rows).toHaveLength(1);
  });

  test('onboarding: identity -> risk -> funds progresses kyc_status toward tier2', async () => {
    await withRls(db, { userId: u1, dbRole: APP }, (tx) =>
      tx
        .insert(kycStatus)
        .values({ userId: u1, identityVerified: true, tier: 'tier1' })
        .onConflictDoUpdate({
          target: kycStatus.userId,
          set: { identityVerified: true },
        }),
    );
    await withRls(db, { userId: u1, dbRole: APP }, (tx) =>
      tx.insert(riskProfiles).values({
        userId: u1,
        answers: { q1: 3, q2: 3, q3: 3 },
        score: 9,
        band: 'high_moderate',
      }),
    );
    await withRls(db, { userId: u1, dbRole: APP }, (tx) =>
      tx
        .insert(kycStatus)
        .values({ userId: u1, fundsConfirmed: true, sources: ['salary'], tier: 'tier2' })
        .onConflictDoUpdate({
          target: kycStatus.userId,
          set: { fundsConfirmed: true, sources: ['salary'], tier: 'tier2' },
        }),
    );

    const [status] = await withRls(db, { userId: u1, dbRole: APP }, (tx) =>
      tx.select().from(kycStatus).where(eq(kycStatus.userId, u1)),
    );
    expect(status?.identityVerified).toBe(true);
    expect(status?.fundsConfirmed).toBe(true);
    expect(status?.tier).toBe('tier2');

    // Another user cannot read u1's KYC status.
    const theirs = await withRls(db, { userId: u2, dbRole: APP }, (tx) =>
      tx.select().from(kycStatus).where(eq(kycStatus.userId, u1)),
    );
    expect(theirs).toHaveLength(0);
  });

  test('console: products/kpis/funnel are scoped to the operator partner', async () => {
    await db
      .insert(productListings)
      .values({ partnerId: sagId, name: 'Sagicor Growth Fund', clients: 12 });
    await db.insert(partnerKpis).values({ partnerId: sagId, label: 'AUM', value: 'US$4.2M' });
    await db.insert(kycFunnelStages).values({ partnerId: sagId, label: 'Applied', count: 40 });

    const asSag = { partnerId: sagId, dbRole: APP };
    const products = await withRls(db, asSag, (tx) =>
      tx.select().from(productListings).where(eq(productListings.partnerId, sagId)),
    );
    expect(products.some((p) => p.name === 'Sagicor Growth Fund')).toBe(true);

    const asNcb = { partnerId: ncbId, dbRole: APP };
    const crossPartner = await withRls(db, asNcb, (tx) =>
      tx.select().from(productListings).where(eq(productListings.partnerId, sagId)),
    );
    expect(crossPartner).toHaveLength(0);
  });
});
