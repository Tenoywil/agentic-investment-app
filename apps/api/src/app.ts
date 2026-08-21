import { connectedAccounts, kycStatus, limits, partners, userProfiles } from '@ccn/db';
import { createMemoryStore, createRateLimiter } from '@ccn/security';
import { and, eq, isNotNull } from 'drizzle-orm';
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
import { MIGRATION_PENDING, isDatabaseBehind } from './migrations';
import { requireAdmin, requireCustomer, requirePartnerOperator, surfaceFor } from './roles';
import { adminRoutes } from './routes/admin';
import { agentRoutes } from './routes/agent';
import { approvalsRoutes } from './routes/approvals';
import { consoleRoutes } from './routes/console';
import { gatewayRoutes } from './routes/gateway';
import { ingestionRoutes } from './routes/ingestion';
import { limitsRoutes } from './routes/limits';
import { onboardingRoutes } from './routes/onboarding';
import { opportunitiesRoutes } from './routes/opportunities';
import { ordersRoutes } from './routes/orders';
import { planningRoutes } from './routes/planning';
import { portfolioRoutes } from './routes/portfolio';
import { publicRoutes } from './routes/public';
import { RATE_LIMITS, type RateLimitClass, createClientIpResolver } from './security';
import {
  type PartnerWebhookAdminRuntime,
  createPartnerWebhookAdminRuntime,
} from './services/partner-webhooks';

/**
 * The CCN API surface. Better Auth owns /api/auth/*; every other /api/* route is
 * session-gated and reads/writes only through the caller's RLS-scoped
 * transaction (withTenant). Handlers close over injected deps — no globals.
 */
