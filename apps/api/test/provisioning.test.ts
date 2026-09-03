import { afterAll, describe, expect, test } from 'bun:test';
import { createDb, partners, user, userRoles } from '@ccn/db';
import { createFieldCipher } from '@ccn/security';
import { eq, inArray } from 'drizzle-orm';
import { createLogger } from '../src/logger';
import { type ProvisioningDeps, ensureProvisioned, needsOperatorGrant } from '../src/provisioning';
import { surfaceFor } from '../src/roles';
import { tenantFromUser } from '../src/tenant';

/**
 * First-sign-in provisioning, run as the application role rather than as a
 * superuser.
 *
 * This is the whole point of the suite. `user_roles` and every customer-owned
 * table are ENABLE + FORCE ROW LEVEL SECURITY with
 * `user_id = app_current_user_id()`. `ensureProvisioned` originally ran on a
 * bare `db.transaction`, which never sets that GUC, so the policy evaluated to
 * `user_id = NULL`: the existence check saw nothing and the INSERT failed its
 * WITH CHECK with "new row violates row-level security policy". FORCE means
 * even the table owner is subject to it — only a superuser bypasses.
 *
 * The local and CI databases connect as `postgres`, which is a superuser with
 * BYPASSRLS, so every existing test passed straight through the policy and the
 * defect reached production, where it broke sign-in itself: the throw
 * propagated out of `tenantFromUser` and turned `/api/me` into a 500.
 *
 * Passing `DB_APP_ROLE` here makes provisioning `SET LOCAL ROLE ccn_app`, which
 * drops the superuser exemption for the rest of the transaction. That is what
 * makes these assertions mean anything.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite('first-sign-in provisioning under RLS', () => {
  const { db, client } = createDb(DATABASE_URL ?? '', { max: 4 });
  const logger = createLogger({ level: 'error', base: { service: 'test' } });
  const kycFieldCipher = createFieldCipher({ id: 'test', material: new Uint8Array(32).fill(23) });
  const made: string[] = [];
  const tag = `prov-${Date.now()}`;

  const deps = (over: Partial<ProvisioningDeps['config']> = {}): ProvisioningDeps => ({
    db,
    logger,
    kycFieldCipher,
    config: {
      PARTNER_OPERATOR_EMAILS: '',
      DEMO_CUSTOMER_EMAILS: '',
      DEMO_PARTNER_CODE: 'SAG',
      ADMIN_EMAILS: '',
      // The role the production connection runs as. Without this the suite
      // would run as a superuser and prove nothing.
      DB_APP_ROLE: 'ccn_app',
      ...over,
    },
  });

  async function makeUser(local: string) {
    const [row] = await db
      .insert(user)
      .values({ name: 'Test Person', email: `${tag}-${local}@example.test` })
      .returning({ id: user.id, email: user.email, name: user.name });
    if (!row) throw new Error('insert returned no row');
    made.push(row.id);
    return row;
  }

  /** The tenant shape the surface resolver actually takes, from role rows. */
  const surfaceOf = (rows: { role: string; partnerId: string | null }[]) =>
    surfaceFor({
      roles: rows.map((r) => r.role),
      partnerId: rows.find((r) => r.role === 'partner_operator')?.partnerId ?? null,
    } as Parameters<typeof surfaceFor>[0]);

  const rolesOf = (userId: string) =>
    db
      .select({ role: userRoles.role, partnerId: userRoles.partnerId })
      .from(userRoles)
      .where(eq(userRoles.userId, userId));

  afterAll(async () => {
    if (made.length > 0) await db.delete(user).where(inArray(user.id, made));
    await client.end();
  });

  test('an ordinary identity is granted customer', async () => {
    const u = await makeUser('plain');
    await ensureProvisioned(deps(), u);
    expect(await rolesOf(u.id)).toEqual([{ role: 'customer', partnerId: null }]);
  });

  test('an allowlisted operator is bound to its partner', async () => {
    const u = await makeUser('operator');
    await ensureProvisioned(deps({ PARTNER_OPERATOR_EMAILS: `${u.email}:SAG` }), u);
    const [sag] = await db
      .select({ id: partners.id })
      .from(partners)
      .where(eq(partners.code, 'SAG'));
    expect(await rolesOf(u.id)).toEqual([{ role: 'partner_operator', partnerId: sag?.id ?? null }]);
  });

  test('an unknown partner code falls back to customer rather than an unbound operator', async () => {
    const u = await makeUser('badcode');
    await ensureProvisioned(deps({ PARTNER_OPERATOR_EMAILS: `${u.email}:NOSUCH` }), u);
    expect(await rolesOf(u.id)).toEqual([{ role: 'customer', partnerId: null }]);
  });

  /**
   * The allowlist has to be able to correct an account it did not cover yet.
   *
   * Provisioning is lazy, so an identity that signed in before
   * PARTNER_OPERATOR_EMAILS was set got `customer` on that first request. This
   * function then returned early for anyone holding any role, so adding the
   * address afterwards did nothing — on that request or any later one — and the
   * account was a customer permanently. `bun run grant` calls this function, so
   * the documented safety valve could not fix it either. Reported as the console
   * being broken with the variable plainly set, which is exactly how it looks.
   */
  test('an account already granted customer is promoted when the allowlist names it', async () => {
    const u = await makeUser('promoted');
    await ensureProvisioned(deps(), u);
    expect(await rolesOf(u.id)).toEqual([{ role: 'customer', partnerId: null }]);

    await ensureProvisioned(deps({ PARTNER_OPERATOR_EMAILS: `${u.email}:SAG` }), u);
    const [sag] = await db
      .select({ id: partners.id })
      .from(partners)
      .where(eq(partners.code, 'SAG'));
    const roles = await rolesOf(u.id);
    expect(roles).toContainEqual({ role: 'partner_operator', partnerId: sag?.id ?? null });
    // surfaceFor() resolves an account holding both to the institution, so the
    // stale customer row is harmless and is left rather than deleted.
    expect(surfaceOf(roles)).toBe('institution');
  });

  test('promoting twice does not add a second operator row', async () => {
    const u = await makeUser('promoted-twice');
    await ensureProvisioned(deps(), u);
    const withList = deps({ PARTNER_OPERATOR_EMAILS: `${u.email}:SAG` });
    await ensureProvisioned(withList, u);
    const after = await rolesOf(u.id);
    await ensureProvisioned(withList, u);
    expect(await rolesOf(u.id)).toEqual(after);
  });

  /**
   * Upward only. An operator granted directly in SQL is legitimate, and
   * silently stripping a console mid-demo is a worse failure than a stale grant,
   * so absence from the allowlist is logged rather than acted on.
   */
  /**
   * The promotion has to be reachable from a real request, not just callable.
   *
   * `tenantFromUser` only called `ensureProvisioned` when a user held no roles
   * at all — so the reconciliation above was unreachable for exactly the
   * accounts that needed it, and fixing `ensureProvisioned` alone left the
   * whole thing inert. This drives the function the request path actually
   * calls, which is the only version of this test that would have caught it.
   */
  test('the request path promotes an allowlisted account that already holds customer', async () => {
    const u = await makeUser('via-tenant');
    await ensureProvisioned(deps(), u);
    expect(surfaceOf(await rolesOf(u.id))).toBe('customer');

    const withList = {
      ...deps({ PARTNER_OPERATOR_EMAILS: `${u.email}:SAG` }),
      auth: {} as never,
    };
    const tenant = await tenantFromUser(withList as never, u);
    expect(tenant.roles).toContain('partner_operator');
    expect(tenant.partnerId).toBeTruthy();
    expect(surfaceFor(tenant)).toBe('institution');
  });

  /** And it must not fire for anyone the allowlist does not name. */
  test('needsOperatorGrant is false for an ordinary account and for a settled operator', () => {
    const cfg = {
      PARTNER_OPERATOR_EMAILS: 'ops@firm.test:SAG',
      DEMO_CUSTOMER_EMAILS: '',
      DEMO_PARTNER_CODE: 'SAG',
      ADMIN_EMAILS: '',
    };
    expect(needsOperatorGrant(cfg, 'someone@else.test', [{ role: 'customer' }])).toBe(false);
    expect(needsOperatorGrant(cfg, 'ops@firm.test', [{ role: 'customer' }])).toBe(true);
    // Casing follows whatever the provider returns.
    expect(needsOperatorGrant(cfg, 'OPS@Firm.test', [{ role: 'customer' }])).toBe(true);
    // Already granted: stops asking.
    expect(needsOperatorGrant(cfg, 'ops@firm.test', [{ role: 'partner_operator' }])).toBe(false);
  });

  test('an existing operator is not demoted by an empty allowlist', async () => {
    const u = await makeUser('keeps-operator');
    await ensureProvisioned(deps({ PARTNER_OPERATOR_EMAILS: `${u.email}:SAG` }), u);
    await ensureProvisioned(deps({ PARTNER_OPERATOR_EMAILS: '' }), u);
    expect(surfaceOf(await rolesOf(u.id))).toBe('institution');
  });

  test('running twice writes one row', async () => {
    const u = await makeUser('twice');
    await ensureProvisioned(deps(), u);
    await ensureProvisioned(deps(), u);
    expect((await rolesOf(u.id)).length).toBe(1);
  });

  test('concurrent first requests produce one row', async () => {
    const u = await makeUser('race');
    await Promise.all([
      ensureProvisioned(deps(), u),
      ensureProvisioned(deps(), u),
      ensureProvisioned(deps(), u),
    ]);
    expect((await rolesOf(u.id)).length).toBe(1);
  });

  test('a demo identity receives the seeded portfolio through the same RLS path', async () => {
    const u = await makeUser('demo');
    await ensureProvisioned(deps({ DEMO_CUSTOMER_EMAILS: u.email }), u);
    expect(await rolesOf(u.id)).toEqual([{ role: 'customer', partnerId: null }]);

    // Seeding is wrapped in a try/catch so a failure cannot block sign-in —
    // which also means an RLS failure here would be silent. Assert the rows.
    const [{ count }] = (await db.execute(
      `select count(*)::int as count from holdings where user_id = '${u.id}'`,
    )) as unknown as [{ count: number }];
    expect(count).toBeGreaterThan(0);
  });
});
