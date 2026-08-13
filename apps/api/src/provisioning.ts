import { type AllowlistConfig, demoCustomerAllowlist, operatorAllowlist } from '@ccn/config';
import { partners, seedDemoCustomer, seedPartnerConsole, userRoles, withRls } from '@ccn/db';
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
 * The subset of AppDeps this needs. Narrowed so the `grant` CLI can call the
 * exact same function without standing up Better Auth or supplying the OAuth and
 * LLM secrets it never reads — pre-provisioning a demo identity must produce
 * byte-identical state to the lazy path, and the only way to guarantee that is
 * for both to be one implementation. `AppDeps` satisfies this structurally, so
 * request handlers pass their deps unchanged.
 */
export interface ProvisioningDeps {
  db: AppDeps['db'];
  config: AllowlistConfig & { DB_APP_ROLE: string };
  logger: AppDeps['logger'];
}

/**
 * Grant the caller their initial role. No-op when they already hold one.
 *
 * Fails closed everywhere: an email absent from the operator allowlist, or one
 * naming a partner code that doesn't exist, becomes a plain `customer` rather
 * than an unbound operator. `surfaceFor()` also treats an operator without a
 * `partnerId` as a customer, so even a partial write cannot open the console.
 */
export async function ensureProvisioned(deps: ProvisioningDeps, user: SessionUser): Promise<void> {
  const email = user.email.trim().toLowerCase();
  const grant = operatorAllowlist(deps.config).get(email);

  // Runs inside the caller's RLS scope, not on a bare connection.
  //
  // `user_roles` is ENABLE + FORCE ROW LEVEL SECURITY with
  // `user_id = app_current_user_id()`, and `app_current_user_id()` reads a GUC
  // that a plain `db.transaction` never sets — so the policy evaluates to
  // `user_id = NULL`, the existence check sees nothing and the INSERT fails its
  // WITH CHECK. FORCE means even the table owner is subject to this; only a
  // superuser bypasses it, which is exactly what the local test database
  // connects as. That is why this passed every test and broke production sign-in.
  // Set when this sign-in granted an operator role, so the console can be
  // populated once the role transaction has committed.
  let operatorPartnerId: string | null = null;

  await withRls(deps.db, { userId: user.id, dbRole: deps.config.DB_APP_ROLE }, async (tx) => {
    // Serialize concurrent first requests for this user; released at commit.
    await tx.execute(sql`select pg_advisory_xact_lock(${lockKey(user.id)})`);

    // Re-check inside the lock — the request that lost the race must not insert.
    const existing = await tx
      .select({ role: userRoles.role, partnerId: userRoles.partnerId })
      .from(userRoles)
      .where(eq(userRoles.userId, user.id));

    // `partners.code` is an enum column, so an allowlist entry naming a code
    // outside it is rejected here rather than reaching the query.
    const knownCodes = partners.code.enumValues as readonly string[];
    const partnerCode = grant && knownCodes.includes(grant.partnerCode) ? grant.partnerCode : null;

    const [partner] = partnerCode
      ? await tx
          .select({ id: partners.id })
          .from(partners)
          .where(eq(partners.code, partnerCode as (typeof partners.code.enumValues)[number]))
      : [];

    /**
     * An account that already holds a role is reconciled against the allowlist,
     * not skipped.
     *
     * This used to return early the moment any role existed, and that made the
     * allowlist unable to correct itself. Provisioning is lazy, so an identity
     * that signed in before `PARTNER_OPERATOR_EMAILS` was set was granted
     * `customer` on that first request — and adding the address afterwards then
     * did nothing, on that request or any later one. The account was a customer
     * permanently. `bun run grant`, the documented safety valve, calls this
     * function and so could not fix it either. From the outside it reads as the
     * console being broken: the firm's own address signs in and lands on the
     * investor dashboard, with the environment variable plainly set.
     *
     * Upward only. Being absent from the allowlist while holding
     * `partner_operator` is logged, not revoked — an operator granted directly
     * in SQL is legitimate, and silently stripping a console mid-demo is a worse
     * failure than a stale grant. Revocation stays a deliberate act.
     */
    if (existing.length > 0) {
      if (!partner) {
        if (grant) {
          deps.logger.error(
            'operator allowlist names an unknown partner; leaving roles as they are',
            {
              partnerCode: grant.partnerCode,
              userId: user.id,
            },
          );
        }
        return;
      }
      const already = existing.some(
        (r) => r.role === 'partner_operator' && r.partnerId === partner.id,
      );
      if (already) return;

      await tx
        .insert(userRoles)
        .values({ userId: user.id, role: 'partner_operator', partnerId: partner.id })
        .onConflictDoNothing();
      operatorPartnerId = partner.id;
      deps.logger.info('promoted an existing account to partner operator from the allowlist', {
        userId: user.id,
        partnerCode,
        heldBefore: existing.map((r) => r.role),
      });
      return;
    }

    if (grant && partner) {
      await tx
        .insert(userRoles)
        .values({ userId: user.id, role: 'partner_operator', partnerId: partner.id })
        .onConflictDoNothing();
      operatorPartnerId = partner.id;
      return;
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
      // Also inside the tenant GUC — every table it writes carries the same
      // forced `user_id = app_current_user_id()` policy — but deliberately
      // WITHOUT dropping to DB_APP_ROLE. The seed is reset-then-insert, and the
      // application role is granted SELECT/INSERT/UPDATE and never DELETE
      // (0001_security.sql), by design. This is an administrative operation, so
      // it runs with the connection's own privileges; setting the GUC is what
      // makes the row policies pass rather than bypassing them.
      await withRls(deps.db, { userId: user.id }, (tx) => seedDemoCustomer(tx, user.id));
    } catch (error) {
      deps.logger.error('demo customer seeding failed; account will be empty', {
        error,
        userId: user.id,
      });
    }
  }

  // The institution counterpart. The console's data lived only in the seed CLI
  // and was hardcoded to the anchor partner, so an operator whose partner had
  // never been seeded — which is every deployment whose pre-deploy step only
  // runs migrations — signed in successfully and landed on an empty console.
  // Seeding it here means the surface populates itself on first sign-in, the
  // same way the customer one does.
  //
  // Not scoped by a tenant GUC: these rows belong to a partner, not a user, and
  // the console's own RLS keys off `app_current_partner_id()`. It runs with the
  // connection's privileges as an administrative operation, and is a no-op when
  // the partner already has listings.
  if (operatorPartnerId) {
    try {
      await seedPartnerConsole(deps.db, operatorPartnerId);
    } catch (error) {
      deps.logger.error('partner console seeding failed; the console will be empty', {
        error,
        userId: user.id,
        partnerId: operatorPartnerId,
      });
    }
  }
}
