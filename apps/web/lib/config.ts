/**
 * Public, build-time configuration. `NEXT_PUBLIC_*` values are inlined at build,
 * so this is the demo↔live switch and the API origin the client talks to.
 *
 * Every API call from the browser must be SAME-ORIGIN. `next.config.mjs`
 * rewrites `/api/*` to the real API server-side, which is what keeps the Better
 * Auth session cookie first-party. Point the browser straight at the API origin
 * instead and the cookie becomes third-party: it is never sent, every
 * authenticated call 401s, and sign-in fails with "We couldn't finish signing
 * you in". That is not hypothetical — it is what production did, and the
 * telltale in the API log is an `origin:` header on the request, which only a
 * browser sends. A server-side rewrite is a server-to-server fetch and carries
 * none.
 *
 * So in production this module IGNORES an absolute `NEXT_PUBLIC_API_URL` and
 * uses the same-origin path regardless. The variable is only honoured for local
 * development, where there is no rewrite to go through. Making the safe value
 * the only reachable one in production is deliberate: the failure it prevents is
 * silent, total, and indistinguishable from a broken login.
 */
export const DATA_MODE: 'demo' | 'live' =
  process.env.NEXT_PUBLIC_DATA_MODE === 'live' ? 'live' : 'demo';

/**
 * Whether the public fixture demo (/demo/*, and every "See a demo" button)
 * exists in this build. On by default; set NEXT_PUBLIC_DEMO_ENABLED=false in
 * the deployment environment to remove it entirely — the buttons disappear
 * and the routes answer 404. Inlined at build time like every NEXT_PUBLIC_*
 * value, so flipping it requires a redeploy.
 */
export const DEMO_ENABLED =
  process.env.NEXT_PUBLIC_DEMO_ENABLED !== 'false' && process.env.NEXT_PUBLIC_DEMO_ENABLED !== '0';

const configured = process.env.NEXT_PUBLIC_API_URL;
const isProd = process.env.NODE_ENV === 'production';
/** An absolute URL points the browser off-origin; a relative one does not. */
const isAbsolute = /^https?:\/\//i.test(configured ?? '');

if (isProd && isAbsolute && typeof console !== 'undefined') {
  console.warn(
    `[ccn] NEXT_PUBLIC_API_URL is set to ${configured}, which would make every API call cross-origin and drop the session cookie. Ignoring it and using the same-origin /api/* rewrite. Set it to an empty string in the deployment environment and redeploy — NEXT_PUBLIC_* values are inlined at build time, so saving the variable alone changes nothing.`,
  );
}

export const API_URL = isProd
  ? isAbsolute
    ? '' // same-origin; the rewrite in next.config.mjs forwards it
    : (configured ?? '')
  : (configured ?? 'http://localhost:3001');
