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
 * Provider-branded aliases for the AI gateway key. The Impala gateway is
 * OpenAI-compatible, so `OPENAI_API_KEY` is canonical and everything downstream
 * reads that; `MINIMAX_SECRET` is honored as a fallback (some deploy platforms
 * name the secret after the model). An explicit `OPENAI_API_KEY` always wins.
 * Returns a copy — the caller's env object is never mutated.
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

  // AI gateway (Impala, OpenAI-compatible)
  OPENAI_BASE_URL: z.string().url().default('https://ht.getimpala.ai/v1'),
  OPENAI_API_KEY: z.string().min(1),
  AI_MODEL: z.string().min(1).default('MiniMax'),
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
});

const clientSchema = z.object({
  NEXT_PUBLIC_DATA_MODE: z.enum(['demo', 'live']).default('demo'),
  NEXT_PUBLIC_API_URL: z.string().url(),
});

export type ServerConfig = z.infer<typeof serverSchema>;
export type ClientConfig = z.infer<typeof clientSchema>;

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
  return Object.freeze(parsed.data);
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
