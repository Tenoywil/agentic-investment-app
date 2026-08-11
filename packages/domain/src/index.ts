/**
 * @ccn/domain — pure domain rules shared across the API and (where relevant) the
 * web app: the order state machine, suitability policy, and the Zod schemas that
 * validate every request boundary. No I/O, no clock, no randomness.
 */
export * from './order';
export * from './suitability';
export * from './schemas';
export * from './gateway';
