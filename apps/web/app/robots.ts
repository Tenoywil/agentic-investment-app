import { SITE_URL } from '@/lib/site';
import type { MetadataRoute } from 'next';

/**
 * What a crawler may index: the marketing pages and the fixture demo. The
 * signed-in product surfaces are session-gated and render nothing useful to a
 * crawler, and indexing them would surface sign-in walls in search results.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/home',
          '/portfolio',
          '/opportunities',
          '/orders',
          '/agent',
          '/planning',
          '/onboarding',
          '/gateway/',
          '/admin',
          '/institutions',
          '/after-sign-in',
          '/sign-in',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
