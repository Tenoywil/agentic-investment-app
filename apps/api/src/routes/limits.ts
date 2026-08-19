import type { Transaction } from '@ccn/db';
import { limits as limitsTable } from '@ccn/db';
import type { EngineLimits } from '@ccn/limits-engine';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../context';
import { withTenant } from '../context';
import { auditAppend } from '../db-fns';
import { requireAuth } from '../middleware';
import { loadLimits } from '../services/gate';

/**
 * The caller's guardrail policy — the exact row the deterministic Limits Engine
 * reads on every proposal (packages/limits-engine). The agent screen used to
 * render these four rules from a client-side constant and toggle them in React
 * state, so what a user saw and what the server enforced could disagree with no
 * way to tell. This is the read/write seam that makes the switches real.
 *
 * A user with no row yet is not an error and not a screen full of zeroes: GET
 * answers with the engine's own defaults (via `loadLimits`, the single place
 * those defaults live) and says so with `source: 'defaults'`, so the UI can
 * label them honestly rather than implying the user chose them.
 *
 * Money columns are bigint minor units and are serialised as strings, the same
 * "bigint -> string over the wire" convention the rest of the API uses.
 *
 * Changing a limit is safety-relevant — it widens or narrows what the agent may
 * do without asking — so every write appends an immutable audit row carrying
 * the before and after policy.
 */

/** The wire shape: money as minor-unit strings, everything else as-is. */
export interface LimitsWire {
  autoInvestCapMinor: string;
  autoInvestEnabled: boolean;
  cashFloorMinor: string;
  cashFloorEnabled: boolean;
  fxSpreadMaxBps: number;
  fxSpreadEnabled: boolean;
  requireApprovalAboveMinor: string;
  requireApprovalEnabled: boolean;
  singlePositionMaxPct: number;
  singlePositionEnabled: boolean;
  dailyCapMinor: string | null;
  dailyCapEnabled: boolean;
}

function toWire(limits: EngineLimits): LimitsWire {
  return {
    autoInvestCapMinor: limits.autoInvestCapMinor.toString(),
    autoInvestEnabled: limits.autoInvestEnabled,
    cashFloorMinor: limits.cashFloorMinor.toString(),
    cashFloorEnabled: limits.cashFloorEnabled,
    fxSpreadMaxBps: limits.fxSpreadMaxBps,
    fxSpreadEnabled: limits.fxSpreadEnabled,
    requireApprovalAboveMinor: limits.requireApprovalAboveMinor.toString(),
    requireApprovalEnabled: limits.requireApprovalEnabled,
    singlePositionMaxPct: limits.singlePositionMaxPct,
    singlePositionEnabled: limits.singlePositionEnabled,
    dailyCapMinor: limits.dailyCapMinor === null ? null : limits.dailyCapMinor.toString(),
    dailyCapEnabled: limits.dailyCapEnabled,
  };
}

/**
 * Partial update body. Written by hand rather than with Zod: `zod` is a
 * dependency of @ccn/domain, not of the API package, and the schema belongs
 * next to the only route that uses it. Every field is optional — the client
 * sends just the rule it changed — but an empty body is rejected rather than
 * treated as a no-op write that would still append an audit row.
 */
export type LimitsUpdate = Partial<EngineLimits>;

type ParseResult =
  | { ok: true; value: LimitsUpdate }
  | { ok: false; issues: { path: string; message: string }[] };

const MONEY_FIELDS = ['autoInvestCapMinor', 'cashFloorMinor', 'requireApprovalAboveMinor'] as const;

/** PostgreSQL bigint's positive ceiling. Reject larger wire values before an
 * attempted upsert can turn a client validation mistake into a database 500. */
const MAX_MONEY_MINOR = 9_223_372_036_854_775_807n;

const FLAG_FIELDS = [
  'autoInvestEnabled',
  'cashFloorEnabled',
  'fxSpreadEnabled',
  'requireApprovalEnabled',
  'singlePositionEnabled',
  'dailyCapEnabled',
] as const;

/** Minor units off the wire: a non-negative integer as a JSON number or a digit
 *  string (bigint has no JSON form). Mirrors @ccn/domain's amountMinorSchema. */
function parseMinor(value: unknown): bigint | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = BigInt(value);
    return parsed <= MAX_MONEY_MINOR ? parsed : null;
  }
  return null;
}

function parseIntInRange(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= min && value <= max ? value : null;
}

