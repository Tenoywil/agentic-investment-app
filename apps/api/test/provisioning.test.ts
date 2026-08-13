import { afterAll, describe, expect, test } from 'bun:test';
import { createDb, partners, user, userRoles } from '@ccn/db';
import { eq, inArray } from 'drizzle-orm';
import { createLogger } from '../src/logger';
import { type ProvisioningDeps, ensureProvisioned } from '../src/provisioning';

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
  const made: string[] = [];
  const tag = `prov-${Date.now()}`;

  const deps = (over: Partial<ProvisioningDeps['config']> = {}): ProvisioningDeps => ({
    db,
    logger,
    config: {
      PARTNER_OPERATOR_EMAILS: '',
      DEMO_CUSTOMER_EMAILS: '',
      DEMO_PARTNER_CODE: 'SAG',
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
