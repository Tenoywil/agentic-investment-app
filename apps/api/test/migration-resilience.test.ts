import { describe, expect, test } from 'bun:test';
import { MIGRATIONS, createDb, pendingMigrations } from '@ccn/db';
import { instruments, partners } from '@ccn/db';
import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { isDatabaseBehind, outstandingMigrations, readOrDegrade } from '../src/migrations';
import { loadFxTable } from '../src/services/fx';
import { loadInstrument } from '../src/services/gate';

/**
 * Surviving a database that is behind the code.
 *
 * Render cannot apply migrations on the free instance type, so a person runs
 * them after every merge that adds one. That has now been missed twice, and the
 * second time one missing column — `fx_rates.as_of`, from `0016` — took
 * `GET /api/portfolio` to a 500 for every signed-in user, because `loadFxTable`
 * selects it on the main investor screen.
 *
 * The degradation that replaced it only ever runs during an incident, which is
 * the worst possible time to discover it was never exercised. So these tests
 * drop the columns for real, inside a transaction that is rolled back, and make
 * the driver raise the same `42703` production raised.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

describe('recognising a database that is behind', () => {
  test('a missing column, however deeply Drizzle has wrapped it', () => {
    // Drizzle wraps the driver error, so the Postgres code is on `cause`.
    const inner = Object.assign(new Error('column "as_of" does not exist'), { code: '42703' });
    const wrapped = Object.assign(new Error('Failed query: select ...'), { cause: inner });
    expect(isDatabaseBehind(wrapped)).toBe(true);
  });

  test('a missing table', () => {
    expect(isDatabaseBehind(Object.assign(new Error('no such relation'), { code: '42P01' }))).toBe(
      true,
    );
  });

  test('a missing function', () => {
    // Every migration since 0014 ships a SECURITY DEFINER function, so this is
    // now the likeliest shape of the failure. It went undetected until a
    // partner operator pressing "List a product" against a database without
    // 0017 got an unexplained 500 instead of "run the migration".
    expect(
      isDatabaseBehind(
        Object.assign(new Error('function partner_upsert_instrument(...) does not exist'), {
          code: '42883',
        }),
      ),
    ).toBe(true);
  });

  test('a missing grant or policy', () => {
    expect(
      isDatabaseBehind(
        Object.assign(new Error('permission denied for table partners'), { code: '42501' }),
      ),
    ).toBe(true);
  });

  test('but not an ordinary failure', () => {
    // A unique violation is the database working correctly. Treating it as
    // "behind" would tell somebody to run a migration that changes nothing.
    expect(
      isDatabaseBehind(Object.assign(new Error('duplicate key value'), { code: '23505' })),
    ).toBe(false);
    expect(isDatabaseBehind(new Error('socket hang up'))).toBe(false);
    expect(isDatabaseBehind(null)).toBe(false);
  });

  test('a cyclic error chain terminates', () => {
    const a = new Error('a') as Error & { cause?: unknown };
    const b = new Error('b') as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;
    expect(isDatabaseBehind(a)).toBe(false);
  });
});

describe('knowing which migrations are outstanding', () => {
  test('a database that has never been migrated needs all of them', () => {
    expect(pendingMigrations(null)).toHaveLength(MIGRATIONS.length);
  });

  test('a database at the newest timestamp needs none', () => {
    const newest = Math.max(...MIGRATIONS.map((m) => m.when));
    expect(pendingMigrations(newest)).toEqual([]);
  });

  test('names exactly the ones after the high-water mark', () => {
    // Precisely the situation production was in: everything up to 0014 applied,
    // 0015 and 0016 merged and never run.
    const before = MIGRATIONS.filter((m) => m.tag.startsWith('0014'))[0];
    if (!before) throw new Error('0014 missing from the journal');
    const pending = pendingMigrations(before.when).map((m) => m.tag);
    expect(pending).toContain('0015_realtime_events');
    expect(pending).toContain('0016_fx_as_of');
    expect(pending).not.toContain('0014_partner_accepts_client');
  });
});

suite('the portfolio survives a behind database', () => {
  const handle = createDb(DATABASE_URL ?? '', { max: 2 });

  test('this database is up to date, so the check is silent', async () => {
    expect(await outstandingMigrations({ db: handle.db } as never)).toEqual([]);
  });

  test('a missing as_of column degrades instead of throwing', async () => {
    /**
     * The columns are really dropped, so `postgres` raises the real 42703 rather
     * than a hand-made error object. DDL is transactional in Postgres, so the
     * rollback at the end puts them back and no other test sees this.
     */
    let snapshot: Awaited<ReturnType<typeof loadFxTable>> | null = null;

    await handle.db
      .transaction(async (tx) => {
        await tx.execute(sql`alter table fx_rates drop column as_of`);
        await tx.execute(sql`alter table fx_rates drop column source`);

        snapshot = await loadFxTable(tx as never);

        // Undo, whatever the assertions below would have said.
        throw new Error('rollback');
      })
      .catch((err: unknown) => {
        if (!(err instanceof Error) || err.message !== 'rollback') throw err;
      });

    const result = snapshot as unknown as Awaited<ReturnType<typeof loadFxTable>>;
    expect(result).not.toBeNull();
    expect(result.degraded).toBe(true);

    const usd = result.rates.find((r) => r.currency === 'USD');
    const jmd = result.rates.find((r) => r.currency === 'JMD');

    // USD is the base: no rate is read for it, so it survives any amount of
    // drift and the screen can always be served in it.
    expect(usd).toMatchObject({ unavailable: false, stale: false });
    // Everything else is refused rather than converted at a rate nobody
    // published — the failure the FX work existed to end, which would be worst
    // of all to reintroduce during an incident.
    expect(jmd).toMatchObject({ unavailable: true, source: null, asOf: null });
  });

  test('and the columns are back afterwards', async () => {
    const snapshot = await loadFxTable(handle.db as never);
    expect(snapshot.degraded).toBe(false);
  });
});

