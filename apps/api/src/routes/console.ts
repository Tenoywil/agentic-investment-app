import type { Transaction } from '@ccn/db';
import {
  auditLog,
  instruments,
  kycFunnelStages,
  orders as ordersTable,
  partnerKpis,
  partners,
  productListings,
  reconciliationItems,
} from '@ccn/db';
import { rejectSchema } from '@ccn/domain';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import type { AppDeps, AppEnv, TenantContext } from '../context';
import { withTenant } from '../context';
import {
  acceptOrder,
  auditAppend,
  reconcileMatch,
  reconcileReject,
  rejectOrder,
  settleOrder,
} from '../db-fns';
import { requireAuth } from '../middleware';

/**
 * Partner console order flow. Every route requires a partner_operator bound to a
 * partner; the RLS scope and the guarded transition functions both check the
 * partner id, so an operator can only ever act on their own partner's orders and
 * only along the legal state path (created → accepted → settled). Ports the
 * prototype's acceptOrder / settleOrder.
 */
export function consoleRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', requireAuth(deps));

  /** Resolve the operator's partner scope, or a 403 descriptor. */
  function partnerScope(tenant: TenantContext): { partnerId: string } | { error: string } {
    if (!tenant.roles.includes('partner_operator') || !tenant.partnerId) {
      return { error: 'partner operator role required' };
    }
    return { partnerId: tenant.partnerId };
  }

  /**
   * Orders carry the instrument's display name and abbreviation from a LEFT
   * JOIN, because the console can only otherwise identify an order by a sliced
   * UUID — it literally printed "Instrument 8f3a2b1c" at an operator whose desk
   * is supposed to execute it. LEFT, not INNER: `orders.instrument_id` is
   * nullable, and an order with no instrument must still appear in the queue.
   */
  const orderColumns = {
    id: ordersTable.id,
    userId: ordersTable.userId,
    partnerId: ordersTable.partnerId,
    instrumentId: ordersTable.instrumentId,
    instrumentName: instruments.name,
    instrumentAbbr: instruments.abbr,
    approvalId: ordersTable.approvalId,
    status: ordersTable.status,
    amountMinor: ordersTable.amountMinor,
    currency: ordersTable.currency,
    idempotencyKey: ordersTable.idempotencyKey,
    clientRef: ordersTable.clientRef,
    settlementEta: ordersTable.settlementEta,
    rejectedReason: ordersTable.rejectedReason,
    createdBy: ordersTable.createdBy,
    createdAt: ordersTable.createdAt,
    updatedAt: ordersTable.updatedAt,
    acceptedAt: ordersTable.acceptedAt,
    settledAt: ordersTable.settledAt,
  };

  /** One order, re-read in the caller's transaction after a state transition. */
  async function selectOrder(tx: Transaction, id: string, partnerId: string) {
    const [row] = await tx
      .select(orderColumns)
      .from(ordersTable)
      .leftJoin(instruments, eq(instruments.id, ordersTable.instrumentId))
      .where(and(eq(ordersTable.id, id), eq(ordersTable.partnerId, partnerId)));
    if (!row) throw new Error('order not visible after transition');
    return row;
  }

  /** The caller's own partner row — the console's branding, regulator and
   *  agreement status, which the UI previously hardcoded as "Sagicor Group". */
  app.get('/partner', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);
    const [partner] = await withTenant(deps, tenant, (tx) =>
      tx
        .select({
          id: partners.id,
          code: partners.code,
          name: partners.name,
          kind: partners.kind,
          regulator: partners.regulator,
          agreementStatus: partners.agreementStatus,
          residency: partners.residency,
        })
        .from(partners)
        // `partners_read` is USING (true) — reference data is readable by every
        // authenticated caller — so the partner id is pinned here explicitly
        // rather than relying on RLS to scope it.
        .where(eq(partners.id, scope.partnerId)),
    );
    if (!partner) return c.json({ error: 'partner not found' }, 404);
    return c.json({ partner });
  });

  /**
   * The real, immutable audit trail (packages/db/schema/audit.ts), newest first.
   *
   * `audit_log_read` already scopes rows to this partner, but that policy also
   * admits rows where `user_id` is the caller — an operator's own customer-side
   * history. The console shows the partner's book, not the operator's personal
   * activity, so the partner id is filtered explicitly too.
   *
   * `seq` is a bigserial and crosses the wire as a numeric STRING via
   * bigintSafeJson, like every other bigint column.
   */
  app.get('/audit', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);
    const requested = Number.parseInt(c.req.query('limit') ?? '', 10);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 200) : 50;
    const entries = await withTenant(deps, tenant, (tx) =>
      tx
        .select({
          id: auditLog.id,
          seq: auditLog.seq,
          action: auditLog.action,
          entityType: auditLog.entityType,
          actorType: auditLog.actorType,
          detail: auditLog.detail,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .where(eq(auditLog.partnerId, scope.partnerId))
        .orderBy(desc(auditLog.seq))
        .limit(limit),
    );
    return c.json({ entries });
  });

  app.get('/orders', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);
    const rows = await withTenant(deps, tenant, (tx) =>
      tx
        .select(orderColumns)
        .from(ordersTable)
        .leftJoin(instruments, eq(instruments.id, ordersTable.instrumentId))
        .where(eq(ordersTable.partnerId, scope.partnerId))
        .orderBy(desc(ordersTable.createdAt)),
    );
    return c.json({ orders: rows });
  });

  const transition =
    (fn: typeof acceptOrder | typeof settleOrder) => async (c: Context<AppEnv>) => {
      const tenant = c.get('tenant');
      if (!tenant) return c.json({ error: 'authentication required' }, 401);
      const scope = partnerScope(tenant);
      if ('error' in scope) return c.json(scope, 403);
      const id = c.req.param('id');
      try {
        // Re-read rather than return the SECURITY DEFINER function's raw row:
        // that row is snake_case and instrument-less, so the client used to
        // swap a well-formed order for one whose amountMinor was `undefined`
        // and rendered "US$NaN" the moment an operator clicked Accept.
        const order = await withTenant(deps, tenant, async (tx) => {
          await fn(tx, id, scope.partnerId);
          return selectOrder(tx, id, scope.partnerId);
        });
        return c.json({ order });
      } catch {
        // The guarded UPDATE matched no row: wrong partner or illegal transition.
        return c.json({ error: 'order is not in a state you can transition' }, 409);
      }
    };

  app.post('/orders/:id/accept', transition(acceptOrder));
  app.post('/orders/:id/settle', transition(settleOrder));

  app.post('/orders/:id/reject', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);
    const parsed = rejectSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success)
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);
    const id = c.req.param('id');
    try {
      const order = await withTenant(deps, tenant, async (tx) => {
        await rejectOrder(tx, id, scope.partnerId, parsed.data.reason ?? 'rejected by partner');
        return selectOrder(tx, id, scope.partnerId);
      });
      return c.json({ order });
    } catch {
      return c.json({ error: 'order is not in a state you can reject' }, 409);
    }
  });

  // ---- Reconciliation (clients & KYC tab): match ingested statement lines ----

  app.get('/reconciliation', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);
    const rows = await withTenant(deps, tenant, (tx) =>
      tx
        .select()
        .from(reconciliationItems)
        .where(
          and(
            eq(reconciliationItems.partnerId, scope.partnerId),
            eq(reconciliationItems.status, 'pending'),
          ),
        )
        .orderBy(desc(reconciliationItems.createdAt)),
    );
    return c.json({ items: rows });
  });

  app.post('/reconciliation/:id/match', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);
    const id = c.req.param('id');
    try {
      const holdingId = await withTenant(deps, tenant, async (tx) => {
        // RLS scopes the read to this operator's partner; matching then writes
        // the holding via the SECURITY DEFINER choke point.
        const [item] = await tx
          .select({ id: reconciliationItems.id })
          .from(reconciliationItems)
          .where(
            and(eq(reconciliationItems.id, id), eq(reconciliationItems.partnerId, scope.partnerId)),
          );
        if (!item) throw new Error('not found');
        return reconcileMatch(tx, id);
      });
      return c.json({ holdingId });
    } catch {
      return c.json({ error: 'item is not pending or not yours' }, 409);
    }
  });

  app.post('/reconciliation/:id/reject', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);
    const parsed = rejectSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success)
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);
    const id = c.req.param('id');
    try {
      await withTenant(deps, tenant, async (tx) => {
        const [item] = await tx
          .select({ id: reconciliationItems.id })
          .from(reconciliationItems)
          .where(
            and(eq(reconciliationItems.id, id), eq(reconciliationItems.partnerId, scope.partnerId)),
          );
        if (!item) throw new Error('not found');
        await reconcileReject(tx, id, parsed.data.reason ?? 'rejected at reconciliation');
      });
      return c.json({ ok: true });
    } catch {
      return c.json({ error: 'item is not pending or not yours' }, 409);
    }
  });

  // ---- Overview / products / compliance tabs: partner-scoped reference data ----

  app.get('/products', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);
    // `clients`, `aum_minor` and `trend` are deliberately not selected. CCN
    // measures none of them — there is no attribution model, no AUM roll-up and
    // no time series behind those columns; they held the prototype's invented
    // figures. They are NOT NULL with a 0 default, so returning them would hand
    // the UI a zero that reads as "this product has no clients" rather than
    // "we do not compute this". Not selecting them means the console cannot
    // render the claim at all, which is the point.
    const rows = await withTenant(deps, tenant, (tx) =>
      tx
        .select({
          id: productListings.id,
          partnerId: productListings.partnerId,
          name: productListings.name,
          type: productListings.type,
          status: productListings.status,
          createdAt: productListings.createdAt,
          updatedAt: productListings.updatedAt,
        })
        .from(productListings)
        .where(eq(productListings.partnerId, scope.partnerId))
        .orderBy(desc(productListings.createdAt)),
    );
    return c.json({ products: rows });
  });

  /**
   * Flip one listing between `live` and `paused` — the console's only write to
   * its own catalogue, and the reason the Products switch is no longer a
   * disabled ornament.
   *
   * The flip is a single guarded UPDATE (CASE expression, not read-then-write)
   * so two operators racing on the same listing cannot lose one another's
   * change, and `partner_id` is in the WHERE as well as the RLS policy. No row
   * back means the listing is not this partner's, which is a 404 rather than a
   * 403: an operator must not be able to probe another firm's listing ids.
   */
  /**
   * List a product.
   *
   * The console could read its catalogue and pause a listing, and never create
   * one — the only products on the network came from `db:seed`, which writes
   * five for the anchor partner and nothing for anyone else. A partner who had
   * just been onboarded signed in to an empty catalogue with no control that
   * could change it, which is the missing half of the institution side.
   *
   * `partner_id` comes from the caller's scope and is never read from the body:
   * an operator lists for their own firm or not at all, and the RLS policy
   * enforces the same thing underneath.
   *
   * A new listing starts `live`, the column's default — the operator is
   * deliberately listing it, and the pause switch beside it is one click away.
   * `clients`, `aum_minor` and `trend` are left at their defaults and are not
   * accepted here: CCN measures none of them, and a figure an operator typed
   * about their own product is not a measurement.
   */
  app.post('/products', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);

    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const type = typeof body?.type === 'string' ? body.type.trim() : '';
    if (name.length < 2) return c.json({ error: 'a product needs a name' }, 400);
    if (name.length > 140) return c.json({ error: 'that name is too long' }, 400);
    if (type.length > 60) return c.json({ error: 'that type is too long' }, 400);

    const product = await withTenant(deps, tenant, async (tx) => {
      const [row] = await tx
        .insert(productListings)
        .values({ partnerId: scope.partnerId, name, type: type || null })
        .returning();
      if (!row) return null;
      await auditAppend(tx, {
        actorType: 'user',
        actorId: tenant.user.id,
        userId: tenant.user.id,
        partnerId: scope.partnerId,
        action: 'product_listing.created',
        entityType: 'product_listings',
        entityId: row.id,
        detail: { name: row.name, type: row.type, status: row.status },
      });
      return row;
    });

    if (!product) return c.json({ error: 'the product was not listed' }, 400);
    deps.logger.info('partner listed a product', { partner: scope.partnerId, product: product.id });
    return c.json({ product }, 201);
  });

  app.post('/products/:id/live', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);
    const id = c.req.param('id');
    const status = await withTenant(deps, tenant, async (tx) => {
      const [row] = await tx
        .update(productListings)
        .set({
          status: sql`case when ${productListings.status} = 'live' then 'paused'::product_listing_status else 'live'::product_listing_status end`,
          updatedAt: new Date(),
        })
        .where(and(eq(productListings.id, id), eq(productListings.partnerId, scope.partnerId)))
        .returning({ status: productListings.status });
      if (!row) return null;
      // A listing going dark is exactly the kind of thing the compliance tab's
      // audit trail exists to record, so record it — through the same
      // append-only, hash-chained choke point everything else uses.
      await auditAppend(tx, {
        actorType: 'user',
        actorId: tenant.user.id,
        userId: tenant.user.id,
        partnerId: scope.partnerId,
        action: `product_listing.${row.status}`,
        entityType: 'product_listing',
        entityId: id,
        detail: { status: row.status },
      });
      return row.status;
    });
    if (!status) return c.json({ error: 'product listing not found' }, 404);
    return c.json({ status });
  });

  app.get('/kpis', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);
    const rows = await withTenant(deps, tenant, (tx) =>
      tx
        .select()
        .from(partnerKpis)
        .where(eq(partnerKpis.partnerId, scope.partnerId))
        .orderBy(asc(partnerKpis.sortOrder)),
    );
    return c.json({ kpis: rows });
  });

  app.get('/funnel', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);
    const rows = await withTenant(deps, tenant, (tx) =>
      tx
        .select()
        .from(kycFunnelStages)
        .where(eq(kycFunnelStages.partnerId, scope.partnerId))
        .orderBy(asc(kycFunnelStages.sortOrder)),
    );
    return c.json({ stages: rows });
  });

  return app;
}
