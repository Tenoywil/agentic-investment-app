import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Structural guards for the app shell, from three defects reported off a real
 * screen rather than found by any test:
 *
 * 1. The tour launcher was a pill fixed to the bottom-right corner. So is the
 *    Ask CCN button. They overlapped almost exactly — measured at 1440x900, the
 *    launcher covered Ask CCN from (1259,840) to (1420,880).
 * 2. There was no way to sign out of the customer surface at all. The only
 *    profile affordance was a decorative avatar in the /home header that opened
 *    nothing, and the institution console has had a real Sign out since it was
 *    built.
 * 3. The theme toggle sat at the bottom of a rail taller than the viewport, so
 *    it was only reachable by scrolling the page.
 *
 * These are static checks. They cannot prove the shell renders correctly — that
 * was verified in a browser — but they are what makes a silent regression loud:
 * each one fails on the exact edit that would reintroduce the defect.
 */

const WEB = resolve(import.meta.dir, '..');
const SHELL = join(WEB, 'app/_components');

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** Source with comments removed, so prose describing a defect never trips a
 *  rule about the defect. Mirrors the anti-fabrication guard's approach. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');
}

describe('app shell controls', () => {
  /**
   * Only one thing may be pinned to the bottom-right corner. A second one does
   * not sit beside the first — it sits on top of it, and whichever has the
   * higher stacking order wins the clicks meant for the other.
   */
  test('exactly one control is fixed to the bottom-right corner', () => {
    const offenders: string[] = [];
    for (const file of [...tsxFiles(SHELL), ...tsxFiles(join(WEB, 'app/(customer)'))]) {
      const src = code(file);
      // Tailwind: `fixed` plus a bottom-* and a right-* on the same className.
      for (const cls of src.match(/className=(?:"[^"]*"|\{`[^`]*`\}|\{cn\([^)]*\))/g) ?? []) {
        if (/\bfixed\b/.test(cls) && /\bbottom-[[\w.]/.test(cls) && /\bright-[[\w.]/.test(cls)) {
          offenders.push(relative(WEB, file));
        }
      }
    }
    // The Ask CCN link in AppScreen.tsx, and nothing else.
    expect(offenders).toEqual(['app/_components/AppScreen.tsx']);
  });

  /** A signed-in customer must be able to leave. */
  test('the customer shell offers a sign out', () => {
    const sidebar = code(join(SHELL, 'AppSidebar.tsx'));
    expect(sidebar).toContain('<AccountMenu />');

    const menu = code(join(SHELL, 'AccountMenu.tsx'));
    expect(menu).toContain('Sign out');
    expect(menu).toContain('authClient.signOut()');
  });

  /**
   * The rail's links scroll; everything below them does not. Without this the
   * footer is pushed off the bottom of a laptop screen, which is how the theme
   * toggle and the account menu became unreachable without scrolling the page.
   */
  test('the sidebar confines its overflow to the nav links', () => {
    const sidebar = code(join(SHELL, 'AppSidebar.tsx'));
    expect(sidebar).toMatch(/app-sidebar__scroll[^"]*\bmin-h-0\b/);
    expect(sidebar).toMatch(/app-sidebar__scroll[^"]*\bflex-1\b/);
    expect(sidebar).toMatch(/app-sidebar__scroll[^"]*\boverflow-y-auto\b/);
  });

  /**
   * The tour must not render a launcher of its own — that is what collided with
   * Ask CCN. Its replay lives in the account menu, gated on there actually
   * being a tour to replay so the item is never a control that does nothing.
   */
  test('the tour renders no launcher and publishes its availability', () => {
    const tour = code(join(SHELL, 'tour/tour.tsx'));
    expect(tour).not.toMatch(/fixed[^"]*bottom-/);
    expect(tour).toContain('export function useTourAvailable');

    const menu = code(join(SHELL, 'AccountMenu.tsx'));
    expect(menu).toContain('useTourAvailable()');
    expect(menu).toContain('tourAvailable ?');
  });

  /**
   * The rail and the drawer are two presentations of one navigation. The
   * failure this prevents is them drifting: a destination added to the rail's
   * list and forgotten on the phone, which is invisible on a desktop and is
   * exactly the sort of thing found on stage.
   */
  test('the phone drawer renders the same nav definition as the rail', () => {
    const mobile = code(join(SHELL, 'MobileNav.tsx'));
    expect(mobile).toContain("from './AppSidebar'");
    expect(mobile).toContain('navGroupsFor(basePath)');
    expect(mobile).toContain('<NavLinks');

    // One list, exported for both. A second literal array of destinations in
    // MobileNav is the drift this is guarding against.
    const sidebar = code(join(SHELL, 'AppSidebar.tsx'));
    expect(sidebar).toContain('export function navGroupsFor');
    expect(sidebar).toContain('export function NavLinks');
    expect(mobile).not.toMatch(/href:\s*'\/(home|portfolio|opportunities)'/);
  });

  /**
   * Built on <dialog>, so the browser owns the backdrop, Escape, the top layer
   * and keeping focus inside. A hand-rolled div would put all four back in our
   * hands, and the first three were already wrong once.
   */
  test('the phone drawer is a native dialog', () => {
    const mobile = code(join(SHELL, 'MobileNav.tsx'));
    expect(mobile).toContain('showModal()');
    expect(mobile).toMatch(/<dialog/);
    expect(mobile).not.toContain('role="dialog"');
  });

  /**
   * A grid item's default min-width is auto, so one unshrinkable child widens
   * its track and the card overflows the phone; the browser then scales the
   * whole page down to fit. `minmax(0, 1fr)` is the usual spelling, but the
   * build's CSS minifier rewrites it back to `1fr` — not the same thing — so
   * the floor has to be zeroed on the items to survive to the browser.
   */
  test('dashboard grid items can shrink below their content', () => {
    // Comments stripped: the rule is explained in the stylesheet in the same
    // words it is banned in, and prose about a trap is not the trap.
    const css = readFileSync(join(WEB, 'app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.g-held > \*[^{]*\{[^}]*min-width: 0/s);
    // If this ever reappears in a declaration, the minifier silently drops it.
    expect(css).not.toContain('minmax(0, 1fr)');
  });

  /**
   * The fixture-only preview has no session, so it cannot show an account menu
   * — and calling /api/me from it would break the rule that the demo track
   * makes no API calls at all. It keeps a bare theme toggle instead.
   */
  test('the demo shell keeps a theme toggle and no account menu', () => {
    const sidebar = code(join(SHELL, 'AppSidebar.tsx'));
    const demoBranch = sidebar.slice(sidebar.indexOf('app-sidebar__footer'));
    expect(demoBranch).toContain('<ThemeToggle />');
    // The account menu belongs to the live branch only.
    expect(sidebar.indexOf('<AccountMenu />')).toBeGreaterThan(sidebar.indexOf('<ThemeToggle />'));
  });
});
