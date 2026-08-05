import { userRoles } from '@ccn/db';
import { eq } from 'drizzle-orm';
import type { AppDeps, SessionUser, TenantContext } from './context';

/**
 * Resolve a user's roles and tenant scope. The roles lookup is an auth bootstrap,
 * so it runs on the privileged connection before any RLS scope exists. Shared by
 * the HTTP auth middleware and the WebSocket upgrade path so both derive tenant
 * identity identically.
 */
export async function tenantFromUser(deps: AppDeps, user: SessionUser): Promise<TenantContext> {
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

  return {
    user,
    roles,
    ...(partnerId ? { partnerId } : {}),
    ...(appRole ? { appRole } : {}),
  };
}

/** Validate a request's session (via cookies in `headers`) and resolve its tenant. */
export async function resolveTenant(
  deps: AppDeps,
  headers: Headers,
): Promise<TenantContext | null> {
  const result = await deps.auth.api.getSession({ headers });
  if (!result?.user) return null;
  const user: SessionUser = {
    id: result.user.id,
    email: result.user.email,
    name: result.user.name,
  };
  return tenantFromUser(deps, user);
}
