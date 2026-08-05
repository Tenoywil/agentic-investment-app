'use client';

import { AppearanceControls } from '@ccn/ui';

/** Global footer: the non-negotiable trust posture, display settings, corridor. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container site-footer__cols">
        <div>
          <p className="brand" style={{ marginBottom: 'var(--sp-3)' }}>
            <span className="brand__mark" aria-hidden="true">
              C
            </span>
            Caribbean Capital Network
          </p>
          <p>
            CCN holds no client money and executes nothing. FSC-licensed partners custody, execute
            and settle every order. The agent proposes; a deterministic limits engine and your
            one-tap approval are the only paths to a trade.
          </p>
        </div>
        <div>
          <h2 style={{ fontSize: 'var(--fs-title)', marginBottom: 'var(--sp-3)' }}>
            Display settings
          </h2>
          <AppearanceControls />
        </div>
        <div>
          <h2 style={{ fontSize: 'var(--fs-title)', marginBottom: 'var(--sp-3)' }}>Corridor</h2>
          <p>Kingston · Port of Spain · Bridgetown · Toronto · London</p>
          <p style={{ marginTop: 'var(--sp-3)' }}>Regulated &amp; regional by construction.</p>
        </div>
      </div>
    </footer>
  );
}
