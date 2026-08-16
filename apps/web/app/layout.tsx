import './globals.css';
import { Tour } from '@/app/_components/tour/tour';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Caribbean Capital Network',
  description:
    'The financial operating system of the Caribbean — one agent for your whole regional portfolio, executed by FSC-licensed partners on your approval.',
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
