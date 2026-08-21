import type { Transaction } from '@ccn/db';
import {
  auditLog,
  connectedAccounts,
  instruments,
  kycDocuments,
  orders as ordersTable,
  partnerWebhookDeliveries,
  partnerWebhookEndpoints,
  partners,
  reconciliationItems,
  user as userTable,
  valueSnapshots,
  withdrawalRequests,
} from '@ccn/db';
import {
  AUDIT_DECISION_ACTIONS,
  type ListInstrumentInput,
  acceptOrderSchema,
  bulkListInstrumentSchema,
  confirmFundsSchema,
  decideWithdrawalSchema,
  listInstrumentSchema,
  partnerProfileSchema,
  partnerWebhookSchema,
  rejectSchema,
  settleOrderSchema,
} from '@ccn/domain';
import { formatMoney, money } from '@ccn/money';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppDeps, AppEnv, TenantContext } from '../context';
import { withTenant } from '../context';
import type { InstrumentRow } from '../db-fns';
import {
  acceptOrder,
  auditAppend,
  partnerClientHoldings,
  partnerClients,
  partnerClientsPage,
  partnerConfirmFunds,
  partnerDecideWithdrawal,
  partnerRequestKyc,
  partnerReviewClient,
  partnerToggleInstrument,
  partnerUpdateLogo,
  partnerUpdateProfile,
  partnerUpsertInstrument,
  reconcileMatch,
  reconcileReject,
  rejectOrder,
  settleOrder,
} from '../db-fns';
import { requireAuth } from '../middleware';
import { renderContractNote } from '../services/contract-note';
import { pullStatements } from '../services/ingestion';
import type { PartnerWebhookAdminRuntime } from '../services/partner-webhooks';
import { maskRef } from './util';

const RECEIPT_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const BULK_PRODUCT_REQUEST_MAX_BYTES = 512_000;

function fundingReceipt(raw: unknown): {
  name: string;
  mime: string;
  data: string;
  size: number | null;
} | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = (raw as Record<string, unknown>).receipt;
  if (!value || typeof value !== 'object') return null;
  const receipt = value as Record<string, unknown>;
  if (
    typeof receipt.name !== 'string' ||
    typeof receipt.mime !== 'string' ||
    typeof receipt.data !== 'string' ||
    !RECEIPT_MIMES.has(receipt.mime)
  ) {
    return null;
  }
  return {
    name: receipt.name,
    mime: receipt.mime,
    data: receipt.data,
    size: typeof receipt.size === 'number' ? receipt.size : null,
  };
}

/** The queue needs evidence metadata, never a multi-megabyte base64 payload. */
function publicFundingEvidence(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return {};
  const value = raw as Record<string, unknown>;
  const receipt = fundingReceipt(raw);
  return {
    declaredBy: value.declaredBy,
    at: value.at,
    reference: typeof value.reference === 'string' ? value.reference : undefined,
    receipt: receipt ? { name: receipt.name, mime: receipt.mime, size: receipt.size } : undefined,
  };
}

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
const CLIENT_STATUSES = ['pending', 'active', 'declined'] as const;

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

