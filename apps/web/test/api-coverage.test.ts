import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Every endpoint the API serves is reachable from the product.
 *
 * An endpoint with no caller is not dead weight — it is a promise the product
 * appears to make and cannot keep. `POST /api/approvals` had no caller, so the
 * "needs your approval" loop the whole product is built around could not happen
 * for anyone outside a demo email allowlist. `POST /api/ingestion/pull` had no
 * caller, so the partner console's reconciliation queue and its Match/Reject
 * buttons were unreachable. Six Gateway endpoints had no caller, so a private
 * deal could never be approved and every investor's match list was permanently
 * empty behind three working nav links.
 *
 * None of those failed anything. They were screens and buttons that could not
 * do the thing they described, and the only way to notice was to trace each
 * route by hand.
 *
 * This is a crude textual scan, deliberately — the same trade the fabricated
 * data guard makes. It reads the route tables out of the API source and the
 * `/api/...` literals out of the web app, normalises path parameters on both
 * sides, and compares. It will not catch an endpoint called with a wrongly
 * constructed URL. It does catch one that nothing calls at all, which is the
 * failure that actually happened, repeatedly.
 */

const WEB = resolve(import.meta.dir, '..');
const API = resolve(WEB, '../api/src');

/**
 * Endpoints intentionally served without a caller in this app. Each needs a
 * reason: "we might want it later" is how the six Gateway endpoints got there.
 */
const INTENTIONALLY_UNCALLED = new Map<string, string>([
  [
    'GET /api/gateway/opportunities',
    'the investor browses scored matches, not the raw deal list; the review queue reads /admin/review-queue',
  ],
]);

/**
 * `:id` and `${...}` both stand for "some value here".
 *
 * A trailing `*` that does not follow a slash came from an interpolated query
 * string — `` `/api/portfolio${query}` `` — not from a path segment, so it is
 * dropped. A path parameter always follows a slash.
 */
function normalise(path: string): string {
  return path
    .replace(/\$\{[^}]*\}/g, '*')
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '*')
    .replace(/([^/])\*+$/, '$1')
    .replace(/\/+$/, '');
}

/** `app.route('/api/orders', ordersRoutes(deps))` → `ordersRoutes` → `/api/orders`. */
function mountPoints(): Map<string, string> {
  const source = readFileSync(join(API, 'app.ts'), 'utf8');
  const mounts = new Map<string, string>();
  for (const m of source.matchAll(/app\.route\(\s*'([^']+)'\s*,\s*(\w+)\(/g)) {
    const [, prefix, fn] = m;
    if (prefix && fn) mounts.set(fn, prefix);
  }
  return mounts;
}

/** Every `app.get('/x', …)` in a routes file, prefixed by that file's mount. */
function servedEndpoints(): Set<string> {
  const mounts = mountPoints();
  const out = new Set<string>();
  const dir = join(API, 'routes');
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
    const source = readFileSync(join(dir, entry), 'utf8');
    // The exported factory name is what app.ts mounts, so it resolves the prefix.
    const exported = [...source.matchAll(/export function (\w+)\(/g)].map((m) => m[1]);
    const prefix = exported.map((fn) => fn && mounts.get(fn)).find(Boolean);
    if (!prefix) continue; // a helper module (util.ts), not a mounted router
    for (const m of source.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)) {
      const [, method, path] = m;
      if (!method || path === undefined) continue;
      const full = `${prefix}${path === '/' ? '' : path}`;
      out.add(`${method.toUpperCase()} ${normalise(full)}`);
    }
  }
  return out;
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else if (path.endsWith('.ts') || path.endsWith('.tsx')) files.push(path);
  }
  return files;
}

/**
 * A path segment chosen inline — `` `/clients/${id}/${accept ? 'accept' : 'decline'}` ``
 * — is two endpoints, not one wildcard. Collapsing it to `*` would report both
 * as uncalled while claiming a segment is a parameter when it is a choice.
 */
