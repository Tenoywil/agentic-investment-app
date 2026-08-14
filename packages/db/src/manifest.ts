import journal from '../migrations/meta/_journal.json';

/**
 * What this build of the code expects the database to have had applied.
 *
 * Render cannot run migrations on the free instance type, so somebody has to run
 * them by hand after every merge that adds one — the procedure in
 * apps/ops/runbooks/database-migrations.md. It has now been missed twice, and
 * both times it reached a user as a 500 rather than anyone as a warning: first
 * an administrator pressing a button against a database with no
 * `0010_admin_reference_data`, then `GET /api/portfolio` selecting
 * `fx_rates.as_of` from a database with no `0016_fx_as_of`.
 *
 * The journal is imported rather than read from disk so this works the same in
 * the deployed image, in a test, and in the migrate script — no path arithmetic
 * relative to a working directory that differs in all three.
 */

export interface MigrationEntry {
  /** e.g. `0016_fx_as_of` — the file, minus its extension. */
  tag: string;
  /**
   * The folder timestamp Drizzle orders by. The migrator applies every
   * migration whose `when` is newer than the newest `created_at` already
   * recorded, so this — not a hash, and not the count — is what decides whether
   * something is outstanding.
   */
  when: number;
}

export const MIGRATIONS: MigrationEntry[] = (
  journal as { entries: { tag: string; when: number }[] }
).entries
  .map((e) => ({ tag: e.tag, when: e.when }))
  .sort((a, b) => a.when - b.when);

/**
 * The migrations this code needs that the database has not recorded.
 *
 * `appliedHighWater` is the newest `created_at` in `drizzle.__drizzle_migrations`,
 * or null on a database that has never been migrated at all — in which case
 * everything is outstanding, which is the honest answer rather than an error.
 */
export function pendingMigrations(appliedHighWater: number | null): MigrationEntry[] {
  if (appliedHighWater === null) return [...MIGRATIONS];
  return MIGRATIONS.filter((m) => m.when > appliedHighWater);
}