export function createApp(
  deps: AppDeps,
  services: { partnerWebhooks?: PartnerWebhookAdminRuntime } = {},
) {
  const app = new Hono<AppEnv>();
  const partnerWebhooks = services.partnerWebhooks ?? createPartnerWebhookAdminRuntime(deps.config);

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

  /**
   * A database behind the code answers 503, not 500.
   *
   * Reads degrade (services/fx.ts, the marketplace, the orders list). Writes
   * cannot: there is no older version of `partner_upsert_instrument` to fall
   * back to, and inventing one would mean writing the wrong table. So a write
   * fails safely. Deployment details remain in the request-correlated server
   * log; the public response says what the operator can act on and gives them
   * a reference support can trace, without exposing infrastructure internals.
   *
   * 503 rather than 500 because it is exactly that: the service is
   * temporarily unable to do this, a specific person can fix it in a minute,
   * and it is not a bug in the request.
   */
  app.onError((err, c) => {
    const reference = c.get('requestId') ?? crypto.randomUUID();
    if (isDatabaseBehind(err)) {
      (c.get('log') ?? deps.logger).error(
        `a request needed a migration this database does not have. ${MIGRATION_PENDING}`,
        { path: c.req.path, method: c.req.method, error: err },
      );
      return c.json(
        {
          error: `We couldn't complete that action right now. Your existing data is unchanged. Please try again shortly. If this continues, contact support and share reference ${reference}.`,
          code: 'service_temporarily_unavailable',
          reference,
        },
        503,
      );
    }
    (c.get('log') ?? deps.logger).error('unhandled error', {
      path: c.req.path,
      method: c.req.method,
      error: err,
    });
    return c.json(
      {
        error: `Something went wrong while completing your request. Please try again. If this continues, contact support and share reference ${reference}.`,
        code: 'request_failed',
        reference,
      },
      500,
    );
  });

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
  // Unauthenticated brand data (landing page). Read budget, keyed by address.
  app.use('/api/public/*', limit('read'));
  app.use('/api/console/*', limit('read'));
  app.use('/api/opportunities/*', limit('read'));
  app.use('/api/planning/*', limit('read'));
  app.use('/api/onboarding/*', limit('orders'));
  // Gateway routes carry their own per-endpoint class (agent-heavy vs. mutating
  // vs. read) since a single group would either starve the LLM passes or let
  // mutations ride the generous read budget.

  // Surface separation. Mounted per group rather than per handler so a route
  // added later cannot silently ship without a guard — the customer routes
  // previously had none at all, which let a partner operator read the entire
  // customer product. `requireCustomer` rejects operators specifically, so
  // compliance and admin users still reach the gateway review queue.
  app.use('/api/portfolio/*', requireCustomer(deps));
  app.use('/api/orders/*', requireCustomer(deps));
  app.use('/api/approvals/*', requireCustomer(deps));
  app.use('/api/agent/*', requireCustomer(deps));
  app.use('/api/opportunities/*', requireCustomer(deps));
  app.use('/api/planning/*', requireCustomer(deps));
  app.use('/api/onboarding/*', requireCustomer(deps));
  // Ingestion pulls statements for the CALLING user from their own partner, so
  // it belongs to the customer surface. It was the one /api group with no
  // surface guard at all — an operator or an administrator could reach it.
  app.use('/api/ingestion/*', requireCustomer(deps));
  app.use('/api/limits/*', requireCustomer(deps));
  // The gateway is the investor-facing private-deal product, so it belongs to
  // the customer surface. Its analyst/compliance review endpoints still work:
  // requireCustomer turns away partner operators only, and analysts hold no
  // partner binding.
  app.use('/api/gateway/*', requireCustomer(deps));
  app.use('/api/console/*', requirePartnerOperator(deps));
  // Administration reads across every tenant, so the guard is mounted at the
  // group rather than per handler: a route added here later cannot forget it.
  app.use('/api/admin/*', requireAdmin(deps));

  /**
   * The authenticated caller: identity, which surface they belong to, their
   * partner (operators only), profile, limits and onboarding progress.
   *
   * Deliberately one call. The web app derives its post-sign-in redirect, its
   * surface guard, the console's partner branding and the execute dialog's KYC
   * checks from this — each of which was previously a hardcoded constant.
   */
  app.get('/api/me', requireAuth(deps), async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const data = await withTenant(deps, tenant, async (tx) => {
      const [profile] = await tx
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, tenant.user.id));
      const [limit] = await tx.select().from(limits).where(eq(limits.userId, tenant.user.id));
      const [kyc] = await tx.select().from(kycStatus).where(eq(kycStatus.userId, tenant.user.id));
      // Firms that asked this person to finish KYC intake (0032). The web
      // shows the ask only while onboarding is actually incomplete, so a
      // stale request after completion costs nothing.
      const kycRequests = await tx
        .select({
          partner: partners.name,
          requestedAt: connectedAccounts.kycRequestedAt,
        })
        .from(connectedAccounts)
        .innerJoin(partners, eq(partners.id, connectedAccounts.partnerId))
        .where(
          and(
            eq(connectedAccounts.userId, tenant.user.id),
            isNotNull(connectedAccounts.kycRequestedAt),
          ),
        );
      const [partner] = tenant.partnerId
        ? await tx
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
            .where(eq(partners.id, tenant.partnerId))
        : [];
      return {
        profile: profile ?? null,
        limits: limit ?? null,
        kyc: kyc ?? null,
        partner,
        kycRequests,
      };
    });

    const { kyc, partner, ...rest } = data;
    return c.json({
      user: tenant.user,
      surface: surfaceFor(tenant),
      roles: tenant.roles,
      partner: partner ?? null,
      ...rest,
      onboarding: {
        tier: kyc?.tier ?? 'none',
        identityVerified: kyc?.identityVerified ?? false,
        complianceConfirmed: kyc?.complianceConfirmed ?? false,
        riskCompleted: kyc?.riskCompleted ?? false,
        fundsConfirmed: kyc?.fundsConfirmed ?? false,
        complete: Boolean(
          kyc?.identityVerified &&
            kyc?.complianceConfirmed &&
            kyc?.riskCompleted &&
            kyc?.fundsConfirmed,
        ),
      },
    });
  });

  // Trading surface: the Limits-Engine-gated order path, approval cards, the
  // unified portfolio, and the partner console's order flow.
  app.route('/api/orders', ordersRoutes(deps));
  app.route('/api/approvals', approvalsRoutes(deps));
  app.route('/api/portfolio', portfolioRoutes(deps));
  app.route('/api/console', consoleRoutes(deps, partnerWebhooks));
  app.route('/api/admin', adminRoutes(deps));
  app.route('/api/agent', agentRoutes(deps));
  app.route('/api/ingestion', ingestionRoutes(deps));
  app.route('/api/opportunities', opportunitiesRoutes(deps));
  app.route('/api/planning', planningRoutes(deps));
  app.route('/api/onboarding', onboardingRoutes(deps));
  app.route('/api/limits', limitsRoutes(deps));
  app.route('/api/gateway', gatewayRoutes(deps, limit));
  // No surface guard on purpose: partner brand marks are the network's public
  // face, served to the signed-out landing page. Brand columns only.
  app.route('/api/public', publicRoutes(deps));

  return app;
}
