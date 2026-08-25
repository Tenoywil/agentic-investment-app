import { createFieldCipher, parseKeyMaterial } from '@ccn/security';
import { eq, inArray, sql } from 'drizzle-orm';
import { createDb } from './client';
import { seedDemoCustomer } from './demo/customer';
import { seedReferenceData } from './reference';
import {
  agentMessages,
  approvals,
  connectedAccounts,
  fxRates,
  goals,
  holdings,
  instruments,
  kycFunnelStages,
  kycStatus,
  limits,
  partnerKpis,
  partners,
  planningProducts,
  productListings,
  riskProfiles,
  user,
  userProfiles,
  userRoles,
} from './schema';

/**
 * Idempotent seed built from the prototype's domain model (index.html). Reference
 * and catalog rows upsert on their natural keys; the demo user's owned rows and
 * the anchor console's rows are reset-then-inserted so re-running is safe. Runs
 * as the privileged migration role (bypasses RLS). The append-only audit trail is
 * seeded only when the log is empty, since it cannot be deleted by design.
 *
 * **Two scopes, because production needs the first half and must not have the
 * second.** `--reference-only` (or SEED_SCOPE=reference) stops after the catalog:
 * partners, planning products, FX rates and instruments. Those are not demo data
 * — they are the licensed institutions CCN routes to and the things it lists, and
 * without them a real deployment has an empty opportunities screen, an empty
 * planning screen, and no partner for an operator to be bound to. The full run
 * additionally creates `marcus.bailey@ccn.demo`, four `@ccn.internal` client
 * placeholders and the anchor console's orders, which belong on a development
 * database and nowhere near a live one.
 *
 * Deliberately not wired into `preDeployCommand`: a deploy step that writes rows
 * on every push is a different kind of hazard. Run it by hand, once, against a
 * new database.
 */

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required to seed.');
  process.exit(1);
}

/** Catalog only — no invented people, no invented orders. */
const REFERENCE_ONLY =
  process.argv.includes('--reference-only') || process.env.SEED_SCOPE === 'reference';

/** Dollars → integer minor units (USD cents). */
const usd = (dollars: number): bigint => BigInt(Math.round(dollars * 100));

// --- Demo tenant ------------------------------------------------------------

const DEMO_EMAIL = 'marcus.bailey@ccn.demo';
const CLIENTS = [
  { email: 'client-4821@ccn.internal', ref: 'Client ••4821' },
  { email: 'client-7134@ccn.internal', ref: 'Client ••7134' },
  { email: 'client-2290@ccn.internal', ref: 'Client ••2290' },
  { email: 'client-5567@ccn.internal', ref: 'Client ••5567' },
];