function expandTernaries(path: string): string[] {
  const ternary = /\$\{[^}]*\?\s*'([^']*)'\s*:\s*'([^']*)'\s*\}/;
  const match = path.match(ternary);
  if (!match) return [path];
  return [match[1], match[2]].flatMap((branch) =>
    expandTernaries(path.replace(ternary, branch ?? '')),
  );
}

/**
 * Each typed client wraps one API group in a helper —
 * `fetch(\`${API_URL}/api/console${path}\`)` — and every function in the file
 * then passes a path relative to it. Without resolving that prefix, the literal
 * `'/orders'` looks like it belongs to no endpoint at all.
 */
function basePathOf(source: string): string | null {
  return source.match(/\$\{API_URL\}(\/api\/[a-z-]+)\$\{\s*path\s*\}/)?.[1] ?? null;
}

/**
 * Every request the web app makes, as `METHOD path`.
 *
 * The method is read from the same call expression as the URL — bounded at the
 * statement's semicolon, because a fixed character window runs past the end of
 * a short GET helper and picks up the `method: 'POST'` of the function
 * underneath it, silently marking the GET as a POST.
 */
function calledEndpoints(): Set<string> {
  const out = new Set<string>();

  for (const file of [join(WEB, 'lib'), join(WEB, 'app')].flatMap((r) => walk(r))) {
    const source = readFileSync(file, 'utf8');
    const base = basePathOf(source);

    // Backticks are scanned separately and allow quotes inside them: a template
    // path may embed a choice — `${accept ? 'accept' : 'decline'}` — and a
    // single character class stops dead at that first inner quote, truncating
    // the URL to something that matches no endpoint.
    const literals = [
      ...source.matchAll(/`([^`\n]*)`/g),
      ...source.matchAll(/['"]([^'"\n]*)['"]/g),
    ];

    for (const m of literals) {
      const literal = m[1];
      if (!literal || m.index === undefined) continue;

      // A URL may be absolute inside a template (`${API_URL}/api/orders`), so
      // the literal is not required to *start* with the path.
      let path: string;
      if (literal.includes('/api/')) path = literal.slice(literal.indexOf('/api/'));
      else if (base && literal.startsWith('/')) path = `${base}${literal}`;
      else continue; // a route href, a class name, or ordinary copy

      const statement = source.slice(m.index, m.index + 400);
      const end = statement.indexOf(';');
      const call = end === -1 ? statement : statement.slice(0, end);
      // Either `{ method: 'POST' }` or a positional verb, as the admin client's
      // `send(path, 'POST', body)` helper passes it.
      const method =
        call.match(/method:\s*'(\w+)'/)?.[1] ??
        call.match(/['"](GET|POST|PUT|PATCH|DELETE)['"]/)?.[1] ??
        'GET';

      // Ternaries expand before the query string is stripped — an inline choice
      // contains a `?`, so splitting first truncates the path mid-expression.
      for (const variant of expandTernaries(path)) {
        out.add(`${method.toUpperCase()} ${normalise(variant.split('?')[0] ?? variant)}`);
      }
    }
  }
  return out;
}

const SERVED = servedEndpoints();
const CALLED = calledEndpoints();

describe('every API endpoint is reachable from the product', () => {
  it('found both route tables', () => {
    // Neither side may quietly become empty and turn this into a passing no-op.
    expect(SERVED.size).toBeGreaterThan(40);
    expect(CALLED.size).toBeGreaterThan(20);
  });

  it('has no endpoint without a caller', () => {
    const orphaned = [...SERVED]
      .filter((e) => !CALLED.has(e))
      .filter((e) => !INTENTIONALLY_UNCALLED.has(e))
      .sort();
    expect(orphaned).toEqual([]);
  });

  it('lists no stale exemption', () => {
    // An exemption for an endpoint that is now called, or no longer exists, is
    // a comment that has stopped being true.
    const stale = [...INTENTIONALLY_UNCALLED.keys()].filter((e) => !SERVED.has(e) || CALLED.has(e));
    expect(stale).toEqual([]);
  });
});
