/**
 * Redaction for structured logs.
 *
 * The plan's logging rule is "request id / actor / route, no secrets or PII".
 * Log call sites are easy to get wrong, so redaction is centralized here and applied
 * to every payload on the way out rather than trusted to each caller.
 *
 * Two independent passes, because the failure modes differ:
 *  - **by key** — anything named like a credential or a direct identifier is masked
 *    regardless of its value (`authorization`, `password`, `dateOfBirth`, …).
 *  - **by shape** — bearer tokens, `sk-` gateway keys, JWTs, emails and long digit
 *    runs (card / account numbers) are masked wherever they appear in a string,
 *    which catches secrets pasted into a message or an error.
 *
 * Pure: no clock, no IO. Cycles are handled; the input is never mutated.
 */

export const REDACTED = '[redacted]';

/** Substring matched case-insensitively against a key name. */
const SENSITIVE_KEY_PARTS = [
  'secret',
  'password',
  'passwd',
  'token',
  'authorization',
  'auth',
  'cookie',
  'session',
  'credential',
  'apikey',
  'api_key',
  'privatekey',
  'private_key',
  'signature',
  'dsn',
  'connectionstring',
  'database_url',
  // Direct identifiers / KYC material — PII minimization.
  'ssn',
  'taxid',
  'tax_id',
  'passport',
  'nationalid',
  'national_id',
  'dateofbirth',
  'date_of_birth',
  'dob',
  'address',
  'phone',
  'accountnumber',
  'account_number',
  'iban',
  'cardnumber',
  'card_number',
];

/** Compare on letters only, so apiKey / api_key / API-KEY all match one pattern. */
const flatten = (text: string) => text.toLowerCase().replace(/[-_\s]/g, '');

function isSensitiveKey(key: string): boolean {
  const flat = flatten(key);
  return SENSITIVE_KEY_PARTS.some((part) => flat.includes(flatten(part)));
}

/** Value-shaped secrets, masked anywhere they appear inside a string. */
const VALUE_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  // JWT — three base64url segments.
  {
    pattern: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g,
    replacement: REDACTED,
  },
  // OpenAI-style gateway keys (`sk-…`).
  { pattern: /\bsk-[A-Za-z0-9_-]{8,}\b/g, replacement: REDACTED },
  // `key=<value>` and friends, anywhere in a string.
  //
  // Not hypothetical: the gateway rejected a bad token with
  //   "Invalid proxy server token passed. key=a1a1957…, not found in db"
  // and the whole message went to the production log, key included, because the
  // token carries no `sk-` prefix — it is a bare 64-character hex string, which
  // matches none of the shapes above. The by-key pass does not help either: the
  // secret is not a field of the payload, it is spelled out inside an upstream
  // error message.
  //
  // Matching the assignment rather than the value keeps this precise. A blanket
  // "long hex run" rule would also mask the SHA-256 audit-chain hashes, which
  // are logged deliberately and are not secret.
  {
    pattern:
      /\b(key|api[_-]?key|token|secret|password|passwd|pwd)(\s*[=:]\s*)["']?[A-Za-z0-9._~+/-]{12,}["']?/gi,
    replacement: `$1$2${REDACTED}`,
  },
  // `Bearer <token>` / `Basic <token>` in a header dump.
  { pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, replacement: `$1 ${REDACTED}` },
  // Postgres/AMQP-style URLs carrying a password.
  { pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s@]+@/gi, replacement: `$1:${REDACTED}@` },
  // Email addresses.
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: REDACTED },
  // Long digit runs (account / card numbers), allowing spaces or dashes as separators.
  { pattern: /\b(?:\d[ -]?){12,19}\b/g, replacement: REDACTED },
];

/** Mask value-shaped secrets inside a single string. */
export function redactString(input: string): string {
  let out = input;
  for (const { pattern, replacement } of VALUE_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Deep-copy a log payload with secrets and direct identifiers masked.
 * Errors become `{ name, message, stack }` (redacted) so they serialize usefully.
 */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redact(item, seen);
  }
  return out;
}
