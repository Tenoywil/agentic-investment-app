import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { demoVillaScreenReasons } from '../app/_components/AppScreen';
import {
  BLUE_MAHOE_PARTNER_NAME,
  DEMO_REFERENCE_PROFILE,
  rankDemoRecommendations,
  selectDemoRecommendations,
} from '../lib/demo-recommendations';

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

  test('the preview keeps deterministic behavior behind the live-shaped product surface', () => {
    const layout = code(join(WEB, 'app/demo/layout.tsx'));
    expect(layout).not.toContain('Interactive demo');
    expect(layout).not.toContain('sample data only');
    expect(layout).toContain('Preview environment');
    expect(layout).toContain('do not send money or open accounts');
    const agent = code(join(WEB, 'app/demo/agent/page.tsx'));
    const portfolio = code(join(WEB, 'app/demo/portfolio/page.tsx'));
    const orders = code(join(WEB, 'app/demo/orders/page.tsx'));
    expect(agent).not.toContain('How the agents reached this');
    expect(agent).not.toContain('Demo complete');
    expect(agent).toContain('Routed to NCB for execution');
    expect(portfolio).toContain('CCN never holds your money');
    expect(portfolio).toContain('fundedPartners: [...accountState.fundedPartners');
    expect(portfolio).not.toContain('fundedPartners.includes(partner.code)');
    expect(orders).toContain('Nothing here is executed by CCN');
  });

  /**
   * The preview and the signed-in app are one product seen twice, and they
   * drifted apart on the screens a prospect sees first: the preview home wore
   * a notification bell and an account avatar the live header does not have,
   * quoted an all-time return and drew a sparkline off a valuation history the
   * schema does not hold, closed on three stat cards restating figures already
   * on the page, and painted its approval pill in a hex pair with no dark-theme
   * value. The preview planning screen opened on a financial-health score, a
   * protection gap and a legacy projection — three figures the live screen
   * dropped because the product computes none of them.
   *
   * Each assertion below fails on the exact edit that would reintroduce one of
   * those, in either direction.
   */
  test('the preview home and planning screens carry the live structure', () => {
    const utils = code(join(WEB, 'app/_lib/utils.ts'));
    const liveHome = code(join(WEB, 'app/(customer)/home/page.tsx'));
    const demoHome = code(join(WEB, 'app/demo/home/page.tsx'));
    const livePlanning = code(join(WEB, 'app/(customer)/planning/page.tsx'));
    const demoPlanning = code(join(WEB, 'app/demo/planning/page.tsx'));
    const demoPortfolio = code(join(WEB, 'app/demo/portfolio/page.tsx'));
    const demoOrders = code(join(WEB, 'app/demo/orders/page.tsx'));

    // One definition of the approval pill's colours, consumed by both homes,
    // so a theme fix on one surface cannot leave the other behind.
    expect(utils).toContain('APPROVAL_TONE_CLASS');
    expect(utils).toContain('dark:bg-teal2/15 dark:text-teal2');
    for (const home of [liveHome, demoHome]) {
      expect(home).toContain('APPROVAL_TONE_CLASS[');
      expect(home).toContain('APPROVAL_TONE_PILL');
    }
    // The pattern that made the pill unreadable in dark mode: light-theme ink
    // over an 8%-alpha fill of the same hex.
    expect(demoHome).not.toContain('tagColor');
    expect(demoHome).not.toContain('background: `${');

    // Header: the live home has no right-hand slot, so neither does the
    // preview.
    expect(demoHome).not.toContain('NotificationsBell');
    expect(demoHome).not.toContain('AvatarFallback');
    expect(demoHome).toContain('<PageHead eyebrow={dateLabel} title={greeting(profile.name)} />');
    expect(demoHome).toContain("hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'");

    // Hero: same dark ground, same reserved height, one figure and no
    // fabricated trend.
    for (const home of [liveHome, demoHome]) {
      expect(home).toContain('dark:bg-[#124e48]');
      expect(home).toContain('min-h-[207px]');
      expect(home).toContain('text-[#eafaf5]/[.78]');
    }
    expect(demoHome).not.toContain('<polyline');
    expect(demoHome).not.toContain('all-time');
    expect(demoHome).not.toContain('↑ 6.8%');

    // Body: approvals before activity, the live empty state, and no closing
    // row of stat cards restating what is already on the screen.
    expect(demoHome.indexOf('data-tour="customer-approvals"')).toBeLessThan(
      demoHome.indexOf('data-tour="customer-activity"'),
    );
    expect(demoHome).toContain('<EmptyState');
    expect(demoHome).toContain('Nothing needs your approval');
    expect(demoHome).not.toContain('Blended yield');
    expect(demoHome).not.toContain('Matched to your goals');

    // Planning: no score, no gap, no projection — on either surface.
    for (const planningScreen of [livePlanning, demoPlanning]) {
      expect(planningScreen).not.toContain('Financial health');
      expect(planningScreen).not.toContain('Protection gap');
      expect(planningScreen).not.toContain('Est. legacy value');
      expect(planningScreen).toContain('Add a goal');
      expect(planningScreen).toContain('<NewGoalDialog');
      expect(planningScreen).toContain('className="mt-auto w-full"');
    }

    // Portfolio and orders: preflight is off, so a bare `border` paints
    // nothing; and a header pill that would read "0 in progress" is withheld,
    // as live withholds it.
    expect(demoPortfolio).toContain(
      'flex items-baseline gap-2 rounded-xl border border-solid border-border bg-mint',
    );
    expect(demoPortfolio).not.toContain('· Licensed partner');
    expect(demoPortfolio).toContain('{inst.regulator}');
    // Connecting an account has a visible outcome on the screen it happens on.
    expect(demoPortfolio).toContain('linkedPartners');
    expect(demoPortfolio).toContain('pendingPartners');
    expect(demoPortfolio).toContain('Waiting on their compliance desk');
    expect(demoOrders).toContain('open.length > 0 ? (');
    expect(demoOrders).toContain('It appears in your portfolio once they next report the position');
  });

  test('the preview starts as a new visitor before entering the live screen structure', () => {
    const shell = code(join(SHELL, 'AppScreen.tsx'));
    const sidebar = code(join(SHELL, 'AppSidebar.tsx'));
    const landing = code(join(WEB, 'app/page.tsx'));
    const signIn = code(join(WEB, 'app/sign-in/page.tsx'));
    const planning = code(join(WEB, 'app/demo/planning/page.tsx'));
    const matching = code(join(WEB, 'app/demo/opportunities/page.tsx'));
    const advisor = code(join(WEB, 'app/demo/agent/page.tsx'));
    const orders = code(join(WEB, 'app/demo/orders/page.tsx'));
    const partner = code(join(WEB, 'app/demo/institutions/page.tsx'));
    const dashboard = code(join(WEB, 'app/demo/home/page.tsx'));
    const layout = code(join(WEB, 'app/demo/layout.tsx'));
    const tour = code(join(SHELL, 'tour/tour.tsx'));

    for (const label of ['Home', 'Portfolio', 'Invest', 'My orders', 'Your agent', 'Planning']) {
      expect(sidebar).toContain(`label: '${label}'`);
    }
    expect(sidebar).not.toContain('1 · Profile & goals');
    expect(sidebar).not.toContain('5 · Partner review');
    expect(sidebar).not.toContain('6 · Dashboard');
    expect(sidebar).not.toContain("label: 'Compliance'");

    expect(landing).toContain("router.push('/sign-in?demo=1')");
    expect(signIn).toContain('Sign in or create an account');
    expect(signIn).toContain("router.push('/demo/planning?setup=1')");
    expect(signIn).toContain('resetDemoInvestorState()');
    expect(dashboard).toContain('Start a new investor journey');
    expect(dashboard).toContain('Find and review an investment');
    expect(dashboard).toContain('Add money to a partner account');
    expect(dashboard).toContain('Review and accept as a partner');
    expect(dashboard).toContain('window.sessionStorage.setItem(DEMO_JOURNEY_STORAGE_KEY');
    expect(dashboard).toContain("startPath: '/sign-in?demo=1'");
    expect(dashboard).toContain("startPath: '/demo/opportunities'");
    expect(dashboard).toContain("startPath: '/demo/portfolio'");
    expect(dashboard).toContain("startPath: '/demo/institutions'");
    expect(dashboard).toContain(
      'window.sessionStorage.setItem(DEMO_JOURNEY_STORAGE_KEY, FREE_JOURNEY)',
    );
    expect(dashboard).toContain('if (!open) {');
    expect(dashboard).toContain('m-0 grid min-w-0 gap-3 border-0 p-0');
    expect(layout).toContain('z-40');
    expect(tour).toContain("surface === 'demo-customer' || surface === 'demo-institution'");

    expect(planning).toContain('Recommended for you');
    expect(planning).toContain('Your goals');
    expect(planning).toContain('Create your investor profile');
    expect(planning).toContain("Let's get to know you better");
    expect(planning).toContain('Where do you live?');
    expect(planning).toContain('Full legal name');
    expect(planning).toContain('What is your age group?');
    expect(planning).toContain('Citizenship(s)');
    expect(planning).toContain('What is your main investment objective?');
    expect(planning).toContain('What is your time horizon?');
    expect(planning).toContain('How much investment risk are you comfortable with?');
    expect(planning).toContain('How quickly might you need access to this money?');
    expect(planning).toContain('Which best describes your current financial situation?');
    expect(planning).toContain('Politically exposed person status');
    expect(planning).toContain('Scan or upload passport');
    expect(planning).toContain('Select valid sample replacement');
    expect(planning).toContain('Source of funds (select all that apply)');
    expect(planning).toContain('Last four digits of your tax identifier');
    expect(planning).toContain('This sample passport expired on 12 June 2025');
    expect(planning).not.toContain('Use my agent’s correction');
    expect(planning).toContain('Review your investor profile');
    expect(planning).toContain(
      'className="flex items-center gap-2.5 text-foreground no-underline"',
    );
    expect(planning).toContain("name: ''");
    expect(planning).not.toContain('Marcus Bailey');
    expect(planning).toContain('citizenships,');
    expect(planning).toContain('pepStatus,');
    expect(planning).toContain('taxIdLastFour,');
    expect(dashboard).toContain('greeting(profile.name)');
    expect(signIn).toContain('DEMO_ENABLED &&');
    expect(shell).toContain('window.sessionStorage.setItem');
    expect(shell).toContain('inMemoryDemoProfile = { ...profile }');
    expect(shell).toContain('DEMO_ACCOUNT_STORAGE_KEY');
    expect(shell).toContain('opportunityOrders');
    expect(shell).toContain('nextDemoOrderId');
    expect(shell).toContain('demoIdentityFingerprint');
    expect(shell).toContain('resetDemoInvestorState');
    expect(matching).toContain('FILTERS.map');
    expect(matching).toContain('<DealCard');
    expect(matching).toContain('Key risk to review');
    expect(matching).toContain('{opportunity.match}%');
    expect(matching).not.toContain('Top 2 recommendations');
    expect(matching).toContain('rankDemoRecommendations(profile)');
    expect(matching).toContain('selectDemoRecommendations(profile)');
    expect(matching).toContain('demoVillaScreenReasons(profile, VILLA_SCREEN_CONTEXT)');
    expect(matching).toContain('writeDemoAccountState');
    expect(matching).toContain('nextDemoOrderId(selectedOpp.id');
    expect(matching).toContain('Follow this order');
    expect(shell).toContain('window.sessionStorage.getItem');

    expect(orders).toContain('Executed and settled by the institution that holds them');
    expect(orders).toContain('data-tour="customer-order-flow"');
    expect(orders).toContain('readDemoAccountState().opportunityOrders');
    expect(orders).toContain('status: order.status');
    expect(orders).toContain('`${order.partner} accepted the instruction');
    expect(orders).not.toContain('Partner onboarding');

    expect(advisor).toContain('I need quarterly access');
    expect(advisor).toContain('Voice input');
    expect(advisor).toContain('Ask your agent');
    expect(advisor).toContain('refreshed your recommendations');
    expect(advisor).not.toContain('How the agents reached this');
    expect(advisor).toContain('href="/demo/orders"');
    expect(advisor).toContain('liquidity: requestedLiquidity');
    expect(advisor).toContain('selectDemoRecommendations(profile)');
    expect(advisor).toContain('setDemoProfile(nextProfile)');
    expect(advisor).toContain('approvedActions');
    expect(advisor).toContain('nextDemoOrderId(`agent-${a.id}`');
    expect(advisor).toContain("amount: 'US$2,150'");
    expect(advisor).toContain('Nothing needs your attention right now.');
    expect(advisor).toContain('weekly access\\s+(?:copy|details?|information');
    expect(advisor).toContain("return 'liquidity'");
    expect(advisor).toContain('weeklyAccessQuestion');
    expect(advisor).toContain('explicitWeeklyAccessUpdate');
    expect(advisor).toContain('modalWeeklyAccessUpdate');
    expect(advisor).toContain("(?:i'd|i would)\\s+like");
    expect(advisor).toContain('(?:profile|liquidity');
    expect(advisor).toContain('ncbPosition');
    expect(advisor).toContain('villaScreenReply(profileForReply)');
    expect(advisor).toContain('max-[900px]:hidden');

    expect(shell).toContain('expired 12 Jun 2025');
    expect(shell).toContain('investor supplied a separate valid');
    expect(shell).not.toContain('passport replaced with valid');
    expect(partner).toContain('Marcus Bailey · ••4821');
    expect(partner).toContain('setProfile(restored)');
    expect(partner).toContain('restoredEvidence.clientReference');
    expect(partner).toContain('readDemoAccountState()');
    expect(partner).toContain('demoPartnerFor(requestedOrder?.partner ?? BLUE_MAHOE_PARTNER_NAME)');
    expect(partner).toContain('updateRequestedOrder(id');
    expect(partner).toContain('{partner.name}.');
    expect(partner).not.toContain('decision belongs to NCB');
    expect(partner).toContain('citizenship.join');
    expect(partner).toContain('Review client');
    expect(partner).toContain('Accept client');
    expect(partner).toContain('response target is within 3 business days');
    expect(partner).toContain('review pack received');
    expect(partner).toContain('dark:bg-card');
    expect(dashboard).toContain('readDemoAccountState()');
    expect(dashboard).toContain('pendingApprovals.length');
    expect(dashboard).toContain('Held across partners');
    expect(dashboard).toContain('View portfolio →');
    expect(dashboard).toContain('<Link href="/demo/opportunities">Invest</Link>');
    expect(dashboard).toContain('Step 6 · Human in the loop');
    expect(dashboard).toContain('simulated PDF review pack');
    expect(dashboard).toContain('Response target: within 3 business days');
    expect(dashboard).toContain('Step 7 · Dashboard');
    expect(dashboard).toContain('Live updates and opportunities');
    expect(dashboard).toContain('latestOrder.status');
    expect(dashboard).toContain('leadingOpportunity.match');
    expect(dashboard).toContain(
      'profile.name === DEFAULT_DEMO_PROFILE.name ? DEMO_REFERENCE_PROFILE : profile',
    );
    expect(dashboard).not.toContain('1 · Profile & goals');
    expect(dashboard).not.toContain('How the agents reached this');
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
    expect(demoAgent).toContain('remains responsible for the final KYC and AML decision');
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

describe('profile-driven demo recommendations', () => {
  test('reproduces the reference comparison and keeps screened products out', () => {
    const results = rankDemoRecommendations(DEMO_REFERENCE_PROFILE);
    expect(results.slice(0, 2).map(({ name, match }) => ({ name, match }))).toEqual([
      { name: 'Blue Mahoe Capital (Guyana)', match: 99 },
      { name: 'NCB Capital Markets', match: 92 },
    ]);
    expect(results.length).toBeGreaterThanOrEqual(5);
    expect(results.some((result) => result.blocked)).toBe(false);
    expect(results[0]?.match).toBeGreaterThan(
      Math.max(...results.slice(1).map(({ match }) => match)),
    );
  });
  test('changes rankings and explains a shorter liquidity preference', () => {
    const results = rankDemoRecommendations({
      ...DEMO_REFERENCE_PROFILE,
      risk: 'Conservative',
      objective: 'Capital preservation',
      liquidity: 'Quarterly access',
    });
    expect(results[0]?.risk).toBe('Low');
    const blueMahoe = results.find((result) => result.id === 'blue-mahoe-feedback');
    expect(blueMahoe?.match).toBeLessThan(99);
    expect(blueMahoe?.agentNote).toContain('exceeds your access preference');
  });
  test('keeps Blue Mahoe Capital (Guyana) in the recommended pair after profile changes', () => {
    const recommendations = selectDemoRecommendations({
      ...DEMO_REFERENCE_PROFILE,
      risk: 'Conservative',
      objective: 'Capital preservation',
      liquidity: 'Quarterly access',
    });
    expect(recommendations).toHaveLength(2);
    expect(recommendations.some((result) => result.partner === BLUE_MAHOE_PARTNER_NAME)).toBe(true);
    expect(recommendations[0]?.partner).toBe(BLUE_MAHOE_PARTNER_NAME);
    expect(recommendations[0]?.match).toBeGreaterThan(recommendations[1]?.match ?? 0);
  });
  test('a changed return target changes the fit explanation', () => {
    const results = rankDemoRecommendations({ ...DEMO_REFERENCE_PROFILE, targetReturn: '5–10%' });
    expect(results.find((result) => result.id === 'blue-mahoe-feedback')?.agentNote).toContain(
      'falls outside',
    );
  });
  test('does not invent a liquidity failure for a five-year lock preference', () => {
    const reasons = demoVillaScreenReasons(DEMO_REFERENCE_PROFILE, {
      minimumAmount: 'US$25,000',
      portfolioShare: '80%',
      singlePositionCap: '15%',
    });
    expect(reasons.some((reason) => reason.startsWith('Liquidity:'))).toBe(false);
    expect(reasons.some((reason) => reason.startsWith('Size:'))).toBe(true);
  });
});
