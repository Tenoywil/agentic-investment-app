import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { createDb, withRls } from '../src/client';
import { goals, orders, partners, productListings, user } from '../src/schema';

/**
 * Tenant-isolation + audit-immutability suite. Runs only when DATABASE_URL points
 * at a migrated Postgres (CI provides a pgvector service; locally, export it).
 * Each scoped assertion drops to the non-superuser `ccn_app` role via withRls so
 * Row-Level Security is actually exercised — the admin connection would bypass it.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;
const APP = 'ccn_app';

/** Narrow a drizzle execute() result to typed rows without using `any`. */
function rows<T>(result: unknown): T[] {
  return result as T[];
}

/**
 * Await any thenable (a real Promise or drizzle's PgRaw) and assert it rejects
 * with a message matching `re`. drizzle wraps the Postgres error as "Failed
 * query: …" and puts the real text (e.g. "permission denied") on `.cause`, so we
 * match against both.
 */
async function expectRejects(work: PromiseLike<unknown>, re: RegExp): Promise<void> {
  try {
    await work;
  } catch (err) {
    const e = err as { message?: string; cause?: unknown };
    const text = `${e.message ?? String(err)} ${String((e.cause as { message?: string })?.message ?? e.cause ?? '')}`;
    expect(text).toMatch(re);
    return;
  }
  throw new Error('expected the query to be rejected, but it resolved');
}

