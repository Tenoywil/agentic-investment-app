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

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@ccn/ui'],
  images: { unoptimized: true },
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
