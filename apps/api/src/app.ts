import { limits, userProfiles } from '@ccn/db';
import { createMemoryStore, createRateLimiter } from '@ccn/security';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { AppDeps, AppEnv } from './context';
import { withTenant } from './context';
import {
  bigintSafeJson,
  rateLimit,
  requestLogger,
  requireAuth,
  sessionMiddleware,
} from './middleware';
import { agentRoutes } from './routes/agent';
import { approvalsRoutes } from './routes/approvals';
import { consoleRoutes } from './routes/console';
import { gatewayRoutes } from './routes/gateway';
import { ingestionRoutes } from './routes/ingestion';
import { ordersRoutes } from './routes/orders';
import { portfolioRoutes } from './routes/portfolio';
import { RATE_LIMITS, type RateLimitClass, createClientIpResolver } from './security';

/**
 * The CCN API surface. Better Auth owns /api/auth/*; every other /api/* route is
 * session-gated and reads/writes only through the caller's RLS-scoped
 * transaction (withTenant). Handlers close over injected deps — no globals.
 */
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  // One limiter per route class. The in-memory store is correct for a single
  // instance; swap in the Postgres store when the API scales past one machine
  // (the RateLimitStore port is the only thing that changes).
  const clientIp = createClientIpResolver();
  const limiters = new Map(
    Object.entries(RATE_LIMITS).map(([name, rule]) => [
      name as RateLimitClass,
      createRateLimiter(rule, createMemoryStore(), () => Date.now()),
    ]),
  );
  const limit = (name: RateLimitClass) => {
    const limiter = limiters.get(name);
    if (!limiter) throw new Error(`unknown rate limit class ${name}`);
    return rateLimit(limiter, clientIp);
  };

  app.use('*', secureHeaders());
  app.use('*', cors({ origin: deps.config.APP_WEB_ORIGIN, credentials: true }));
  app.use('*', bigintSafeJson());
  app.use('*', requestLogger(deps));

  // Better Auth (sign in with Google, OAuth callbacks, session, sign out).
  // Rate limited before the handler — this is the credential-stuffing surface.
  app.use('/api/auth/*', limit('auth'));
  app.on(['GET', 'POST'], '/api/auth/*', (c) => deps.auth.handler(c.req.raw));

  // Liveness probe — no auth, no database, no limit (the platform polls it).
  app.get('/health', (c) => c.json({ status: 'ok', env: deps.config.APP_ENV }));

  app.use('/api/*', sessionMiddleware(deps));

  // Budgets by cost and consequence. Session middleware has already run, so an
  // authenticated caller is keyed by user id rather than by address.
  app.use('/api/agent/*', limit('agent'));
  app.use('/api/orders/*', limit('orders'));
  app.use('/api/approvals/*', limit('approvals'));
  app.use('/api/ingestion/*', limit('orders'));
  app.use('/api/portfolio/*', limit('read'));
  app.use('/api/console/*', limit('read'));
  // Gateway routes carry their own per-endpoint class (agent-heavy vs. mutating
  // vs. read) since a single group would either starve the LLM passes or let
  // mutations ride the generous read budget.

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

  // Trading surface: the Limits-Engine-gated order path, approval cards, the
  // unified portfolio, and the partner console's order flow.
  app.route('/api/orders', ordersRoutes(deps));
  app.route('/api/approvals', approvalsRoutes(deps));
  app.route('/api/portfolio', portfolioRoutes(deps));
  app.route('/api/console', consoleRoutes(deps));
  app.route('/api/agent', agentRoutes(deps));
  app.route('/api/ingestion', ingestionRoutes(deps));
  app.route('/api/gateway', gatewayRoutes(deps, limit));

  return app;
}
