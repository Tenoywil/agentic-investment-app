import { describe, loadServerConfig } from '@ccn/config';
import { createDb } from '@ccn/db';
import { createApp } from './app';
import { createAuth } from './auth';

/**
 * Composition root: load and validate config (fail-fast), open the DB pool, wire
 * Better Auth, and serve the Hono app over Bun's HTTP server.
 */
const config = loadServerConfig();
const { db } = createDb(config.DATABASE_URL);
const auth = createAuth(db, config);
const app = createApp({ db, auth, config });

console.log(`CCN API on :${config.PORT} (${config.APP_ENV})`, describe(config));

export default {
  port: config.PORT,
  fetch: app.fetch,
};
