import { z } from 'zod';

/**
 * Fail-fast, typed configuration for CCN.
 *
 * - Every environment variable is validated here at startup; an invalid or missing
 *   value throws immediately with a readable report (never a silent `undefined`).
 * - Secrets are referenced by name and never logged. `describe()` returns a redacted
 *   view safe for diagnostics.
 * - This is the ONLY module that reads `process.env`. Everything else receives a typed
 *   `ServerConfig` by dependency injection.
 */

const appEnv = z.enum(['development', 'staging', 'production']);

/** Keys whose values must never be logged or surfaced. */
const SECRET_KEYS = new Set([
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'GOOGLE_CLIENT_SECRET',
  'OPENAI_API_KEY',
  'MINIMAX_SECRET',
  'FIELD_ENCRYPTION_KEY',
  'SENTRY_DSN',
]);

/**
 * Provider-branded aliases for the AI gateway key. MiniMax's API is
 * OpenAI-compatible, so `OPENAI_API_KEY` is canonical and everything downstream
 * reads that; `MINIMAX_SECRET` is honored as a fallback (some deploy platforms
 * name the secret after the provider). An explicit `OPENAI_API_KEY` always wins.
 * Returns a copy — the caller's env object is never mutated.
 *
 * Whatever the variable is called, the key must have been issued by whoever
 * answers at `OPENAI_BASE_URL`. That used to be the Impala gateway while
 * `MINIMAX_SECRET` named the model Impala routed to rather than the
 * credential's issuer, so a genuine MiniMax key landed in it and was rejected
 * with "Invalid proxy server token passed … not found in db". The base URL now
 * points at MiniMax itself, which makes the alias mean what it looks like it
 * means — but the rule is the base URL, not the name.
 */
function withAliases(
  source: Record<string, string | undefined>,
): Record<string, string | undefined> {
  if (source.OPENAI_API_KEY || !source.MINIMAX_SECRET) return source;
  return { ...source, OPENAI_API_KEY: source.MINIMAX_SECRET };
}

