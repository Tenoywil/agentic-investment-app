import { ingestPullSchema } from '@ccn/domain';
import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../context';
import { withTenant } from '../context';
import { requireAuth } from '../middleware';
import { pullStatements } from '../services/ingestion';
import { maskRef } from './util';

/**
 * Statement ingestion (investor side). POST /pull pulls a connected partner's
 * statements through the adapter and lands them as pending reconciliation items;
 * a partner operator later matches them into holdings from the console. Nothing
 * becomes a holding without that human step.
 */
export function ingestionRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', requireAuth(deps));

  app.post('/pull', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const parsed = ingestPullSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);

    try {
      const result = await withTenant(deps, tenant, (tx) =>
        pullStatements(tx, {
          userId: tenant.user.id,
          partnerCode: parsed.data.partnerCode,
          clientRef: maskRef(tenant.user.id),
          now: () => Date.now(),
        }),
      );
      return c.json({ queued: result.created });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'ingestion failed' }, 409);
    }
  });

  return app;
}
