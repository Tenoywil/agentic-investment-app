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
      // Vercel (web) and Render (api) are different registrable domains, not
      // subdomains of one parent, so the session cookie needs SameSite=None to
      // survive a cross-site fetch — the SameSite=Lax default is only sent on
      // top-level navigation, so every authenticated API call from the browser
      // would silently look logged-out even right after a successful sign-in.
      // `partitioned` opts into CHIPS so the cookie still works under browsers'
      // third-party-cookie restrictions. Left at the Lax/insecure default in
      // dev, where web and api both run on http://localhost (same-site, and
      // SameSite=None without HTTPS is rejected by the browser outright).
      ...(config.APP_ENV === 'production'
        ? { defaultCookieAttributes: { sameSite: 'none', secure: true, partitioned: true } }
        : {}),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