const serverSchema = z.object({
  APP_ENV: appEnv.default('development'),
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  // Database / Supabase (Postgres + Storage only)
  DATABASE_URL: z.string().url(),
  // Non-superuser role the request transaction drops to (SET LOCAL ROLE) so RLS
  // is enforced. In prod the connection is already this role, making it a no-op.
  DB_APP_ROLE: z.string().min(1).default('ccn_app'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default('ccn-private'),

  // Auth
  BETTER_AUTH_URL: z.string().url(),
  APP_WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  // AI gateway — MiniMax's own OpenAI-compatible API.
  //
  // https://api.minimax.io/v1 is the international endpoint; the China platform
  // answers on a different host, so a key issued there will 401 here. The SSRF
  // allowlist follows this value automatically, so pointing it elsewhere needs
  // no other change.
  OPENAI_BASE_URL: z.string().url().default('https://api.minimax.io/v1'),
  OPENAI_API_KEY: z.string().min(1),
  // An exact model id, not a family name. `GET ${OPENAI_BASE_URL}/models` is the
  // authoritative list for a given key and region, and the boot check below
  // calls it — MiniMax-M2 is the id kept compatible as newer ones ship.
  AI_MODEL: z.string().min(1).default('MiniMax-M2'),
  AI_EMBED_MODEL: z.string().default(''),
  // Gateway tiered-model overrides (packages/agent/src/gateway). Empty means
  // "use AI_MODEL" — resolved by packages/agent/src/gateway/provider.ts, so a
  // deployment that only sets AI_MODEL keeps working unchanged.
  GATEWAY_MODEL_HIGH: z.string().default(''),
  GATEWAY_MODEL_GENERAL: z.string().default(''),
  GATEWAY_MODEL_LOW: z.string().default(''),

  // Crypto
  FIELD_ENCRYPTION_KEY: z.string().min(1),

  // Observability
  SENTRY_DSN: z.string().default(''),

  // Demo provisioning. Nothing in the product assigns roles, so these allowlists
  // are how a real Google identity acquires one on first sign-in (see
  // apps/api/src/provisioning.ts). Both default to empty, i.e. every new user is
  // an ordinary customer with an empty account.
  //   PARTNER_OPERATOR_EMAILS  "ops@x.com:SAG, other@y.com"  (code optional)
  //   DEMO_CUSTOMER_EMAILS     "me@gmail.com"                (gets the seeded portfolio)
  //   ADMIN_EMAILS             "ops@ccn.com"                 (reads across tenants)
  PARTNER_OPERATOR_EMAILS: z.string().default(''),
  DEMO_CUSTOMER_EMAILS: z.string().default(''),
  DEMO_PARTNER_CODE: z.string().min(2).default('SAG'),
  ADMIN_EMAILS: z.string().default(''),
});

const clientSchema = z.object({
  NEXT_PUBLIC_DATA_MODE: z.enum(['demo', 'live']).default('demo'),
  NEXT_PUBLIC_API_URL: z.string().url(),
});

export type ServerConfig = z.infer<typeof serverSchema>;
export type ClientConfig = z.infer<typeof clientSchema>;

/** One entry of PARTNER_OPERATOR_EMAILS: an email, and the partner it operates. */
export interface OperatorGrant {
  email: string;
  partnerCode: string;
}

/**
 * The three fields the allowlist helpers actually read. Declared separately from
 * `ServerConfig` so a DB-only tool (the `grant` CLI) can resolve the same
 * allowlists without also having to supply OAuth secrets and an LLM key it will
 * never use. `ServerConfig` structurally satisfies this, so callers holding a
 * full config pass it unchanged.
 */
export interface AllowlistConfig {
  PARTNER_OPERATOR_EMAILS: string;
  DEMO_CUSTOMER_EMAILS: string;
  DEMO_PARTNER_CODE: string;
  ADMIN_EMAILS: string;
}

function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse `PARTNER_OPERATOR_EMAILS` into `email -> partnerCode`. Entries are
 * `email` (falling back to DEMO_PARTNER_CODE) or `email:CODE`. Emails are
 * lowercased so the lookup matches whatever casing the provider returns.
 */
export function operatorAllowlist(config: AllowlistConfig): Map<string, OperatorGrant> {
  const out = new Map<string, OperatorGrant>();
  for (const entry of splitList(config.PARTNER_OPERATOR_EMAILS)) {
    const [rawEmail, rawCode] = entry.split(':');
    const email = rawEmail?.trim().toLowerCase();
    if (!email) continue;
    out.set(email, {
      email,
      partnerCode: (rawCode?.trim() || config.DEMO_PARTNER_CODE).toUpperCase(),
    });
  }
  return out;
}

/**
 * Emails that administer the network.
 *
 * `admin` is the only role that reads across tenants (0008_admin_read.sql), and
 * it is read-only there — everything that changes state still goes through the
 * product's own choke points. Like the operator list it is deliberately an
 * environment variable rather than a screen: there is no in-product way to make
 * someone an administrator, so a compromised account cannot promote itself.
 */
export function adminAllowlist(config: AllowlistConfig): Set<string> {
  return new Set(splitList(config.ADMIN_EMAILS).map((e) => e.toLowerCase()));
}

/** Emails that receive the seeded Caribbean demo portfolio on first sign-in. */
export function demoCustomerAllowlist(config: AllowlistConfig): Set<string> {
  return new Set(splitList(config.DEMO_CUSTOMER_EMAILS).map((e) => e.toLowerCase()));
}

/**
 * An email in both allowlists is the worst demo-day failure available: the
 * customer account silently becomes an operator and lands on the wrong surface.
 * Reject it at startup rather than debugging it on stage.
 */
function assertAllowlistsDisjoint(config: AllowlistConfig): void {
  const operators = operatorAllowlist(config);
  const overlap = [...demoCustomerAllowlist(config)].filter((e) => operators.has(e));
  if (overlap.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n  - PARTNER_OPERATOR_EMAILS / DEMO_CUSTOMER_EMAILS: ${overlap.join(', ')} appears in both. An email must be exactly one surface.`,
    );
  }
}

function format(error: z.ZodError): string {
  const lines = error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
  return `Invalid environment configuration:\n${lines.join('\n')}`;
}

/** Parse and validate server-side config. Throws on any invalid/missing value. */
export function loadServerConfig(
  source: Record<string, string | undefined> = process.env,
): ServerConfig {
  const parsed = serverSchema.safeParse(withAliases(source));
  if (!parsed.success) throw new Error(format(parsed.error));
  const config = Object.freeze(parsed.data);
  assertAllowlistsDisjoint(config);
  return config;
}

/** Parse and validate the public (client-safe) config. */
export function loadClientConfig(
  source: Record<string, string | undefined> = process.env,
): ClientConfig {
  const parsed = clientSchema.safeParse(source);
  if (!parsed.success) throw new Error(format(parsed.error));
  return Object.freeze(parsed.data);
}

/** A redacted, log-safe view of the config. Secret values become `***`. */
export function describe(config: ServerConfig): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    out[key] = SECRET_KEYS.has(key) ? '***' : String(value);
  }
  return out;
}

export { serverSchema, clientSchema, SECRET_KEYS };
