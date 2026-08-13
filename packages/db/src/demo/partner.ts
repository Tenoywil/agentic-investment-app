import { eq, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../client';
import { instruments, productListings, user, userRoles } from '../schema';

/** Dollars → minor units. Mirrors the helper in seed.ts. */
const usd = (dollars: number): bigint => BigInt(Math.round(dollars * 100));

/**
 * The partner console's demo dataset, attached to one partner.
 *
 * This is the institution-side counterpart to `seedDemoCustomer`, and it exists
 * for the same reason that one does. The console's data lived only in the seed
 * CLI, hardcoded to the anchor partner (SAG), so an operator granted any other
 * partner opened an empty console — and on a database where `db:seed` had never
 * run, which is every deployment whose pre-deploy step only migrates, so did
 * the operator for SAG. Provisioning grants the `partner_operator` role on
 * first sign-in and had nothing to populate behind it.
 *
 * What it seeds is deliberately narrow:
 *
 * - **Product listings** carry a name and a type. Their `clients`, `aum_minor`
 *   and `trend` columns are left at their defaults, because CCN measures none
 *   of them; those figures were the prototype's inventions and were removed
 *   from the seed for exactly that reason. Re-adding them here would put them
 *   straight back.
 * - **`partner_kpis` and `kyc_funnel_stages` are not touched at all.** The
 *   console renders empty states for both, which is honest. Referred AUM and a
 *   KYC funnel are not things this system computes.
 * - **Orders** go through `create_order`, the same choke point the product
 *   uses, so they are audited and idempotent exactly like a real one. Nothing
 *   writes to the orders table directly — the app role is not permitted to.
 *
 * Idempotent: the idempotency keys are derived from the partner, so a replay
 * returns the existing rows rather than creating a second set.
 */
export async function seedPartnerConsole(
  db: Database | Transaction,
  partnerId: string,
): Promise<void> {
  // Already populated: leave it alone. An operator who has been using the
  // console must not have demo rows appear underneath their real ones.
  const [existing] = await db
    .select({ id: productListings.id })
    .from(productListings)
    .where(eq(productListings.partnerId, partnerId))
    .limit(1);
  if (existing) return;

  await db.insert(productListings).values([
    { partnerId, name: 'GOJ USD Global Bond 2032', type: 'Bond' },
    { partnerId, name: 'Sagicor Real Estate X Fund', type: 'Real Estate' },
    { partnerId, name: 'Proven USD Income Fund', type: 'Fund' },
    { partnerId, name: 'NCB Money Market Fund', type: 'Money Market' },
    { partnerId, name: 'Sygnus Private Credit III', type: 'Private' },
  ]);

  // The clients whose orders appear in the queue. Named by reference only —
  // the console shows "Client ••4821", never an identity, because an operator
  // has no business seeing one before an introduction.
  const CLIENTS = [
    { ref: '4821', email: 'client-4821@ccn.internal' },
    { ref: '2290', email: 'client-2290@ccn.internal' },
    { ref: '7134', email: 'client-7134@ccn.internal' },
    { ref: '5567', email: 'client-5567@ccn.internal' },
  ];

  const idByEmail = new Map<string, string>();
  for (const c of CLIENTS) {
    const [row] = await db
      .insert(user)
      .values({ name: `Client ••${c.ref}`, email: c.email, emailVerified: true })
      .onConflictDoNothing({ target: user.email })
      .returning({ id: user.id });
    const id =
      row?.id ??
      (await db.select({ id: user.id }).from(user).where(eq(user.email, c.email)).limit(1))[0]?.id;
    if (!id) continue;
    idByEmail.set(c.email, id);
    await db.insert(userRoles).values({ userId: id, role: 'customer' }).onConflictDoNothing();
  }

  const catalogue = await db
    .select({ id: instruments.id, slug: instruments.slug })
    .from(instruments);
  const idBySlug = new Map(catalogue.map((i) => [i.slug, i.id]));

  const ORDERS = [
    { ref: '4821', slug: 'sagrex', amount: 5000, to: 'created' as const },
    { ref: '2290', slug: null, amount: 3500, to: 'created' as const },
    { ref: '7134', slug: 'goj32', amount: 2000, to: 'accepted' as const },
    { ref: '5567', slug: 'provfd', amount: 10000, to: 'settled' as const },
  ];

  for (const o of ORDERS) {
    const client = CLIENTS.find((c) => c.ref === o.ref);
    const clientId = client ? idByEmail.get(client.email) : undefined;
    if (!clientId) continue;
    // Keyed on the partner so seeding a second partner does not collide with
    // the first, and replaying either is a no-op.
    const key = `seed-${partnerId}-${o.ref}`;
    const created = await db.execute(sql`
      select id from create_order(
        ${clientId}::uuid, ${partnerId}::uuid,
        ${o.slug ? (idBySlug.get(o.slug) ?? null) : null}::uuid,
        null::uuid, ${usd(o.amount)}::bigint, 'USD'::currency, ${key}::text,
        ${o.ref}::text, 'agent'::actor_type)
    `);
    const orderId = (created as unknown as Array<{ id: string }>)[0]?.id;
    if (!orderId) continue;
    if (o.to === 'accepted' || o.to === 'settled') {
      await db
        .execute(sql`select id from accept_order(${orderId}::uuid, ${partnerId}::uuid)`)
        .catch(() => {});
    }
    if (o.to === 'settled') {
      await db
        .execute(sql`select id from settle_order(${orderId}::uuid, ${partnerId}::uuid)`)
        .catch(() => {});
    }
  }
}
