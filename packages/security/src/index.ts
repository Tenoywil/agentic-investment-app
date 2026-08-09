/**
 * @ccn/security — the platform's security primitives.
 *
 * Pure and dependency-injected (clock, DNS, fetch, RNG are all passed in), so every
 * rule here is exhaustively testable offline and reusable from the API, jobs and
 * future workers without touching a global.
 */

export { parseIp, isPublicIp, type ParsedIp, type IpVersion } from './ip';
export {
  createSsrfGuard,
  SsrfBlockedError,
  type Resolver,
  type SsrfPolicy,
  type SsrfDeps,
  type FetchLike,
  type SsrfGuard,
} from './ssrf';
export {
  consume,
  initialState,
  createMemoryStore,
  createRateLimiter,
  type RateLimitRule,
  type BucketState,
  type RateLimitDecision,
  type ConsumeResult,
  type RateLimitStore,
  type RateLimiter,
} from './rate-limit';
export { redact, redactString, REDACTED } from './redact';
export {
  createFieldCipher,
  parseKeyMaterial,
  FieldDecryptionError,
  type FieldKey,
  type FieldCipher,
} from './field-crypto';
