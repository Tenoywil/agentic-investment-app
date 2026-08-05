'use client';

import { AppSidebar } from '../_components/AppSidebar';
import { C } from '../_lib/ui';

export default function PlanningPage() {
  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        background: C.bg,
        color: C.ink,
        fontFamily: C.body,
      }}
    >
      <AppSidebar active="planning" />
      <main style={{ flex: 1, padding: '40px 32px' }}>
        <h1
          style={{
            fontFamily: C.disp,
            fontWeight: 700,
            fontSize: 30,
            letterSpacing: '-.4px',
            margin: '0 0 8px',
          }}
        >
          Planning
        </h1>
        <p style={{ color: C.dim, fontSize: 15 }}>
          Being ported from the prototype next, on the same Warm design as Home.
        </p>
      </main>
    </div>
  );
}
