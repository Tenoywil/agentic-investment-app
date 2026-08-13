'use client';

import * as React from 'react';

/**
 * Swipe a bottom sheet away, the way a phone expects.
 *
 * The navigation used to be a panel pinned to the left edge — a desktop drawer
 * shrunk down. On a phone the sheet that rises from the bottom is the native
 * idiom on both platforms, and it is reachable: the dismiss gesture ends where
 * the thumb already is, rather than at the far top corner.
 *
 * Three ways out, because a gesture must never be the only one. The backdrop
 * takes a tap, Escape closes it (the browser's own, via <dialog>), and this adds
 * the drag. The handle is also a button, so a screen reader and a keyboard get
 * the same affordance the gesture advertises.
 *
 * The drag is applied straight to the element's transform rather than through
 * React state — a re-render per touchmove frame is how a sheet ends up feeling
 * like it is lagging behind the finger.
 *
 * It only takes over a downward drag that begins either on the handle or with
 * the content already scrolled to the top. Otherwise the sheet would swallow
 * the scroll of its own list, which is the classic way this pattern goes wrong:
 * you try to read the bottom of the menu and the menu leaves instead.
 */

/** Past this many pixels, or this fast, the sheet goes rather than springs back. */
const DISMISS_PX = 96;
const DISMISS_VELOCITY = 0.5; // px per ms

export function useSheetDismiss(
  ref: React.RefObject<HTMLDialogElement | null>,
  onDismiss: () => void,
): void {
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let startY = 0;
    let startTime = 0;
    let dy = 0;
    let dragging = false;

    /** The scrollable region inside the sheet, if the touch began in one. */
    function scrollerAt(target: EventTarget | null): Element | null {
      let node = target instanceof Element ? target : null;
      while (node && node !== el) {
        if (node.scrollHeight > node.clientHeight + 1) return node;
        node = node.parentElement;
      }
      return null;
    }

    const onStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      const onHandle = (e.target as Element | null)?.closest('[data-sheet-handle]') !== null;
      const scroller = scrollerAt(e.target);
      // A drag that starts mid-list belongs to the list.
      if (!onHandle && scroller && scroller.scrollTop > 0) return;
      dragging = true;
      startY = touch.clientY;
      startTime = e.timeStamp;
      dy = 0;
      if (el) el.style.transition = 'none';
    };

    const onMove = (e: TouchEvent) => {
      if (!dragging || !el) return;
      const touch = e.touches[0];
      if (!touch) return;
      dy = touch.clientY - startY;
      if (dy <= 0) {
        // Dragging up: let the content scroll normally.
        el.style.transform = '';
        return;
      }
      if (e.cancelable) e.preventDefault();
      // Slight resistance, so the sheet feels attached rather than thrown.
      el.style.transform = `translateY(${dy}px)`;
    };

    const onEnd = (e: TouchEvent) => {
      if (!dragging || !el) return;
      dragging = false;
      const elapsed = Math.max(1, e.timeStamp - startTime);
      const velocity = dy / elapsed;
      el.style.transition = '';
      el.style.transform = '';
      if (dy > DISMISS_PX || (dy > 24 && velocity > DISMISS_VELOCITY)) onDismiss();
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.style.transform = '';
      el.style.transition = '';
    };
  }, [ref, onDismiss]);
}
