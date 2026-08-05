import { createMiddleware } from 'hono/factory';
import type { AppDeps, AppEnv, SessionUser } from './context';
import { tenantFromUser } from './tenant';

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
    c.set('tenant', await tenantFromUser(deps, user));
    await next();
  });
}