suite('RLS + audit isolation', () => {
  const handle = createDb(DATABASE_URL ?? '', { max: 4 });
  const { db } = handle;
  const tag = `rlstest-${Date.now()}`;

  let u1 = '';
  let u2 = '';
  let sagId = '';
  let ncbId = '';

  beforeAll(async () => {
    await db
      .insert(partners)
      .values([
        { code: 'SAG', name: 'Sagicor Investments' },
        { code: 'NCB', name: 'National Commercial Bank' },
      ])
      .onConflictDoNothing({ target: partners.code });
    const prows = await db.select({ id: partners.id, code: partners.code }).from(partners);
    sagId = prows.find((p) => p.code === 'SAG')?.id ?? '';
    ncbId = prows.find((p) => p.code === 'NCB')?.id ?? '';

    const inserted = await db
      .insert(user)
      .values([
        { name: 'U1', email: `${tag}-u1@x.com`, emailVerified: true },
        { name: 'U2', email: `${tag}-u2@x.com`, emailVerified: true },
      ])
      .returning({ id: user.id, email: user.email });
    u1 = inserted.find((u) => u.email.endsWith('u1@x.com'))?.id ?? '';
    u2 = inserted.find((u) => u.email.endsWith('u2@x.com'))?.id ?? '';

    await db.insert(goals).values([
      { userId: u1, name: `${tag}-g1`, targetMinor: 100n },
      { userId: u2, name: `${tag}-g2`, targetMinor: 200n },
    ]);
    await db.insert(productListings).values([
      { partnerId: sagId, name: `${tag}-sag-listing` },
      { partnerId: ncbId, name: `${tag}-ncb-listing` },
    ]);
  });

  afterAll(async () => {
    await db.delete(orders).where(sql`idempotency_key like ${`${tag}%`}`);
    await db.delete(goals).where(sql`name like ${`${tag}%`}`);
    await db.delete(productListings).where(sql`name like ${`${tag}%`}`);
    await db.delete(user).where(sql`email like ${`${tag}%`}`);
    await handle.close();
  });

  test('a customer reads only their own rows', async () => {
    const asU1 = await withRls(db, { userId: u1, dbRole: APP }, (tx) =>
      tx
        .select({ name: goals.name })
        .from(goals)
        .where(sql`name like ${`${tag}%`}`),
    );
    expect(asU1.map((g) => g.name)).toEqual([`${tag}-g1`]);
    const asU2 = await withRls(db, { userId: u2, dbRole: APP }, (tx) =>
      tx
        .select({ name: goals.name })
        .from(goals)
        .where(sql`name like ${`${tag}%`}`),
    );
    expect(asU2.map((g) => g.name)).toEqual([`${tag}-g2`]);
  });

  test('an unscoped query (no tenant) sees nothing', async () => {
    const none = await withRls(db, { dbRole: APP }, (tx) =>
      tx
        .select()
        .from(goals)
        .where(sql`name like ${`${tag}%`}`),
    );
    expect(none).toHaveLength(0);
  });

  test('WITH CHECK blocks writing a row owned by another user', async () => {
    await expectRejects(
      withRls(db, { userId: u1, dbRole: APP }, (tx) =>
        tx.insert(goals).values({ userId: u2, name: `${tag}-hack`, targetMinor: 1n }),
      ),
      /row-level security policy/i,
    );
  });

  test('a cross-tenant UPDATE touches zero rows', async () => {
    await withRls(db, { userId: u1, dbRole: APP }, (tx) =>
      tx
        .update(goals)
        .set({ name: `${tag}-pwned` })
        .where(sql`name like ${`${tag}%`}`),
    );
    const g2 = await db.select({ name: goals.name }).from(goals).where(eq(goals.userId, u2));
    expect(g2[0]?.name).toBe(`${tag}-g2`); // U2's row untouched
  });

  test('DELETE is denied to the app role (no grant)', async () => {
    await expectRejects(
      withRls(db, { userId: u1, dbRole: APP }, (tx) => tx.delete(goals).where(sql`true`)),
      /denied/i,
    );
  });

  test('a partner operator sees only their partner listings', async () => {
    const sag = await withRls(db, { partnerId: sagId, dbRole: APP }, (tx) =>
      tx
        .select({ name: productListings.name })
        .from(productListings)
        .where(sql`name like ${`${tag}%`}`),
    );
    expect(sag.map((r) => r.name)).toEqual([`${tag}-sag-listing`]);
  });

  test('orders: direct insert denied; create_order works and is tenant-scoped', async () => {
    await expectRejects(
      withRls(db, { userId: u1, dbRole: APP }, (tx) =>
        tx.insert(orders).values({
          userId: u1,
          partnerId: sagId,
          amountMinor: 100n,
          idempotencyKey: `${tag}-direct`,
        }),
      ),
      /denied/i,
    );

    const created = await withRls(db, { userId: u1, dbRole: APP }, (tx) =>
      tx.execute(
        sql`select id from create_order(${u1}::uuid, ${sagId}::uuid, null::uuid, null::uuid, ${100}::bigint, 'USD'::currency, ${`${tag}-o1`}::text, 'ref'::text, 'agent'::actor_type)`,
      ),
    );
    expect(rows<{ id: string }>(created)[0]?.id).toBeTruthy();

    const u1sees = await withRls(db, { userId: u1, dbRole: APP }, (tx) =>
      tx
        .select()
        .from(orders)
        .where(eq(orders.idempotencyKey, `${tag}-o1`)),
    );
    expect(u1sees).toHaveLength(1);
    const u2sees = await withRls(db, { userId: u2, dbRole: APP }, (tx) =>
      tx
        .select()
        .from(orders)
        .where(eq(orders.idempotencyKey, `${tag}-o1`)),
    );
    expect(u2sees).toHaveLength(0);
  });

  test('audit_log is append-only and its hash chain verifies', async () => {
    const ok = await db.execute(sql`select audit_verify() as ok`);
    expect(rows<{ ok: boolean }>(ok)[0]?.ok).toBe(true);
    await expectRejects(db.execute(sql`update audit_log set action = 'x'`), /append-only/i);
    await expectRejects(db.execute(sql`delete from audit_log`), /append-only/i);
  });

  test('audit visibility: owner sees own rows, another tenant does not, compliance sees all', async () => {
    const owner = await withRls(db, { userId: u1, dbRole: APP }, (tx) =>
      tx.execute(sql`select count(*)::int as n from audit_log where user_id = ${u1}::uuid`),
    );
    expect(rows<{ n: number }>(owner)[0]?.n).toBeGreaterThanOrEqual(1);

    const other = await withRls(db, { userId: u2, dbRole: APP }, (tx) =>
      tx.execute(sql`select count(*)::int as n from audit_log where user_id = ${u1}::uuid`),
    );
    expect(rows<{ n: number }>(other)[0]?.n).toBe(0);

    const compliance = await withRls(db, { userId: u2, appRole: 'compliance', dbRole: APP }, (tx) =>
      tx.execute(sql`select count(*)::int as n from audit_log where user_id = ${u1}::uuid`),
    );
    expect(rows<{ n: number }>(compliance)[0]?.n).toBeGreaterThanOrEqual(1);
  });
});
