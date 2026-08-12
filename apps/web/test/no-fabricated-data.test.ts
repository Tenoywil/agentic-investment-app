import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * No fabricated data on an authenticated surface.
 *
 * The demo track (`app/demo/**`) is fixtures by design — it is the tour a
 * visitor takes *before* signing up, and it is exempt. Everything a signed-in
 * user sees must trace to an API response, because the alternative is showing
 * someone invented figures about their own money.
 *
 * This is deliberately a crude literal scan rather than anything clever. It
 * caught the real regressions (a hardcoded all-time gain wrapped around a live
 * net worth; three green KYC ticks asserted at the moment of authorising an
 * order) and it keeps working when someone adds a screen next week. A reviewer
 * reading a diff does not.
 */

/** Resolved against this file, not the cwd — the suite runs both from the repo
 *  root (`bun test`) and from apps/web (`turbo run test`). */
const WEB = resolve(import.meta.dir, '..');
const ROOTS = ['app/(customer)', 'app/(institution)', 'app/_components'].map((r) => join(WEB, r));

/** Literals lifted from the prototype during the audit. Each one shipped to a
 *  live screen at some point, so each one earns a permanent test. */
const DENYLIST: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /US\$1,994/, why: "the invented all-time gain on /home's net worth" },
  { pattern: /6\.8\s*%/, why: 'the invented portfolio return' },
  { pattern: /yield 6\.2\s*%/, why: 'the invented blended yield' },
  { pattern: /Sagicor Group/, why: 'a hardcoded partner name — use me.partner.name' },
  { pattern: /Marcus/, why: 'the prototype persona — use the signed-in user’s name' },
  { pattern: /US\$48\.2M/, why: 'the invented referred-AUM KPI' },
  { pattern: /\b4,120\b/, why: 'the invented KYC funnel top-of-funnel count' },
  { pattern: /\b1,284\b/, why: 'the invented KYC funnel conversion count' },
  { pattern: /72\s*\/\s*100/, why: 'the invented financial health score' },
  { pattern: /US\$120,000/, why: 'the invented protection gap' },
  { pattern: /US\$310,000/, why: 'the invented legacy value' },
  { pattern: /47\s+(instruments|holdings)/, why: 'the invented holdings count' },
  { pattern: /8\s+licensed partners/, why: 'the invented partner count' },
  { pattern: /FSC-regulated/, why: 'a regulator asserted as static text — use partner.regulator' },
];

/**
 * Anything that looks like a money amount or a signed percentage. Real money
 * arrives pre-formatted from @ccn/money server-side, so a currency literal in
 * a component is by definition invented.
 */
const SHAPES: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /US\$[\d]/, why: 'a hardcoded money amount' },
  { pattern: /[+↑↓]\s?\d+(\.\d+)?%/, why: 'a hardcoded signed percentage' },
];

/**
 * Strip what is not rendered: comments (which document the fabrications we
 * removed, and must be allowed to name them) and `placeholder` text (form
 * hint copy, e.g. an example mandate — instructional, not a claim about the
 * reader). Replaced with spaces so reported line numbers stay accurate.
 */
function strip(source: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + blank(m.slice(lead.length)))
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, blank)
    .replace(/placeholder=(["'])(?:(?!\1)[\s\S])*?\1/g, blank)
    .replace(/placeholder=\{(["'`])(?:(?!\1)[\s\S])*?\1\}/g, blank);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith('.tsx') || path.endsWith('.ts')) out.push(path);
  }
  return out;
}

const files = ROOTS.flatMap((root) => walk(root));

describe('authenticated surfaces carry no fabricated data', () => {
  it('finds the screens to scan', () => {
    // A refactor that moves the route groups must not silently turn this suite
    // into a no-op that passes by scanning nothing.
    expect(files.length).toBeGreaterThan(15);
  });

  for (const file of files) {
    const label = relative(WEB, file);
    it(label, () => {
      const lines = strip(readFileSync(file, 'utf8')).split('\n');
      const hits: string[] = [];
      for (const [i, line] of lines.entries()) {
        for (const { pattern, why } of [...DENYLIST, ...SHAPES]) {
          if (pattern.test(line)) hits.push(`${label}:${i + 1} — ${why}: ${line.trim()}`);
        }
      }
      expect(hits).toEqual([]);
    });
  }
});
