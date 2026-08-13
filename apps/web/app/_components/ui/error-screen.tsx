'use client';

import * as React from 'react';
import { Button } from './button';

/**
 * The one error screen, used by every route group's error boundary.
 *
 * Before this existed there was no boundary anywhere in the app, so a single
 * render throw — a payload whose shape had drifted, a null where an object was
 * expected — replaced the entire screen with nothing at all. A blank white page
 * is the worst possible failure in front of an audience: it looks like the
 * product is broken rather than like one panel could not load, and it offers no
 * way back.
 *
 * Deliberately says nothing it cannot support. It does not guess at a cause, it
 * does not promise the retry will work, and it shows the error's `digest`
 * (Next.js's server-side correlation id) rather than a stack, so a real failure
 * can still be traced without putting internals on screen.
 */
export function ErrorScreen({
  error,
  reset,
  surface,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  surface: 'customer' | 'institution' | 'admin';
}) {
  const heading = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    // The boundary swaps out the whole subtree, so a keyboard or screen-reader
    // user is left with focus on a node that no longer exists.
    heading.current?.focus();
    console.error('route error boundary', error);
  }, [error]);

  const home =
    surface === 'admin' ? '/admin' : surface === 'institution' ? '/institutions' : '/home';

  return (
    <div className="grid min-h-screen place-items-center bg-background px-6">
      <div
        // A live region so the failure is announced, not just drawn.
        role="alert"
        className="w-full max-w-[46ch] rounded-xl border border-solid border-input bg-card p-7 text-center"
      >
        <h1
          ref={heading}
          tabIndex={-1}
          className="font-display text-[19px] font-bold text-foreground outline-none"
        >
          This screen didn’t load
        </h1>
        <p className="mt-2.5 text-[14px] leading-relaxed text-dim">
          Your account and your data are unaffected — this is a display failure, and nothing was
          changed.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          <Button onClick={reset}>Try again</Button>
          <Button variant="outline" onClick={() => window.location.assign(home)}>
            Back to {surface === 'institution' ? 'console' : 'home'}
          </Button>
        </div>
        {error.digest ? (
          <p className="mt-5 font-mono text-[12px] text-dim">Reference {error.digest}</p>
        ) : null}
      </div>
    </div>
  );
}
