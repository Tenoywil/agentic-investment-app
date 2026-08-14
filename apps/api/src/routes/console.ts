import type { Transaction } from '@ccn/db';
import {
  auditLog,
  instruments,
  orders as ordersTable,
  partners,
  productListings,
  reconciliationItems,
} from '@ccn/db';
import { rejectSchema } from '@ccn/domain';
import { formatMoney, money } from '@ccn/money';
import { and, desc, eq, sql } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import type { AppDeps, AppEnv, TenantContext } from '../context';
import { withTenant } from '../context';
import {
  acceptOrder,
  auditAppend,
  partnerClients,
  partnerReviewClient,
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
/**
 * Whether a database error was raised by a particular RAISE EXCEPTION.
 *
 * Drizzle wraps a driver error in one of its own — "Failed query: select …" —
 * so the message a PL/pgSQL function raised is on `cause`, not on the error
 * itself. Matching only the outer message silently loses every distinction the
 * function bothered to draw, which is how a "you have not finished onboarding"
 * becomes an unhelpful generic 409.
 */
function raisedBy(err: unknown, fragment: string): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 4; depth++) {
    if (e instanceof Error) {
      if (e.message.includes(fragment)) return true;
      e = e.cause;
    } else return false;
  }
  return false;
}

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

  // ---- Clients: the people who linked an account here, and their KYC ----

  /**
   * The firm's clients, pending reviews first.
   *
   * The console's Clients tab has always been titled "Clients & KYC" and has
   * never shown a client. It had a seeded funnel of counts and a reconciliation
   * queue — nothing that named a person, and no way to admit or refuse one. An
   * investor could link an account at a firm and the firm was never told.
   *
   * The KYC package is the client's own: CCN records the verified outcome, the
   * partner remains the regulated owner. It becomes visible to this firm because
   * the client linked an account here, and the database enforces that join
   * rather than this handler.
   *
   * `holdings_value_minor` is a bigint and crosses the wire as a string, like
   * every other bigint column.
   */
  app.get('/clients', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);
    const clients = await withTenant(deps, tenant, (tx) => partnerClients(tx));
    return c.json({ clients });
  });

  /**
   * Accept or decline a pending client.
   *
   * Both verbs are one handler because they are one decision with one guarded
   * transition behind them, and splitting them would let the two drift.
   *
   * A failure here is a 409 rather than a 404: the connection was not pending at
   * this firm, or the person has completed no KYC, and both are states the
   * operator can see on the row they just acted on. The database's message is
   * not forwarded — it names internal ids — but the two cases are distinguished
   * because the operator's next move differs.
   */
  const review = (accept: boolean) => async (c: Context<AppEnv>) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);

    let reason: string | null = null;
    if (!accept) {
      const parsed = rejectSchema.safeParse(await c.req.json().catch(() => ({})));
      if (!parsed.success)
        return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);
      reason = parsed.data.reason ?? 'declined by partner';
    }

    const id = c.req.param('id');
    try {
      const status = await withTenant(deps, tenant, (tx) =>
        partnerReviewClient(tx, id, accept, reason),
      );
      deps.logger.info('partner reviewed a client', { partner: scope.partnerId, status });
      return c.json({ status });
    } catch (err) {
      if (raisedBy(err, 'has completed no KYC')) {
        return c.json(
          {
            error:
              'This person has not finished onboarding, so CCN has no verified KYC to pass you yet.',
          },
          409,
        );
      }
      return c.json({ error: 'that client is not awaiting a decision here' }, 409);
    }
  };

  app.post('/clients/:id/accept', review(true));
  app.post('/clients/:id/decline', review(false));

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

  /**
   * The firm's numbers, computed from its own rows.
   *
   * This read `partner_kpis`, a table with no writer anywhere in the product —
   * the seed leaves it empty on purpose (packages/db/src/seed.ts) after the
   * invented "Referred AUM US$48.2M" and "1,284 funded clients" were removed
   * from the prototype. Leaving them out was the right call. Leaving a reader
   * pointed at an empty table was not: the tiles never appeared, the tour step
   * that describes them narrated a grid that could not exist, and an operator
   * had no way to see the business CCN was sending them.
   *
   * So they are derived instead, from the four things this partner genuinely
   * owns: who asked to become their client, who they accepted, what those
   * clients hold with them, and what CCN has routed. Nothing here is a figure
   * the database cannot answer for.
   */
  app.get('/kpis', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);

    const [row] = await withTenant(
      deps,
      tenant,
      async (tx) =>
        // A single statement rather than four round trips, and every count scoped
        // to this partner — RLS would enforce it anyway, and saying so in the
        // query keeps the intent legible next to the numbers.
        (await tx.execute(sql`
        select
          (select count(*) from connected_accounts
             where partner_id = ${scope.partnerId} and status = 'active')      as active_clients,
          (select count(*) from connected_accounts
             where partner_id = ${scope.partnerId} and status = 'pending')     as pending_clients,
          (select coalesce(sum(h.value_minor), 0) from holdings h
             join connected_accounts ca on ca.id = h.connected_account_id
             where ca.partner_id = ${scope.partnerId} and ca.status = 'active') as aum_minor,
          (select count(*) from orders
             where partner_id = ${scope.partnerId} and status = 'settled')     as settled_orders
      `)) as unknown as [Record<string, string>],
    );

    const aumMinor = BigInt(row?.aum_minor ?? '0');
    const kpis = [
      {
        id: 'active-clients',
        label: 'Clients you accepted',
        value: String(row?.active_clients ?? 0),
        sub: `${row?.pending_clients ?? 0} awaiting your review`,
        sortOrder: 0,
      },
      {
        id: 'aum',
        label: 'Held by CCN-referred clients',
        value: formatMoney(money(aumMinor, 'USD')),
        sub: 'Across the accounts you have accepted',
        sortOrder: 1,
      },
      {
        id: 'settled',
        label: 'Orders settled',
        value: String(row?.settled_orders ?? 0),
        sub: 'Routed by CCN, executed by you',
        sortOrder: 2,
      },
    ];
    return c.json({ kpis });
  });

  /**
   * Where a referred client stops.
   *
   * Same story as the KPIs: this read `kyc_funnel_stages`, which nothing writes,
   * so "No referrals yet" was permanent regardless of how many people had asked
   * to connect. The real funnel is short and every stage is a column this
   * database already holds — a request, a completed self-declaration, the firm's
   * own decision, and whether anything was ever funded into the account.
   */
  app.get('/funnel', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);

    const [row] = await withTenant(
      deps,
      tenant,
      async (tx) =>
        (await tx.execute(sql`
        select
          count(*)                                                          as requested,
          count(*) filter (where k.funds_confirmed)                         as declared,
          count(*) filter (where ca.status = 'active')                      as accepted,
          count(*) filter (where ca.status = 'active' and h.held > 0)       as funded
        from connected_accounts ca
        left join kyc_status k on k.user_id = ca.user_id
        left join lateral (
          select count(*) as held from holdings
           where connected_account_id = ca.id
        ) h on true
        where ca.partner_id = ${scope.partnerId}
      `)) as unknown as [Record<string, string>],
    );

    const requested = Number(row?.requested ?? 0);
    const stage = (id: string, label: string, count: number, sortOrder: number) => ({
      id,
      label,
      count,
      // Of the top of the funnel, not of the previous stage: an operator reading
      // "31%" wants to know what share of everyone who asked got there.
      pct: requested === 0 ? 0 : Math.round((count / requested) * 100),
      sortOrder,
    });

    return c.json({
      stages: [
        stage('requested', 'Asked to connect', requested, 0),
        stage('declared', 'Completed declarations', Number(row?.declared ?? 0), 1),
        stage('accepted', 'Accepted by you', Number(row?.accepted ?? 0), 2),
        stage('funded', 'Holding assets', Number(row?.funded ?? 0), 3),
      ],
    });
  });

  return app;
}
