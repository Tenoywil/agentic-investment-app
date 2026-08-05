'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { C, Icon, icons } from '../_lib/ui';

type Key = 'home' | 'portfolio' | 'opportunities' | 'agent' | 'planning' | 'onboarding';

const GROUPS: {
  label: string;
  items: { key: Key; label: string; href: string; icon: ReactNode; badge?: number }[];
}[] = [
  {
    label: 'Overview',
    items: [
      { key: 'home', label: 'Home', href: '/home', icon: icons.home },
      { key: 'portfolio', label: 'Portfolio', href: '/portfolio', icon: icons.portfolio, badge: 4 },
    ],
  },
  {
    label: 'Invest',
    items: [
      {
        key: 'opportunities',
        label: 'Opportunities',
        href: '/opportunities',
        icon: icons.opportunities,
        badge: 8,
      },
      { key: 'agent', label: 'Agent', href: '/agent', icon: icons.agent, badge: 2 },
    ],
  },
  {
    label: 'Plan',
    items: [
      { key: 'planning', label: 'Planning', href: '/planning', icon: icons.planning },
      { key: 'onboarding', label: 'Onboarding', href: '/onboarding', icon: icons.onboarding },
    ],
  },
];

export function AppSidebar({ active }: { active: Key | 'institutions' }) {
  return (
    <nav
      className="app-sidebar"
      aria-label="Primary"
      style={{
        width: 264,
        flex: 'none',
        position: 'sticky',
        top: 0,
        height: '100vh',
        background: C.card,
        borderRight: `1px solid ${C.line}`,
        display: 'flex',
        flexDirection: 'column',
        padding: '26px 18px 20px',
      }}
    >
      <Link
        href="/home"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 8px 22px',
          textDecoration: 'none',
          color: C.ink,
        }}
      >
        <span
          style={{
            width: 44,
            height: 44,
            borderRadius: 13,
            background: C.teal,
            color: '#fff',
            display: 'grid',
            placeItems: 'center',
            fontFamily: C.disp,
            fontWeight: 700,
            fontSize: 20,
          }}
        >
          C
        </span>
        <span
          style={{
            fontFamily: C.disp,
            fontWeight: 700,
            fontSize: 17,
            lineHeight: 1.05,
            letterSpacing: '-.2px',
          }}
        >
          Caribbean
          <br />
          Capital
        </span>
      </Link>

      {GROUPS.map((g) => (
        <div key={g.label}>
          <div
            style={{
              padding: '14px 10px 8px',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '1.6px',
              textTransform: 'uppercase',
              color: C.faint,
            }}
          >
            {g.label}
          </div>
          {g.items.map((it) => {
            const on = it.key === active;
            return (
              <Link
                key={it.key}
                href={it.href}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '11px 12px',
                  borderRadius: 11,
                  marginBottom: 2,
                  textDecoration: 'none',
                  background: on ? C.mint : 'transparent',
                  color: on ? C.teal : C.dim,
                  fontWeight: on ? 700 : 600,
                  fontSize: 15,
                }}
              >
                <Icon path={it.icon} />
                <span style={{ flex: 1 }}>{it.label}</span>
                {it.badge ? (
                  <span
                    style={{
                      minWidth: 22,
                      textAlign: 'center',
                      padding: '1px 7px',
                      borderRadius: 999,
                      background: on ? C.teal : C.line,
                      color: on ? '#fff' : C.dim,
                      fontSize: 12.5,
                      fontWeight: 700,
                    }}
                  >
                    {it.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}

      <div className="app-sidebar__grow" style={{ flex: 1 }} />

      <div
        className="app-sidebar__agentcard"
        style={{
          background: C.teal,
          borderRadius: 18,
          padding: 17,
          color: C.tealInk,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            fontSize: 13.5,
            opacity: 0.85,
            marginBottom: 6,
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.peach }} />
          Your agent · live
        </div>
        <div style={{ fontFamily: C.disp, fontWeight: 600, fontSize: 16, marginBottom: 4 }}>
          6 opportunities matched
        </div>
        <div style={{ fontSize: 13.5, opacity: 0.8, lineHeight: 1.45, marginBottom: 12 }}>
          2 actions ready for your approval this week.
        </div>
        <Link
          href="/agent"
          style={{
            display: 'block',
            textAlign: 'center',
            padding: 11,
            borderRadius: 11,
            background: C.peach,
            color: '#3a2415',
            fontFamily: C.body,
            fontSize: 15,
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          Review with agent
        </Link>
      </div>

      <Link
        href="/institutions"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '11px 12px',
          borderRadius: 11,
          color: C.dim,
          textDecoration: 'none',
          fontWeight: 600,
          fontSize: 15,
        }}
      >
        <Icon path={icons.institutions} size={20} />
        For institutions
      </Link>
    </nav>
  );
}