export function consoleRoutes(
  deps: AppDeps,
  partnerWebhooks: PartnerWebhookAdminRuntime,
): Hono<AppEnv> {
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
          fundingInstructions: partners.fundingInstructions,
          withdrawalFeeFlatMinor: partners.withdrawalFeeFlatMinor,
          withdrawalFeeBps: partners.withdrawalFeeBps,
          gctBps: partners.gctBps,
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
        // undefined = the form did not touch them; the function keeps them.
        fundingInstructions: parsed.data.fundingInstructions ?? null,
        withdrawalFeeFlatMinor: parsed.data.withdrawalFeeFlatMinor ?? null,
        withdrawalFeeBps: parsed.data.withdrawalFeeBps ?? null,
        gctBps: parsed.data.gctBps ?? null,
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
        fundingInstructions: row.funding_instructions,
        withdrawalFeeFlatMinor: row.withdrawal_fee_flat_minor,
        withdrawalFeeBps: row.withdrawal_fee_bps,
        gctBps: row.gct_bps,
      },
    });
  });

  /**
   * The firm's own growth curve: what clients hold through it, one point per
   * day since the recorder first saw the firm, plus the client count. The
   * answer to "is the network making a difference for us" — recorded, never
   * projected. Empty means history starts today.
   */
  app.get('/equity-history', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);
    const rows = await withTenant(deps, tenant, (tx) =>
      tx
        .select({
          takenOn: valueSnapshots.takenOn,
          heldMinor: valueSnapshots.netWorthMinor,
          clients: valueSnapshots.clients,
        })
        .from(valueSnapshots)
        .where(
          and(eq(valueSnapshots.scope, 'partner'), eq(valueSnapshots.partnerId, scope.partnerId)),
        )
        .orderBy(valueSnapshots.takenOn)
        .limit(366),
    );
    return c.json({
      points: rows.map((r) => ({
        takenOn: r.takenOn,
        heldMinor: r.heldMinor.toString(),
        clients: r.clients ?? 0,
      })),
    });
  });

  /**
   * The firm's own logo — the one piece of brand identity an operator owns
   * outright. Base64 in JSON like the KYC document upload; `data: null`
   * clears it and the monogram mark returns. Size and mime are validated
   * here for a readable error and again by table CHECKs (0030) for the
   * callers that aren't this route.
   */
  app.put('/partner/logo', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);

    const body = (await c.req.json().catch(() => null)) as {
      mime?: unknown;
      data?: unknown;
    } | null;
    if (!body) return c.json({ error: 'invalid request' }, 400);

    if (body.data === null) {
      await withTenant(deps, tenant, (tx) => partnerUpdateLogo(tx, { logo: null, mime: null }));
      return c.json({ ok: true, hasLogo: false });
    }

    const mime = typeof body.mime === 'string' ? body.mime : '';
    if (!['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'].includes(mime)) {
      return c.json({ error: 'the logo must be a PNG, JPEG, SVG or WebP image' }, 400);
    }
    if (typeof body.data !== 'string') return c.json({ error: 'invalid request' }, 400);
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(body.data), (ch) => ch.charCodeAt(0));
    } catch {
      return c.json({ error: 'the file data is not valid base64' }, 400);
    }
    if (bytes.length === 0) return c.json({ error: 'the file is empty' }, 400);
    if (bytes.length > 256 * 1024) {
      return c.json({ error: 'the logo must be 256KB or smaller' }, 400);
    }

    await withTenant(deps, tenant, (tx) => partnerUpdateLogo(tx, { logo: bytes, mime }));
    return c.json({ ok: true, hasLogo: true });
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
    const { limit, offset } = readPage(c);
    const decisionsOnly = c.req.query('decisions') === 'true';
    const where = and(
      eq(auditLog.partnerId, scope.partnerId),
      decisionsOnly ? inArray(auditLog.action, AUDIT_DECISION_ACTIONS) : undefined,
    );
    const { entries, total } = await withTenant(deps, tenant, async (tx) => ({
      entries: await tx
        .select({
          id: auditLog.id,
          seq: auditLog.seq,
          action: auditLog.action,
          entityType: auditLog.entityType,
          actorType: auditLog.actorType,
          // WHO. `actor_id` has been written since the first migration and
          // never read, so every decision rendered as an anonymous "Operator"
          // — a compliance officer could see that a client was accepted and a
          // withdrawal paid, and not by whom, which is the first question a
          // review asks. LEFT join: system and agent rows have no person.
          actorName: userTable.name,
          detail: auditLog.detail,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .leftJoin(userTable, eq(userTable.id, auditLog.actorId))
        .where(where)
        .orderBy(desc(auditLog.seq))
        .limit(limit)
        .offset(offset),
      total: await tx.select({ n: sql<string>`count(*)` }).from(auditLog).where(where),
    }));
    return c.json({ entries, total: Number(total[0]?.n ?? 0) });
  });

  /**
   * Optional machine-to-machine export of the same immutable audit stream.
   * Only sanitized endpoint metadata and tenant-scoped delivery history leave
   * this route; the encrypted signing secret is never selected.
   */
  app.get('/webhook', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);

    const result = await withTenant(deps, tenant, async (tx) => {
      const [endpoint] = await tx
        .select({
          id: partnerWebhookEndpoints.id,
          url: partnerWebhookEndpoints.url,
          active: partnerWebhookEndpoints.active,
          createdAt: partnerWebhookEndpoints.createdAt,
          updatedAt: partnerWebhookEndpoints.updatedAt,
        })
        .from(partnerWebhookEndpoints)
        .where(eq(partnerWebhookEndpoints.partnerId, scope.partnerId));
      const deliveries = await tx
        .select({
          id: partnerWebhookDeliveries.id,
          eventId: partnerWebhookDeliveries.eventId,
          eventType: partnerWebhookDeliveries.eventType,
          status: partnerWebhookDeliveries.status,
          attemptCount: partnerWebhookDeliveries.attemptCount,
          responseStatus: partnerWebhookDeliveries.responseStatus,
          lastError: partnerWebhookDeliveries.lastError,
          lastAttemptAt: partnerWebhookDeliveries.lastAttemptAt,
          nextAttemptAt: partnerWebhookDeliveries.nextAttemptAt,
          deliveredAt: partnerWebhookDeliveries.deliveredAt,
          createdAt: partnerWebhookDeliveries.createdAt,
        })
        .from(partnerWebhookDeliveries)
        .where(eq(partnerWebhookDeliveries.partnerId, scope.partnerId))
        .orderBy(desc(partnerWebhookDeliveries.createdAt))
        .limit(20);
      return { endpoint: endpoint ?? null, deliveries };
    });
    return c.json({ ...result, allowedHosts: partnerWebhooks.allowedHosts });
  });

  /** Create or update the endpoint; a new/rotated secret is shown once. */
  app.put('/webhook', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);

    const parsed = partnerWebhookSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);
    }
    try {
      await partnerWebhooks.assertTarget(parsed.data.url);
    } catch {
      return c.json(
        {
          error: 'That destination is not an approved public webhook host.',
          allowedHosts: partnerWebhooks.allowedHosts,
        },
        400,
      );
    }

    const result = await withTenant(deps, tenant, async (tx) => {
      const [existing] = await tx
        .select()
        .from(partnerWebhookEndpoints)
        .where(eq(partnerWebhookEndpoints.partnerId, scope.partnerId));
      const endpointId = existing?.id ?? partnerWebhooks.newEndpointId();
      const shouldRotate = !existing || parsed.data.rotateSecret;
      const signingSecret = shouldRotate ? partnerWebhooks.newSigningSecret() : null;
      const secretCiphertext = signingSecret
        ? await partnerWebhooks.encryptSecret(signingSecret, endpointId)
        : existing?.secretCiphertext;
      if (!secretCiphertext) throw new Error('webhook secret was not available');

      const now = new Date();
      if (existing) {
        await tx
          .update(partnerWebhookEndpoints)
          .set({
            url: parsed.data.url,
            active: parsed.data.active,
            secretCiphertext,
            updatedBy: tenant.user.id,
            updatedAt: now,
          })
          .where(
            and(
              eq(partnerWebhookEndpoints.id, endpointId),
              eq(partnerWebhookEndpoints.partnerId, scope.partnerId),
            ),
          );
      } else {
        await tx.insert(partnerWebhookEndpoints).values({
          id: endpointId,
          partnerId: scope.partnerId,
          url: parsed.data.url,
          active: parsed.data.active,
          secretCiphertext,
          createdBy: tenant.user.id,
          updatedBy: tenant.user.id,
        });
      }

      const action = !existing
        ? 'webhook.configured'
        : shouldRotate
          ? 'webhook.secret_rotated'
          : existing.active !== parsed.data.active
            ? parsed.data.active
              ? 'webhook.enabled'
              : 'webhook.disabled'
            : 'webhook.updated';
      await auditAppend(tx, {
        actorType: 'user',
        actorId: tenant.user.id,
        userId: tenant.user.id,
        partnerId: scope.partnerId,
        action,
        entityType: 'partner_webhook_endpoint',
        entityId: endpointId,
        detail: {
          active: parsed.data.active,
          endpointHost: new URL(parsed.data.url).hostname,
          secretRotated: shouldRotate,
        },
      });
      return {
        endpoint: {
          id: endpointId,
          url: parsed.data.url,
          active: parsed.data.active,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        },
        signingSecret,
      };
    });
    deps.logger.info('partner webhook configuration changed', {
      partner: scope.partnerId,
      active: result.endpoint.active,
      secretRotated: result.signingSecret !== null,
    });
    return c.json(result);
  });

  /** Queue a signed test event through the exact production outbox path. */
  app.post('/webhook/test', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);

    const result = await withTenant(deps, tenant, async (tx) => {
      const [endpoint] = await tx
        .select({ id: partnerWebhookEndpoints.id, active: partnerWebhookEndpoints.active })
        .from(partnerWebhookEndpoints)
        .where(eq(partnerWebhookEndpoints.partnerId, scope.partnerId));
      if (!endpoint) return { error: 'Configure a webhook before sending a test.' as const };
      if (!endpoint.active) return { error: 'Enable the webhook before sending a test.' as const };
      const eventId = await auditAppend(tx, {
        actorType: 'user',
        actorId: tenant.user.id,
        userId: tenant.user.id,
        partnerId: scope.partnerId,
        action: 'webhook.test',
        entityType: 'partner_webhook_endpoint',
        entityId: endpoint.id,
        detail: { requestedBy: tenant.user.name },
      });
      return { eventId };
    });
    if ('error' in result) return c.json(result, 409);
    deps.logger.info('partner webhook test queued', {
      partner: scope.partnerId,
      eventId: result.eventId,
    });
    return c.json({ queued: true, eventId: result.eventId }, 202);
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
        .orderBy(desc(ordersTable.createdAt), desc(ordersTable.id))
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
   * The contract note for one settled order — the desk's copy, from the SAME
   * renderer as the client's, so the two parties cannot hold different
   * accounts of the same trade. Scoped to the firm's own book; not-yours and
   * not-found are the same 404.
   */
  app.get('/orders/:id/contract-note', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);

    const [row] = await withTenant(deps, tenant, (tx) =>
      tx
        .select({
          id: ordersTable.id,
          status: ordersTable.status,
          amountMinor: ordersTable.amountMinor,
          currency: ordersTable.currency,
          unitPriceMinor: ordersTable.unitPriceMinor,
          units: ordersTable.units,
          feeMinor: ordersTable.feeMinor,
          externalRef: ordersTable.externalRef,
          clientRef: ordersTable.clientRef,
          createdAt: ordersTable.createdAt,
          acceptedAt: ordersTable.acceptedAt,
          settledAt: ordersTable.settledAt,
          instrumentName: instruments.name,
          instrumentAbbr: instruments.abbr,
          partnerName: partners.name,
          partnerCode: partners.code,
          regulator: partners.regulator,
          clientName: userTable.name,
          clientEmail: userTable.email,
        })
        .from(ordersTable)
        .leftJoin(instruments, eq(instruments.id, ordersTable.instrumentId))
        .leftJoin(partners, eq(partners.id, ordersTable.partnerId))
        .leftJoin(userTable, eq(userTable.id, ordersTable.userId))
        .where(
          and(eq(ordersTable.id, c.req.param('id')), eq(ordersTable.partnerId, scope.partnerId)),
        ),
    );
    if (!row) return c.json({ error: 'order not found' }, 404);
    if (row.status !== 'settled') {
      return c.json({ error: 'A contract note is issued when the order settles.' }, 409);
    }
    return c.html(
      renderContractNote({
        orderId: row.id,
        clientName: row.clientName ?? 'Client',
        clientEmail: row.clientEmail ?? '—',
        partnerName: row.partnerName ?? 'Executing firm',
        partnerCode: row.partnerCode ?? '—',
        regulator: row.regulator,
        instrumentName: row.instrumentName,
        instrumentAbbr: row.instrumentAbbr,
        amountMinor: row.amountMinor,
        currency: row.currency,
        unitPriceMinor: row.unitPriceMinor,
        units: row.units,
        feeMinor: row.feeMinor,
        externalRef: row.externalRef,
        clientRef: row.clientRef,
        createdAt: row.createdAt,
        acceptedAt: row.acceptedAt,
        settledAt: row.settledAt,
      }),
    );
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
   * The KYC intake package is the client's own recorded details and declarations;
   * it is not a CCN verification result. The partner remains the regulated owner
   * of verification and the final KYC/AML decision. The package becomes visible
   * because the client linked an account here, and the database enforces that join.
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
    const requestedStatus = c.req.query('status');
    const status =
      requestedStatus && (CLIENT_STATUSES as readonly string[]).includes(requestedStatus)
        ? (requestedStatus as (typeof CLIENT_STATUSES)[number])
        : undefined;
    const q = (c.req.query('q') ?? '').trim();
    const page = await withTenant(deps, tenant, (tx) =>
      partnerClientsPage(tx, { status, q: q || undefined, limit, offset }),
    );

    return c.json(page);
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
          // The deciding person's name — "accepted, by whom" is one fact.
          actorName: userTable.name,
          detail: auditLog.detail,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .leftJoin(userTable, eq(userTable.id, auditLog.actorId))
        .where(and(eq(auditLog.partnerId, scope.partnerId), eq(auditLog.userId, client.user_id)))
        .orderBy(desc(auditLog.seq))
        .limit(50);
      // The documents behind the declarations (0027). Metadata only here — the
      // bytes come one at a time from /clients/:id/documents/:docId. The
      // partner-read policy admits them because this person is the firm's
      // pending/active client, which is exactly when a desk reviews KYC.
      const documents = await tx
        .select({
          id: kycDocuments.id,
          step: kycDocuments.step,
          label: kycDocuments.label,
          mime: kycDocuments.mime,
          createdAt: kycDocuments.createdAt,
        })
        .from(kycDocuments)
        .where(eq(kycDocuments.userId, client.user_id))
        .orderBy(desc(kycDocuments.createdAt));
      // The relationship over time: this client's value held through THIS
      // firm, one point per day (scope 'client', 0032) — never their
      // cross-firm net worth, which is theirs and not any one firm's to see.
      const equity = await tx
        .select({ takenOn: valueSnapshots.takenOn, heldMinor: valueSnapshots.netWorthMinor })
        .from(valueSnapshots)
        .where(
          and(
            eq(valueSnapshots.scope, 'client'),
            eq(valueSnapshots.partnerId, scope.partnerId),
            eq(valueSnapshots.userId, client.user_id),
          ),
        )
        .orderBy(valueSnapshots.takenOn)
        .limit(366);
      return { client, holdings, orders: clientOrders, audit: history, documents, equity };
    });

    // Not found and not-yours are the same answer, so an account id cannot be
    // probed by watching which one comes back.
    if (!detail) return c.json({ error: 'client not found' }, 404);
    return c.json({
      ...detail,
      equity: detail.equity.map((p) => ({ takenOn: p.takenOn, heldMinor: p.heldMinor.toString() })),
    });
  });

  /**
   * One KYC document's bytes, for the reviewing desk. The account id scopes it:
   * the document must belong to the person behind that account, and the
   * account must be this firm's — both resolved through partner_clients, which
   * only returns the caller's own book. RLS backs the same claim underneath.
   */
  app.get('/clients/:id/documents/:docId', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);
    const accountId = c.req.param('id');

    const doc = await withTenant(deps, tenant, async (tx) => {
      const client = (await partnerClients(tx)).find((row) => row.account_id === accountId);
      if (!client) return null;
      const [row] = await tx
        .select({ mime: kycDocuments.mime, bytes: kycDocuments.bytes, label: kycDocuments.label })
        .from(kycDocuments)
        .where(
          and(eq(kycDocuments.id, c.req.param('docId')), eq(kycDocuments.userId, client.user_id)),
        );
      return row ?? null;
    });
    if (!doc?.bytes) return c.json({ error: 'document not found' }, 404);
    return new Response(new Uint8Array(doc.bytes), {
      headers: {
        'Content-Type': doc.mime ?? 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${doc.label.replace(/[^\w. -]/g, '_')}"`,
      },
    });
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
              'This person has not finished onboarding, so CCN has no complete KYC intake package to pass you yet.',
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

  /**
   * Ask a client to finish their KYC — the desk's third verb.
   *
   * A half-finished package left the operator with accept (refused when the
   * package is empty) or decline (which the client reads as rejection). The
   * request is the honest middle: the firm asks, the client's screens are told
   * in realtime (the 0015 trigger on connected_accounts), and the asking is on
   * the audit trail as `kyc.requested` with the package as it stood.
   */
  app.post('/clients/:id/request-kyc', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);

    try {
      const requestedAt = await withTenant(deps, tenant, (tx) =>
        partnerRequestKyc(tx, c.req.param('id')),
      );
      deps.logger.info('partner requested client KYC', { partner: scope.partnerId });
      return c.json({ requestedAt });
    } catch (err) {
      if (raisedBy(err, 'already completed KYC')) {
        return c.json({ error: 'this client has already completed their KYC' }, 409);
      }
      if (raisedBy(err, 'already requested recently')) {
        return c.json(
          { error: 'you asked within the last day; give the client time to respond' },
          409,
        );
      }
      return c.json({ error: 'that client is not one of yours' }, 409);
    }
  });

  /**
   * The firm confirms a client's funding has settled.
   *
   * Funding an account happens between the investor and the firm — a wire, a
   * branch deposit — never through CCN, which holds no money. What was missing
   * was the confirmation: nothing on the platform could say the money landed,
   * so a freshly funded client showed an empty balance until the next statement
   * cycle. This is the firm's one write for that fact. The client's cash at
   * this firm (a holding with no instrument) grows by the stated amount, the
   * investor sees it on their portfolio, and the audit trail carries the firm's
   * own reference.
   */
  app.post('/clients/:id/funds', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);

    const parsed = confirmFundsSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);

    const accountId = c.req.param('id');
    try {
      const holdingId = await withTenant(deps, tenant, (tx) =>
        partnerConfirmFunds(tx, {
          accountId,
          amountMinor: parsed.data.amountMinor,
          currency: parsed.data.currency,
          reference: parsed.data.reference ?? null,
        }),
      );
      deps.logger.info('partner confirmed settled funds', {
        partner: scope.partnerId,
        account: accountId,
        currency: parsed.data.currency,
      });
      return c.json({ holdingId });
    } catch (err) {
      if (raisedBy(err, 'is not active')) {
        return c.json(
          { error: 'This client is not active, so settled funds cannot be recorded yet.' },
          409,
        );
      }
      if (raisedBy(err, 'not a client of this partner')) {
        return c.json({ error: 'that client is not one of yours' }, 404);
      }
      throw err;
    }
  });

  /**
   * Money on its way out of the firm: the withdrawal queue.
   *
   * Requests the firm's clients have raised, pending first. The decision is
   * the firm's alone — `partner_decide_withdrawal` pays (and decrements the
   * recorded cash) or declines with a reason the client reads.
   */
  app.get('/withdrawals', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);

    const { limit, offset } = readPage(c);
    const { rows, total } = await withTenant(deps, tenant, async (tx) => {
      const list = await tx
        .select({ request: withdrawalRequests, clientName: userTable.name })
        .from(withdrawalRequests)
        .leftJoin(userTable, eq(userTable.id, withdrawalRequests.userId))
        .where(eq(withdrawalRequests.partnerId, scope.partnerId))
        .orderBy(
          sql`case ${withdrawalRequests.status} when 'pending' then 0 else 1 end`,
          desc(withdrawalRequests.createdAt),
          desc(withdrawalRequests.id),
        )
        .limit(limit)
        .offset(offset);
      const count = await tx
        .select({ n: sql<string>`count(*)` })
        .from(withdrawalRequests)
        .where(eq(withdrawalRequests.partnerId, scope.partnerId));
      return {
        rows: list.map(({ request: w, clientName }) => ({
          id: w.id,
          clientName: clientName ?? 'A client',
          accountId: w.connectedAccountId,
          amountMinor: w.amountMinor.toString(),
          feeMinor: w.feeMinor.toString(),
          gctMinor: w.gctMinor.toString(),
          // What the firm actually pays out: the client's amount less charges.
          netMinor: (w.amountMinor - w.feeMinor - w.gctMinor).toString(),
          currency: w.currency,
          status: w.status,
          reason: w.reason,
          reference: w.reference,
          createdAt: w.createdAt,
          decidedAt: w.decidedAt,
        })),
        total: Number(count[0]?.n ?? 0),
      };
    });
    return c.json({ withdrawals: rows, total });
  });

  app.post('/withdrawals/:id/decide', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);
    const parsed = decideWithdrawalSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);

    try {
      const row = await withTenant(deps, tenant, (tx) =>
        partnerDecideWithdrawal(tx, {
          requestId: c.req.param('id'),
          paid: parsed.data.paid,
          reason: parsed.data.reason ?? null,
          reference: parsed.data.reference ?? null,
        }),
      );
      deps.logger.info('partner decided a withdrawal', {
        partner: scope.partnerId,
        status: row.status,
      });
      return c.json({ withdrawal: { ...row, amount_minor: row.amount_minor.toString() } });
    } catch (err) {
      if (raisedBy(err, 'no longer covers')) {
        return c.json(
          {
            error:
              "CCN's record of this client's cash no longer covers the amount — an order may have settled first. Record their funding, or decline with the reason.",
          },
          409,
        );
      }
      if (raisedBy(err, 'is not pending')) {
        return c.json({ error: 'that request is not pending at your firm' }, 409);
      }
      throw err;
    }
  });

  // ---- Reconciliation (clients & KYC tab): match ingested statement lines ----

  /**
   * Pull statements for every active client, filling this desk's own queue.
   *
   * The reconciliation queue is the console's — Match and Reject live here —
   * but until now only an investor could fill it, by pressing "Check for
   * statements" on their own portfolio. A desk that wanted to reconcile its
   * book had to wait for each client to think of it, which is backwards: the
   * statements are the firm's records, and reconciliation is the firm's job.
   *
   * Active clients only. A pending connection has no relationship to read
   * through and a declined one has been refused — the same rule the investor
   * path enforces one account at a time.
   */
  app.post('/reconciliation/pull', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);

    const result = await withTenant(deps, tenant, async (tx) => {
      const [firm] = await tx
        .select({ code: partners.code, agreementStatus: partners.agreementStatus })
        .from(partners)
        .where(eq(partners.id, scope.partnerId));
      if (!firm) return { error: 'partner not found' as const, httpStatus: 404 as const };
      /**
       * Said here, not thrown from inside the adapter registry. The registry
       * refuses a non-routable agreement — correctly — but from this button
       * that refusal surfaced as an unexplained 500 at the desk of the firm
       * it describes. The agreement is the firm's own state and deserves a
       * sentence, not a stack trace.
       */
      if (firm.agreementStatus !== 'sandbox' && firm.agreementStatus !== 'live') {
        return {
          error:
            `Your agreement with CCN is ${firm.agreementStatus}, so statements cannot be read yet. Once the agreement is live (or sandbox), this pulls for every active client.` as const,
          httpStatus: 409 as const,
        };
      }

      const clients = await tx
        .select({ userId: connectedAccounts.userId })
        .from(connectedAccounts)
        .where(
          and(
            eq(connectedAccounts.partnerId, scope.partnerId),
            eq(connectedAccounts.status, 'active'),
          ),
        );

      let queued = 0;
      for (const client of clients) {
        const pulled = await pullStatements(tx, {
          userId: client.userId,
          partnerCode: firm.code,
          clientRef: maskRef(client.userId),
          now: () => Date.now(),
        });
        queued += pulled.created;
      }

      await auditAppend(tx, {
        actorType: 'user',
        actorId: tenant.user.id,
        userId: null,
        partnerId: scope.partnerId,
        action: 'reconciliation.pulled',
        entityType: 'reconciliation_items',
        entityId: null,
        detail: { clients: clients.length, queued },
      });
      return { clients: clients.length, queued };
    });

    if ('error' in result) return c.json({ error: result.error }, result.httpStatus);
    deps.logger.info('desk pulled statements for its clients', {
      partner: scope.partnerId,
      ...result,
    });
    return c.json(result);
  });

  app.get('/reconciliation', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);
    const { limit, offset } = readPage(c);
    const where = and(
      eq(reconciliationItems.partnerId, scope.partnerId),
      eq(reconciliationItems.status, 'pending'),
    );
    const { rows, total } = await withTenant(deps, tenant, async (tx) => ({
      rows: await tx
        .select()
        .from(reconciliationItems)
        .where(where)
        .orderBy(desc(reconciliationItems.createdAt), desc(reconciliationItems.id))
        .limit(limit)
        .offset(offset),
      total: await tx.select({ n: sql<string>`count(*)` }).from(reconciliationItems).where(where),
    }));
    return c.json({
      items: rows.map((row) => ({
        ...row,
        raw: row.source === 'investor_notice' ? publicFundingEvidence(row.raw) : row.raw,
      })),
      total: Number(total[0]?.n ?? 0),
    });
  });

  /** One investor-supplied funding receipt, scoped to this partner's queue. */
  app.get('/reconciliation/:id/receipt', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);
    const [item] = await withTenant(deps, tenant, (tx) =>
      tx
        .select({ raw: reconciliationItems.raw, source: reconciliationItems.source })
        .from(reconciliationItems)
        .where(
          and(
            eq(reconciliationItems.id, c.req.param('id')),
            eq(reconciliationItems.partnerId, scope.partnerId),
          ),
        )
        .limit(1),
    );
    const receipt = item?.source === 'investor_notice' ? fundingReceipt(item.raw) : null;
    if (!receipt) return c.json({ error: 'receipt not found' }, 404);
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(receipt.data), (ch) => ch.charCodeAt(0));
    } catch {
      return c.json({ error: 'receipt not found' }, 404);
    }
    if (bytes.length === 0 || bytes.length > 2 * 1024 * 1024) {
      return c.json({ error: 'receipt not found' }, 404);
    }
    return new Response(bytes, {
      headers: {
        'Content-Type': receipt.mime,
        'Content-Disposition': `attachment; filename="${receipt.name.replace(/[^\w. -]/g, '_')}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
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
   * One tenant-scoped write used by both single and bulk listing routes. Keeping
   * the mapping here prevents the spreadsheet path from drifting into a looser
   * set of fields or a different ownership rule.
   */
  function upsertConsoleProduct(tx: Transaction, input: ListInstrumentInput) {
    return partnerUpsertInstrument(tx, {
      id: input.id ?? null,
      name: input.name,
      type: input.type,
      // A short badge for the card. Punctuation and spaces are stripped before
      // slicing so a generated abbreviation never wraps inside the tile.
      abbr: (
        input.abbr ||
        input.name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6) ||
        'NEW'
      ).toUpperCase(),
      currency: input.currency,
      minInvestmentMinor: input.minInvestmentMinor,
      term: input.term ?? null,
      metric: input.metric ?? null,
      metricLabel: input.metricLabel ?? null,
      risk: input.risk ?? null,
      description: input.description ?? null,
      region: input.region ?? null,
    });
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
    const { limit, offset } = readPage(c);
    const status = c.req.query('status');
    const q = (c.req.query('q') ?? '').trim();
    const where = and(
      eq(instruments.partnerId, scope.partnerId),
      status === 'live' || status === 'paused' ? eq(instruments.listingStatus, status) : undefined,
      q
        ? sql`(${instruments.name} ilike ${`%${q}%`} or ${instruments.abbr} ilike ${`%${q}%`} or ${instruments.type} ilike ${`%${q}%`})`
        : undefined,
    );
    const { rows, total } = await withTenant(deps, tenant, async (tx) => ({
      rows: await tx
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
        .where(where)
        .orderBy(desc(instruments.createdAt), desc(instruments.id))
        .limit(limit)
        .offset(offset),
      total: await tx.select({ n: sql<string>`count(*)` }).from(instruments).where(where),
    }));
    return c.json({ products: rows, total: Number(total[0]?.n ?? 0) });
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
      const row = await withTenant(deps, tenant, (tx) => upsertConsoleProduct(tx, input));
      return c.json({ product: toConsoleProduct(row) }, input.id ? 200 : 201);
    } catch (err) {
      if (raisedBy(err, 'is not listed by this partner')) {
        return c.json({ error: 'that product is not one of yours' }, 404);
      }
      throw err;
    }
  });

  /**
   * Add up to 100 products atomically. New bulk rows are paused after creation:
   * a spreadsheet is efficient input, not sufficient approval to publish a
   * regulated product to investors. Any failed row rolls the whole transaction
   * back, so the operator never has to discover which half of a file landed.
   */
  app.post(
    '/products/bulk',
    bodyLimit({
      maxSize: BULK_PRODUCT_REQUEST_MAX_BYTES,
      onError: (c) => c.json({ error: 'bulk product request is too large' }, 413),
    }),
    async (c) => {
      const tenant = c.get('tenant');
      if (!tenant) return c.json({ error: 'authentication required' }, 401);
      const scope = partnerScope(tenant);
      if ('error' in scope) return c.json(scope, 403);

      const rawBody = await c.req.text();
      if (new TextEncoder().encode(rawBody).byteLength > BULK_PRODUCT_REQUEST_MAX_BYTES) {
        return c.json({ error: 'bulk product request is too large' }, 413);
      }
      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        return c.json({ error: 'invalid request' }, 400);
      }
      const parsed = bulkListInstrumentSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);
      }

      const products = await withTenant(deps, tenant, async (tx) => {
        const created = [];
        for (const input of parsed.data.products) {
          const row = await upsertConsoleProduct(tx, input);
          const status =
            row.listing_status === 'live'
              ? await partnerToggleInstrument(tx, row.id)
              : row.listing_status;
          created.push({ ...toConsoleProduct(row), status });
        }
        return created;
      });
      return c.json({ products }, 201);
    },
  );

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
        //
        // Held-by-clients goes through partner_clients(), not a direct join on
        // holdings: RLS lets only the owning investor (or an admin) read
        // holdings rows, so an operator joining the table directly sums zero
        // rows and the console reports US$0 under real client money. The
        // SECURITY DEFINER function is the sanctioned partner-scoped read.
        (await tx.execute(sql`
        select
          (select count(*) from connected_accounts
             where partner_id = ${scope.partnerId} and status = 'active')      as active_clients,
          (select count(*) from connected_accounts
             where partner_id = ${scope.partnerId} and status = 'pending')     as pending_clients,
          (select coalesce(sum(pc.holdings_value_minor), 0) from partner_clients() pc
             where pc.status = 'active')                                       as aum_minor,
          (select count(*) from orders
             where partner_id = ${scope.partnerId} and status = 'settled')     as settled_orders,
          (select count(*) from orders
             where partner_id = ${scope.partnerId} and status = 'created')     as created_orders,
          (select count(*) from orders
             where partner_id = ${scope.partnerId} and status = 'accepted')    as accepted_orders,
          (select count(*) from orders
             where partner_id = ${scope.partnerId})                            as total_orders,
          (select count(*) from instruments
             where partner_id = ${scope.partnerId})                            as products,
          (select count(*) from reconciliation_items
             where partner_id = ${scope.partnerId} and status = 'pending')     as pending_reconciliation,
          (select count(*) from withdrawal_requests
             where partner_id = ${scope.partnerId} and status = 'pending')     as pending_withdrawals
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
    return c.json({
      kpis,
      summary: {
        activeClients: Number(row?.active_clients ?? 0),
        pendingClients: Number(row?.pending_clients ?? 0),
        createdOrders: Number(row?.created_orders ?? 0),
        acceptedOrders: Number(row?.accepted_orders ?? 0),
        totalOrders: Number(row?.total_orders ?? 0),
        products: Number(row?.products ?? 0),
        pendingReconciliation: Number(row?.pending_reconciliation ?? 0),
        pendingWithdrawals: Number(row?.pending_withdrawals ?? 0),
      },
    });
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
