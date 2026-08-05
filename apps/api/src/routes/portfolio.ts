import { connectedAccounts, holdings, partners } from '@ccn/db';
import { CURRENCIES, type Currency, convert, formatMoney, money } from '@ccn/money';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../context';
import { withTenant } from '../context';
import { requireAuth } from '../middleware';

/**
 * Unified portfolio: every holding across partners, grouped by institution, with
 * the net worth converted to the caller's display currency by @ccn/money. Ports
 * the prototype's `institutions` + `fmt()` + currency toggle. Read-only.
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
        })
        .from(holdings)
        .leftJoin(connectedAccounts, eq(holdings.connectedAccountId, connectedAccounts.id))
        .leftJoin(partners, eq(connectedAccounts.partnerId, partners.id))
        .where(eq(holdings.userId, tenant.user.id)),
    );

    // Group by partner; base amounts are USD minor units.
    const groups = new Map<
      string,
      { code: string; name: string; totalMinor: bigint; holdings: unknown[] }
    >();
    let netWorthMinor = 0n;
    for (const r of rows) {
      netWorthMinor += r.valueMinor;
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
    return c.json({
      currency: display,
      netWorth: formatMoney(netWorth),
      netWorthMinor: netWorth.minor.toString(),
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
