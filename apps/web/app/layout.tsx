import '@ccn/ui/styles.css';
import './globals.css';
import { themeInitScript } from '@ccn/ui/init';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteFooter } from './components/SiteFooter';
import { SiteHeader } from './components/SiteHeader';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Caribbean Capital Network',
  description:
    'One trusted interface for wealth creation across the Caribbean and its diaspora — an AI capital agent that proposes, you approve, and FSC-licensed partners execute.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies saved theme / contrast / text-size before first paint (no flash). */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted first-party init string
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body>
        <Providers>
          <a className="skip-link" href="#main">
            Skip to content
          </a>
          <SiteHeader />
          <main id="main" tabIndex={-1}>
            {children}
          </main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
