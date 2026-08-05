import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit tooling config (CLI only — never imported by runtime code, so it is
 * allowed to read process.env here). `db:generate` emits table DDL from the TS
 * schema; the security-critical migrations (extensions, roles, RLS policies, the
 * immutable-audit triggers, pgvector indexes) live as hand-authored custom SQL in
 * ./migrations and are applied in order alongside the generated ones.
 */
export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/ccn' },
  strict: true,
  verbose: true,
});
