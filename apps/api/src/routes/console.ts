import { orders as ordersTable } from '@ccn/db';
import { rejectSchema } from '@ccn/domain';
import { desc, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import type { AppDeps, AppEnv, TenantContext } from '../context';
import { withTenant } from '../context';
import { acceptOrder, rejectOrder, settleOrder } from '../db-fns';
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

  app.get('/orders', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const scope = partnerScope(tenant);
    if ('error' in scope) return c.json(scope, 403);
    const rows = await withTenant(deps, tenant, (tx) =>
      tx
        .select()
        .from(ordersTable)
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
        const order = await withTenant(deps, tenant, (tx) => fn(tx, id, scope.partnerId));
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
      const order = await withTenant(deps, tenant, (tx) =>
        rejectOrder(tx, id, scope.partnerId, parsed.data.reason ?? 'rejected by partner'),
      );
      return c.json({ order });
    } catch {
      return c.json({ error: 'order is not in a state you can reject' }, 409);
    }
  });

  return app;
}
