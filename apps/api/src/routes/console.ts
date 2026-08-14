import type { Transaction } from '@ccn/db';
import {
  auditLog,
  instruments,
  orders as ordersTable,
  partners,
  reconciliationItems,
} from '@ccn/db';
import {
  acceptOrderSchema,
  listInstrumentSchema,
  partnerProfileSchema,
  rejectSchema,
  settleOrderSchema,
} from '@ccn/domain';
import { formatMoney, money } from '@ccn/money';
import { and, desc, eq, sql } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import type { AppDeps, AppEnv, TenantContext } from '../context';
import { withTenant } from '../context';
import type { InstrumentRow } from '../db-fns';
import {
  acceptOrder,
  auditAppend,
  partnerClientHoldings,
  partnerClients,
  partnerReviewClient,
  partnerToggleInstrument,
  partnerUpdateProfile,
  partnerUpsertInstrument,
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

/**
 * A body that failed its schema, thrown from inside a transition so the guarded
 * transition and the parse can share one handler. Distinguished from a database
 * refusal because the operator's next move differs: one is a field to correct,
 * the other is an order that is not theirs or not in that state.
 */
class BadRequest extends Error {
  constructor(
    message: string,
    readonly issues: unknown,
  ) {
    super(message);
  }
}

/** The order states a caller may filter on — the enum, not a free string. */
const ORDER_STATUSES = ['created', 'accepted', 'settled', 'rejected', 'expired'] as const;

/**
 * `limit` and `offset` from the query string, clamped.
 *
 * The same shape the audit route already used and the orders and clients routes
 * did not have at all. 200 is the ceiling rather than 500 because these rows are
 * wide; a desk exporting more than that uses the export, which says when it has
 * truncated.
 */
function readPage(c: Context<AppEnv>): { limit: number; offset: number } {
  const rawLimit = Number.parseInt(c.req.query('limit') ?? '', 10);
  const rawOffset = Number.parseInt(c.req.query('offset') ?? '', 10);
  return {
    limit: Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50,
    offset: Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0,
  };
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
    // What the firm reported at settlement. Null means it did not report the
    // figure, which the screens say rather than filling in a zero.
    unitPriceMinor: ordersTable.unitPriceMinor,
    units: ordersTable.units,
    feeMinor: ordersTable.feeMinor,
    externalRef: ordersTable.externalRef,
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
   * The firm corrects its own record.
   *
   * `partners` has an UPDATE grant and exactly one UPDATE policy —
   * `partners_admin_correct` — so an operator's transaction failed it and a
   * firm could not fix a typo in its own name. It goes through a SECURITY
   * DEFINER function rather than a new partner-scoped policy because RLS cannot
   * restrict columns, and three columns must not be a firm's to set about
   * itself: `code` resolves the executing adapter, `regulator` is a compliance
   * claim shown to investors on every deal card, and `agreement_status` gates
   * live order routing. They are not parameters, so this path cannot reach them.
   */
  app.patch('/partner', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);

    const parsed = partnerProfileSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);
    }

    const row = await withTenant(deps, tenant, (tx) =>
      partnerUpdateProfile(tx, {
        name: parsed.data.name,
        kind: parsed.data.kind ?? null,
        residency: parsed.data.residency ?? null,
      }),
    );
    return c.json({
      partner: {
        id: row.id,
        code: row.code,
        name: row.name,
        kind: row.kind,
        regulator: row.regulator,
        agreementStatus: row.agreement_status,
        residency: row.residency,
      },
    });
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

  /**
   * The firm's order queue — filtered, searchable and bounded.
   *
   * It used to take no parameters and return **every order the firm had ever
   * received**, unbounded, on every page load and again on every realtime event.
   * That is fine for a desk with nine orders and untenable for one with nine
   * thousand, and it left an operator scrolling to find the one they were asked
   * about.
   *
   * `total` accompanies the page because a count is the one thing the client
   * cannot derive once the rows are truncated, and the pager needs it.
   */
  app.get('/orders', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);

    const { limit, offset } = readPage(c);
    const status = c.req.query('status');
    const q = (c.req.query('q') ?? '').trim();

    const filters = [eq(ordersTable.partnerId, scope.partnerId)];
    if (status && (ORDER_STATUSES as readonly string[]).includes(status)) {
      filters.push(eq(ordersTable.status, status as (typeof ORDER_STATUSES)[number]));
    }
    if (q) {
      // The two things an operator is given when asked about an order: the
      // product's name, or the masked client reference on the row.
      filters.push(
        sql`(${instruments.name} ilike ${`%${q}%`} or ${ordersTable.clientRef} ilike ${`%${q}%`})`,
      );
    }
    const where = and(...filters);

    const { rows, total } = await withTenant(deps, tenant, async (tx) => ({
      rows: await tx
        .select(orderColumns)
        .from(ordersTable)
        .leftJoin(instruments, eq(instruments.id, ordersTable.instrumentId))
        .where(where)
        .orderBy(desc(ordersTable.createdAt))
        .limit(limit)
        .offset(offset),
      total: await tx
        .select({ n: sql<string>`count(*)` })
        .from(ordersTable)
        .leftJoin(instruments, eq(instruments.id, ordersTable.instrumentId))
        .where(where),
    }));

    return c.json({ orders: rows, total: Number(total[0]?.n ?? 0) });
  });

  /**
   * Accept or settle, each carrying what the firm is telling us.
   *
   * `move` runs the guarded transition inside the caller's transaction and
   * re-reads the order afterwards, rather than returning the SECURITY DEFINER
   * function's raw row: that row is snake_case and instrument-less, so the
   * client used to swap a well-formed order for one whose amountMinor was
   * `undefined` and rendered "US$NaN" the moment an operator clicked Accept.
   */
  const transition =
    (move: (tx: Transaction, id: string, partnerId: string, body: unknown) => Promise<unknown>) =>
    async (c: Context<AppEnv>) => {
      const tenant = c.get('tenant');
      if (!tenant) return c.json({ error: 'authentication required' }, 401);
      const scope = partnerScope(tenant);
      if ('error' in scope) return c.json(scope, 403);
      const id = c.req.param('id');
      const body = await c.req.json().catch(() => ({}));
      try {
        const order = await withTenant(deps, tenant, async (tx) => {
          await move(tx, id, scope.partnerId, body);
          return selectOrder(tx, id, scope.partnerId);
        });
        return c.json({ order });
      } catch (err) {
        // A rejected body is the operator's mistake to correct and says which
        // field; an unmatched UPDATE is a wrong partner or an illegal
        // transition and deliberately says neither.
        if (err instanceof BadRequest)
          return c.json({ error: err.message, issues: err.issues }, 400);
        return c.json({ error: 'order is not in a state you can transition' }, 409);
      }
    };

  app.post(
    '/orders/:id/accept',
    transition(async (tx, id, partnerId, body) => {
      const parsed = acceptOrderSchema.safeParse(body);
      if (!parsed.success) throw new BadRequest('invalid request', parsed.error.issues);
      return acceptOrder(tx, id, partnerId, parsed.data.settlementEta ?? null);
    }),
  );

  app.post(
    '/orders/:id/settle',
    transition(async (tx, id, partnerId, body) => {
      const parsed = settleOrderSchema.safeParse(body);
      if (!parsed.success) throw new BadRequest('invalid request', parsed.error.issues);
      const d = parsed.data;
      return settleOrder(tx, id, partnerId, {
        unitPriceMinor: d.unitPriceMinor ?? null,
        units: d.units ?? null,
        feeMinor: d.feeMinor ?? null,
        externalRef: d.externalRef ?? null,
      });
    }),
  );

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

    /**
     * `partner_clients()` returns a table and resolves the partner from the GUC
     * itself, so filtering happens around it rather than inside it — no change
     * to a SECURITY DEFINER function, which is the last place to put a
     * user-supplied string.
     */
    const { limit, offset } = readPage(c);
    const status = c.req.query('status');
    const q = (c.req.query('q') ?? '').trim();

    const all = await withTenant(deps, tenant, (tx) => partnerClients(tx));
    const filtered = all.filter((row) => {
      if (status && row.status !== status) return false;
      if (!q) return true;
      const needle = q.toLowerCase();
      return (
        (row.client_name ?? '').toLowerCase().includes(needle) ||
        (row.client_email ?? '').toLowerCase().includes(needle)
      );
    });

    return c.json({ clients: filtered.slice(offset, offset + limit), total: filtered.length });
  });

  /**
   * One client, opened.
   *
   * The list row carries a holdings count and a total, so the console could say
   * "4 holdings · US$12,400" and could not say what any of them were. This
   * answers the first question anyone asks about a client — what are they
   * actually in with us — and the second, what have they traded through us.
   *
   * Three reads, each scoped a different way and all to the same firm: the KYC
   * package through `partner_clients()` (the only path to it), the holdings
   * through `partner_client_holdings()` (holdings have no partner read policy),
   * and the orders through RLS, which already admits `partner_id = ours`. The
   * client's user id is taken from the row this firm can see rather than from
   * the request, so there is no id to substitute.
   */
  app.get('/clients/:id', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);
    const accountId = c.req.param('id');

    const detail = await withTenant(deps, tenant, async (tx) => {
      const client = (await partnerClients(tx)).find((row) => row.account_id === accountId);
      if (!client) return null;
      const holdings = await partnerClientHoldings(tx, accountId);
      const clientOrders = await tx
        .select(orderColumns)
        .from(ordersTable)
        .leftJoin(instruments, eq(instruments.id, ordersTable.instrumentId))
        .where(
          and(eq(ordersTable.partnerId, scope.partnerId), eq(ordersTable.userId, client.user_id)),
        )
        .orderBy(desc(ordersTable.createdAt))
        .limit(50);
      // This client's own thread of the firm's audit log. `audit_log_read`
      // scopes to the partner; `user_id` — the subject of the action, not its
      // actor — narrows it to the person.
      const history = await tx
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
        .where(and(eq(auditLog.partnerId, scope.partnerId), eq(auditLog.userId, client.user_id)))
        .orderBy(desc(auditLog.seq))
        .limit(50);
      return { client, holdings, orders: clientOrders, audit: history };
    });

    // Not found and not-yours are the same answer, so an account id cannot be
    // probed by watching which one comes back.
    if (!detail) return c.json({ error: 'client not found' }, 404);
    return c.json(detail);
  });

  /**
   * Move a client along: accept, decline, revoke, reinstate.
   *
   * Two verbs, four transitions — `accept` is also how a declined client is
   * reinstated and `decline` is also how an active one is revoked, because
   * underneath they are one guarded transition and the database picks the audit
   * action from where the row actually was. Splitting them into four routes
   * would let four things drift.
   *
   * A failure here is a 409 rather than a 404: the connection is already in
   * that state, or the person has completed no KYC, and both are states the
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
      if (raisedBy(err, 'is already')) {
        return c.json({ error: 'that client is already in that state' }, 409);
      }
      return c.json({ error: 'that client is not one of yours' }, 409);
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

  /**
   * The upsert function returns `RETURNS instruments` — the raw snake_case row
   * — while GET /products returns a Drizzle select. Mapping here keeps the two
   * identical, so the console can drop a saved product straight into the list
   * it already has instead of refetching to find out what it just wrote.
   *
   * `slug` and `partner_id` are deliberately not returned: neither is the
   * operator's to see or set, and echoing an id back invites a client to start
   * sending it.
   */
  function toConsoleProduct(row: InstrumentRow) {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      abbr: row.abbr,
      currency: row.currency,
      minInvestmentMinor: row.min_investment_minor,
      term: row.term,
      metric: row.metric,
      metricLabel: row.metric_label,
      risk: row.risk,
      description: row.description,
      region: row.region,
      status: row.listing_status,
      blocked: row.blocked,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * The firm's own listings, from the table the marketplace reads.
   *
   * This used to read `product_listings`, which the marketplace has no
   * relationship to at all — so a partner could list a fund, see it here, and no
   * investor would ever be shown it. `product_listings` is left alone; nothing
   * writes it from here any more.
   */
  app.get('/products', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);
    const rows = await withTenant(deps, tenant, (tx) =>
      tx
        .select({
          id: instruments.id,
          name: instruments.name,
          type: instruments.type,
          abbr: instruments.abbr,
          currency: instruments.currency,
          minInvestmentMinor: instruments.minInvestmentMinor,
          term: instruments.term,
          metric: instruments.metric,
          metricLabel: instruments.metricLabel,
          risk: instruments.risk,
          description: instruments.description,
          region: instruments.region,
          status: instruments.listingStatus,
          blocked: instruments.blocked,
          createdAt: instruments.createdAt,
          updatedAt: instruments.updatedAt,
        })
        .from(instruments)
        .where(eq(instruments.partnerId, scope.partnerId))
        .orderBy(desc(instruments.createdAt)),
    );
    return c.json({ products: rows });
  });

  /**
   * List a product, or amend one already listed.
   *
   * The fields are the ones the marketplace renders. Without them a new listing
   * showed "US$0", an empty metric and "Not rated" on every investor's deal
   * card, which is worse than not appearing — it is appearing wrong.
   *
   * The slug and the regulator are set by the function, not accepted here: a
   * slug is the key holdings and reconciliation join on, and a regulator is a
   * compliance claim about the executing firm rather than a field it types.
   */
  app.post('/products', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);

    const parsed = listInstrumentSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);
    }
    const input = parsed.data;

    try {
      const row = await withTenant(deps, tenant, (tx) =>
        partnerUpsertInstrument(tx, {
          id: input.id ?? null,
          name: input.name,
          type: input.type,
          // A short badge for the card. Derived when not given rather than
          // demanded: it is display, and an empty tile reads as a bug.
          //
          // Punctuation and spaces are stripped before slicing. `slice(0, 6)`
          // on the raw name gave "BARE M" for "Bare Minimum Fund" — a badge
          // with a space in it, which wraps inside a 40px tile and reads as a
          // rendering fault rather than an abbreviation.
          abbr: (
            input.abbr ||
            input.name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6) ||
            'NEW'
          ).toUpperCase(),
          currency: input.currency,
          minInvestmentMinor: BigInt(input.minInvestmentMinor),
          term: input.term ?? null,
          metric: input.metric ?? null,
          metricLabel: input.metricLabel ?? null,
          risk: input.risk ?? null,
          description: input.description ?? null,
          region: input.region ?? null,
        }),
      );
      return c.json({ product: toConsoleProduct(row) }, input.id ? 200 : 201);
    } catch (err) {
      if (raisedBy(err, 'is not listed by this partner')) {
        return c.json({ error: 'that product is not one of yours' }, 404);
      }
      throw err;
    }
  });

  /** Take a listing off the marketplace, or put it back. */
  app.post('/products/:id/live', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);
    const id = c.req.param('id');

    try {
      const status = await withTenant(deps, tenant, (tx) => partnerToggleInstrument(tx, id));
      return c.json({ status });
    } catch (err) {
      // 404 rather than 403 for a product belonging to another firm, so ids
      // cannot be probed by watching which answer comes back.
      if (raisedBy(err, 'is not listed by this partner')) {
        return c.json({ error: 'product listing not found' }, 404);
      }
      throw err;
    }
  });

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
