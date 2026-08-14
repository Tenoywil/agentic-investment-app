import { type Transaction, instruments, orders as ordersTable, partners } from '@ccn/db';
import { proposeOrderSchema } from '@ccn/domain';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../context';
import { withTenant } from '../context';
import { auditAppend, createOrder } from '../db-fns';
import { requireAuth } from '../middleware';
import { readOrDegrade } from '../migrations';
import { adapterFor } from '../services/adapters';
import { loadInstrument, runGate } from '../services/gate';
import { maskRef } from './util';

/**
 * Orders. GET lists the caller's orders; POST is the exec-modal "authorize &
 * route" path — the proposal passes the Limits Engine gate, then (unless blocked)
 * reaches the `create_order` choke point. The live human tap satisfies a
 * requires-approval verdict; only `blocked` stops here.
 */
export function ordersRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', requireAuth(deps));

  /**
   * The caller's own orders, newest first.
   *
   * Joined to the instrument and the executing partner, because the columns
   * alone name an order by two UUIDs. This route existed and nothing consumed
   * it: a person authorised an order and it disappeared — no screen told them
   * whether their institution had accepted it, settled it or turned it down.
   *
   * LEFT on both: `instrument_id` is nullable, and an order must not vanish
   * from its owner's list because a join found nothing.
   */
  app.get('/', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    /** Everything that existed before `0019` added the settlement columns. */
    const base = {
      id: ordersTable.id,
      status: ordersTable.status,
      amountMinor: ordersTable.amountMinor,
      currency: ordersTable.currency,
      instrumentName: instruments.name,
      instrumentAbbr: instruments.abbr,
      partnerName: partners.name,
      partnerCode: partners.code,
      settlementEta: ordersTable.settlementEta,
      rejectedReason: ordersTable.rejectedReason,
      createdBy: ordersTable.createdBy,
      createdAt: ordersTable.createdAt,
      acceptedAt: ordersTable.acceptedAt,
      settledAt: ordersTable.settledAt,
    };
    // What the firm reported when it settled. Null throughout means the firm
    // did not report it, and the screen says nothing rather than printing a
    // zero the firm never claimed.
    const settlement = {
      unitPriceMinor: ordersTable.unitPriceMinor,
      units: ordersTable.units,
      feeMinor: ordersTable.feeMinor,
      externalRef: ordersTable.externalRef,
    };
    const mine = eq(ordersTable.userId, tenant.user.id);

    const rows = await withTenant(deps, tenant, (tx) =>
      /**
       * On a database without `0019` the settlement columns do not exist. The
       * fallback drops them and serves the rest, which is what this screen
       * showed before that migration — the four figures are absent rather than
       * wrong, and "settled" without a price is exactly the state those rows
       * are actually in on such a database.
       *
       * The two queries are written out rather than shared behind a helper:
       * Drizzle's builder types do not survive being made generic over the
       * column set, and a cast to make them would be a cast over the one thing
       * this function exists to get right.
       */
      readOrDegrade(
        deps,
        'a customer\u2019s order list',
        tx,
        (t) =>
          t
            .select({ ...base, ...settlement })
            .from(ordersTable)
            .leftJoin(instruments, eq(instruments.id, ordersTable.instrumentId))
            .leftJoin(partners, eq(partners.id, ordersTable.partnerId))
            .where(mine)
            .orderBy(desc(ordersTable.createdAt)),
        async (t) => {
          const legacy = await t
            .select(base)
            .from(ordersTable)
            .leftJoin(instruments, eq(instruments.id, ordersTable.instrumentId))
            .leftJoin(partners, eq(partners.id, ordersTable.partnerId))
            .where(mine)
            .orderBy(desc(ordersTable.createdAt));
          return legacy.map((r) => ({
            ...r,
            unitPriceMinor: null,
            units: null,
            feeMinor: null,
            externalRef: null,
          }));
        },
      ),
    );
    return c.json({ orders: rows });
  });

  app.post('/', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const parsed = proposeOrderSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);
    const { instrumentId, amountMinor, currency, idempotencyKey } = parsed.data;

    const result = await withTenant(deps, tenant, async (tx) => {
      const instrument = await loadInstrument(tx, instrumentId);
      if (!instrument) return { status: 404 as const, body: { error: 'instrument not found' } };
      if (!instrument.partnerId || !instrument.partnerCode) {
        return { status: 409 as const, body: { error: 'instrument has no executing partner' } };
      }
      // A listing paused between the marketplace loading and this tap. The
      // card is gone from /api/opportunities, but a page held open still has
      // the id, so the refusal has to be here as well as in the query.
      if (instrument.listingStatus !== 'live') {
        return {
          status: 409 as const,
          body: { error: 'this product is no longer offered by the listing firm' },
        };
      }
      const partnerCode = instrument.partnerCode;
      const decision = await runGate(tx, {
        userId: tenant.user.id,
        instrument,
        amountMinor,
        currency,
      });
      if (decision.decision === 'blocked') {
        return {
          status: 200 as const,
          body: { decision: 'blocked', code: decision.code, reasons: decision.reasons },
        };
      }
      const key = idempotencyKey ?? crypto.randomUUID();
      const order = await createOrder(tx, {
        userId: tenant.user.id,
        partnerId: instrument.partnerId,
        instrumentId,
        approvalId: null,
        amountMinor,
        currency,
        idempotencyKey: key,
        clientRef: maskRef(tenant.user.id),
        createdBy: 'user',
      });

      /**
       * Route the instruction to the partner.
       *
       * `placeOrder` is the one method on the adapter port that carries the
       * product's whole claim — "CCN routes signed instructions; the licensed
       * firm executes, custodies and settles" — and nothing had ever called it.
       * An order was a row in this database and a queue item a human at the firm
       * had to notice, while the receipt told the investor CCN had routed their
       * instruction to that firm. It had not; it had written it down.
       *
       * Idempotent on the same key the order carries, so a retried request
       * cannot place a second instruction.
       *
       * A routing failure does not fail the request. The order exists, it is
       * correctly in `created`, and the operator's queue is still a real path to
       * execution — but it is audited as unrouted rather than reported as
       * routed, because the difference is exactly the thing that was being
       * misstated.
       */
      let partnerRef: string | null = null;
      try {
        const { adapter } = await adapterFor(tx, partnerCode, 'trade', () => Date.now());
        const placed = await adapter.placeOrder(
          { instrumentSlug: instrument.slug, amountMinor, currency },
          key,
        );
        partnerRef = placed.partnerRef;
        await auditAppend(tx, {
          actorType: 'user',
          actorId: tenant.user.id,
          userId: tenant.user.id,
          partnerId: instrument.partnerId,
          action: 'order.routed',
          entityType: 'orders',
          entityId: order.id,
          detail: { partnerRef, settlementEta: placed.settlementEta },
        });
      } catch (error) {
        deps.logger.error(
          'the order was created but could not be routed to the partner; it stands in their queue unrouted',
          { orderId: order.id, partner: partnerCode, error },
        );
        await auditAppend(tx, {
          actorType: 'system',
          actorId: null,
          userId: tenant.user.id,
          partnerId: instrument.partnerId,
          action: 'order.routing_failed',
          entityType: 'orders',
          entityId: order.id,
          detail: { partner: partnerCode },
        });
      }

      return {
        status: 201 as const,
        body: { decision: 'created', gate: decision.code, order, partnerRef },
      };
    });
    return c.json(result.body, result.status);
  });

  return app;
}
