import {
  connectedAccounts,
  holdings,
  instruments,
  partners,
  reconciliationItems,
  withdrawalRequests,
} from '@ccn/db';
import { fundingNoticeSchema, withdrawalRequestSchema } from '@ccn/domain';
import { CURRENCIES, type Currency, convert, formatMoney, money } from '@ccn/money';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../context';
import { withTenant } from '../context';
import { auditAppend, requestWithdrawal } from '../db-fns';
import { requireAuth } from '../middleware';
import { adapterFor } from '../services/adapters';
import { loadFxTable } from '../services/fx';

/** A refusal with a message the investor reads verbatim. */
class WithdrawalRefused extends Error {}

/** Was this thrown by a PL/pgSQL RAISE whose message contains `fragment`?
 *  Drizzle wraps the postgres error, so the cause chain is walked — matching
 *  only the top-level message misses every RAISE. Same helper as console.ts. */
function raisedBy(err: unknown, fragment: string): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 4; depth++) {
    if (e instanceof Error) {
      if (e.message.includes(fragment)) return true;
      e = e.cause;
    } else return false;
  }
  return false;
}

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

  /**
   * Brand marks for every partner on the network, one small list the client
   * caches: id, code, name, brand colors, and whether a real logo exists.
   * `partners_read` is USING (true), so this is reference data for any
   * authenticated caller — the bytes themselves come from /partner-logo/:id.
   */
  app.get('/partner-marks', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const rows = await withTenant(deps, tenant, (tx) =>
      tx
        .select({
          id: partners.id,
          code: partners.code,
          name: partners.name,
          color: partners.color,
          tint: partners.tint,
          logoMime: partners.logoMime,
        })
        .from(partners)
        .orderBy(partners.name),
    );
    return c.json({
      marks: rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        color: r.color,
        tint: r.tint,
        hasLogo: r.logoMime !== null,
      })),
    });
  });

  /** One partner's logo bytes. 404 when the firm has not uploaded one — the
   *  client falls back to its monogram mark, so a 404 here is a state, not an
   *  error. Cached: a brand changes rarely and renders everywhere. */
  app.get('/partner-logo/:id', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const id = c.req.param('id');
    const [row] = await withTenant(deps, tenant, (tx) =>
      tx
        .select({ logo: partners.logo, mime: partners.logoMime })
        .from(partners)
        .where(eq(partners.id, id)),
    );
    if (!row?.logo || !row.mime) return c.json({ error: 'no logo' }, 404);
    return c.body(new Uint8Array(row.logo).buffer as ArrayBuffer, 200, {
      'content-type': row.mime,
      'cache-control': 'private, max-age=3600',
    });
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
      if (!partner)
        return { error: `no partner with code ${code}` as const, httpStatus: 400 as const };
      // The adapter registry would refuse this anyway; saying so is kinder than
      // a 500 from inside it.
      if (partner.agreementStatus !== 'sandbox' && partner.agreementStatus !== 'live') {
        return {
          error:
            `${partner.name} is not connectable yet — CCN's agreement with them is ${partner.agreementStatus}.` as const,
          httpStatus: 400 as const,
        };
      }

      const [existing] = await tx
        .select({ id: connectedAccounts.id, status: connectedAccounts.status })
        .from(connectedAccounts)
        .where(
          and(
            eq(connectedAccounts.userId, tenant.user.id),
            eq(connectedAccounts.partnerId, partner.id),
          ),
        )
        .limit(1);

      // A new link is a request, not a fait accompli. CCN does not own KYC —
      // the firm does — so nothing is read from them until an operator there has
      // reviewed the package CCN passes across and accepted this person as their
      // client (partner_review_client, 0014). Before that there is no
      // relationship to read through, and holdings pulled anyway would be a
      // firm's client data moved on nobody's authority.
      if (!existing) {
        const [row] = await tx
          .insert(connectedAccounts)
          .values({ userId: tenant.user.id, partnerId: partner.id, label: partner.name })
          .returning({ id: connectedAccounts.id });
        if (!row)
          return { error: 'the account was not connected' as const, httpStatus: 400 as const };
        await auditAppend(tx, {
          actorType: 'user',
          actorId: tenant.user.id,
          userId: tenant.user.id,
          partnerId: partner.id,
          action: 'connected_account.requested',
          entityType: 'connected_accounts',
          entityId: row.id,
          detail: { partner: partner.name, code },
        });
        return {
          accountId: row.id,
          partner: partner.name,
          status: 'pending' as const,
          holdings: 0,
          refreshed: false,
          created: true,
        };
      }

      const accountId = existing.id;
      if (existing.status === 'pending') {
        // Still waiting. Pressing the button again is not a second request,
        // and must not read as one.
        return {
          accountId,
          partner: partner.name,
          status: 'pending' as const,
          holdings: 0,
          refreshed: false,
          created: false,
        };
      }
      if (existing.status === 'declined') {
        return {
          error: `${partner.name} did not accept this account. Their compliance desk can tell you why.`,
          httpStatus: 409 as const,
        };
      }

      // Accepted: the partner's own view of what this client holds.
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
      // The first pull after the firm accepted this person is the link; every
      // one after it is a refresh. `existing` no longer tells them apart —
      // the connection is always already there by the time anything is pulled.
      const refreshed = mine.length > 0;

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
        action: refreshed ? 'connected_account.refreshed' : 'connected_account.linked',
        entityType: 'connected_accounts',
        entityId: accountId,
        detail: { partner: partner.name, code, holdings: pulled.length },
      });

      return {
        accountId,
        partner: partner.name,
        status: 'active' as const,
        holdings: pulled.length,
        refreshed,
        // The first pull after acceptance brings holdings into being; a refresh
        // updates what is already there.
        created: !refreshed && pulled.length > 0,
      };
    });

    if ('error' in result) return c.json({ error: result.error }, result.httpStatus);
    deps.logger.info('investor connected an account', {
      user: tenant.user.id,
      partner: code,
      status: result.status,
    });
    return c.json(result, result.created ? 201 : 200);
  });

  /**
   * "I've sent the money."
   *
   * Funding happens off-platform, and until now the moment between wiring and
   * the firm's confirmation was invisible to everyone: the investor stared at
   * an unchanged balance, and the desk did not know a wire was inbound. The
   * notice lands in the firm's EXISTING reconciliation queue — the same
   * human-review choke point statement lines flow through — so the desk sees
   * it beside its other unmatched lines, and Match is what credits the cash.
   * Nothing is credited on the investor's say-so.
   */
  app.post('/funding-notice', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const parsed = fundingNoticeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);
    const code = parsed.data.partnerCode.trim().toUpperCase();

    const result = await withTenant(deps, tenant, async (tx) => {
      const [account] = await tx
        .select({ id: connectedAccounts.id, partnerId: connectedAccounts.partnerId })
        .from(connectedAccounts)
        .innerJoin(partners, eq(partners.id, connectedAccounts.partnerId))
        .where(
          and(
            eq(connectedAccounts.userId, tenant.user.id),
            eq(partners.code, code),
            eq(connectedAccounts.status, 'active'),
          ),
        )
        .limit(1);
      if (!account) {
        return {
          error: `You don't hold an active account at ${code}, so there is nowhere to send money.`,
          httpStatus: 400 as const,
        };
      }
      const [item] = await tx
        .insert(reconciliationItems)
        .values({
          userId: tenant.user.id,
          partnerId: account.partnerId,
          source: 'investor_notice',
          raw: { declaredBy: 'investor', at: new Date().toISOString() },
          parsed: {
            name: 'Cash · client-declared funding',
            valueMinor: parsed.data.amountMinor.toString(),
            currency: parsed.data.currency,
          },
          status: 'pending',
        })
        .returning({ id: reconciliationItems.id });
      await auditAppend(tx, {
        actorType: 'user',
        actorId: tenant.user.id,
        userId: tenant.user.id,
        partnerId: account.partnerId,
        action: 'funding.declared',
        entityType: 'reconciliation_items',
        entityId: item?.id ?? null,
        detail: {
          amount_minor: parsed.data.amountMinor.toString(),
          currency: parsed.data.currency,
        },
      });
      return { ok: true as const };
    });
    if ('error' in result) return c.json({ error: result.error }, result.httpStatus);
    return c.json(result, 201);
  });

  /**
   * The investor asks their firm for money back. The guarded function checks
   * the account is theirs and active, the recorded cash covers it, and that no
   * request is already pending — and deducts nothing: cash falls when the firm
   * confirms it actually paid, mirroring how funding is confirmed inward.
   */
  app.post('/withdrawals', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const parsed = withdrawalRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);
    const code = parsed.data.partnerCode.trim().toUpperCase();

    try {
      const row = await withTenant(deps, tenant, async (tx) => {
        const [account] = await tx
          .select({ id: connectedAccounts.id })
          .from(connectedAccounts)
          .innerJoin(partners, eq(partners.id, connectedAccounts.partnerId))
          .where(and(eq(connectedAccounts.userId, tenant.user.id), eq(partners.code, code)))
          .limit(1);
        if (!account) throw new WithdrawalRefused(`You don't hold an account at ${code}.`);
        return requestWithdrawal(tx, {
          accountId: account.id,
          amountMinor: parsed.data.amountMinor,
          currency: parsed.data.currency,
        });
      });
      deps.logger.info('investor requested a withdrawal', {
        user: tenant.user.id,
        partner: code,
      });
      return c.json({ withdrawal: row }, 201);
    } catch (err) {
      if (err instanceof WithdrawalRefused) return c.json({ error: err.message }, 400);
      if (raisedBy(err, 'insufficient recorded cash')) {
        return c.json(
          {
            error:
              'Your recorded cash at this firm does not cover that amount. If you have funded recently, it may not be confirmed yet.',
          },
          409,
        );
      }
      if (raisedBy(err, 'already pending')) {
        return c.json(
          { error: 'A withdrawal is already pending on this account. The firm decides it first.' },
          409,
        );
      }
      if (raisedBy(err, 'not active')) {
        return c.json({ error: 'This account is not active, so nothing can be withdrawn.' }, 409);
      }
      if (raisedBy(err, 'would consume this withdrawal')) {
        return c.json(
          {
            error:
              "The firm's charges would consume this amount entirely. Withdraw more, or contact the firm.",
          },
          409,
        );
      }
      throw err;
    }
  });

  app.get('/', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);

    const requested = c.req.query('currency');
    const asked: Currency =
      requested && (CURRENCIES as readonly string[]).includes(requested)
        ? (requested as Currency)
        : 'USD';

    const { rows, connections, fx, withdrawals } = await withTenant(deps, tenant, async (tx) => ({
      /**
       * The rates the region's central banks published, not the constants in
       * @ccn/money. Read inside the same transaction as the holdings so a
       * refresh landing mid-request cannot value one partner's line at today's
       * rate and another's at yesterday's.
       */
      fx: await loadFxTable(tx),
      rows: await tx
        .select({
          partnerCode: partners.code,
          partnerName: partners.name,
          partnerKind: partners.kind,
          partnerRegulator: partners.regulator,
          partnerFunding: partners.fundingInstructions,
          // The firm's withdrawal charges, so the Withdraw dialog can show a
          // client the net they would receive BEFORE they ask (0026).
          partnerFeeFlatMinor: partners.withdrawalFeeFlatMinor,
          partnerFeeBps: partners.withdrawalFeeBps,
          partnerGctBps: partners.gctBps,
          holdingName: holdings.name,
          valueMinor: holdings.valueMinor,
          holdingCurrency: holdings.currency,
          // Null = not matched to a catalogue instrument. Cash — money the firm
          // confirmed settled, waiting to be invested — is exactly this shape.
          instrumentId: holdings.instrumentId,
          ret: holdings.returnLabel,
          instrumentType: instruments.type,
          // When this balance was last pulled from the partner. The column has
          // always been written on every refresh and never read, so no screen
          // could say how old the figure it was showing actually was.
          updatedAt: holdings.updatedAt,
        })
        .from(holdings)
        .leftJoin(connectedAccounts, eq(holdings.connectedAccountId, connectedAccounts.id))
        .leftJoin(partners, eq(connectedAccounts.partnerId, partners.id))
        .leftJoin(instruments, eq(holdings.instrumentId, instruments.id))
        .where(eq(holdings.userId, tenant.user.id)),
      /**
       * Every link this person has, whatever its standing — because the ones
       * that matter most to them hold nothing yet. A connection awaiting the
       * firm's decision, or refused by it, produces no holdings and would
       * otherwise be invisible on the screen where they went looking for it.
       */
      connections: await tx
        .select({
          code: partners.code,
          name: partners.name,
          status: connectedAccounts.status,
          requestedAt: connectedAccounts.createdAt,
          declineReason: connectedAccounts.declineReason,
        })
        .from(connectedAccounts)
        .innerJoin(partners, eq(connectedAccounts.partnerId, partners.id))
        .where(eq(connectedAccounts.userId, tenant.user.id))
        .orderBy(connectedAccounts.createdAt),
      /**
       * Money on its way out. The pending one gates the card's Withdraw button
       * (one open request per account); the decided ones carry the firm's
       * reference or its reason, which is the investor's record of what
       * happened to their money.
       */
      withdrawals: await tx
        .select({
          id: withdrawalRequests.id,
          partnerCode: partners.code,
          amountMinor: withdrawalRequests.amountMinor,
          feeMinor: withdrawalRequests.feeMinor,
          gctMinor: withdrawalRequests.gctMinor,
          currency: withdrawalRequests.currency,
          status: withdrawalRequests.status,
          reason: withdrawalRequests.reason,
          reference: withdrawalRequests.reference,
          createdAt: withdrawalRequests.createdAt,
          decidedAt: withdrawalRequests.decidedAt,
        })
        .from(withdrawalRequests)
        .innerJoin(partners, eq(partners.id, withdrawalRequests.partnerId))
        .where(eq(withdrawalRequests.userId, tenant.user.id))
        .orderBy(desc(withdrawalRequests.createdAt))
        .limit(10),
    }));

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
        fundingInstructions: string | null;
        withdrawalFeeFlatMinor: bigint;
        withdrawalFeeBps: number;
        gctBps: number;
        totalMinor: bigint;
        /** Uninvested money at this firm — holdings with no instrument. */
        cashMinor: bigint;
        holdings: unknown[];
        /** The oldest `updated_at` on this card's holdings — see below. */
        updatedAt: Date | null;
      }
    >();
    // Allocation by asset class, derived from each holding's instrument type.
    /**
     * The currency actually used, which is not always the one asked for.
     *
     * When the rate table cannot be read — this database behind the code, no
     * `as_of` column — converting would mean picking a number nobody published.
     * Serving the base currency instead is the one answer that cannot be wrong,
     * and the response says which currency was requested so the screen can
     * explain itself rather than silently showing different units.
     */
    const wanted = fx.rates.find((r) => r.currency === asked);
    const display: Currency = wanted?.unavailable ? 'USD' : asked;

    // `holdings.instrumentId` is nullable (an ingested statement line may not
    // have been matched to a catalogue instrument yet), so those fall into
    // `other` rather than being silently dropped from the denominator.
    const byClass = new Map<string, bigint>();
    let netWorthMinor = 0n;
    for (const r of rows) {
      // A holding is stored in its own currency — a firm settles a GYD wire in
      // GYD. Everything aggregates in USD minor units, converted per line, so
      // one JMD money-market line no longer counts as 157× itself.
      const usdMinor = convert(money(r.valueMinor, r.holdingCurrency), 'USD', fx.table).minor;
      netWorthMinor += usdMinor;
      const cls = r.instrumentType ?? 'other';
      byClass.set(cls, (byClass.get(cls) ?? 0n) + usdMinor);
      const key = r.partnerCode ?? 'UNKNOWN';
      const group = groups.get(key) ?? {
        code: key,
        name: r.partnerName ?? 'Unlinked',
        kind: r.partnerKind ?? null,
        regulator: r.partnerRegulator ?? null,
        fundingInstructions: r.partnerFunding ?? null,
        withdrawalFeeFlatMinor: r.partnerFeeFlatMinor ?? 0n,
        withdrawalFeeBps: r.partnerFeeBps ?? 0,
        gctBps: r.partnerGctBps ?? 0,
        totalMinor: 0n,
        cashMinor: 0n,
        holdings: [],
        updatedAt: null,
      };
      group.totalMinor += usdMinor;
      if (r.instrumentId === null) group.cashMinor += usdMinor;
      // The oldest line decides what the card can claim: a partner card is only
      // as current as its least recently refreshed holding.
      if (r.updatedAt && (!group.updatedAt || r.updatedAt < group.updatedAt)) {
        group.updatedAt = r.updatedAt;
      }
      group.holdings.push({
        name: r.holdingName,
        value: formatMoney(convert(money(r.valueMinor, r.holdingCurrency), display, fx.table)),
        ret: r.ret,
      });
      groups.set(key, group);
    }

    const netWorth = convert(money(netWorthMinor, 'USD'), display, fx.table);
    // Percentages are of net worth, computed in minor units (integer maths, no
    // float drift) and rounded to one decimal. They will not always sum to
    // exactly 100 — that is rounding, not a missing slice, so the UI must not
    // present the remainder as an unallocated bucket.
    const allocation = [...byClass.entries()]
      .sort(([, a], [, b]) => (b > a ? 1 : b < a ? -1 : 0))
      .map(([type, valueMinor]) => ({
        type,
        label: ASSET_CLASS_LABELS[type] ?? 'Other',
        value: formatMoney(convert(money(valueMinor, 'USD'), display, fx.table)),
        valueMinor: valueMinor.toString(),
        pct:
          netWorthMinor === 0n
            ? 0
            : Math.round((Number(valueMinor) / Number(netWorthMinor)) * 1000) / 10,
      }));

    return c.json({
      currency: display,
      /**
       * Which bank published the rate this screen converted at, and when. A
       * converted figure without them is a number the reader has no way to
       * date, which is how the hardcoded table went unnoticed for months.
       */
      /** Null only if the currency list and the rate list ever disagree. */
      fx: fx.rates.find((r) => r.currency === display) ?? null,
      /**
       * Set when the caller asked for a currency that could not be converted to.
       * The figures above are in `currency`, not in this one.
       */
      requestedCurrency: display === asked ? null : asked,
      netWorth: formatMoney(netWorth),
      netWorthMinor: netWorth.minor.toString(),
      allocation,
      connections,
      withdrawals: withdrawals.map((w) => {
        const netMinor = w.amountMinor - w.feeMinor - w.gctMinor;
        // Charges and the net render to the cent: "US$983" for a payment whose
        // record says 982.75 would misstate the one figure this rail exists to
        // state accurately. The gross keeps the screen-wide whole-unit style.
        const exact = { minorDigits: 2 as const };
        return {
          ...w,
          amountMinor: w.amountMinor.toString(),
          amount: formatMoney(money(w.amountMinor, w.currency as Currency)),
          feeMinor: w.feeMinor.toString(),
          fee:
            w.feeMinor > 0n ? formatMoney(money(w.feeMinor, w.currency as Currency), exact) : null,
          gctMinor: w.gctMinor.toString(),
          gct:
            w.gctMinor > 0n ? formatMoney(money(w.gctMinor, w.currency as Currency), exact) : null,
          /** What actually reaches the client after the firm's charges. */
          net: formatMoney(money(netMinor, w.currency as Currency), exact),
        };
      }),
      partners: [...groups.values()].map((g) => ({
        code: g.code,
        name: g.name,
        kind: g.kind,
        regulator: g.regulator,
        fundingInstructions: g.fundingInstructions,
        /**
         * The firm's withdrawal charges as raw settings, so the dialog can
         * compute a live estimate as the person types. Formatting a single
         * figure here would pin the estimate to one amount.
         */
        withdrawalFeeFlatMinor: g.withdrawalFeeFlatMinor.toString(),
        withdrawalFeeBps: g.withdrawalFeeBps,
        gctBps: g.gctBps,
        total: formatMoney(convert(money(g.totalMinor, 'USD'), display, fx.table)),
        /**
         * The uninvested balance at this firm, distinct from the total: an
         * investor's "balance" is per partner — money settled with NCB is not
         * spendable at Sagicor — while the header's net worth is the sum of
         * everything everywhere. Null when this firm holds no cash line at all,
         * which renders differently from a zero balance.
         */
        cash:
          g.cashMinor > 0n
            ? formatMoney(convert(money(g.cashMinor, 'USD'), display, fx.table))
            : null,
        asOf: g.updatedAt ? g.updatedAt.toISOString() : null,
        holdings: g.holdings,
      })),
    });
  });

  return app;
}
