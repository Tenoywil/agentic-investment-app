import { DEMO_ENABLED } from '@/lib/config';
import { SITE_URL } from '@/lib/site';
import type { MetadataRoute } from 'next';

/**
 * Every public page, by hand. The app's routes are mostly session-gated and
 * deliberately absent (see robots.ts); what a search engine should find is
 * the pitch, the explainers, the legal pages, and the fixture demo.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const page = (path: string, priority: number): MetadataRoute.Sitemap[number] => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: 'weekly',
    priority,
  });

  return [
    page('/', 1),
    page('/how-it-works', 0.8),
    page('/help', 0.6),
    // The demo track only exists in builds that enable it (lib/config.ts);
    // a sitemap entry for a 404 is an invitation to index a dead page.
    ...(DEMO_ENABLED
      ? [
          page('/demo/home', 0.7),
          page('/demo/portfolio', 0.5),
          page('/demo/opportunities', 0.5),
          page('/demo/orders', 0.4),
          page('/demo/agent', 0.5),
          page('/demo/planning', 0.4),
          page('/demo/institutions', 0.5),
        ]
      : []),
    page('/privacy', 0.3),
    page('/terms', 0.3),
  ];
}
