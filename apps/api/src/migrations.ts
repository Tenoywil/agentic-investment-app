import { type MigrationEntry, pendingMigrations } from '@ccn/db';
import { sql } from 'drizzle-orm';
import type { AppDeps } from './context';

/**
 * Detecting, and surviving, a database that is behind the code.
 *
 * Render does not support pre-deploy commands on the free instance type, so
 * migrations are applied by a person after every merge that adds one
 * (apps/ops/runbooks/database-migrations.md). That step has now been missed
 * twice, and both times the product's first report of it was a 500 in front of
 * somebody: an administrator pressing "Onboard a partner" against a database
 * with no `0010`, and then every signed-in investor's portfolio failing because
 * `fx_rates.as_of` did not exist.
 *
 * The pattern this file collects was already in the admin routes and matched
 * only `42501`. `42703` is what a missing *column* raises, which is the shape a
 * missed migration takes when the code selects something new — and it is
 * precisely what the second incident was.
 */

export const MIGRATION_PENDING =
  'this database is missing a migration that this version of the code needs. Apply it with `bun run db:migrate` against this database, or run packages/db/scripts/apply-admin-migrations.sql from the SQL editor, then try again.';

/**
 * Whether an error is the database being behind the code, rather than a
 * legitimate refusal.
 *
 * Three shapes, all of them "the migration never ran":
 *   - `42501` the GRANT never happened — "permission denied for table partners"
 *   - `42501` the POLICY never happened — "new row violates row-level security
 *     policy for table user_roles"
 *   - `42703` / `42P01` the DDL never happened — "column as_of does not exist"
 *
 * Drizzle wraps a driver error in one of its own, so the code raised by Postgres
 * is on `cause` rather than on the error itself; matching only the outer message
 * loses every distinction underneath it.
 *
 * The `42501` cases are safe to read this way **on a surface whose writes have
 * already been checked in TypeScript** — see the reasoning kept beside the admin
 * handlers. The `42703`/`42P01` cases are safe everywhere: a column that does
 * not exist is never a correctly-refused request.
 */
export function isDatabaseBehind(err: unknown): boolean {
  const seen = new Set<unknown>();
  let e: unknown = err;
  while (e && typeof e === 'object' && !seen.has(e)) {
    seen.add(e);
    const { code, message } = e as { code?: string; message?: string };
    if (
      code === '42501' &&
      /permission denied for|violates row-level security policy/i.test(message ?? '')
    ) {
      return true;
    }
    // A missing column or relation. No message match: unlike a permission
    // refusal, there is no legitimate reading of these.
    if (code === '42703' || code === '42P01') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Ask the database which migrations it has, and report what is outstanding.
 *
 * Compares against `drizzle.__drizzle_migrations.created_at` — the same
 * high-water mark the migrator itself uses to decide what to apply — rather than
 * counting rows, so it stays correct if a migration is ever inserted out of
 * order. A database that has never been migrated has no such table, which reads
 * as "everything is pending" rather than as a failure.
 */
export async function outstandingMigrations(deps: Pick<AppDeps, 'db'>): Promise<MigrationEntry[]> {
  let highWater: number | null = null;
  try {
    const [row] = (await deps.db.execute(
      sql`select max(created_at)::bigint as high_water from drizzle.__drizzle_migrations`,
    )) as unknown as [{ high_water: string | null }];
    highWater = row?.high_water == null ? null : Number(row.high_water);
  } catch {
    // No drizzle schema at all — nothing has ever been applied here.
    highWater = null;
  }
  return pendingMigrations(highWater);
}

/**
 * Say at boot whether this database is behind, and name the command.
 *
 * Deliberately does not exit, matching the three checks already in the
 * composition root: an API still serving `/health` and the auth routes is more
 * useful than one that refuses to start, and with the degradation in
 * services/fx.ts most of the product keeps working. What it buys is that the
 * next time somebody forgets, it is a line in the deploy log naming the tags
 * rather than a support message about a broken screen.
 */
export async function checkMigrations(deps: Pick<AppDeps, 'db' | 'logger'>): Promise<void> {
  try {
    const pending = await outstandingMigrations(deps);
    if (pending.length === 0) {
      deps.logger.info('migration check passed', { applied: 'up to date' });
      return;
    }
    deps.logger.error(
      `this database is behind the code by ${pending.length} migration(s): ${pending
        .map((m) => m.tag)
        .join(
          ', ',
        )}. Render cannot apply them on the free plan — run \`cd packages/db && DATABASE_URL='<this database>' bun run db:migrate\`. Until then, anything those migrations add will fail.`,
      { pending: pending.map((m) => m.tag) },
    );
  } catch (error) {
    // The check itself must never be the reason a deploy looks broken.
    deps.logger.error('could not determine whether this database is up to date', { error });
  }
}
