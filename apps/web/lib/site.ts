/**
 * The site's canonical public origin, for SEO surfaces (metadataBase, the
 * sitemap, robots). Build-time, server-only resolution:
 *
 *  1. NEXT_PUBLIC_SITE_URL when the deployment sets one (a custom domain);
 *  2. the Vercel production URL the platform injects at build;
 *  3. localhost, for development.
 *
 * Absolute URLs matter here: og:image and sitemap entries are read by
 * crawlers with no base to resolve against.
 */
const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
const fromVercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;

export const SITE_URL =
  fromEnv && /^https?:\/\//.test(fromEnv)
    ? fromEnv.replace(/\/$/, '')
    : fromVercel
      ? `https://${fromVercel}`
      : 'http://localhost:3000';
