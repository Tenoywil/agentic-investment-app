import { describe, expect, it } from 'bun:test';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { navGroupsFor } from '@/app/_components/AppSidebar';

/**
 * Every destination the navigation offers must exist.
 *
 * This is not hypothetical tidiness. `navGroupsFor('/demo')` strips the Gateway
 * group and the Onboarding item, but not Orders — so the preview shell's rail
 * and its mobile drawer both rendered a link to `/demo/orders`, a route that was
 * never built. A visitor evaluating the product clicked a primary nav item and
 * got Next's default 404. Nothing failed; the link simply pointed at nothing,
 * and it shipped because a nav list and a route tree are two files that no test
 * compared.
 *
 * The nav is imported rather than pattern-matched out of the source, so the
 * assertion is over the real list the app renders, including whatever filtering
 * `navGroupsFor` applies now or later.
 */

const WEB = resolve(import.meta.dir, '..');
const APP = join(WEB, 'app');

/**
 * Every route the App Router actually serves, as a pathname.
 *
 * Route groups — the `(customer)` / `(institution)` / `(admin)` directories —
 * organise files without appearing in the URL, so they are dropped. A directory
 * holding a `page.tsx` is a route; anything else is not.
 */
function routes(dir: string, prefix = '', out = new Set<string>()): Set<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (entry === 'page.tsx') out.add(prefix === '' ? '/' : prefix);
    else if (statSync(path).isDirectory()) {
      // `(group)` is organisational and contributes no URL segment; `_components`
      // and `_lib` are private folders the router ignores entirely.
      if (entry.startsWith('_')) continue;
      const segment = entry.startsWith('(') && entry.endsWith(')') ? '' : `/${entry}`;
      routes(path, `${prefix}${segment}`, out);
    }
  }
  return out;
}

const SERVED = routes(APP);

/** The two shells the product renders: the live app, and the signed-out preview. */
const SHELLS: { label: string; basePath: string }[] = [
  { label: 'the signed-in app', basePath: '' },
  { label: 'the /demo preview', basePath: '/demo' },
];

describe('every navigation destination is a route that exists', () => {
  it('found the route tree', () => {
    // A refactor that moves `app/` must not turn this suite into a no-op that
    // passes because it compared the nav against an empty set.
    expect(SERVED.size).toBeGreaterThan(10);
    expect(SERVED.has('/home')).toBe(true);
  });

  for (const { label, basePath } of SHELLS) {
    const hrefs = navGroupsFor(basePath).flatMap((g) => g.items.map((i) => `${basePath}${i.href}`));

    it(`${label} offers at least one destination`, () => {
      expect(hrefs.length).toBeGreaterThan(0);
    });

    for (const href of hrefs) {
      it(`${label}: ${href}`, () => {
        expect(SERVED.has(href)).toBe(true);
      });
    }
  }

  /**
   * The preview shell's footer links to the console rather than to an account
   * menu, so it is a nav destination that does not come from `navGroupsFor`.
   */
  it('the /demo preview: /demo/institutions', () => {
    expect(SERVED.has('/demo/institutions')).toBe(true);
  });
});

/**
 * The loading shell picks a skeleton by matching the current pathname against a
 * table of route prefixes, falling back to Home. A customer route missing from
 * that table does not fail — it renders the *Home* skeleton with *Home*
 * highlighted in the rail, then swaps to the real screen, which reads as a
 * misrouted navigation rather than a load. `/orders` was missing.
 */
describe('every customer route has a loading skeleton', () => {
  const source = Bun.file(join(APP, '(customer)', 'shell-skeleton.tsx'));

  it('each signed-in nav destination appears in the skeleton route table', async () => {
    const text = await source.text();
    const missing = navGroupsFor('')
      .flatMap((g) => g.items.map((i) => i.href))
      .filter((href) => !text.includes(`prefix: '${href}'`));
    expect(missing).toEqual([]);
  });
});
