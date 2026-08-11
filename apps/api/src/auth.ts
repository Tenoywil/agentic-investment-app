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
      // Cookie attributes are deliberately left at Better Auth's SameSite=Lax
      // default. Do NOT re-add SameSite=None/Partitioned here: apps/web proxies
      // /api/* through the web origin (apps/web/next.config.mjs), so the browser
      // only ever sees same-origin requests and Lax is both sufficient and the
      // safer choice (it keeps the CSRF protection None gives up). An earlier
      // attempt set None+Partitioned to bridge the two domains directly, which
      // is what BROKE production auth: a Partitioned cookie is keyed to whichever
      // site is the top-level browsing context when it's set, and the Google
      // OAuth callback lands on the API's own domain — so the cookie was
      // partitioned under the API's site and invisible to the web app forever
      // after. Lax survives the OAuth callback fine (Set-Cookie is honored on a
      // cross-site top-level navigation, and every later call is same-origin).
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
