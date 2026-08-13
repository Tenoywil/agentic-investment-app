import { isPublicIp, parseIp } from './ip';

/**
 * SSRF guard for every outbound call CCN makes (AI gateway, OAuth, partner
 * sandbox, Supabase).
 *
 * Defence in depth, strictest control first:
 *  1. An **exact-host allowlist** — the primary control. A host that is not named
 *     is refused before any DNS or socket work happens.
 *  2. **https only**, and no credentials embedded in the URL.
 *  3. Every **resolved address must be public** — loopback, RFC1918, link-local
 *     (169.254.169.254 cloud metadata), CGNAT and friends are refused, so an
 *     allowlisted name that resolves inward is still blocked.
 *  4. **Redirects are followed manually**, re-running the full check on each hop,
 *     so a 302 cannot walk the request off the allowlist.
 *
 * Note on DNS rebinding: this validates the addresses a hostname resolves to, but
 * the socket is opened by `fetch`, so a name that changes answers between the two
 * is a residual TOCTOU. The exact-host allowlist is what makes that unreachable in
 * practice — an attacker cannot introduce a new hostname, only reuse a trusted one.
 *
 * Pure except for the injected `resolve`/`fetch` — no globals, no ambient network.
 */

/** Resolves a hostname to its A/AAAA addresses. Injected so tests stay offline. */
export type Resolver = (hostname: string) => Promise<string[]>;

export type SsrfPolicy = {
  /** Exact hostnames permitted, case-insensitive. No wildcards, no suffix matching. */
  allowedHosts: readonly string[];
  /** Maximum redirect hops to follow. Default 3. */
  maxRedirects?: number;
  /**
   * Permit non-public addresses and http. Local development only — the loader
   * should never set this in staging or production.
   */
  allowPrivate?: boolean;
};

/**
 * Just the call signature the guard uses — deliberately narrower than
 * `typeof globalThis.fetch` (which carries runtime extras like `preconnect`),
 * so any plain function, including a test double, satisfies it.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type SsrfDeps = {
  resolve: Resolver;
  fetch: FetchLike;
};

/** Thrown when a request is refused. Never contains a secret or response body. */
export class SsrfBlockedError extends Error {
  readonly url: string;
  readonly reason: string;
  constructor(url: string, reason: string) {
    super(`blocked outbound request to ${url}: ${reason}`);
    this.name = 'SsrfBlockedError';
    this.url = url;
    this.reason = reason;
  }
}

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

function normalizeHost(host: string): string {
  // Strip IPv6 brackets and a trailing FQDN dot so "Example.com." === "example.com".
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  return bare.toLowerCase().replace(/\.$/, '');
}

export type SsrfGuard = {
  /** Throws SsrfBlockedError unless the URL passes every check. */
  assertAllowed(url: string): Promise<URL>;
  /** fetch() that validates the target and every redirect hop. */
  fetch(url: string, init?: RequestInit): Promise<Response>;
};

export function createSsrfGuard(policy: SsrfPolicy, deps: SsrfDeps): SsrfGuard {
  const allowed = new Set(policy.allowedHosts.map(normalizeHost));
  const maxRedirects = policy.maxRedirects ?? 3;
  const allowPrivate = policy.allowPrivate ?? false;

  async function assertAllowed(url: string): Promise<URL> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new SsrfBlockedError(url, 'malformed URL');
    }

    if (parsed.protocol !== 'https:' && !(allowPrivate && parsed.protocol === 'http:')) {
      throw new SsrfBlockedError(url, `protocol ${parsed.protocol} is not permitted`);
    }
    if (parsed.username || parsed.password) {
      throw new SsrfBlockedError(url, 'credentials in URL are not permitted');
    }

    const host = normalizeHost(parsed.hostname);
    if (!allowed.has(host)) {
      throw new SsrfBlockedError(url, `host ${host} is not on the allowlist`);
    }

    // An allowlisted literal IP still has to be public.
    const literal = parseIp(host);
    if (literal) {
      if (!allowPrivate && !isPublicIp(literal)) {
        throw new SsrfBlockedError(url, `host ${host} is not a public address`);
      }
      return parsed;
    }

    if (allowPrivate) return parsed;

    let addresses: string[];
    try {
      addresses = await deps.resolve(host);
    } catch {
      throw new SsrfBlockedError(url, `could not resolve ${host}`);
    }
    if (addresses.length === 0) {
      throw new SsrfBlockedError(url, `${host} resolved to no addresses`);
    }
    for (const address of addresses) {
      const ip = parseIp(address);
      if (!ip) throw new SsrfBlockedError(url, `${host} resolved to an unparseable address`);
      if (!isPublicIp(ip)) {
        throw new SsrfBlockedError(url, `${host} resolves to non-public address ${address}`);
      }
    }
    return parsed;
  }

  async function guardedFetch(url: string, init: RequestInit = {}): Promise<Response> {
    let target = (await assertAllowed(url)).toString();

    for (let hop = 0; ; hop++) {
      const response = await deps.fetch(target, { ...init, redirect: 'manual' });
      if (!REDIRECT_CODES.has(response.status)) return response;

      const location = response.headers.get('location');
      if (!location) return response;
      if (hop >= maxRedirects) {
        throw new SsrfBlockedError(target, `exceeded ${maxRedirects} redirects`);
      }
      // Resolve relative redirects against the current hop, then re-check in full.
      const next = new URL(location, target).toString();
      target = (await assertAllowed(next)).toString();
    }
  }

  return { assertAllowed, fetch: guardedFetch };
}