/**
 * The surfaces the merge of PR #31 would have taken down.
 *
 * Only the portfolio had a fallback. `0017` added `instruments.listing_status`
 * and `0019` four `orders` columns, and the code selects both — so merging
 * before the migrations ran meant the marketplace, the orders list, order
 * placement and approvals all raising 42703 at once. These read paths now
 * degrade to the query that was correct before the migration, which is a real
 * answer rather than a guess.
 *
 * Same technique as above: drop for real, roll back at the end.
 */
suite('the marketplace and the order path survive a behind database', () => {
  const handle = createDb(DATABASE_URL ?? '', { max: 2 });
  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

  /** Run `fn` with the named columns really gone, then put them back. */
  async function without(drops: string[], fn: (tx: never) => Promise<unknown>): Promise<unknown> {
    let result: unknown;
    await handle.db
      .transaction(async (tx) => {
        for (const drop of drops) await tx.execute(sql.raw(drop));
        result = await fn(tx as never);
        throw new Error('rollback');
      })
      .catch((err: unknown) => {
        if (!(err instanceof Error) || err.message !== 'rollback') throw err;
      });
    return result;
  }

  test('the marketplace still lists instruments without listing_status', async () => {
    const rows = (await without(['alter table instruments drop column listing_status'], (tx) =>
      readOrDegrade(
        { logger },
        'test marketplace',
        tx,
        (t) =>
          (t as unknown as typeof handle.db)
            .select({ id: instruments.id })
            .from(instruments)
            .where(eq(instruments.listingStatus, 'live')),
        (t) => (t as unknown as typeof handle.db).select({ id: instruments.id }).from(instruments),
      ),
    )) as { id: string }[];
    // Not empty: an empty marketplace would be a different lie from a 500.
    expect(rows.length).toBeGreaterThan(0);
  });

  test('loadInstrument answers live rather than raising', async () => {
    const [seed] = await handle.db.select({ id: instruments.id }).from(instruments).limit(1);
    if (!seed) throw new Error('no seeded instrument to load');

    const loaded = (await without(['alter table instruments drop column listing_status'], (tx) =>
      loadInstrument(tx, seed.id, logger),
    )) as Awaited<ReturnType<typeof loadInstrument>>;

    expect(loaded).not.toBeNull();
    // Before 0017 nothing could be paused, so "live" is the previous truth,
    // not an optimistic guess — and it keeps the order path open.
    expect(loaded?.listingStatus).toBe('live');
    expect(loaded?.id).toBe(seed.id);
  });

  test('the fallback runs on a savepoint, so the transaction survives', async () => {
    /**
     * The property the whole mechanism rests on. A statement that raises leaves
     * the transaction aborted, so without a SAVEPOINT the fallback would fail
     * with 25P02 and this would turn one 500 into another.
     */
    const after = await without(
      ['alter table instruments drop column listing_status'],
      async (tx) => {
        await readOrDegrade(
          { logger },
          'test marketplace',
          tx,
          (t) =>
            (t as unknown as typeof handle.db)
              .select({ id: instruments.id })
              .from(instruments)
              .where(eq(instruments.listingStatus, 'live')),
          (t) =>
            (t as unknown as typeof handle.db).select({ id: instruments.id }).from(instruments),
        );
        // The transaction is still usable afterwards, which is the point.
        return (tx as unknown as typeof handle.db)
          .select({ id: partners.id })
          .from(partners)
          .limit(1);
      },
    );
    expect(after).toBeTruthy();
  });

  test('an error that is not a missing column still propagates', async () => {
    await expect(
      readOrDegrade(
        { logger },
        'test',
        handle.db as never,
        () => Promise.reject(Object.assign(new Error('duplicate key'), { code: '23505' })),
        () => Promise.resolve('fallback ran'),
      ),
    ).rejects.toThrow('duplicate key');
    await handle.client.end();
  });
});
