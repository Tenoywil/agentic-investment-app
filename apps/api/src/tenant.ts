import { userRoles, withRls } from '@ccn/db';
import { eq } from 'drizzle-orm';
import type { AppDeps, SessionUser, TenantContext } from './context';
import { ensureProvisioned, needsOperatorGrant } from './provisioning';

/**
 * Resolve a user's roles and tenant scope. Shared by the HTTP auth middleware
 * and the WebSocket upgrade path so both derive tenant identity identically.
 *
 * The roles lookup is an auth bootstrap, but it still runs inside the user's own
 * RLS scope rather than on a bare connection. `user_roles` is FORCE ROW LEVEL
 * SECURITY with `user_id = app_current_user_id()`; without the GUC set, the
 * policy is `user_id = NULL` and the read returns nothing for everybody — which
 * on a database whose connection is not a superuser means no user ever resolves
 * a role. Scoping the read to the user we are resolving satisfies the policy
 * and is the same seam every other read uses.
 */
export async function tenantFromUser(deps: AppDeps, user: SessionUser): Promise<TenantContext> {
  const readRoles = () =>
    withRls(deps.db, { userId: user.id, dbRole: deps.config.DB_APP_ROLE }, (tx) =>
      tx
        .select({ role: userRoles.role, partnerId: userRoles.partnerId })
        .from(userRoles)
        .where(eq(userRoles.userId, user.id)),
    );

  let roleRows = await readRoles();

  // A user with no roles has never been provisioned — grant their initial role
  // now and re-read. Nothing else in the product assigns roles, so this is the
  // only path by which a real Google identity ever gets one.
  //
  // The second condition is what lets the operator allowlist correct itself.
  // Provisioning is lazy, so an identity that signed in before
  // PARTNER_OPERATOR_EMAILS was set holds `customer` — and with the check being
  // only `length === 0`, it would never be reconsidered, on this request or any
  // later one. Adding the address to the allowlist did nothing, permanently.
  // `needsOperatorGrant` is a Map lookup and a scan of a few rows, it is false
  // for everyone not named in the allowlist, and it stops being true the moment
  // the grant lands — so the ordinary request pays nothing for it.
  if (roleRows.length === 0 || needsOperatorGrant(deps.config, user.email, roleRows)) {
    await ensureProvisioned(deps, user);
    roleRows = await readRoles();
  }

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
