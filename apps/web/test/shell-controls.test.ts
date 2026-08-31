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
   * One component owns the bottom-right corner. A second one does not sit
   * beside the first — it sits on top of it, and whichever has the higher
   * stacking order wins the clicks meant for the other. That already happened
   * once: the tour launcher was a pill in that corner, and so is Ask CCN.
   *
   * Any string literal carrying `fixed` + a `bottom-*` + a `right-*` counts,
   * not just an inline `className`. The corner classes live in a const now, and
   * a rule that only read `className="…"` would have gone quietly blind at the
   * moment the control moved.
   */
  test('one component owns the bottom-right corner', () => {
    const owners = new Set<string>();
    for (const file of [...tsxFiles(SHELL), ...tsxFiles(join(WEB, 'app/(customer)'))]) {
      for (const lit of code(file).match(/(?:"[^"\n]*"|`[^`]*`)/g) ?? []) {
        if (/\bfixed\b/.test(lit) && /\bbottom-[[\w.]/.test(lit) && /\bright-[[\w.]/.test(lit)) {
          owners.add(relative(WEB, file).replaceAll('\\', '/'));
        }
      }
    }
    expect([...owners]).toEqual(['app/_components/VoiceAsk.tsx']);
  });

  /**
   * That component pins two things there — the button, and the line that says
   * what it is hearing — so they must be at different heights. Stacked at the
   * same offset the notice would cover the control that raised it.
   */
  test('the corner control and its transcript notice do not overlap', () => {
    const src = code(join(SHELL, 'VoiceAsk.tsx'));
    const bottoms = [...src.matchAll(/\bbottom-\[(\d+)px\]/g)].map((m) => Number(m[1]));
    expect(bottoms.length).toBeGreaterThanOrEqual(2);
    expect(new Set(bottoms).size).toBe(bottoms.length);
  });

  /**
   * A microphone must be able to hear. This control shipped once as a mic with
   * no handler and no speech capture behind it anywhere in the product, and was
   * deleted for it. It may only wear the microphone where the browser actually
   * supports recognition; everywhere else it is the link it used to be.
   */
  test('the voice control is gated on speech support', () => {
    const src = code(join(SHELL, 'VoiceAsk.tsx'));
    expect(src).toContain('useDictation');
    expect(src).toMatch(/!dictation\.supported/);
    // The fallback keeps a real destination rather than a disabled button.
    expect(src).toMatch(/<Link href=\{`\$\{basePath\}\/agent`\}>/);
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
    // The call gained a second argument (hide "Finish onboarding" once
    // complete); what matters here is that BOTH surfaces call the one
    // definition, not the exact arity.
    expect(mobile).toContain('navGroupsFor(basePath');
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
   * The tour must not auto-start over a loading screen.
   *
   * This was not cosmetic. The readiness check was "any one step's element is on
   * the page", which the navigation satisfies before the session has resolved —
   * and on a phone the navigation is the top bar, which is always visible. So
   * the tour opened over the skeleton, dropped the five steps whose elements had
   * not arrived, showed the one nav step, and `onDestroyed` marked the surface
   * seen. The six-step tour then never ran again on that browser. Measured with
   * a 1.5s identity round trip: one step before, four after.
   *
   * The gate is two conditions, and both are load-bearing — a screen can stop
   * being busy while a second fetch is still filling a card, and a target count
   * can hold steady for one tick while the skeleton is still up.
   */
  test('the tour waits for the screen to settle before auto-starting', () => {
    const tour = code(join(SHELL, 'tour/tour.tsx'));

    // Reads the busy state the skeletons already publish, rather than inventing
    // a second signal that has to be kept in step with them.
    expect(tour).toContain('aria-busy="true"');
    expect(tour).toMatch(/function screenIsBusy/);

    // Auto-start is gated on both conditions, not on "some target exists".
    const autoStart = tour.slice(tour.indexOf('const settled'), tour.indexOf('if (tries > 40)'));
    expect(autoStart).toContain('!busy');
    expect(autoStart).toContain('count === previous');
    expect(autoStart).toContain('start()');
    expect(tour).not.toMatch(/\.some\(\(s\)\s*=>\s*visibleTarget/);

    // And the skeletons must keep publishing it, or the gate reads nothing.
    expect(code(join(SHELL, 'ui/skeleton.tsx'))).toContain('aria-busy="true"');
  });

  test('the tour auto-starts at most once for each pathname', () => {
    const tour = code(join(SHELL, 'tour/tour.tsx'));
    expect(tour).toContain('DISMISS_KEY(surface, pathname');
    expect(tour).toContain('autoStarted.current.has(key)');
    expect(tour).toContain('autoStarted.current.add(key)');
    expect(tour).toContain("localStorage.setItem(DISMISS_KEY(surface, pathname), 'done')");
  });

  test('the partner demo tour keeps every step reachable from the overview tab', () => {
    const steps = code(join(SHELL, 'tour/steps.ts'));
    const demoSteps = steps.slice(
      steps.indexOf('const DEMO_INSTITUTION'),
      steps.indexOf('function routeKey'),
    );
    const sidebar = code(join(SHELL, 'console/console-sidebar.tsx'));
    for (const target of ['products', 'clients', 'compliance']) {
      const tourTarget = `institution-tab-${target}`;
      expect(demoSteps).toContain(`target: '${tourTarget}'`);
      // Both the desktop rail and mobile bottom controls use the same target,
      // and visibleTarget resolves the presentation that occupies space.
      expect(sidebar).toContain('data-tour={`institution-tab-${key}`}');
    }
    for (const hiddenPanelTarget of [
      'institution-products',
      'demo-institution-clients',
      'demo-institution-aml',
      'demo-institution-decisions',
    ]) {
      // Radix removes inactive tab panels from layout. A first-run overview
      // tour must never depend on one of those hidden targets.
      expect(demoSteps).not.toContain(`target: '${hiddenPanelTarget}'`);
    }
    for (const context of ['bulk CSV', 'consented KYC and AML', 'PEP disclosures']) {
      expect(demoSteps).toContain(context);
    }
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

  test('every demo screen carries an explicit sample-data and no-transaction boundary', () => {
    const layout = code(join(WEB, 'app/demo/layout.tsx'));
    expect(layout).toContain('Interactive demo');
    expect(layout).toContain('sample data only');
    expect(layout).toContain('no real accounts or transactions');

    const agent = code(join(WEB, 'app/demo/agent/page.tsx'));
    expect(agent).toContain('How the agents reached this');
    expect(agent).toContain('no transaction placed');
    expect(agent).toContain('no money moved');
  });

  test('the demo presents Marcus as a connected multi-screen agent journey', () => {
    const shell = code(join(SHELL, 'AppScreen.tsx'));
    const sidebar = code(join(SHELL, 'AppSidebar.tsx'));
    const planning = code(join(WEB, 'app/demo/planning/page.tsx'));
    const matching = code(join(WEB, 'app/demo/opportunities/page.tsx'));
    const advisor = code(join(WEB, 'app/demo/agent/page.tsx'));
    const compliance = code(join(WEB, 'app/demo/orders/page.tsx'));
    const partner = code(join(WEB, 'app/demo/institutions/page.tsx'));
    const dashboard = code(join(WEB, 'app/demo/home/page.tsx'));

    for (const destination of [
      '/demo/planning',
      '/demo/opportunities',
      '/demo/agent',
      '/demo/orders',
      '/demo/institutions',
      '/demo/home',
    ]) {
      expect(shell).toContain(destination);
    }
    expect(sidebar).toContain('1 · Profile & goals');
    expect(sidebar).toContain('5 · Partner review');
    expect(sidebar).toContain('6 · Dashboard');

    expect(planning).toContain('Marcus Bailey');
    expect(planning).toContain('Citizenship · select all');
    expect(planning).toContain('Save and re-run matching');
    expect(shell).toContain('window.sessionStorage.setItem');
    expect(planning).toContain('writeDemoProfile(profile)');
    expect(planning).toContain('setProfile(savedProfile)');

    expect(matching).toContain('Top 2 recommendations');
    expect(matching).toContain('Alternatives');
    expect(matching).toContain('Not a match');
    expect(matching).toContain('% match');
    expect(shell).toContain('window.sessionStorage.getItem');
    expect(shell).toContain("opportunity.id === 'ncbmm' ? 27");
    expect(matching).toContain('rankDemoMatches(TRADEABLE, profile)');

    expect(advisor).toContain('I need weekly access');
    expect(advisor).toContain('re-ran the workflow without restarting');
    expect(advisor).toContain('How the agents reached this');
    expect(advisor).toContain('href="/demo/orders"');
    expect(advisor).toContain("liquidity: 'Weekly access'");
    expect(advisor).toContain('rankDemoMatches(AGENT_MATCH_CANDIDATES, profile)');
    expect(advisor).toContain('setDemoProfile(nextProfile)');
    expect(advisor).toContain("return 'liquidity'");
    expect(advisor).toContain('max-[900px]:hidden');

    expect(compliance).toContain('expired 12 Jun 2025');
    expect(compliance).toContain('Use valid US passport');
    expect(compliance).toContain('Review client PDF');
    expect(compliance).toContain('if (!packReviewed)');
    expect(compliance).toContain('setPackReviewed(false)');
    expect(compliance).toContain('disabled={!passportCorrected}');
    expect(compliance).toContain('Within 3 business days');
    expect(compliance).toContain('makes the final KYC, AML and client-acceptance decision');

    expect(partner).toContain('Marcus Bailey · ••4821');
    expect(partner).toContain('Review Marcus');
    expect(partner).toContain('Accept client');
    expect(dashboard).toContain('Marcus is connected to the live-monitoring workflow');
  });

  test('identity intake and demo compliance copy reserve verification for licensed firms', () => {
    const onboardingData = code(join(WEB, 'app/(customer)/onboarding/data.ts'));
    const onboardingPage = code(join(WEB, 'app/(customer)/onboarding/page.tsx'));
    const demoAgent = code(join(WEB, 'app/demo/agent/page.tsx'));
    const opportunities = code(join(WEB, 'app/(customer)/opportunities/page.tsx'));
    const demoOpportunities = code(join(WEB, 'app/demo/opportunities/page.tsx'));

    expect(onboardingData).toContain('Complete identity intake');
    expect(onboardingData).toContain('Identity intake recorded.');
    expect(onboardingData).not.toContain("'Get verified'");
    expect(onboardingData).not.toContain('Verification complete.');
    expect(onboardingPage).toContain(
      'Identity intake recorded · ready to share with a partner you choose',
    );
    expect(onboardingPage).not.toContain('Identity documents verified · KYC Tier 2 unlocked');
    expect(demoAgent).not.toContain('Verified KYC readiness');
    expect(demoAgent.match(/retains the final KYC and AML decision/g)).toHaveLength(2);
    for (const surface of [opportunities, demoOpportunities]) {
      expect(surface).toContain(
        'Identity intake recorded · partner verification required before execution',
      );
      expect(surface).not.toMatch(/KYC(?: ·)? Tier/);
    }
  });

  test('the demo agent uses the real inline chart renderer for visual requests', () => {
    const agent = code(join(WEB, 'app/demo/agent/page.tsx'));
    expect(agent).toContain('<AgentDisplayCard display={m.display} />');
    expect(agent).toContain("kind: 'allocation'");
    expect(agent).toMatch(/chart\|graph\|pie/);
  });

  test('the compliance page locks unapproved webhooks and packs cards by column', () => {
    const compliance = code(join(SHELL, 'console/compliance-tab.tsx'));
    const fieldStart = compliance.indexOf('id="partner-webhook-url"');
    const field = compliance.slice(fieldStart, compliance.indexOf('/>', fieldStart));

    expect(fieldStart).toBeGreaterThan(-1);
    expect(field).toContain('disabled={!exportAvailable || busy}');
    expect(compliance.match(/disabled=\{!exportAvailable \|\| busy\}/g)).toHaveLength(3);
    expect(compliance).toContain('disabled={!exportAvailable || !endpoint?.active || busy}');
    expect(compliance).toContain('disabled={!exportAvailable || busy || !url.trim()}');

    const liveLayout = compliance.slice(compliance.indexOf('export function ComplianceTab'));
    expect(liveLayout.match(/grid min-w-0 content-start gap-\[18px\]/g)).toHaveLength(2);
    const readingOrder = [
      'Agreement &amp; residency',
      '<WebhookExportCard />',
      'Audit trail',
      'How CCN works with your firm',
    ].map((part) => liveLayout.indexOf(part));
    expect(readingOrder.every((position) => position >= 0)).toBe(true);
    expect(readingOrder).toEqual([...readingOrder].sort((a, b) => a - b));
  });

  test('administration links attention to bounded, audited resolution controls', () => {
    const admin = code(join(WEB, 'app/(admin)/admin/page.tsx'));
    const person = code(join(WEB, 'app/(admin)/admin/person.tsx'));
    const client = code(join(WEB, 'lib/admin-api.ts'));
    const route = code(resolve(WEB, '../api/src/routes/admin.ts'));

    expect(admin).toContain('Resolution center');
    expect(admin).toContain('No impersonation or money movement');
    expect(admin).toContain("openOrders('created')");
    expect(admin).toContain("openPeople('approvals')");
    expect(admin).toContain('setSelected(o.investorId)');
    expect(person).toContain('Pending investor decisions');
    expect(person).toContain('Recent orders');

    expect(client).toContain('JSON.stringify({ status, expectedStatus, reason })');
    expect(route).toContain('reason.length < 8');
    expect(route).toContain('reason,');
    expect(admin).not.toContain('Approve for investor');
    expect(admin).not.toContain('Settle order');
  });

  test('agent sheets keep content scrolling and hand off nested editors', () => {
    const agent = code(join(WEB, 'app/(customer)/agent/page.tsx'));
    const sheet = code(join(WEB, 'app/_lib/sheet.ts'));
    const css = code(join(WEB, 'app/globals.css'));

    expect(sheet).toContain('if (node === el) break');
    expect(agent).toContain('suspendParentModal={suspendPanelsForEditor}');
    expect(agent).toContain('restoreParentModal={restorePanelsAfterEditor}');
    expect(agent).toContain('onCloseAutoFocus');
    expect(css).toContain('body:has(dialog.agent-panels[open])');
    expect(agent).toContain('touch-scroll-strip');
    expect(css).toContain('.touch-scroll-strip::-webkit-scrollbar');
  });
});
