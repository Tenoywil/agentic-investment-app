import { connectedAccounts, holdings, instruments, partners } from '@ccn/db';
import { CURRENCIES, type Currency, convert, formatMoney, money } from '@ccn/money';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../context';
import { withTenant } from '../context';
import { auditAppend } from '../db-fns';
import { requireAuth } from '../middleware';
import { adapterFor } from '../services/adapters';

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

  /**
   * Connect an account at a partner, and pull what it holds.
   *
   * Until this existed an investor could not put anything into CCN. Holdings
   * arrived only from `db:seed`, so a real person who signed up and finished
   * onboarding had an empty portfolio, no cash, and therefore could not place
   * an order at all — every amount drew them below their cash floor, and the
   * guardrail refused it correctly. The whole customer side terminated at a
   * screen saying there was nothing there.
   *
   * The balances are not invented here. They come from the partner's adapter
   * through the same registry the ingestion pipeline uses, gated on the
   * partner's live `agreement_status` and its scopes — today that resolves to
   * the sandbox adapter, and when a real one is registered for a partner code
   * this route does not change.
   *
   * Re-connecting the same partner refreshes that account's holdings rather
   * than creating a second one: a person has one account at a firm, and the
   * second press of a button should not double their net worth. The refresh
   * deletes nothing — the app role has no DELETE on `holdings` — it updates the
   * rows it already wrote and inserts the ones it has not seen.
   */
  /**
   * The institutions on the network, for the connect dialog.
   *
   * Distinct from the partners on `GET /`, which are the ones this investor has
   * already connected — an empty list for anybody new, which is exactly who
   * needs to see the choices. `partners` is readable by every authenticated
   * user, so this exposes nothing that was not already open.
   *
   * Only the firms an investor can actually connect to. The adapter registry
   * refuses a read for a partner whose agreement is `prospect` or `dpa_pending`
   * — correctly, since CCN has no relationship to read through — so listing one
   * here would be offering a control that fails. A firm CCN is still talking to
   * is not a firm you can link an account at.
   */
  app.get('/partners', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const rows = await withTenant(deps, tenant, (tx) =>
      tx
        .select({
          code: partners.code,
          name: partners.name,
          kind: partners.kind,
          regulator: partners.regulator,
        })
        .from(partners)
        .where(inArray(partners.agreementStatus, ['sandbox', 'live']))
        .orderBy(partners.name),
    );
    return c.json({ partners: rows });
  });

  app.post('/accounts', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);

    const body = (await c.req.json().catch(() => null)) as { partnerCode?: unknown } | null;
    const code = typeof body?.partnerCode === 'string' ? body.partnerCode.trim().toUpperCase() : '';
    if (!code) return c.json({ error: 'partnerCode is required' }, 400);

    const result = await withTenant(deps, tenant, async (tx) => {
      const [partner] = await tx
        .select({
          id: partners.id,
          name: partners.name,
          agreementStatus: partners.agreementStatus,
        })
        .from(partners)
        .where(eq(partners.code, code))
        .limit(1);
      if (!partner) return { error: `no partner with code ${code}` as const, status: 400 as const };
      // The adapter registry would refuse this anyway; saying so is kinder than
      // a 500 from inside it.
      if (partner.agreementStatus !== 'sandbox' && partner.agreementStatus !== 'live') {
        return {
          error:
            `${partner.name} is not connectable yet — CCN's agreement with them is ${partner.agreementStatus}.` as const,
          status: 400 as const,
        };
      }

      const [existing] = await tx
        .select({ id: connectedAccounts.id })
        .from(connectedAccounts)
        .where(
          and(
            eq(connectedAccounts.userId, tenant.user.id),
            eq(connectedAccounts.partnerId, partner.id),
          ),
        )
        .limit(1);

      let accountId = existing?.id;
      if (!accountId) {
        const [row] = await tx
          .insert(connectedAccounts)
          .values({ userId: tenant.user.id, partnerId: partner.id, label: partner.name })
          .returning({ id: connectedAccounts.id });
        accountId = row?.id;
      }
      if (!accountId)
        return { error: 'the account was not connected' as const, status: 400 as const };

      // The partner's own view of what this client holds.
      const { adapter } = await adapterFor(tx, code, 'read', () => Date.now());
      const pulled = await adapter.getHoldings(tenant.user.id);

      // Catalogue instruments, so a pulled holding lands on the right one where
      // CCN lists it and stays a plain named holding where it does not.
      const slugs = pulled.map((h) => h.instrumentSlug).filter((s): s is string => Boolean(s));
      const known = slugs.length
        ? await tx
            .select({ id: instruments.id, slug: instruments.slug })
            .from(instruments)
            .where(inArray(instruments.slug, slugs))
        : [];
      const idBySlug = new Map(known.map((i) => [i.slug, i.id]));

      const mine = await tx
        .select({ id: holdings.id, name: holdings.name })
        .from(holdings)
        .where(eq(holdings.connectedAccountId, accountId));
      const idByName = new Map(mine.map((h) => [h.name, h.id]));

      for (const h of pulled) {
        const already = idByName.get(h.name);
        const values = {
          instrumentId: h.instrumentSlug ? (idBySlug.get(h.instrumentSlug) ?? null) : null,
          valueMinor: h.valueMinor,
          currency: h.currency,
          updatedAt: new Date(),
        };
        if (already) {
          await tx.update(holdings).set(values).where(eq(holdings.id, already));
        } else {
          await tx.insert(holdings).values({
            userId: tenant.user.id,
            connectedAccountId: accountId,
            name: h.name,
            ...values,
          });
        }
      }

      await auditAppend(tx, {
        actorType: 'user',
        actorId: tenant.user.id,
        userId: tenant.user.id,
        partnerId: partner.id,
        action: existing ? 'connected_account.refreshed' : 'connected_account.linked',
        entityType: 'connected_accounts',
        entityId: accountId,
        detail: { partner: partner.name, code, holdings: pulled.length },
      });

      return { accountId, partner: partner.name, holdings: pulled.length, refreshed: !!existing };
    });

    if ('error' in result) return c.json({ error: result.error }, result.status);
    deps.logger.info('investor connected an account', { user: tenant.user.id, partner: code });
    return c.json(result, result.refreshed ? 200 : 201);
  });

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
          partnerKind: partners.kind,
          partnerRegulator: partners.regulator,
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

    // Group by partner; base amounts are USD minor units. `kind` and
    // `regulator` ride along because the screens were printing "· FSC-regulated"
    // under every institution as static text — true for the seeded Jamaican
    // partners, an unverifiable claim for anyone else. Both are nullable, and
    // the UI omits the line rather than guessing.
    const groups = new Map<
      string,
      {
        code: string;
        name: string;
        kind: string | null;
        regulator: string | null;
        totalMinor: bigint;
        holdings: unknown[];
      }
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
        kind: r.partnerKind ?? null,
        regulator: r.partnerRegulator ?? null,
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
        kind: g.kind,
        regulator: g.regulator,
        total: formatMoney(convert(money(g.totalMinor, 'USD'), display)),
        holdings: g.holdings,
      })),
    });
  });

  return app;
}
