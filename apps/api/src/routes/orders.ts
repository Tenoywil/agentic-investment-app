import { instruments, orders as ordersTable, partners } from '@ccn/db';
import { proposeOrderSchema } from '@ccn/domain';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../context';
import { withTenant } from '../context';
import { createOrder } from '../db-fns';
import { requireAuth } from '../middleware';
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
    const rows = await withTenant(deps, tenant, (tx) =>
      tx
        .select({
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
        })
        .from(ordersTable)
        .leftJoin(instruments, eq(instruments.id, ordersTable.instrumentId))
        .leftJoin(partners, eq(partners.id, ordersTable.partnerId))
        .where(eq(ordersTable.userId, tenant.user.id))
        .orderBy(desc(ordersTable.createdAt)),
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
      if (!instrument.partnerId) {
        return { status: 409 as const, body: { error: 'instrument has no executing partner' } };
      }
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
      const order = await createOrder(tx, {
        userId: tenant.user.id,
        partnerId: instrument.partnerId,
        instrumentId,
        approvalId: null,
        amountMinor,
        currency,
        idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
        clientRef: maskRef(tenant.user.id),
        createdBy: 'user',
      });
      return { status: 201 as const, body: { decision: 'created', gate: decision.code, order } };
    });
    return c.json(result.body, result.status);
  });

  return app;
}