async function main(): Promise<void> {
  const { db, close } = createDb(url as string, { max: 1 });
  try {
    // The catalog. One definition, shared with the administration surface,
    // which loads exactly this on a database that has none (packages/db/src/reference.ts).
    await seedReferenceData(db);

    // Everything above is the catalog a real deployment needs. Everything below
    // is a development fixture — named people who never signed up, and orders
    // nobody placed. On production that is exactly the fabricated data this
    // product has already had to remove from its screens once.
    if (REFERENCE_ONLY) {
      const [{ partners: partnerCount } = { partners: '0' }] = (await db.execute(
        sql`select count(*)::text as partners from partners`,
      )) as unknown as [{ partners: string }];
      console.log(`✓ reference data seeded (${partnerCount} partners) — no demo accounts created`);
      return;
    }

    const instrumentRows = await db
      .select({ id: instruments.id, slug: instruments.slug })
      .from(instruments);
    const instrumentIdBySlug = new Map(instrumentRows.map((i) => [i.slug, i.id]));
    const [anchor] = await db
      .select({ id: partners.id })
      .from(partners)
      .where(eq(partners.code, 'SAG'));
    const sag = anchor?.id;
    if (!sag) throw new Error('anchor partner SAG missing after seed');

    // Users (upsert on email) ------------------------------------------------
    await db
      .insert(user)
      .values([
        { name: 'Marcus A. Bailey', email: DEMO_EMAIL, emailVerified: true },
        ...CLIENTS.map((c) => ({ name: c.ref, email: c.email, emailVerified: true })),
      ])
      .onConflictDoNothing({ target: user.email });

    const userRows = await db
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(inArray(user.email, [DEMO_EMAIL, ...CLIENTS.map((c) => c.email)]));
    const userIdByEmail = new Map(userRows.map((u) => [u.email, u.id]));
    const demoId = userIdByEmail.get(DEMO_EMAIL);
    if (!demoId) throw new Error('demo user missing after seed');

    // The demo customer's whole account, from the one definition that runtime
    // provisioning also uses (see packages/db/src/demo/customer.ts).
    const encryptionKey = process.env.FIELD_ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error('FIELD_ENCRYPTION_KEY is required for a full demo seed');
    }
    const kycCipher = createFieldCipher({ id: 'k1', material: parseKeyMaterial(encryptionKey) });
    await seedDemoCustomer(db, demoId, kycCipher);
    await db.insert(userRoles).values({ userId: demoId, role: 'customer' }).onConflictDoNothing();

    // Anchor (SAG) console: reset-then-insert -------------------------------
    await db.delete(productListings).where(eq(productListings.partnerId, sag));
    await db.delete(partnerKpis).where(eq(partnerKpis.partnerId, sag));
    await db.delete(kycFunnelStages).where(eq(kycFunnelStages.partnerId, sag));

    // Which products the partner has listed — real configuration, and the
    // subject of the live/paused toggle.
    //
    // Their per-product `clients`, `aum_minor` and `trend` are deliberately not
    // seeded. CCN does not compute any of them: there is no attribution model
    // behind "412 clients", no AUM roll-up behind "US$14.2M" and no series
    // behind "+22%". They were the prototype's inventions sitting in a
    // production table, which made them read as the most trustworthy figures on
    // the console. The columns are NOT NULL with a 0 default (changing that
    // needs a migration), so the API simply does not return them and the UI has
    // no column to render — a zero standing in for unknown is the same lie in
    // quieter clothing.
    await db.insert(productListings).values([
      { partnerId: sag, name: 'GOJ USD Global Bond 2032', type: 'Bond' },
      { partnerId: sag, name: 'Sagicor Real Estate X Fund', type: 'Real Estate' },
      { partnerId: sag, name: 'Proven USD Income Fund', type: 'Fund' },
      { partnerId: sag, name: 'NCB Money Market Fund', type: 'Money Market' },
      { partnerId: sag, name: 'Sygnus Private Credit III', type: 'Private' },
    ]);

    // `partner_kpis` and `kyc_funnel_stages` are intentionally left empty.
    //
    // They used to carry "Referred AUM US$48.2M", "New clients (MTD) 1,284",
    // "Onboarding conversion 71%", "CAC vs. direct −41%" and a 4,120 → 1,284
    // funnel. Not one of those is measured anywhere in this system; they were
    // invented for the prototype and then seeded into the real database, where
    // being API-backed made them look like the most authoritative numbers on
    // screen. The console renders its empty states for both panels instead, and
    // its metrics row still shows real pending/settled order counts computed
    // from the orders table. Both tables stay — the surface is right, the
    // numbers just have to be earned.

    // Console orders (via the create_order choke point) + transitions --------
    const orderSpecs = [
      {
        email: CLIENTS[0]?.email,
        ref: CLIENTS[0]?.ref,
        slug: 'sagrex',
        amount: 5000,
        key: 'seed-o1',
        to: 'created' as const,
      },
      {
        email: CLIENTS[1]?.email,
        ref: CLIENTS[1]?.ref,
        slug: 'goj32',
        amount: 2000,
        key: 'seed-o2',
        to: 'created' as const,
      },
      {
        email: CLIENTS[2]?.email,
        ref: CLIENTS[2]?.ref,
        slug: null,
        amount: 3500,
        key: 'seed-o3',
        to: 'accepted' as const,
      },
      {
        email: CLIENTS[3]?.email,
        ref: CLIENTS[3]?.ref,
        slug: 'provfd',
        amount: 10000,
        key: 'seed-o4',
        to: 'settled' as const,
      },
    ];
    for (const o of orderSpecs) {
      const clientId = o.email ? userIdByEmail.get(o.email) : undefined;
      if (!clientId) continue;
      const created = await db.execute(sql`
        select id from create_order(
          ${clientId}::uuid, ${sag}::uuid, ${o.slug ? (instrumentIdBySlug.get(o.slug) ?? null) : null}::uuid,
          null::uuid, ${usd(o.amount)}::bigint, 'USD'::currency, ${o.key}::text, ${o.ref ?? null}::text, 'agent'::actor_type)
      `);
      const orderId = (created as unknown as Array<{ id: string }>)[0]?.id;
      if (!orderId) continue; // idempotent replay returns the existing row too, but guard anyway
      if (o.to === 'accepted' || o.to === 'settled') {
        await db
          .execute(sql`select id from accept_order(${orderId}::uuid, ${sag}::uuid)`)
          .catch(() => {});
      }
      if (o.to === 'settled') {
        await db
          .execute(sql`select id from settle_order(${orderId}::uuid, ${sag}::uuid)`)
          .catch(() => {});
      }
    }

    console.log('✓ seed complete');
  } finally {
    await close();
  }
}

await main();
