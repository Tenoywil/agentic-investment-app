/**
 * Public, build-time configuration. `NEXT_PUBLIC_*` values are inlined at build,
 * so this is the demo↔live switch and the API origin the client talks to.
 */
export const DATA_MODE: 'demo' | 'live' =
  process.env.NEXT_PUBLIC_DATA_MODE === 'live' ? 'live' : 'demo';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
