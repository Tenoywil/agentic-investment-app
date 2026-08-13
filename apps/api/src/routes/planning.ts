import { goals, planningProducts } from '@ccn/db';
import { createGoalSchema } from '@ccn/domain';
import { asc, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../context';
import { withTenant } from '../context';
import { auditAppend } from '../db-fns';
import { requireAuth } from '../middleware';

/**
 * Cross-border planning: the products catalog (reference data — life cover,
 * annuities, mortgages, …) and the caller's own goal rings. Ports the
 * prototype's `planningProducts` + `goals`. Read-mostly; goal creation is the
 * only mutation and carries no guardrail (unlike orders/approvals, a goal is a
 * target the user sets for themselves, not a capital commitment).
 */
export function planningRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', requireAuth(deps));

  app.get('/products', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const rows = await withTenant(deps, tenant, (tx) =>
      tx.select().from(planningProducts).orderBy(asc(planningProducts.code)),
    );
    return c.json({ products: rows });
  });

  app.get('/goals', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const rows = await withTenant(deps, tenant, (tx) =>
      tx
        .select()
        .from(goals)
        .where(eq(goals.userId, tenant.user.id))
        .orderBy(desc(goals.createdAt)),
    );
    return c.json({
      goals: rows.map((g) => ({
        ...g,
        targetMinor: g.targetMinor.toString(),
        currentMinor: g.currentMinor.toString(),
      })),
    });
  });

  app.post('/goals', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const parsed = createGoalSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);
    const { name, targetMinor, fromLabel, eta, color } = parsed.data;

    const created = await withTenant(deps, tenant, async (tx) => {
      const [goal] = await tx
        .insert(goals)
        .values({
          userId: tenant.user.id,
          name,
          targetMinor,
          fromLabel: fromLabel ?? null,
          eta: eta ?? null,
          color: color ?? null,
        })
        .returning();
      if (!goal) throw new Error('goal insert returned no row');
      await auditAppend(tx, {
        actorType: 'user',
        actorId: tenant.user.id,
        userId: tenant.user.id,
        partnerId: null,
        action: 'goal.created',
        entityType: 'goal',
        entityId: goal.id,
        detail: { name, targetMinor: targetMinor.toString() },
      });
      return goal;
    });

    return c.json(
      {
        goal: {
          ...created,
          targetMinor: created.targetMinor.toString(),
          currentMinor: created.currentMinor.toString(),
        },
      },
      201,
    );
  });

  return app;
}
