import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Schema = typeof schema;
export type Database = PostgresJsDatabase<Schema>;
/** The transaction handle drizzle passes to a `db.transaction` callback. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface DbHandle {
  /** Drizzle query builder, typed against the full schema. */
  db: Database;
  /** The raw postgres.js client (migrations, LISTEN/NOTIFY, `pg_notify`). */
  client: postgres.Sql;
  /** Close the pool. Call on graceful shutdown. */
  close: () => Promise<void>;
}

/**
 * Create a database handle. The connection string is injected by the composition
 * root (never read from the environment here) so this package stays free of
 * `process.env`. In production the app connects as a NON-superuser application
 * role so Row-Level Security is actually enforced; migrations run as a privileged
 * role separately.
 */
export function createDb(
  connectionString: string,
  options: postgres.Options<Record<string, never>> = {},
): DbHandle {
  const client = postgres(connectionString, {
    max: 10,
    ...options,
  });
  const db = drizzle(client, { schema });
  return { db, client, close: () => client.end() };
}

/** Tenant context applied to every request-scoped transaction for RLS. */
export interface RlsContext {
  /** Authenticated end-user id; drives `app.current_user_id` in policies. */
  userId?: string;
  /** Bound partner id for partner-operator sessions; drives `app.current_partner_id`. */
  partnerId?: string;
  /** App RBAC role (e.g. 'compliance', 'admin'); exposed to policies via
   *  `app.current_role` (e.g. compliance-wide audit visibility). */
  appRole?: string;
  /** Postgres role to SET LOCAL. In tests/dev we drop to the non-superuser
   *  `ccn_app` so policies apply; in production the connection is already that
   *  role, so leave it undefined. */
  dbRole?: string;
}

/**
 * Run `fn` inside a transaction whose Postgres settings carry the tenant context,
 * so every query is filtered by RLS. `set_config(..., is_local => true)` scopes
 * the settings to this transaction and — unlike `SET LOCAL` — takes a bound
 * parameter, so the ids are never string-concatenated into SQL.
 *
 * This is the single seam through which request-scoped reads and writes reach the
 * database; a query that runs outside it has no tenant and RLS returns nothing.
 */
export async function withRls<T>(
  db: Database,
  ctx: RlsContext,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    if (ctx.dbRole) {
      // Identifier, not a value — validated against an allowlist pattern before use.
      if (!/^[a-z_][a-z0-9_]*$/.test(ctx.dbRole)) {
        throw new Error(`Invalid role name: ${ctx.dbRole}`);
      }
      await tx.execute(sql.raw(`SET LOCAL ROLE ${ctx.dbRole}`));
    }
    await tx.execute(sql`select set_config('app.current_user_id', ${ctx.userId ?? ''}, true)`);
    await tx.execute(
      sql`select set_config('app.current_partner_id', ${ctx.partnerId ?? ''}, true)`,
    );
    await tx.execute(sql`select set_config('app.current_role', ${ctx.appRole ?? ''}, true)`);
    return fn(tx);
  });
}
