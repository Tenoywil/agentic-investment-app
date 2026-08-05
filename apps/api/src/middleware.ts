import { userRoles } from '@ccn/db';
import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import type { AppDeps, AppEnv, SessionUser, TenantContext } from './context';

/** Resolve the Better Auth session (if any) and attach the user to the context. */
export function sessionMiddleware(deps: AppDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const result = await deps.auth.api.getSession({ headers: c.req.raw.headers });
    if (result?.user) {
      const user: SessionUser = {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
      };
      c.set('user', user);
    }
    await next();
  });
}

/**
 * Gate a route on an authenticated session and resolve the caller's tenant scope
 * (roles, bound partner, RBAC role). The roles lookup is an auth bootstrap, so it
 * runs on the privileged connection before any RLS scope is established.
 */
export function requireAuth(deps: AppDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'authentication required' }, 401);

    const roleRows = await deps.db
      .select({ role: userRoles.role, partnerId: userRoles.partnerId })
      .from(userRoles)
      .where(eq(userRoles.userId, user.id));

    const roles = roleRows.map((r) => r.role);
    const partnerId = roleRows.find((r) => r.role === 'partner_operator')?.partnerId ?? undefined;
    const appRole = roles.includes('admin')
      ? 'admin'
      : roles.includes('compliance')
        ? 'compliance'
        : undefined;

    const tenant: TenantContext = {
      user,
      roles,
      ...(partnerId ? { partnerId } : {}),
      ...(appRole ? { appRole } : {}),
    };
    c.set('tenant', tenant);
    await next();
  });
}
