import { connectedAccounts, holdings, instruments, partners } from '@ccn/db';
import { CURRENCIES, type Currency, convert, formatMoney, money } from '@ccn/money';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../context';
import { withTenant } from '../context';
import { requireAuth } from '../middleware';

/** Display names for the instrument_type enum, plus the `other` bucket used for
 *  holdings not yet matched to a catalogue instrument. */
const ASSET_CLASS_LABELS: Record<string, string> = {
  bond: 'Fixed income',
  fund: 'Funds',
  equity: 'Equities',
  real_estate: 'Real estate',
  private: 'Private markets',
  other: 'Other',
};

/**
 * Unified portfolio: every holding across partners, grouped by institution, with
 * the net worth converted to the caller's display currency by @ccn/money. Ports
 * the prototype's `institutions` + `fmt()` + currency toggle. Read-only.
 *
 * Also returns the real allocation by asset class. The screens previously drew
 * this from a hardcoded array of percentages, which on a live account meant
 * showing a signed-in user a fabricated breakdown of their own money.
 */
export function portfolioRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', requireAuth(deps));

  app.get('/', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);

    const requested = c.req.query('currency');
    const display: Currency =
      requested && (CURRENCIES as readonly string[]).includes(requested)
        ? (requested as Currency)
        : 'USD';

    const rows = await withTenant(deps, tenant, (tx) =>
      tx
        .select({
          partnerCode: partners.code,
          partnerName: partners.name,
          holdingName: holdings.name,
          valueMinor: holdings.valueMinor,
          ret: holdings.returnLabel,
          instrumentType: instruments.type,
        })
        .from(holdings)
        .leftJoin(connectedAccounts, eq(holdings.connectedAccountId, connectedAccounts.id))
        .leftJoin(partners, eq(connectedAccounts.partnerId, partners.id))
        .leftJoin(instruments, eq(holdings.instrumentId, instruments.id))
        .where(eq(holdings.userId, tenant.user.id)),
    );

    // Group by partner; base amounts are USD minor units.
    const groups = new Map<
      string,
      { code: string; name: string; totalMinor: bigint; holdings: unknown[] }
    >();
    // Allocation by asset class, derived from each holding's instrument type.
    // `holdings.instrumentId` is nullable (an ingested statement line may not
    // have been matched to a catalogue instrument yet), so those fall into
    // `other` rather than being silently dropped from the denominator.
    const byClass = new Map<string, bigint>();
    let netWorthMinor = 0n;
    for (const r of rows) {
      netWorthMinor += r.valueMinor;
      const cls = r.instrumentType ?? 'other';
      byClass.set(cls, (byClass.get(cls) ?? 0n) + r.valueMinor);
      const key = r.partnerCode ?? 'UNKNOWN';
      const group = groups.get(key) ?? {
        code: key,
        name: r.partnerName ?? 'Unlinked',
        totalMinor: 0n,
        holdings: [],
      };
      group.totalMinor += r.valueMinor;
      group.holdings.push({
        name: r.holdingName,
        value: formatMoney(convert(money(r.valueMinor, 'USD'), display)),
        ret: r.ret,
      });
      groups.set(key, group);
    }

    const netWorth = convert(money(netWorthMinor, 'USD'), display);
    // Percentages are of net worth, computed in minor units (integer maths, no
    // float drift) and rounded to one decimal. They will not always sum to
    // exactly 100 — that is rounding, not a missing slice, so the UI must not
    // present the remainder as an unallocated bucket.
    const allocation = [...byClass.entries()]
      .sort(([, a], [, b]) => (b > a ? 1 : b < a ? -1 : 0))
      .map(([type, valueMinor]) => ({
        type,
        label: ASSET_CLASS_LABELS[type] ?? 'Other',
        value: formatMoney(convert(money(valueMinor, 'USD'), display)),
        valueMinor: valueMinor.toString(),
        pct:
          netWorthMinor === 0n
            ? 0
            : Math.round((Number(valueMinor) / Number(netWorthMinor)) * 1000) / 10,
      }));

    return c.json({
      currency: display,
      netWorth: formatMoney(netWorth),
      netWorthMinor: netWorth.minor.toString(),
      allocation,
      partners: [...groups.values()].map((g) => ({
        code: g.code,
        name: g.name,
        total: formatMoney(convert(money(g.totalMinor, 'USD'), display)),
        holdings: g.holdings,
      })),
    });
  });

  return app;
}
