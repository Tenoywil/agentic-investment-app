import type { ServerConfig } from '@ccn/config';
import type { Database } from '@ccn/db';
import { account, session, user, verification } from '@ccn/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

/**
 * Better Auth, mounted in the Bun server. Google is the only sign-in method;
 * sessions and accounts persist in the same Postgres as the domain data via the
 * Drizzle adapter. Ids are UUIDs so they satisfy the `::uuid` RLS predicate.
 */
export function createAuth(db: Database, config: ServerConfig) {
  return betterAuth({
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.APP_WEB_ORIGIN],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user, session, account, verification },
    }),
    socialProviders: {
      google: {
        clientId: config.GOOGLE_CLIENT_ID,
        clientSecret: config.GOOGLE_CLIENT_SECRET,
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // sliding 7-day sessions
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      cookiePrefix: 'ccn',
      useSecureCookies: config.APP_ENV === 'production',
      database: { generateId: () => crypto.randomUUID() },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
