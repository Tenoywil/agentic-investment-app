'use client';

import { type CcnEvent, type Topics, subscribe } from '@/lib/realtime';
import { useEffect, useRef } from 'react';

/**
 * Keep a screen current.
 *
 * Pass the topics the screen cares about and the function that reloads its data.
 * It runs when a matching event arrives and whenever the stream connects, since
 * anything that happened while it was down was not buffered anywhere — see
 * `lib/realtime.ts` for why the stream is a signal rather than a source of
 * truth.
 *
 * `reload` is held in a ref and read at call time, so a screen can pass an
 * inline closure over its current state without tearing down and rebuilding the
 * subscription on every render. `topics` is joined into the dependency list for
 * the same reason: a caller writing `useRealtime(['order'], …)` allocates a new
 * array each render, and comparing the array by identity would resubscribe
 * every time.
 */
export function useRealtime(topics: Topics, reload: (event?: CcnEvent) => unknown): void {
  const latest = useRef(reload);
  latest.current = reload;

  const key = topics.join(',');

  useEffect(() => {
    return subscribe(key === '' ? [] : key.split(','), {
      onChange: (event) => {
        void latest.current(event);
      },
      onResync: () => {
        void latest.current();
      },
    });
  }, [key]);
}
