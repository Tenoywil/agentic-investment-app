import { promises as dns } from 'node:dns';
import type { ServerConfig } from '@ccn/config';
import {
  type FieldCipher,
  type RateLimitRule,
  type SsrfGuard,
  createFieldCipher,
  createSsrfGuard,
  parseKeyMaterial,
} from '@ccn/security';

/**
 * Composition root for the security primitives: derives the SSRF allowlist and the
 * field cipher from validated config, so neither can drift from what is deployed.
 */

/** Hosts CCN is permitted to call, derived from the URLs it is configured with. */
export function outboundAllowlist(config: ServerConfig): string[] {
  const hosts = new Set<string>();
  const add = (url: string) => {
    try {
      hosts.add(new URL(url).hostname.toLowerCase());
    } catch {
      // loadServerConfig already validated these as URLs; ignore anything odd.
    }
  };

  // The AI gateway and Supabase are wherever config points them.
  add(config.OPENAI_BASE_URL);
  add(config.SUPABASE_URL);
  // Google OAuth token/discovery endpoints (Better Auth).
  hosts.add('accounts.google.com');
  hosts.add('oauth2.googleapis.com');
  hosts.add('www.googleapis.com');

  return [...hosts];
}

/**
 * The guard every outbound request must go through. Private addresses are only
 * tolerated in local development, where Supabase and the gateway may be on
 * localhost; staging and production always require public, allowlisted hosts.
 */
export function createOutboundGuard(config: ServerConfig): SsrfGuard {
  return createSsrfGuard(
    {
      allowedHosts: outboundAllowlist(config),
      allowPrivate: config.APP_ENV === 'development',
    },
    {
      resolve: async (hostname) => {
        const records = await dns.lookup(hostname, { all: true });
        return records.map((record) => record.address);
      },
      fetch: (input, init) => globalThis.fetch(input, init),
    },
  );
}

/**
 * Field cipher for PII / KYC references.
 * `FIELD_ENCRYPTION_KEY` holds the primary key; `FIELD_ENCRYPTION_KEY_PREVIOUS`
 * (optional, comma-separated `id:material` pairs) keeps retired keys readable
 * during a rotation sweep.
 */
export function createFieldCipherFrom(
  config: ServerConfig,
  previousRaw = process.env.FIELD_ENCRYPTION_KEY_PREVIOUS ?? '',
): FieldCipher {
  const previous = previousRaw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(':');
      if (separator === -1)
        throw new Error('FIELD_ENCRYPTION_KEY_PREVIOUS entries must be id:material');
      return {
        id: entry.slice(0, separator),
        material: parseKeyMaterial(entry.slice(separator + 1)),
      };
    });

  return createFieldCipher(
    { id: 'k1', material: parseKeyMaterial(config.FIELD_ENCRYPTION_KEY) },
    { previous },
  );
}

/**
 * Resolve the client address for IP-keyed rate limiting.
 *
 * Forwarding headers are attacker-controlled: anyone can send
 * `X-Forwarded-For: <random>` and mint a fresh bucket per request, which silently
 * disables IP rate limiting. So a header is trusted **only** when the deployment
 * declares which one its proxy sets (`TRUSTED_CLIENT_IP_HEADER`; Render's
 * reverse proxy sets the standard `X-Forwarded-For`, appending the real client
 * as the last hop — see apps/api/render.yaml). With nothing declared we fall
 * back to the socket address — possibly coarse behind a proxy, but never forgeable.
 */
export function createClientIpResolver(
  trustedHeader = process.env.TRUSTED_CLIENT_IP_HEADER ?? '',
): (c: { req: { header(name: string): string | undefined } }, socketAddress?: string) => string {
  const header = trustedHeader.trim().toLowerCase();
  return (c, socketAddress) => {
    if (header) {
      const value = c.req.header(header);
      // X-Forwarded-For may be a chain; the proxy appends, so the last hop is ours.
      if (value) {
        const parts = value.split(',');
        const candidate = (
          header === 'x-forwarded-for' ? parts[parts.length - 1] : parts[0]
        )?.trim();
        if (candidate) return candidate;
      }
    }
    return socketAddress ?? 'unknown';
  };
}

/**
 * Per-route-class budgets. Tighter where abuse is expensive (agent tokens) or
 * consequential (orders, approvals, auth); loose on plain reads.
 * Capacity is the burst a real user can produce; refill is the sustained rate.
 */
export const RATE_LIMITS = {
  /** Gateway tokens cost money — a few in a row, then roughly one every 6s. */
  agent: { capacity: 5, refillPerSecond: 1 / 6 },
  /** The money path: the Limits Engine gates correctness, this caps volume. */
  orders: { capacity: 10, refillPerSecond: 1 / 3 },
  /** One-tap approvals — bursty by nature, still bounded. */
  approvals: { capacity: 20, refillPerSecond: 1 },
  /** Credential stuffing / OAuth hammering. */
  auth: { capacity: 10, refillPerSecond: 1 / 2 },
  /** Reads: generous, but not unbounded. */
  read: { capacity: 60, refillPerSecond: 5 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitClass = keyof typeof RATE_LIMITS;
