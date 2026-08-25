import { afterAll, describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { createFieldCipher } from '@ccn/security';
import { asc, eq } from 'drizzle-orm';
import { createDb } from '../src/client';
import { seedDemoCustomer } from '../src/demo/customer';
import { seedPartnerConsole } from '../src/demo/partner';
import {
  agentMessages,
  approvals,
  goals,
  holdings,
  kycDossiers,
  kycFunnelStages,
  orders,
  partnerKpis,
  partnerKycReviews,
  partners,
  productListings,
  user,
} from '../src/schema';

/**
 * Reference data is corrected by re-seeding, and demo data is only ever
 * attached deliberately.
 *
 * Both of these were real defects. `partners` was inserted with
 * `onConflictDoNothing`, so a database seeded before `kind`, `regulator` and
 * `agreement_status` were filled in kept them NULL permanently — on the console
 * that is a partner with no line of business, no regulator, no agreement chip
 * and no sandbox badge, and no amount of re-seeding would have fixed it. And a
 * brand-new account must start genuinely empty: the demo portfolio is a
 * decision, not a default.
 *
 * The seed runs as a subprocess rather than an import, because `seed.ts` is a
 * CLI that executes on load and closes its pool — which is also exactly how it
 * runs on deploy.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

async function runSeed(): Promise<void> {
  const proc = Bun.spawn([process.execPath, 'run', 'src/seed.ts'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`seed exited ${code}: ${await new Response(proc.stderr).text()}`);
  }
}

suite('reference data and demo attachment', () => {
  const { db, client } = createDb(DATABASE_URL ?? '', { max: 4 });
  const made: string[] = [];

  afterAll(async () => {
    for (const id of made) await db.delete(user).where(eq(user.id, id));
    await client.end();
  });

  test('re-seeding corrects partner reference columns that were nulled', async () => {
    // Simulate the database as it actually existed: descriptive columns blank
    // and the anchor partner stuck at the default agreement status.
    await db
      .update(partners)
      .set({ kind: null, regulator: null, agreementStatus: 'prospect' })
      .where(eq(partners.code, 'SAG'));

    await runSeed();

    const [sag] = await db.select().from(partners).where(eq(partners.code, 'SAG'));
    expect(sag?.kind).toBeTruthy();
    expect(sag?.regulator).toBe('FSC_JAMAICA');
    // The demo partner must be the sandbox one — the console raises its
    // "illustrative" badge off exactly this value.
    expect(sag?.agreementStatus).toBe('sandbox');
  }, 60_000);

  test('a fresh user owns nothing until the demo portfolio is attached', async () => {
    const [fresh] = await db
      .insert(user)
      .values({ name: 'Fresh Account', email: `fresh-${Date.now()}@example.test` })
      .returning({ id: user.id });
    if (!fresh) throw new Error('insert returned no row');
    made.push(fresh.id);

    const counts = async (userId: string) => ({
      holdings: (await db.select().from(holdings).where(eq(holdings.userId, userId))).length,
      goals: (await db.select().from(goals).where(eq(goals.userId, userId))).length,
      approvals: (await db.select().from(approvals).where(eq(approvals.userId, userId))).length,
    });

    expect(await counts(fresh.id)).toEqual({ holdings: 0, goals: 0, approvals: 0 });

    const cipher = createFieldCipher({ id: 'test', material: new Uint8Array(32).fill(17) });
    await seedDemoCustomer(db, fresh.id, cipher);
    const after = await counts(fresh.id);
    expect(after.holdings).toBeGreaterThan(0);
    expect(after.goals).toBeGreaterThan(0);

    // Twice is a no-op — both the grant CLI and lazy provisioning can run it.
    await seedDemoCustomer(db, fresh.id, cipher);
    expect(await counts(fresh.id)).toEqual(after);

    const reviews = await db
      .select()
      .from(partnerKycReviews)
      .where(eq(partnerKycReviews.userId, fresh.id));
    expect(reviews.length).toBeGreaterThan(0);
    expect(
      reviews.every(
        (review) =>
          review.status === 'approved' &&
          review.identityVerified &&
          review.addressVerified &&
          review.sanctionsClear &&
          review.pepReviewComplete &&
          review.fundsVerified &&
          review.taxDocumentationComplete &&
          Boolean(review.nextReviewAt),
      ),
    ).toBe(true);

    const [dossier] = await db.select().from(kycDossiers).where(eq(kycDossiers.userId, fresh.id));
    expect(dossier?.identityCiphertext).toStartWith('v1.test.');
    const identity = JSON.parse(
      await cipher.decrypt(dossier?.identityCiphertext ?? '', `kyc_dossiers.identity:${fresh.id}`),
    ) as { citizenships: string[] };
    expect(identity.citizenships).toEqual(['Jamaica', 'United Kingdom']);
  }, 30_000);

  /**
   * The anti-fabrication guard in apps/web scans components. This one scans the
   * rows, because the worst fabrication we shipped was neither a component nor
   * a literal in a page: the seeded agent conversation greeted "Marcus" and
   * claimed the portfolio was "up 6.8% this year", and the screen rendered it
   * faithfully. No amount of checking the UI would have found it.
   */
  test('seeded narrative names the account holder and invents no figures', async () => {
    const [fresh] = await db
      .insert(user)
      .values({ name: 'Test Holder', email: `holder-${Date.now()}@example.test` })
      .returning({ id: user.id });
    if (!fresh) throw new Error('insert returned no row');
    made.push(fresh.id);
    await seedDemoCustomer(db, fresh.id);

    const messages = await db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.userId, fresh.id));
    const recs = await db.select().from(approvals).where(eq(approvals.userId, fresh.id));
    const text = [
      ...messages.map((m) => m.content),
      ...recs.map((a) => `${a.title} ${a.body ?? ''}`),
    ].join('\n');

    // The greeting must name this account holder, not a persona.
    expect(text).toContain('Test');
    for (const banned of [
      'Marcus', // the prototype persona
      'up 6.8%', // a portfolio return with no valuation history behind it
      'settles Friday', // a coupon schedule that does not exist in the schema
      'blended yield', // a figure nothing computes
      // A row written at seed time cannot know what time it is read. The home
      // screen's own greeting is computed from the viewer's clock and sits
      // directly beside this message, so a baked-in one is wrong for most of
      // the day — "Good afternoon, Amara" under a live "Good evening, Amara".
      'Good morning',
      'Good afternoon',
      'Good evening',
    ]) {
      expect(text).not.toContain(banned);
    }
  }, 30_000);

  /**
   * Google supplies a display name for every account, so the nameless branch
   * will not be hit by a real sign-in — which is exactly why it needs a test.
   * It is the branch that would ship a message opening on a stray comma and
   * nobody would see it until an identity arrived without a name.
   */
  test('the seeded greeting stays grammatical when the account has no name', async () => {
    const [anon] = await db
      .insert(user)
      .values({ name: '', email: `anon-${Date.now()}@example.test` })
      .returning({ id: user.id });
    if (!anon) throw new Error('insert returned no row');
    made.push(anon.id);
    await seedDemoCustomer(db, anon.id);

    const [first] = await db
      .select({ content: agentMessages.content })
      .from(agentMessages)
      .where(eq(agentMessages.userId, anon.id))
      .orderBy(asc(agentMessages.createdAt))
      .limit(1);

    expect(first?.content).toBe(
      "I'm watching 4 licensed partners for you, and everything is inside the limits you set.",
    );
  }, 30_000);

  /**
   * Invented business metrics are not seeded back in. `partner_kpis` and
   * `kyc_funnel_stages` carried "Referred AUM US$48.2M", "1,284 new clients"
   * and a 4,120-person funnel; `product_listings` carried per-product client
   * and AUM counts. CCN measures none of them, and being API-backed made them
   * read as the most authoritative numbers on the console.
   */
  test('the console seeds no metric the product does not measure', async () => {
    await runSeed();
    const [sag] = await db.select().from(partners).where(eq(partners.code, 'SAG'));
    if (!sag) throw new Error('anchor partner SAG missing');

    expect(await db.select().from(partnerKpis).where(eq(partnerKpis.partnerId, sag.id))).toEqual(
      [],
    );
    expect(
      await db.select().from(kycFunnelStages).where(eq(kycFunnelStages.partnerId, sag.id)),
    ).toEqual([]);

    // Listings stay — name, type and status are real configuration — but the
    // columns behind the invented figures must be left at their defaults.
    const listings = await db
      .select()
      .from(productListings)
      .where(eq(productListings.partnerId, sag.id));
    expect(listings.length).toBeGreaterThan(0);
    for (const l of listings) {
      expect(l.clients).toBe(0);
      expect(l.aumMinor).toBe(0n);
      expect(l.trend).toBeNull();
    }
  }, 60_000);
  /**
   * The institution surface's counterpart to the demo portfolio.
   *
   * The console's data lived only in the seed CLI and was hardcoded to the
   * anchor partner, so an operator granted any other partner signed in
   * successfully and landed on an empty console — as did every operator on a
   * database where `db:seed` had never run, which is any deployment whose
   * pre-deploy step only migrates. Provisioning now seeds it on first sign-in.
   */
  test("an operator's console seeds itself, once", async () => {
    const [p] = await db
      .select({ id: partners.id })
      .from(partners)
      .where(eq(partners.code, 'JMMB'));
    if (!p) throw new Error('partner JMMB missing');

    const counts = async () => ({
      products: (await db.select().from(productListings).where(eq(productListings.partnerId, p.id)))
        .length,
      orders: (await db.select().from(orders).where(eq(orders.partnerId, p.id))).length,
    });

    await seedPartnerConsole(db, p.id);
    const after = await counts();
    expect(after.products).toBeGreaterThan(0);
    expect(after.orders).toBeGreaterThan(0);

    // The queue needs something to accept and something already settled, or the
    // console's headline counts are all zero and the screen has nothing to show.
    const statuses = (
      await db.select({ s: orders.status }).from(orders).where(eq(orders.partnerId, p.id))
    ).map((r) => r.s);
    expect(statuses).toContain('created');
    expect(statuses).toContain('settled');

    // Replayed on every sign-in, so it must not accumulate.
    await seedPartnerConsole(db, p.id);
    expect(await counts()).toEqual(after);
  }, 60_000);

  /**
   * The invented console metrics must not come back through this door. The seed
   * CLI was cleaned of them; a second seeder that re-added them would undo that
   * silently, and being API-backed is what made them convincing.
   */
  test('the partner seeder invents no metric either', async () => {
    const [p] = await db.select({ id: partners.id }).from(partners).where(eq(partners.code, 'NCB'));
    if (!p) throw new Error('partner NCB missing');
    await seedPartnerConsole(db, p.id);

    expect(await db.select().from(partnerKpis).where(eq(partnerKpis.partnerId, p.id))).toEqual([]);
    expect(
      await db.select().from(kycFunnelStages).where(eq(kycFunnelStages.partnerId, p.id)),
    ).toEqual([]);
    for (const l of await db
      .select()
      .from(productListings)
      .where(eq(productListings.partnerId, p.id))) {
      expect(l.clients).toBe(0);
      expect(l.aumMinor).toBe(0n);
      expect(l.trend).toBeNull();
    }
  }, 60_000);

  /**
   * `SET LOCAL ROLE ccn_app` is the first statement of every RLS-scoped
   * transaction, and it requires the connecting role to be a MEMBER of ccn_app
   * (or a superuser). ccn_app is NOLOGIN, so it can never be the connection
   * role itself — the API always switches into it.
   *
   * Nothing granted that membership until 0006. It went unnoticed because dev
   * and CI connect as `postgres`, a superuser, which may SET ROLE to anything;
   * managed Postgres deliberately gives you no true superuser, so production is
   * the first place it bites — and it bites every authenticated request.
   */
  test('the connecting role can switch into the application role', async () => {
    const [row] = (await db.execute(
      "select pg_has_role(current_user, 'ccn_app', 'MEMBER') as ok",
    )) as unknown as [{ ok: boolean }];
    expect(row.ok).toBe(true);
  });
});
