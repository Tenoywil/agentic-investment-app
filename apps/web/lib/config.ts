/**
 * Public, build-time configuration. `NEXT_PUBLIC_*` values are inlined at build,
 * so this is the demo↔live switch and the API origin the client talks to.
 *
 * In production NEXT_PUBLIC_API_URL is '' (empty) on purpose: every client
 * below then calls a same-origin relative path (e.g. `/api/onboarding/status`),
 * which next.config.mjs's rewrite forwards server-side to the real API. This
 * keeps the Better Auth session cookie same-origin from the browser's point of
 * view — see next.config.mjs for why that's required, not cosmetic. Falls back
 * to the local API port so `bun --filter web dev` works unproxied.
 */
export const DATA_MODE: 'demo' | 'live' =
  process.env.NEXT_PUBLIC_DATA_MODE === 'live' ? 'live' : 'demo';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
