import { describe, expect, it } from 'bun:test';
import { buildContext } from './context';
import { sampleSnapshot } from './eval-fixtures';

/**
 * The agent can answer the three questions people actually ask after acting:
 * where is my order, has the firm accepted me, what's waiting on me.
 *
 * The sentences are composed deterministically in the context, not left to the
 * model — so what the agent narrates is the process the product runs. These
 * tests pin the claims that must never drift: the firm is named as the party
 * that executes and settles (CCN never), a rejection carries its reason, and a
 * settled order does not promise a portfolio position the product has not
 * created.
 */
describe('getActivity', () => {
  const ctx = buildContext(sampleSnapshot());

  it('narrates an accepted order with the date the firm committed to', () => {
    const [order] = ctx.getActivity().orders;
    expect(order?.status).toBe('accepted');
    expect(order?.state).toContain('NCB accepted it');
    expect(order?.state).toContain('Aug 17, 2026');
  });

  it('names the firm, never CCN, as the executing party', () => {
    for (const order of ctx.getActivity().orders) {
      expect(order.state).not.toContain('CCN');
    }
  });

  it('reports what awaits the user, with when it started waiting', () => {
    const [approval] = ctx.getActivity().approvals;
    expect(approval?.title).toContain('Barita money market');
    expect(approval?.amount).toBe('US$2,000');
    expect(approval?.waitingSince).toContain('Aug 12, 2026');
  });

  it('says a pending connection reads nothing until the firm accepts', () => {
    const [connection] = ctx.getActivity().connections;
    expect(connection?.status).toBe('pending');
    expect(connection?.state).toContain('Nothing is read from them until they accept');
  });

  it('a settled order does not claim a portfolio position that does not exist', () => {
    const snapshot = sampleSnapshot();
    const order = snapshot.activity.orders[0];
    if (!order) throw new Error('fixture lost its order');
    order.status = 'settled';
    order.settledAt = '2026-08-17T15:00:00.000Z';
    order.unitPriceMinor = 10_025n;
    const [settled] = buildContext(snapshot).getActivity().orders;
    expect(settled?.state).toContain('Settled on Aug 17, 2026');
    expect(settled?.state).toContain('US$100'); // the reported unit price
    // The honest wording: it APPEARS once the firm reports it — not "it is in
    // your portfolio", which settle_order does not make true.
    expect(settled?.state).toContain('once the firm next reports it');
  });

  it('a rejection reaches the user with its reason', () => {
    const snapshot = sampleSnapshot();
    const order = snapshot.activity.orders[0];
    if (!order) throw new Error('fixture lost its order');
    order.status = 'rejected';
    order.rejectedReason = 'position limit reached at the desk';
    const [rejected] = buildContext(snapshot).getActivity().orders;
    expect(rejected?.state).toContain('position limit reached at the desk');
  });
});
