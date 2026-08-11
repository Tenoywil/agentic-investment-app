/**
 * SSR build on Vercel: a real Next.js server rendering per request, not a static
 * export. Vercel project's Root Directory must be set to apps/web (dashboard
 * setting, not something expressible in git) so its native Next.js + Turborepo
 * detection builds and serves this app directly, instead of the old repo-root
 * vercel.json driving a static `out/` deploy.
 *
 * Security headers live here (not vercel.json) so they apply identically
 * regardless of deploy target and travel with the app, not the platform config.
 *
 * @type {import('next').NextConfig}
 */
const CSP =
  "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; " +
  "form-action 'self'; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-inline'; " +
  "connect-src 'self' https://*.onrender.com https://*.supabase.co; upgrade-insecure-requests";

/**
 * API proxy: the browser calls /api/* on THIS origin; Next.js forwards it
 * server-side to the Bun/Hono API on Render. This makes every API call —
 * including the Better Auth session cookie — same-origin from the browser's
 * point of view. Without it, the session cookie is a genuine third-party
 * cookie: even with SameSite=None + Secure + Partitioned (apps/api/src/auth.ts),
 * a Partitioned cookie is scoped to whichever site is the top-level browsing
 * context AT THE MOMENT it's set — and Google's OAuth callback lands on the
 * API's own domain before redirecting onward, so the cookie ends up
 * partitioned under the API's site, invisible to every later cross-site fetch
 * the web app makes back to it (confirmed in prod: valid, unexpired session
 * rows in the `session` table, zero cookies in the browser's jar for the API's
 * domain, every authenticated call failing in ~5ms — too fast to have even
 * queried the database). Collapsing "two sites" into "one" is the actual fix.
 *
 * Requires, on top of this code change:
 *  - Vercel: API_ORIGIN (server-only) = the API's real origin, e.g.
 *    https://ccn-api.onrender.com; NEXT_PUBLIC_API_URL set to '' (empty) in
 *    production, so every apps/web/lib/*-api.ts client and the Better Auth
 *    client call same-origin relative paths, which this rewrite intercepts.
 *  - Render: BETTER_AUTH_URL changed to the WEB app's origin (e.g.
 *    https://caribbean-capital-network-platform.vercel.app), not the API's own
 *    — Better Auth derives the OAuth callback URL and the cookie's implicit
 *    domain from BETTER_AUTH_URL, so it must match wherever the browser
 *    actually is when the cookie gets set.
 *  - Google Cloud Console: the OAuth client's Authorized redirect URI updated
 *    to `${BETTER_AUTH_URL}/api/auth/callback/google` on the web origin.
 */
const API_ORIGIN = process.env.API_ORIGIN || 'https://ccn-api.onrender.com';

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@ccn/ui'],
  images: { unoptimized: true },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: CSP },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value:
              'accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(self), midi=(), payment=(), usb=()',
          },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
        ],
      },
    ];
  },
};

export default nextConfig;
