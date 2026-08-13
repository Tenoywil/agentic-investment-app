import type { RateLimiter } from '@ccn/security';
import { createMiddleware } from 'hono/factory';
import type { AppDeps, AppEnv, SessionUser } from './context';
import { tenantFromUser } from './tenant';

/**
 * Drizzle's `bigint`-mode money columns (moneyMinor helper) come back as
 * native JS `BigInt` so precision is never silently lost — but `JSON.stringify`
 * throws on a BigInt, and Hono's `c.json()` calls it raw. Recursively stringify
 * any BigInt before it reaches JSON.stringify, the same "bigint -> string over
 * the wire" convention db-fns.ts already uses for the SECURITY DEFINER
 * functions' raw-SQL results.
 */
function bigintSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(bigintSafe);
  if (value instanceof Date) return value;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, bigintSafe(v)]));
  }
  return value;
}

/**
 * Every JSON response passes through bigintSafe first — a route handler can
 * return a raw Drizzle row with a bigint money column without thinking about
 * serialization, and it just works, rather than every handler needing to
 * remember `.toString()` on every money field (easy to forget, a 500 when
 * missed). Overrides `c.json` for this request only, before any handler runs.
 */
export function bigintSafeJson() {
  return createMiddleware<AppEnv>(async (c, next) => {
    const original = c.json.bind(c);
    c.json = ((object: unknown, ...rest: unknown[]) =>
      // biome-ignore lint/suspicious/noExplicitAny: matching c.json's own overloaded signature exactly isn't practical for a runtime wrapper; the cast is safe because the wrapped call always passes the caller's own arguments through unchanged.
      (original as any)(bigintSafe(object), ...rest)) as typeof c.json;
    await next();
  });
}

/**
 * Resolve the Better Auth session (if any) and attach the user to the context.
 *
 * When no session resolves, log which cookie NAMES arrived (never values — and
 * the logger redacts on the way out regardless). A 401 on an authenticated
 * route is otherwise indistinguishable between "browser sent no cookie at all",
 * "sent one under an unexpected name" (the `__Secure-` prefix flips with
 * useSecureCookies, so a stale cookie from a different config silently misses),
 * and "sent a well-formed cookie whose session row is gone" — three very
 * different bugs that look identical from the client side.
 */
export function sessionMiddleware(deps: AppDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const result = await deps.auth.api.getSession({ headers: c.req.raw.headers });
    if (result?.user) {
      const user: SessionUser = {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
      };
      c.set('user', user);
    } else {
      const cookieNames = (c.req.header('cookie') ?? '')
        .split(';')
        .map((pair) => pair.split('=')[0]?.trim())
        .filter((name): name is string => Boolean(name));
      c.get('log')?.info('no session resolved', {
        cookieNames,
        hasCookieHeader: c.req.header('cookie') !== undefined,
        origin: c.req.header('origin') ?? null,
      });
    }
    await next();
  });
}

/**
 * Gate a route on an authenticated session and resolve the caller's tenant scope
 * (roles, bound partner, RBAC role). The roles lookup is an auth bootstrap, so it
 * runs on the privileged connection before any RLS scope is established.
 */
export function requireAuth(deps: AppDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'authentication required' }, 401);
    c.set('tenant', await tenantFromUser(deps, user));
    await next();
  });
}

/**
 * Stamp each request with an id and log its outcome as one structured line.
 * The id is echoed back as `x-request-id` so a user-reported failure can be
 * traced to its log record; an inbound id is ignored to keep the value trusted.
 */
export function requestLogger(deps: AppDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const requestId = crypto.randomUUID();
    const started = performance.now();
    c.set('requestId', requestId);
    c.header('x-request-id', requestId);

    const log = deps.logger.child({
      requestId,
      method: c.req.method,
      // The routed pattern, not the raw path — keeps ids out of the log line.
      route: c.req.routePath,
    });
    c.set('log', log);

    try {
      await next();
    } catch (error) {
      log.error('request failed', {
        error,
        durationMs: Math.round(performance.now() - started),
      });
      throw error;
    }

    log.info('request', {
      status: c.res.status,
      // Present only after requireAuth; absent on anonymous routes.
      actor: c.get('tenant')?.user.id,
      durationMs: Math.round(performance.now() - started),
    });
  });
}

/**
 * Token-bucket rate limiting.
 *
 * Keyed per authenticated user where we know one, per client IP otherwise, so a
 * signed-in caller's budget follows them across addresses and an anonymous flood
 * is still bounded. Refusals answer 429 with `Retry-After`.
 */
export function rateLimit(
  limiter: RateLimiter,
  clientIp: (c: { req: { header(name: string): string | undefined } }) => string,
) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const actor = c.get('tenant')?.user.id ?? c.get('user')?.id;
    const key = actor ? `user:${actor}` : `ip:${clientIp(c)}`;

    const decision = await limiter.check(key);
    if (!decision.allowed) {
      const seconds = Math.ceil(decision.retryAfterMs / 1000);
      c.header('Retry-After', String(Number.isFinite(seconds) ? seconds : 3600));
      c.get('log')?.warn('rate limited', { key, retryAfterMs: decision.retryAfterMs });
      return c.json({ error: 'rate limit exceeded' }, 429);
    }
    await next();
  });
}
