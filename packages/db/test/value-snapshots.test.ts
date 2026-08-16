import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import { createDb } from '../src/client';
import { connectedAccounts, holdings, partners, user, valueSnapshots } from '../src/schema';

/**
 * The valuation recorder (0031): one row per investor per day, one per firm
 * per day, computed from real holdings — cash split out for the investor,
 * client count for the firm — and idempotent per day, so an hourly check can
 * call it freely and a re-run refreshes today instead of duplicating it.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite('value snapshot recorder', () => {
  const handle = createDb(DATABASE_URL ?? '', { max: 2 });
  const { db } = handle;
  const tag = `vsnap-${Date.now()}`;

  let userId = '';
  let partnerId = '';

  beforeAll(async () => {
    const [u] = await db
      .insert(user)
      .values({ name: tag, email: `${tag}@x.com`, emailVerified: true })
      .returning({ id: user.id });
    userId = u?.id ?? '';
    const [p] = await db
      .insert(partners)
      .values({ code: `VS${tag.slice(-4)}`, name: 'Snapshot Test Capital' })
      .returning({ id: partners.id });
    partnerId = p?.id ?? '';
    const [acct] = await db
      .insert(connectedAccounts)
      .values({ userId, partnerId, label: tag, status: 'active' })
      .returning({ id: connectedAccounts.id });
    await db.insert(holdings).values([
      {
        userId,
        connectedAccountId: acct?.id ?? '',
        instrumentId: null,
        name: 'Cash',
        valueMinor: 300_000n,
      },
    ]);
  });

  afterAll(async () => {
    if (userId) await db.delete(user).where(eq(user.id, userId));
    if (partnerId) await db.delete(partners).where(eq(partners.id, partnerId));
    await handle.close();
  });

  test('records the investor curve point and the firm curve point from holdings', async () => {
    await db.execute(sql`select record_value_snapshots()`);

    const [mine] = await db
      .select()
      .from(valueSnapshots)
      .where(and(eq(valueSnapshots.scope, 'user'), eq(valueSnapshots.userId, userId)));
    expect(mine?.netWorthMinor).toBe(300_000n);
    expect(mine?.cashMinor).toBe(300_000n);

    const [firm] = await db
      .select()
      .from(valueSnapshots)
      .where(and(eq(valueSnapshots.scope, 'partner'), eq(valueSnapshots.partnerId, partnerId)));
    expect(firm?.netWorthMinor).toBe(300_000n);
    expect(firm?.clients).toBe(1);
  });

  test('a same-day re-run refreshes today rather than duplicating it', async () => {
    // The portfolio moved during the day; the recorder runs again.
    await db.update(holdings).set({ valueMinor: 500_000n }).where(eq(holdings.userId, userId));
    await db.execute(sql`select record_value_snapshots()`);

    const rows = await db
      .select()
      .from(valueSnapshots)
      .where(and(eq(valueSnapshots.scope, 'user'), eq(valueSnapshots.userId, userId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.netWorthMinor).toBe(500_000n);
  });
});
