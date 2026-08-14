import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  approvals,
  connectedAccounts,
  createDb,
  partners,
  productListings,
  reconciliationItems,
  user,
} from '@ccn/db';
import { eq } from 'drizzle-orm';
import { startEventBridge } from '../src/ws/bridge';
import { WsHub } from '../src/ws/hub';

/**
 * Realtime for everything an investor or an operator waits on.
 *
 * `ccn_events` carried four notifications, all of them order transitions, so
 * every other thing a person sits and waits for happened in silence: the
 * approval card that is the product's whole premise, the firm accepting them as
 * a client, a statement landing in the reconciliation queue, a listing going
 * live. Migration 0015 puts triggers on those four tables.
 *
 * Two things are worth proving and only one is obvious. The first is that each
 * event arrives at all. The second is that it arrives at the right tenant and
 * nobody else — a listing belongs to a partner's desk and must never reach an
 * investor, and the trigger encodes that as an absent user column rather than as
 * a filter someone has to remember to write.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await wait(25);
  }
}

suite('realtime: approvals, connections, reconciliation and listings', () => {
  const handle = createDb(DATABASE_URL ?? '', { max: 4 });
  const { db } = handle;
  const tag = `rt-${Date.now()}`;

  const hub = new WsHub();
  /** What the investor's socket sees. */
  const asInvestor: string[] = [];
  /** What the partner operator's socket sees. */
  const asOperator: string[] = [];

  let userId = '';
  let partnerId = '';
  let stop: (() => Promise<void>) | null = null;

  const seen = (sink: string[], type: string) =>
    sink.map((s) => JSON.parse(s) as { type: string }).filter((e) => e.type === type);

  beforeAll(async () => {
    await db
      .insert(partners)
      .values({ code: 'NCB', name: 'National Commercial Bank' })
      .onConflictDoNothing({ target: partners.code });
    const [p] = await db.select({ id: partners.id }).from(partners).where(eq(partners.code, 'NCB'));
    partnerId = p?.id ?? '';

    const [u] = await db
      .insert(user)
      .values({ name: 'Marcus', email: `${tag}@x.com`, emailVerified: true })
      .returning({ id: user.id });
    userId = u?.id ?? '';

    hub.add({ send: (d) => asInvestor.push(d) }, { userId });
    // A different person entirely: an operator holds a partner and is not the
    // investor, so anything reaching both sinks did so on its own merits.
    hub.add({ send: (d) => asOperator.push(d) }, { userId: `${tag}-operator`, partnerId });

    stop = await startEventBridge(handle.client, hub);
  });

  afterAll(async () => {
    if (stop) await stop();
    await db.delete(approvals).where(eq(approvals.userId, userId));
    await db.delete(reconciliationItems).where(eq(reconciliationItems.userId, userId));
    await db.delete(connectedAccounts).where(eq(connectedAccounts.userId, userId));
    await db.delete(productListings).where(eq(productListings.name, `${tag} listing`));
    await db.delete(user).where(eq(user.id, userId));
    await handle.client.end();
  });

  test('an approval reaches the person it is waiting on', async () => {
    await db
      .insert(approvals)
      .values({ userId, type: 'investment_rec', title: 'Reinvest your coupon' });

    await waitFor(() => seen(asInvestor, 'approval.insert').length > 0);
    expect(seen(asInvestor, 'approval.insert')[0]).toMatchObject({
      type: 'approval.insert',
      user_id: userId,
      status: 'pending',
    });
    // An approval belongs to one person. It carries no partner, so an operator's
    // socket must not match it.
    expect(seen(asOperator, 'approval.insert')).toHaveLength(0);
  });

  test('a connection request reaches both the investor and the firm', async () => {
    const [row] = await db
      .insert(connectedAccounts)
      .values({ userId, partnerId })
      .returning({ id: connectedAccounts.id });

    await waitFor(() => seen(asInvestor, 'connection.insert').length > 0);
    expect(seen(asInvestor, 'connection.insert')[0]).toMatchObject({ status: 'pending' });
    expect(seen(asOperator, 'connection.insert').length).toBeGreaterThan(0);

    // The decision the investor is actually waiting on.
    await db
      .update(connectedAccounts)
      .set({ status: 'active' })
      .where(eq(connectedAccounts.id, row?.id ?? ''));

    await waitFor(() => seen(asInvestor, 'connection.update').length > 0);
    expect(seen(asInvestor, 'connection.update')[0]).toMatchObject({
      type: 'connection.update',
      status: 'active',
    });
  });

  test('a reconciliation item reaches the desk that has to clear it', async () => {
    await db.insert(reconciliationItems).values({ userId, partnerId });

    await waitFor(() => seen(asOperator, 'reconciliation.insert').length > 0);
    expect(seen(asOperator, 'reconciliation.insert')[0]).toMatchObject({ status: 'pending' });
  });

  test('a listing reaches the partner and never the investor', async () => {
    await db.insert(productListings).values({ partnerId, name: `${tag} listing` });

    await waitFor(() => seen(asOperator, 'listing.insert').length > 0);
    expect(seen(asOperator, 'listing.insert')[0]).toMatchObject({
      type: 'listing.insert',
      user_id: null,
      status: 'live',
    });
    // The check that matters: a partner's desk activity is not investor data,
    // and `shouldReceive` only keeps it that way while the payload carries no
    // user. A trigger that helpfully filled in a user id would leak one firm's
    // book to whichever investor happened to be connected.
    expect(seen(asInvestor, 'listing.insert')).toHaveLength(0);
  });
});
