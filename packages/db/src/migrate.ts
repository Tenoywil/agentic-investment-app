import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Apply all pending migrations (generated table DDL + the hand-authored security
 * layer) in journal order. Runs as a privileged role — CREATE EXTENSION / ROLE
 * and the SECURITY DEFINER functions require it — so this is separate from the
 * non-superuser role the app connects as at runtime.
 */
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required to run migrations.');
  process.exit(1);
}

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));
const client = postgres(url, { max: 1 });
try {
  await migrate(drizzle(client), { migrationsFolder });
  console.log('✓ migrations applied');
} finally {
  await client.end();
}
