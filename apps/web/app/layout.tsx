import './globals.css';
import { Tour } from '@/app/_components/tour/tour';
import { SITE_URL } from '@/lib/site';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

const DESCRIPTION =
  'The financial operating system of the Caribbean. One agent watches your whole regional portfolio, and FSC-licensed partners execute every move on your approval.';

/**
 * Site-wide SEO. The icon set (favicon.ico for legacy and Safari, icon.svg
 * for modern browsers, apple-icon.png for iOS home screens) and the social
 * card (opengraph-image.png) are file conventions in this directory; Next
 * wires the tags. metadataBase makes every relative URL in here absolute,
 * which crawlers and social scrapers require.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Caribbean Capital Network',
    template: '%s · Caribbean Capital Network',
  },
  description: DESCRIPTION,
  applicationName: 'Caribbean Capital Network',
  category: 'finance',
  keywords: [
    'Caribbean investing',
    'Jamaica investments',
    'diaspora investing',
    'AI investment agent',
    'regulated investment platform',
    'Caribbean portfolio',
  ],
  openGraph: {
    type: 'website',
    siteName: 'Caribbean Capital Network',
    url: '/',
    title: 'Caribbean Capital Network',
    description: DESCRIPTION,
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Caribbean Capital Network',
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
};

/**
 * iPhone Safari needs all three of these to render the app as an app:
 * `viewportFit: 'cover'` is what makes `env(safe-area-inset-*)` non-zero on
 * notched phones (without it every safe-area padding in globals.css is a
 * no-op and content sits under the Dynamic Island in landscape); the
 * themeColor pair paints Safari's own chrome — the URL bar and the notch
 * surround — in the page's background instead of default white, per scheme.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f0e7' },
    { media: '(prefers-color-scheme: dark)', color: '#171512' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Apply the saved (or OS-preferred) theme before first paint — no flash. */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static inline theme bootstrap, no user data
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('ccn-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();",
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Hanken+Grotesk:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        {/* Mounted once for the whole app; it decides from the pathname whether
            there is a tour to offer, and renders nothing anywhere else. */}
        <Tour />
      </body>
    </html>
  );
}
