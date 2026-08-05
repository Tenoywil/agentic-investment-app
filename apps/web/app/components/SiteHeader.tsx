'use client';

import { TextSizeControl } from '@ccn/ui';
import Link from 'next/link';

/**
 * Persistent header. The text-size control lives here (per the 35+ brief) so any
 * user can scale the whole interface from every page.
 */
export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="container site-header__row">
        <Link className="brand" href="/">
          <span className="brand__mark" aria-hidden="true">
            C
          </span>
          Caribbean Capital Network
        </Link>
        <nav className="site-nav" aria-label="Primary">
          <Link href="/#how">How it works</Link>
          <Link href="/#institutions">For institutions</Link>
          <Link className="btn btn-primary" href="/sign-in">
            Sign in
          </Link>
        </nav>
      </div>
      <div
        className="container"
        style={{ display: 'flex', justifyContent: 'flex-end', paddingBottom: 'var(--sp-3)' }}
      >
        <TextSizeControl />
      </div>
    </header>
  );
}
