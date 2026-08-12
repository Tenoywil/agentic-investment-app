import { demoCustomerAllowlist, operatorAllowlist } from '@ccn/config';
import { partners, seedDemoCustomer, userRoles } from '@ccn/db';
import { eq, sql } from 'drizzle-orm';
import type { AppDeps, SessionUser } from './context';

/**
 * First-sign-in role provisioning.
 *
 * Nothing else in the product assigns a role, so without this every real Google
 * identity would hold zero roles forever — which is exactly the state production
 * was in: `/api/console/*` returned 403 to everyone alive because no user could
 * ever become a `partner_operator`.
 *
 * This runs lazily from `tenantFromUser`, not from a Better Auth
 * `databaseHooks.user.create.after`, for three reasons: the hook only fires on
 * user *creation*, so it would do nothing for identities that have already
 * signed in; a throw inside it would break the OAuth flow itself; and the role
 * lookup is already happening here on every request, so this is the natural
 * seam. It is idempotent and self-healing — an account that predates the
 * allowlist picks up its role on its next request.
 */

/** Stable 64-bit lock key per user, so two concurrent first requests serialize. */
function lockKey(userId: string) {
  return sql`hashtextextended(${userId}, 0)`;
}

/**
 * Grant the caller their initial role. No-op when they already hold one.
 *
 * Fails closed everywhere: an email absent from the operator allowlist, or one
 * naming a partner code that doesn't exist, becomes a plain `customer` rather
 * than an unbound operator. `surfaceFor()` also treats an operator without a
 * `partnerId` as a customer, so even a partial write cannot open the console.
 */
export async function ensureProvisioned(deps: AppDeps, user: SessionUser): Promise<void> {
  const email = user.email.trim().toLowerCase();
  const grant = operatorAllowlist(deps.config).get(email);

  await deps.db.transaction(async (tx) => {
    // Serialize concurrent first requests for this user; released at commit.
    await tx.execute(sql`select pg_advisory_xact_lock(${lockKey(user.id)})`);

    // Re-check inside the lock — the request that lost the race must not insert.
    const existing = await tx
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, user.id));
    if (existing.length > 0) return;

    // `partners.code` is an enum column, so an allowlist entry naming a code
    // outside it is rejected here rather than reaching the query.
    const knownCodes = partners.code.enumValues as readonly string[];
    const partnerCode = grant && knownCodes.includes(grant.partnerCode) ? grant.partnerCode : null;

    if (grant && partnerCode) {
      const [partner] = await tx
        .select({ id: partners.id })
        .from(partners)
        .where(eq(partners.code, partnerCode as (typeof partners.code.enumValues)[number]));

      if (partner) {
        await tx
          .insert(userRoles)
          .values({ userId: user.id, role: 'partner_operator', partnerId: partner.id })
          .onConflictDoNothing();
        return;
      }
    }

    if (grant) {
      deps.logger.error('operator allowlist names an unknown partner; granting customer instead', {
        partnerCode: grant.partnerCode,
        userId: user.id,
      });
    }

    await tx.insert(userRoles).values({ userId: user.id, role: 'customer' }).onConflictDoNothing();
  });

  // Demo accounts get the seeded Caribbean portfolio; everyone else starts
  // genuinely empty. Outside the role transaction so a seeding failure cannot
  // roll back the role grant and leave the user unable to sign in anywhere.
  if (demoCustomerAllowlist(deps.config).has(email)) {
    try {
      await seedDemoCustomer(deps.db, user.id);
    } catch (error) {
      deps.logger.error('demo customer seeding failed; account will be empty', {
        error,
        userId: user.id,
      });
    }
  }
}