export function parseLimitsUpdate(body: unknown): ParseResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, issues: [{ path: '', message: 'expected an object' }] };
  }
  const input = body as Record<string, unknown>;
  const issues: { path: string; message: string }[] = [];
  const value: LimitsUpdate = {};

  for (const field of MONEY_FIELDS) {
    if (input[field] === undefined) continue;
    const parsed = parseMinor(input[field]);
    if (parsed === null) {
      issues.push({ path: field, message: 'must be a non-negative integer of minor units' });
    } else {
      value[field] = parsed;
    }
  }

  // The daily cap is the one nullable amount: null means "no cap set".
  if (input.dailyCapMinor !== undefined) {
    if (input.dailyCapMinor === null) {
      value.dailyCapMinor = null;
    } else {
      const parsed = parseMinor(input.dailyCapMinor);
      if (parsed === null) {
        issues.push({
          path: 'dailyCapMinor',
          message: 'must be a non-negative integer of minor units, or null',
        });
      } else {
        value.dailyCapMinor = parsed;
      }
    }
  }

  for (const field of FLAG_FIELDS) {
    if (input[field] === undefined) continue;
    if (typeof input[field] !== 'boolean') {
      issues.push({ path: field, message: 'must be a boolean' });
    } else {
      value[field] = input[field] as boolean;
    }
  }

  if (input.fxSpreadMaxBps !== undefined) {
    const parsed = parseIntInRange(input.fxSpreadMaxBps, 0, 10_000);
    if (parsed === null) {
      issues.push({ path: 'fxSpreadMaxBps', message: 'must be an integer between 0 and 10000' });
    } else {
      value.fxSpreadMaxBps = parsed;
    }
  }

  if (input.singlePositionMaxPct !== undefined) {
    const parsed = parseIntInRange(input.singlePositionMaxPct, 1, 100);
    if (parsed === null) {
      issues.push({
        path: 'singlePositionMaxPct',
        message: 'must be an integer between 1 and 100',
      });
    } else {
      value.singlePositionMaxPct = parsed;
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  if (Object.keys(value).length === 0) {
    return { ok: false, issues: [{ path: '', message: 'no recognised fields to update' }] };
  }
  return { ok: true, value };
}

/** The stored row, or the engine defaults when the user has none yet. */
async function readLimits(
  tx: Transaction,
  userId: string,
): Promise<{ effective: EngineLimits; updatedAt: Date | null; source: 'saved' | 'defaults' }> {
  const [row] = await tx.select().from(limitsTable).where(eq(limitsTable.userId, userId));
  if (!row) {
    return { effective: await loadLimits(tx, userId), updatedAt: null, source: 'defaults' };
  }
  return {
    effective: {
      autoInvestCapMinor: row.autoInvestCapMinor,
      autoInvestEnabled: row.autoInvestEnabled,
      cashFloorMinor: row.cashFloorMinor,
      cashFloorEnabled: row.cashFloorEnabled,
      fxSpreadMaxBps: row.fxSpreadMaxBps,
      fxSpreadEnabled: row.fxSpreadEnabled,
      requireApprovalAboveMinor: row.requireApprovalAboveMinor,
      requireApprovalEnabled: row.requireApprovalEnabled,
      singlePositionMaxPct: row.singlePositionMaxPct,
      singlePositionEnabled: row.singlePositionEnabled,
      dailyCapMinor: row.dailyCapMinor,
      dailyCapEnabled: row.dailyCapEnabled,
    },
    updatedAt: row.updatedAt,
    source: 'saved',
  };
}

export function limitsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', requireAuth(deps));

  app.get('/', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const { effective, updatedAt, source } = await withTenant(deps, tenant, (tx) =>
      readLimits(tx, tenant.user.id),
    );
    return c.json({
      limits: toWire(effective),
      updatedAt: updatedAt?.toISOString() ?? null,
      source,
    });
  });

  app.put('/', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const parsed = parseLimitsUpdate(await c.req.json().catch(() => null));
    if (!parsed.ok) return c.json({ error: 'invalid request', issues: parsed.issues }, 400);

    const result = await withTenant(deps, tenant, async (tx) => {
      const before = await readLimits(tx, tenant.user.id);
      const next: EngineLimits = { ...before.effective, ...parsed.value };

      // A daily cap that is on but has no amount would silently do nothing in
      // the engine, which is exactly the kind of switch that lies to the user.
      if (next.dailyCapEnabled && next.dailyCapMinor === null) {
        return {
          status: 400 as const,
          body: {
            error: 'invalid request',
            issues: [
              { path: 'dailyCapMinor', message: 'set a daily cap amount before enabling it' },
            ],
          },
        };
      }

      const now = new Date();
      const [row] = await tx
        .insert(limitsTable)
        .values({ userId: tenant.user.id, ...next, updatedAt: now })
        .onConflictDoUpdate({ target: limitsTable.userId, set: { ...next, updatedAt: now } })
        .returning();
      if (!row) throw new Error('limits upsert returned no row');

      const after = toWire(next);
      await auditAppend(tx, {
        actorType: 'user',
        actorId: tenant.user.id,
        userId: tenant.user.id,
        partnerId: null,
        action: 'limits.updated',
        entityType: 'limits',
        entityId: tenant.user.id,
        detail: {
          changed: Object.keys(parsed.value),
          before: toWire(before.effective),
          after,
        },
      });

      return {
        status: 200 as const,
        body: { limits: after, updatedAt: row.updatedAt.toISOString(), source: 'saved' as const },
      };
    });

    return c.json(result.body, result.status);
  });

  return app;
}
