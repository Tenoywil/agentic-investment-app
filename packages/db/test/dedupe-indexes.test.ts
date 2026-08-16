import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/client';
import { approvals, instruments, partners, user } from '../src/schema';

/**
 * The duplicate-card backstop (0029): one PENDING approval per
 * (user, instrument), enforced by a partial unique index — the guard the
 * application's pre-checks lean on when two writers race. A decided card
 * must not block a new one; a second pending card must never exist.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite('one pending card per instrument', () => {
  const handle = createDb(DATABASE_URL ?? '', { max: 2 });
  const { db } = handle;
  const tag = `dedupe-${Date.now()}`;

  let userId = '';
  let partnerId = '';
  let instrumentId = '';

  beforeAll(async () => {
    const [u] = await db
      .insert(user)
      .values({ name: tag, email: `${tag}@x.com`, emailVerified: true })
      .returning({ id: user.id });
    userId = u?.id ?? '';
    const [p] = await db
      .insert(partners)
      .values({ code: `DD${tag.slice(-4)}`, name: 'Dedupe Test Capital' })
      .returning({ id: partners.id });
    partnerId = p?.id ?? '';
    const [i] = await db
      .insert(instruments)
      .values({
        slug: `${tag}-fund`,
        abbr: 'DDF',
        type: 'fund',
        partnerId,
        risk: 'low',
        name: 'Dedupe Test Fund',
        minInvestmentMinor: 10_000n,
      })
      .returning({ id: instruments.id });
    instrumentId = i?.id ?? '';
  });

  afterAll(async () => {
    if (userId) await db.delete(user).where(eq(user.id, userId));
    if (instrumentId) await db.delete(instruments).where(eq(instruments.id, instrumentId));
    if (partnerId) await db.delete(partners).where(eq(partners.id, partnerId));
    await handle.close();
  });

  const card = () => ({
    userId,
    type: 'investment_rec' as const,
    status: 'pending' as const,
    instrumentId,
    title: 'Dedupe Test Fund · US$100',
    amountMinor: 10_000n,
    currency: 'USD' as const,
  });

  test('a second pending card for the same instrument cannot exist', async () => {
    await db.insert(approvals).values(card());
    // The racing writer's insert comes back empty instead of duplicating.
    const raced = await db.insert(approvals).values(card()).onConflictDoNothing().returning();
    expect(raced).toHaveLength(0);

    const pending = await db.select().from(approvals).where(eq(approvals.userId, userId));
    expect(pending).toHaveLength(1);
  });

  test('a decided card frees the slot — the index constrains pending only', async () => {
    await db
      .update(approvals)
      .set({ status: 'rejected', decidedAt: new Date() })
      .where(eq(approvals.userId, userId));
    const again = await db.insert(approvals).values(card()).onConflictDoNothing().returning();
    expect(again).toHaveLength(1);
  });
});
