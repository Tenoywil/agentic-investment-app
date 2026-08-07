import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Caribbean Capital Network',
  description:
    'The financial operating system of the Caribbean — one agent for your whole regional portfolio, executed by FSC-licensed partners on your approval.',
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
      <body>{children}</body>
    </html>
  );
}
