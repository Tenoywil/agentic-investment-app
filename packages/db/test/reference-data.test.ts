import { afterAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/client';
import { seedDemoCustomer } from '../src/demo/customer';
import { approvals, goals, holdings, partners, user } from '../src/schema';

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
  const proc = Bun.spawn(['bun', 'run', 'src/seed.ts'], {
    cwd: new URL('..', import.meta.url).pathname,
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

    await seedDemoCustomer(db, fresh.id);
    const after = await counts(fresh.id);
    expect(after.holdings).toBeGreaterThan(0);
    expect(after.goals).toBeGreaterThan(0);

    // Twice is a no-op — both the grant CLI and lazy provisioning can run it.
    await seedDemoCustomer(db, fresh.id);
    expect(await counts(fresh.id)).toEqual(after);
  }, 30_000);
});
