'use client';

import type { ReactNode } from 'react';
import { C, Icon, icons } from '../_lib/ui';
import { AppSidebar } from './AppSidebar';

type Key = 'home' | 'portfolio' | 'opportunities' | 'agent' | 'planning' | 'onboarding';

/** The investor app shell: warm sidebar + scrolling main + the Ask CCN button. */
export function AppScreen({ active, children }: { active: Key; children: ReactNode }) {
  return (
    <div className="app-shell" style={{ background: C.bg, color: C.ink, fontFamily: C.body }}>
      <AppSidebar active={active} />
      <main style={{ flex: 1, minWidth: 0, padding: '26px 32px 96px', position: 'relative' }}>
        {children}
      </main>
      <button
        type="button"
        style={{
          position: 'fixed',
          right: 30,
          bottom: 26,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 9,
          padding: '13px 20px',
          borderRadius: 999,
          background: C.teal,
          color: '#fff',
          border: 'none',
          cursor: 'pointer',
          boxShadow: '0 12px 30px rgba(18,78,72,.4)',
          fontFamily: C.body,
          fontWeight: 700,
          fontSize: 15,
        }}
      >
        <Icon path={icons.mic} size={18} />
        Ask CCN
      </button>
    </div>
  );
}

/** Standard page header: muted eyebrow + display title + optional right-hand slot. */
export function PageHead({
  eyebrow,
  title,
  right,
}: { eyebrow: string; title: string; right?: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
        marginBottom: 22,
      }}
    >
      <div>
        <div style={{ fontSize: 13.5, color: C.dim, marginBottom: 4 }}>{eyebrow}</div>
        <h1
          style={{
            fontFamily: C.disp,
            fontWeight: 700,
            fontSize: 30,
            letterSpacing: '-.4px',
            margin: 0,
          }}
        >
          {title}
        </h1>
      </div>
      {right}
    </div>
  );
}
