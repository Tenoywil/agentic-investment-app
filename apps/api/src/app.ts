import { limits, userProfiles } from '@ccn/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { AppDeps, AppEnv } from './context';
import { withTenant } from './context';
import { requireAuth, sessionMiddleware } from './middleware';

/**
 * The CCN API surface. Better Auth owns /api/auth/*; every other /api/* route is
 * session-gated and reads/writes only through the caller's RLS-scoped
 * transaction (withTenant). Handlers close over injected deps — no globals.
 */
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use('*', secureHeaders());
  app.use('*', cors({ origin: deps.config.APP_WEB_ORIGIN, credentials: true }));

  // Better Auth (sign in with Google, OAuth callbacks, session, sign out).
  app.on(['GET', 'POST'], '/api/auth/*', (c) => deps.auth.handler(c.req.raw));

  // Liveness probe — no auth, no database.
  app.get('/health', (c) => c.json({ status: 'ok', env: deps.config.APP_ENV }));

  app.use('/api/*', sessionMiddleware(deps));

  // The authenticated caller, with profile + limits read under their RLS scope.
  app.get('/api/me', requireAuth(deps), async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const data = await withTenant(deps, tenant, async (tx) => {
      const [profile] = await tx
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, tenant.user.id));
      const [limit] = await tx.select().from(limits).where(eq(limits.userId, tenant.user.id));
      return { profile: profile ?? null, limits: limit ?? null };
    });
    return c.json({ user: tenant.user, roles: tenant.roles, ...data });
  });

  return app;
}
