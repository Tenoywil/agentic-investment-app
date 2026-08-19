import { approvals as approvalsTable } from '@ccn/db';
import { approveSchema, createApprovalSchema, rejectSchema } from '@ccn/domain';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../context';
import { withTenant } from '../context';
import { auditAppend, createOrder } from '../db-fns';
import { requireAuth } from '../middleware';
import { assessExecutionCompliance, loadInstrument, runGate } from '../services/gate';
import { maskRef } from './util';

/**
 * "Needs your approval" cards — the human-in-the-loop escalation. POST opens a
 * card (the agent's path when a proposal exceeds the auto-invest limit). Approve
 * re-runs the gate and, unless it is now blocked, creates the order with the
 * approval attached — one of only two paths to `create_order`. Reject records
 * the decision in the immutable audit log.
 */
export function approvalsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', requireAuth(deps));

  app.get('/', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const rows = await withTenant(deps, tenant, (tx) =>
      tx
        .select()
        .from(approvalsTable)
        .where(eq(approvalsTable.userId, tenant.user.id))
        .orderBy(desc(approvalsTable.createdAt)),
    );
    return c.json({ approvals: rows });
  });

  app.post('/', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const parsed = createApprovalSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);
    const { instrumentId, amountMinor, currency, type, title, body, summary, reasons } =
      parsed.data;

    const result = await withTenant(deps, tenant, async (tx) => {
      /**
       * A second card for an instrument whose first card is still waiting is a
       * duplicate, not a new intention (the same rule request_withdrawal
       * enforces for money out). Answer with the card that already exists, so
       * the client can point at it instead of stacking the queue.
       */
      const [existing] = await tx
        .select()
        .from(approvalsTable)
        .where(
          and(
            eq(approvalsTable.userId, tenant.user.id),
            eq(approvalsTable.instrumentId, instrumentId),
            eq(approvalsTable.status, 'pending'),
          ),
        )
        .limit(1);
      if (existing)
        return { status: 409 as const, body: { error: 'already_pending', approval: existing } };

      // The HTTP endpoint is a security boundary too: a caller must not bypass
      // the compliance specialist by posting the proposal the UI would refuse.
      const instrument = await loadInstrument(tx, instrumentId, deps.logger);
      if (!instrument?.partnerId) {
        return { status: 409 as const, body: { error: 'instrument not investable' } };
      }
      const compliance = await assessExecutionCompliance(tx, tenant.user.id, instrument.partnerId);
      if (compliance.decision === 'blocked') {
        return {
          status: 409 as const,
          body: {
            decision: 'blocked' as const,
            code: 'compliance_not_ready',
            reasons: compliance.reasons,
            checks: compliance.checks,
          },
        };
      }

      const created = await tx
        .insert(approvalsTable)
        .values({
          userId: tenant.user.id,
          type,
          status: 'pending',
          instrumentId,
          title,
          body: body ?? null,
          amountMinor,
          currency,
          snapshot: {
            source: 'chat',
            instrumentId,
            amountMinor: amountMinor.toString(),
            currency,
            // The proposal's own case rides along as a one-stage trace, so
            // "How this was decided" renders on chat-raised cards too.
            ...(summary
              ? {
                  trace: [
                    {
                      stage: 'suitability',
                      agent: 'Suitability agent',
                      summary,
                      detail: reasons ?? [],
                    },
                  ],
                }
              : {}),
          },
        })
        // The partial unique index (0029) is the race backstop: a concurrent
        // insert that slips past the read above comes back empty instead of
        // duplicating the card.
        .onConflictDoNothing()
        .returning();
      const row = created[0];
      if (!row) {
        const [raced] = await tx
          .select()
          .from(approvalsTable)
          .where(
            and(
              eq(approvalsTable.userId, tenant.user.id),
              eq(approvalsTable.instrumentId, instrumentId),
              eq(approvalsTable.status, 'pending'),
            ),
          )
          .limit(1);
        return { status: 409 as const, body: { error: 'already_pending', approval: raced } };
      }
      return { status: 201 as const, body: { approval: row } };
    });
    return c.json(result.body, result.status);
  });

  app.post('/:id/approve', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const id = c.req.param('id');
    const parsed = approveSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success)
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);

    const result = await withTenant(deps, tenant, async (tx) => {
      const [approval] = await tx
        .select()
        .from(approvalsTable)
        .where(and(eq(approvalsTable.id, id), eq(approvalsTable.userId, tenant.user.id)));
      if (!approval) return { status: 404 as const, body: { error: 'approval not found' } };
      if (approval.status !== 'pending') {
        return { status: 409 as const, body: { error: `approval already ${approval.status}` } };
      }
      if (!approval.instrumentId || approval.amountMinor === null) {
        return { status: 409 as const, body: { error: 'approval has no investable proposal' } };
      }
      const instrument = await loadInstrument(tx, approval.instrumentId);
      if (!instrument?.partnerId) {
        return { status: 409 as const, body: { error: 'instrument not investable' } };
      }
      // An approval card can sit for days, and the firm may have withdrawn the
      // product in the meantime. Approving it then would route an order into a
      // listing that no longer exists on the marketplace.
      if (instrument.listingStatus !== 'live') {
        return {
          status: 409 as const,
          body: { error: 'this product is no longer offered by the listing firm' },
        };
      }
      // Re-check at the execution choke point. KYC standing or the exact firm
      // relationship may have changed while the approval card was waiting.
      const compliance = await assessExecutionCompliance(tx, tenant.user.id, instrument.partnerId);
      if (compliance.decision === 'blocked') {
        return {
          status: 409 as const,
          body: {
            decision: 'blocked' as const,
            code: 'compliance_not_ready',
            reasons: compliance.reasons,
            checks: compliance.checks,
          },
        };
      }
      // Re-gate on approval: guardrails may have changed since the card opened.
      const decision = await runGate(tx, {
        userId: tenant.user.id,
        instrument,
        amountMinor: approval.amountMinor,
        currency: approval.currency,
      });
      if (decision.decision === 'blocked') {
        return {
          status: 409 as const,
          body: { decision: 'blocked', code: decision.code, reasons: decision.reasons },
        };
      }
      const order = await createOrder(tx, {
        userId: tenant.user.id,
        partnerId: instrument.partnerId,
        instrumentId: approval.instrumentId,
        approvalId: approval.id,
        amountMinor: approval.amountMinor,
        currency: approval.currency,
        idempotencyKey: parsed.data.idempotencyKey ?? `approval:${approval.id}`,
        clientRef: maskRef(tenant.user.id),
        createdBy: 'user',
      });
      await tx
        .update(approvalsTable)
        .set({ status: 'approved', decidedAt: new Date() })
        .where(eq(approvalsTable.id, approval.id));
      await auditAppend(tx, {
        actorType: 'user',
        actorId: tenant.user.id,
        userId: tenant.user.id,
        partnerId: instrument.partnerId,
        action: 'approval.approved',
        entityType: 'approval',
        entityId: approval.id,
        detail: { orderId: order.id },
      });
      return { status: 201 as const, body: { decision: 'created', order } };
    });
    return c.json(result.body, result.status);
  });

  app.post('/:id/reject', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const id = c.req.param('id');
    const parsed = rejectSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success)
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);

    const result = await withTenant(deps, tenant, async (tx) => {
      const [approval] = await tx
        .select()
        .from(approvalsTable)
        .where(and(eq(approvalsTable.id, id), eq(approvalsTable.userId, tenant.user.id)));
      if (!approval) return { status: 404 as const, body: { error: 'approval not found' } };
      if (approval.status !== 'pending') {
        return { status: 409 as const, body: { error: `approval already ${approval.status}` } };
      }
      await tx
        .update(approvalsTable)
        .set({ status: 'rejected', decidedAt: new Date() })
        .where(eq(approvalsTable.id, approval.id));
      await auditAppend(tx, {
        actorType: 'user',
        actorId: tenant.user.id,
        userId: tenant.user.id,
        partnerId: null,
        action: 'approval.rejected',
        entityType: 'approval',
        entityId: approval.id,
        detail: parsed.data.reason ? { reason: parsed.data.reason } : {},
      });
      return { status: 200 as const, body: { ok: true } };
    });
    return c.json(result.body, result.status);
  });

  return app;
}
