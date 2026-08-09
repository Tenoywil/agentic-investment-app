import type { ServerConfig } from '@ccn/config';
import type { Database, Transaction } from '@ccn/db';
import { withRls } from '@ccn/db';
import type { Auth } from './auth';
import type { Logger } from './logger';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

/** Everything a request handler needs, wired once at the composition root. */
export interface AppDeps {
  db: Database;
  auth: Auth;
  config: ServerConfig;
  logger: Logger;
}

/** The authenticated caller's resolved identity, roles, and tenant scope. */
export interface TenantContext {
  user: SessionUser;
  roles: string[];
  partnerId?: string;
  appRole?: string;
}

export type AppEnv = {
  Variables: {
    user?: SessionUser;
    tenant?: TenantContext;
    /** Correlation id for this request, echoed as `x-request-id`. */
    requestId?: string;
    /** Request-scoped logger, pre-stamped with requestId/method/route. */
    log?: Logger;
  };
};

/**
 * Run `fn` inside the caller's RLS-scoped transaction — the one seam through
 * which request data reaches the database. Drops to the app's non-superuser role
 * and sets the tenant GUCs, so RLS filters every query to this user/partner.
 */
export function withTenant<T>(
  deps: AppDeps,
  ctx: TenantContext,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return withRls(
    deps.db,
    {
      userId: ctx.user.id,
      partnerId: ctx.partnerId,
      appRole: ctx.appRole,
      dbRole: deps.config.DB_APP_ROLE,
    },
    fn,
  );
}
