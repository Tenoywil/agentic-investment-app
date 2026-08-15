import {
  approvals,
  auditLog,
  holdings,
  instruments,
  kycStatus,
  orders,
  partners,
  seedReferenceData,
  user,
  userProfiles,
  userRoles,
} from '@ccn/db';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../context';
import { withTenant } from '../context';
import { auditAppend } from '../db-fns';
import { MIGRATION_PENDING, isDatabaseBehind } from '../migrations';
import { createOutboundGuard } from '../security';
import { refreshFxRates } from '../services/fx';

/**
 * Administration: one read across the whole network.
 *
 * Every other surface is scoped to a tenant by row-level security — an investor
 * sees their own rows, an operator sees their partner's — which is correct, and
 * is also why there was no way to run the business. Answering "who is stuck in
 * onboarding", "what is this partner actually offering" or "what changed today"
 * meant opening a SQL client against production.
 *
 * **Read-only, enforced by the database.** 0008_admin_read.sql grants `admin`
 * SELECT and nothing else, so a handler here that tried to write across tenants
 * would be refused by Postgres rather than by a code review. Everything that
 * changes state keeps going through the choke points the product already has —
 * `create_order`, `accept_order`, `settle_order`, the limits engine, the
 * approval loop — so an administrative screen can never become a second,
 * unaudited way to move money.
 *
 * Counts are computed in SQL rather than by loading rows and measuring the
 * array, because this is the one surface whose queries are unbounded by a
 * tenant and the difference is the whole table.
 *
 * The one write: a person's roles. 0009_admin_role_writes.sql opens
 * `user_roles` and nothing else, and refuses `admin` at the policy — the only
 * route to becoming an administrator stays the ADMIN_EMAILS environment
 * variable, so a compromised admin account cannot promote a second one. Every
 * change goes through `audit_append`, which is append-only by trigger.
 *
 * What is deliberately absent: subscriptions and billing. There is no such
 * table in this schema, and inventing a figure on an administrative screen —
 * where it would be read as the authoritative one — is the exact failure this
 * product has already had once.
 */
export function adminRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** Run a write, and turn "the database is behind" into a sentence. */
  async function attempt<T>(work: () => Promise<T>): Promise<{ ok: T } | { pending: true }> {
    try {
      return { ok: await work() };
    } catch (err) {
      if (!isDatabaseBehind(err)) throw err;
      deps.logger.error('an administration write was refused: this database is behind', {
        error: err instanceof Error ? err.message : String(err),
      });
      return { pending: true };
    }
  }

  /** The shape of the network in one request. */
  app.get('/overview', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);

    const data = await withTenant(deps, tenant, async (tx) => {
      /**
       * `total` is people; the other three are roles held.
       *
       * The screen used to print the `customer` role count under the word
       * "Investors" while the tab beside it listed every person on the network —
       * two numbers, the same noun, nine apart. They differ for an ordinary
       * reason: roles are granted lazily on a user's first authenticated
       * request, so somebody who has signed up and not come back yet holds no
       * role row at all. Counting people and counting roles are both worth
       * knowing; calling them the same thing is what was wrong.
       *
       * `count(distinct user_id)` on the roles, not `count(*)`: one person may
       * hold the same role at two partners.
       */
      const [roleCounts] = (await tx.execute(sql`
        select
          (select count(*) from "user")                                       as total,
          count(distinct user_id) filter (where role = 'customer')            as customers,
          count(distinct user_id) filter (where role = 'partner_operator')    as operators,
          count(distinct user_id) filter (where role = 'admin')               as admins
        from user_roles
      `)) as unknown as [{ total: string; customers: string; operators: string; admins: string }];

      const [orderCounts] = (await tx.execute(sql`
        select
          count(*)                                    as total,
          count(*) filter (where status = 'created')  as created,
          count(*) filter (where status = 'accepted') as accepted,
          count(*) filter (where status = 'settled')  as settled,
          count(*) filter (where status = 'rejected') as rejected
        from orders
      `)) as unknown as [Record<string, string>];

      const [onboarding] = (await tx.execute(sql`
        select
          count(*)                                       as profiles,
          count(*) filter (where tier = 'none')          as tier_none,
          count(*) filter (where tier = 'tier1')         as tier1,
          count(*) filter (where tier = 'tier2')         as tier2
        from kyc_status
      `)) as unknown as [Record<string, string>];

      const [partnerRow] = (await tx.execute(sql`
        select
          count(*)                                          as total,
          count(*) filter (where agreement_status = 'live')  as live,
          count(*) filter (where agreement_status = 'sandbox') as sandbox
        from partners
      `)) as unknown as [Record<string, string>];

      /**
       * `instruments` — the table the marketplace reads and the console writes
       * — not `product_listings`. That table has had no writer since 0017, so
       * this count was frozen at the prototype rows while every product a firm
       * actually listed was invisible to the person running the network.
       */
      const [productRow] = (await tx.execute(sql`
        select
          count(*)                                        as total,
          count(*) filter (where listing_status = 'live')   as live,
          count(*) filter (where listing_status = 'paused') as paused
        from instruments
      `)) as unknown as [{ total: string; live: string; paused: string }];

      const [approvalRow] = (await tx.execute(
        sql`select count(*) filter (where status = 'pending') as pending from approvals`,
      )) as unknown as [{ pending: string }];

      return { roleCounts, orderCounts, onboarding, partnerRow, productRow, approvalRow };
    });

    const n = (v: unknown) => Number(v ?? 0);
    return c.json({
      people: {
        total: n(data.roleCounts?.total),
        customers: n(data.roleCounts?.customers),
        operators: n(data.roleCounts?.operators),
        admins: n(data.roleCounts?.admins),
      },
      onboarding: {
        started: n(data.onboarding?.profiles),
        tierNone: n(data.onboarding?.tier_none),
        tier1: n(data.onboarding?.tier1),
        tier2: n(data.onboarding?.tier2),
      },
      partners: {
        total: n(data.partnerRow?.total),
        live: n(data.partnerRow?.live),
        sandbox: n(data.partnerRow?.sandbox),
      },
      products: {
        total: n(data.productRow?.total),
        live: n(data.productRow?.live),
        paused: n(data.productRow?.paused),
      },
      orders: {
        total: n(data.orderCounts?.total),
        created: n(data.orderCounts?.created),
        accepted: n(data.orderCounts?.accepted),
        settled: n(data.orderCounts?.settled),
        rejected: n(data.orderCounts?.rejected),
      },
      approvals: { pending: n(data.approvalRow?.pending) },
    });
  });

  /**
   * Everyone on the network, with the two things an administrator is asked
   * about: how far through onboarding they are, and what they hold.
   */
  app.get('/investors', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
    /**
     * Search, because a list capped at 500 with no way to narrow it is not a
     * way to find a person — it is a way to scroll past them. Matched on the
     * two things an administrator is actually handed: a name or an email.
     */
    const q = (c.req.query('q') ?? '').trim();

    /**
     * People first, roles second — two queries rather than one join with a
     * LIMIT on it. The join fans out one row per role held, so the limit was
     * counting rows and not people: a handful of operators bound to two
     * partners each would silently push real people off the end of a list whose
     * whole purpose is to be complete.
     */
    const { people, roles } = await withTenant(deps, tenant, async (tx) => {
      const found = await tx
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          createdAt: user.createdAt,
          kycTier: kycStatus.tier,
          identityVerified: kycStatus.identityVerified,
          complianceConfirmed: kycStatus.complianceConfirmed,
          riskCompleted: kycStatus.riskCompleted,
          fundsConfirmed: kycStatus.fundsConfirmed,
          residency: userProfiles.residencyCountry,
        })
        .from(user)
        .leftJoin(kycStatus, eq(kycStatus.userId, user.id))
        .leftJoin(userProfiles, eq(userProfiles.userId, user.id))
        .where(q ? or(ilike(user.name, `%${q}%`), ilike(user.email, `%${q}%`)) : undefined)
        .orderBy(desc(user.createdAt))
        .limit(limit);
      const ids = found.map((p) => p.id);
      return {
        people: found,
        roles: ids.length
          ? await tx
              .select({
                userId: userRoles.userId,
                role: userRoles.role,
                partnerId: userRoles.partnerId,
                // The firm's code, so an operator row can say "SAG" rather
                // than a uuid nobody can act on.
                partnerCode: partners.code,
              })
              .from(userRoles)
              .leftJoin(partners, eq(partners.id, userRoles.partnerId))
              .where(inArray(userRoles.userId, ids))
          : [],
      };
    });

    const held = new Map<
      string,
      { roles: string[]; partnerId: string | null; partnerCode: string | null }
    >();
    for (const r of roles) {
      const entry = held.get(r.userId) ?? { roles: [], partnerId: null, partnerCode: null };
      if (!entry.roles.includes(r.role)) entry.roles.push(r.role);
      entry.partnerId = entry.partnerId ?? r.partnerId;
      entry.partnerCode = entry.partnerCode ?? r.partnerCode;
      held.set(r.userId, entry);
    }

    return c.json({
      investors: people.map((p) => ({
        ...p,
        roles: held.get(p.id)?.roles ?? [],
        partnerId: held.get(p.id)?.partnerId ?? null,
        partnerCode: held.get(p.id)?.partnerCode ?? null,
      })),
    });
  });

  /** Every partner, and what each is actually offering. */
  app.get('/partners', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);

    const rows = await withTenant(deps, tenant, async (tx) => {
      const list = await tx.select().from(partners).orderBy(partners.name);
      // Products from `instruments` — what the marketplace offers and the
      // console writes — not the prototype's product_listings table.
      const counts = (await tx.execute(sql`
        select p.id::text as partner_id,
               count(distinct i.id) as products,
               count(distinct o.id)  as orders
          from partners p
          left join instruments i on i.partner_id = p.id
          left join orders o on o.partner_id = p.id
         group by p.id
      `)) as unknown as Array<{ partner_id: string; products: string; orders: string }>;
      const byPartner = new Map(counts.map((r) => [r.partner_id, r]));
      return list.map((p) => ({
        ...p,
        products: Number(byPartner.get(p.id)?.products ?? 0),
        orders: Number(byPartner.get(p.id)?.orders ?? 0),
      }));
    });
    return c.json({ partners: rows });
  });

  /**
   * Onboarding a partner, and keeping its record right afterwards.
   *
   * This is the most ordinary commercial event the company has, and until
   * 0011 it was impossible without an engineer: `partners.code` was an enum of
   * eight institutions, so a ninth needed a migration and a deploy. The list of
   * licensed institutions CCN routes to is the business, not a schema constant.
   *
   * Two closed sets stay closed, because they are genuinely closed and both are
   * load-bearing. `regulator` is the three CCN is licensed under. And
   * `agreement_status` is the gate on live order routing — the adapter registry
   * refuses `placeOrder` unless a partner is `live` with trade scope — so a
   * partner with a misspelled status would silently never trade.
   *
   * A code is an identity, not a field: it is written into audit rows and read
   * back by operators, so it is set once at onboarding and never edited. Change
   * the name, the regulator, the agreement — not who this is.
   */
  const REGULATORS = ['FSC_JAMAICA', 'FSC_BARBADOS', 'FSC_TRINIDAD_TOBAGO'] as const;
  const AGREEMENTS = ['prospect', 'dpa_pending', 'sandbox', 'live', 'suspended'] as const;
  /** Mirrors the CHECK constraint in 0011, so the caller gets a reason not a 500. */
  const CODE_SHAPE = /^[A-Z][A-Z0-9]{1,11}$/;

  type PartnerFields = {
    name: string;
    kind: string | null;
    regulator: (typeof REGULATORS)[number] | null;
    agreementStatus: (typeof AGREEMENTS)[number];
    residency: string | null;
  };

  function readPartnerBody(
    body: unknown,
    { withCode }: { withCode: boolean },
  ): ({ code?: string } & PartnerFields) | { bad: string } {
    if (typeof body !== 'object' || body === null) return { bad: 'a JSON body is required' };
    const b = body as Record<string, unknown>;
    const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

    const name = str(b.name);
    if (name.length < 2) return { bad: 'a partner needs a name' };
    if (name.length > 120) return { bad: 'that name is too long' };

    const regulator = str(b.regulator);
    if (regulator && !(REGULATORS as readonly string[]).includes(regulator)) {
      return { bad: `regulator must be one of ${REGULATORS.join(', ')}` };
    }
    const agreement = str(b.agreementStatus) || 'prospect';
    if (!(AGREEMENTS as readonly string[]).includes(agreement)) {
      return { bad: `agreementStatus must be one of ${AGREEMENTS.join(', ')}` };
    }

    const fields: PartnerFields = {
      name,
      kind: str(b.kind) || null,
      regulator: (regulator || null) as PartnerFields['regulator'],
      agreementStatus: agreement as PartnerFields['agreementStatus'],
      residency: str(b.residency) || null,
    };
    if (!withCode) return fields;

    const code = str(b.code).toUpperCase();
    if (!CODE_SHAPE.test(code)) {
      return {
        bad: 'a code is 2 to 12 characters, uppercase letters and digits, starting with a letter — like SAG or JMMB',
      };
    }
    return { code, ...fields };
  }

  app.post('/partners', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);

    const parsed = readPartnerBody(await c.req.json().catch(() => null), { withCode: true });
    if ('bad' in parsed) return c.json({ error: parsed.bad }, 400);
    const { code, ...fields } = parsed as { code: string } & PartnerFields;

    const attempted = await attempt(() =>
      withTenant(deps, tenant, async (tx) => {
        const [clash] = await tx
          .select({ id: partners.id, name: partners.name })
          .from(partners)
          .where(eq(partners.code, code))
          .limit(1);
        if (clash) return { error: `${code} is already ${clash.name}` as const };

        const [row] = await tx
          .insert(partners)
          .values({ code, ...fields })
          .returning();
        if (!row) return { error: 'the partner was not created' as const };

        await auditAppend(tx, {
          actorType: 'user',
          actorId: tenant.user.id,
          userId: tenant.user.id,
          partnerId: row.id,
          action: 'partner.onboarded',
          entityType: 'partners',
          entityId: row.id,
          detail: { code, ...fields, by: tenant.user.email },
        });
        return { partner: row };
      }),
    );
    if ('pending' in attempted) return c.json({ error: MIGRATION_PENDING }, 503);
    const result = attempted.ok;

    if ('error' in result) return c.json({ error: result.error }, 400);
    deps.logger.info('administrator onboarded a partner', { actor: tenant.user.id, code });
    return c.json({ partner: { ...result.partner, products: 0, orders: 0 } }, 201);
  });

  /** Correct a partner's record. Everything but its code, which is its identity. */
  app.put('/partners/:id', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const id = c.req.param('id');

    const parsed = readPartnerBody(await c.req.json().catch(() => null), { withCode: false });
    if ('bad' in parsed) return c.json({ error: parsed.bad }, 400);
    const fields = parsed as PartnerFields;

    const attempted = await attempt(() =>
      withTenant(deps, tenant, async (tx) => {
        const [before] = await tx.select().from(partners).where(eq(partners.id, id)).limit(1);
        if (!before) return { error: 'not found' as const, status: 404 as const };

        const [row] = await tx.update(partners).set(fields).where(eq(partners.id, id)).returning();
        if (!row) return { error: 'the partner was not updated' as const, status: 400 as const };

        await auditAppend(tx, {
          actorType: 'user',
          actorId: tenant.user.id,
          userId: tenant.user.id,
          partnerId: row.id,
          action: 'partner.changed',
          entityType: 'partners',
          entityId: row.id,
          detail: {
            code: row.code,
            // The agreement gates live order routing, so a change to it is the
            // one thing someone reading this trail will be looking for.
            agreementStatus: { from: before.agreementStatus, to: row.agreementStatus },
            name: { from: before.name, to: row.name },
            by: tenant.user.email,
          },
        });
        return { partner: row };
      }),
    );
    if ('pending' in attempted) return c.json({ error: MIGRATION_PENDING }, 503);
    const result = attempted.ok;

    if ('error' in result) return c.json({ error: result.error }, result.status);
    return c.json({ partner: result.partner });
  });

  /**
   * Everything the marketplace offers, across every partner.
   *
   * Read from `instruments` — the table investors see and the console writes —
   * with the fields a takedown decision needs: whose it is, whether it is
   * live, and what it claims. The old version read `product_listings`, which
   * nothing has written since 0017, so an administrator was reviewing a
   * catalogue frozen at the prototype while the real one changed underneath.
   */
  app.get('/products', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);

    const rows = await withTenant(deps, tenant, (tx) =>
      tx
        .select({
          id: instruments.id,
          name: instruments.name,
          type: instruments.type,
          status: instruments.listingStatus,
          blocked: instruments.blocked,
          risk: instruments.risk,
          metric: instruments.metric,
          metricLabel: instruments.metricLabel,
          minInvestmentMinor: instruments.minInvestmentMinor,
          currency: instruments.currency,
          updatedAt: instruments.updatedAt,
          partnerId: instruments.partnerId,
          partnerName: partners.name,
          partnerCode: partners.code,
        })
        .from(instruments)
        .leftJoin(partners, eq(partners.id, instruments.partnerId))
        .orderBy(partners.name, instruments.name),
    );
    return c.json({
      products: rows.map((r) => ({ ...r, minInvestmentMinor: String(r.minInvestmentMinor) })),
    });
  });

  /**
   * Take a listing off the marketplace, or put it back — the network's
   * takedown control.
   *
   * A firm can pause its own product; until 0022 nobody else could, so a
   * listing flagged by a regulator or listed in error could only be withdrawn
   * with SQL against production. The write is the admin's own, through the
   * `instruments_admin_correct` policy, flips `listing_status` and nothing
   * else, and is audited with who did it — the pause gates the marketplace
   * query and both order paths, exactly as the firm's own switch does.
   */
  app.post('/products/:id/toggle', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const id = c.req.param('id');

    const attempted = await attempt(() =>
      withTenant(deps, tenant, async (tx) => {
        const [before] = await tx
          .select({ id: instruments.id, name: instruments.name, status: instruments.listingStatus })
          .from(instruments)
          .where(eq(instruments.id, id))
          .limit(1);
        if (!before) return { error: 'not found' as const, httpStatus: 404 as const };

        const next = before.status === 'live' ? ('paused' as const) : ('live' as const);
        const [row] = await tx
          .update(instruments)
          .set({ listingStatus: next, updatedAt: new Date() })
          .where(eq(instruments.id, id))
          .returning({ status: instruments.listingStatus });
        if (!row) {
          return { error: 'the listing was not changed' as const, httpStatus: 400 as const };
        }

        await auditAppend(tx, {
          actorType: 'user',
          actorId: tenant.user.id,
          userId: tenant.user.id,
          partnerId: null,
          action: next === 'paused' ? 'instrument.paused' : 'instrument.live',
          entityType: 'instruments',
          entityId: id,
          detail: { name: before.name, from: before.status, to: next, by: tenant.user.email },
        });
        return { status: row.status };
      }),
    );
    if ('pending' in attempted) return c.json({ error: MIGRATION_PENDING }, 503);
    const result = attempted.ok;
    if ('error' in result) return c.json({ error: result.error }, result.httpStatus);
    deps.logger.info('administrator toggled a listing', { actor: tenant.user.id, id });
    return c.json(result);
  });

  /** Recent orders across every partner, named by product, filterable by state. */
  app.get('/orders', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
    const wanted = c.req.query('status');
    const STATUSES = ['created', 'accepted', 'settled', 'rejected', 'expired'] as const;
    const status = (STATUSES as readonly string[]).includes(wanted ?? '')
      ? (wanted as (typeof STATUSES)[number])
      : null;

    const rows = await withTenant(deps, tenant, (tx) =>
      tx
        .select({
          id: orders.id,
          status: orders.status,
          amountMinor: orders.amountMinor,
          currency: orders.currency,
          createdAt: orders.createdAt,
          partnerName: partners.name,
          investorEmail: user.email,
          // The product, so a row reads "GOJ 2032 · US$5,000" and not a pair
          // of uuids. LEFT, because an order may carry no instrument.
          instrumentName: instruments.name,
        })
        .from(orders)
        .leftJoin(partners, eq(partners.id, orders.partnerId))
        .leftJoin(user, eq(user.id, orders.userId))
        .leftJoin(instruments, eq(instruments.id, orders.instrumentId))
        .where(status ? eq(orders.status, status) : undefined)
        .orderBy(desc(orders.createdAt))
        .limit(limit),
    );
    // Minor units as strings: an amount is not a float, and JSON has no other
    // integer wide enough to promise it survives the trip.
    return c.json({
      orders: rows.map((o) => ({ ...o, amountMinor: String(o.amountMinor) })),
    });
  });

  /** What changed, newest first. The table is append-only by trigger. */
  app.get('/audit', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);

    const rows = await withTenant(deps, tenant, (tx) =>
      tx
        .select({
          id: auditLog.id,
          seq: auditLog.seq,
          action: auditLog.action,
          entityType: auditLog.entityType,
          entityId: auditLog.entityId,
          actorType: auditLog.actorType,
          // Who it concerned and what the writer recorded — the two halves
          // that turn "user_roles.changed" into an answerable question.
          subjectEmail: user.email,
          detail: auditLog.detail,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .leftJoin(user, eq(user.id, auditLog.userId))
        .orderBy(desc(auditLog.seq))
        .limit(limit),
    );
    return c.json({ entries: rows.map((r) => ({ ...r, seq: String(r.seq) })) });
  });

  /** One person, in full: what they hold and what is waiting on them. */
  app.get('/investors/:id', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const id = c.req.param('id');

    const data = await withTenant(deps, tenant, async (tx) => {
      const [person] = await tx.select().from(user).where(eq(user.id, id)).limit(1);
      if (!person) return null;
      const roles = await tx.select().from(userRoles).where(eq(userRoles.userId, id));
      const [kyc] = await tx.select().from(kycStatus).where(eq(kycStatus.userId, id)).limit(1);
      const [profile] = await tx
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, id))
        .limit(1);
      const held = await tx.select().from(holdings).where(eq(holdings.userId, id));
      const waiting = await tx.select().from(approvals).where(eq(approvals.userId, id));
      return { person, roles, kyc, profile, held, waiting };
    });

    if (!data) return c.json({ error: 'not found' }, 404);
    return c.json({
      user: { id: data.person.id, name: data.person.name, email: data.person.email },
      roles: data.roles.map((r) => ({ role: r.role, partnerId: r.partnerId })),
      kyc: data.kyc ?? null,
      profile: data.profile ?? null,
      // Minor units as strings for the same reason the order amounts are.
      holdings: data.held.map((h) => ({
        id: h.id,
        name: h.name,
        valueMinor: String(h.valueMinor),
        currency: h.currency,
      })),
      approvals: data.waiting.map((a) => ({
        id: a.id,
        type: a.type,
        title: a.title,
        status: a.status,
        createdAt: a.createdAt,
      })),
    });
  });

  /**
   * Set a person's roles.
   *
   * A whole-set PUT rather than add/remove verbs: roles decide which product
   * someone sees, and "make this person an operator for JMMB" is one intention,
   * not two edits with a window in between where they hold both surfaces or
   * neither.
   *
   * Three refusals before any SQL runs. The database enforces the first two as
   * well (see the migration), and the API states them so the caller gets a
   * reason rather than a constraint violation:
   *
   *  - `admin` may not be granted or revoked here, ever.
   *  - An administrator may not edit their own roles.
   *  - `partner_operator` requires a partner that exists; an unbound operator
   *    resolves to the customer surface and would look like the grant silently
   *    failed.
   */
  /** Roles an administrator may assign. `admin` is absent on purpose. */
  const ASSIGNABLE = ['customer', 'partner_operator', 'compliance', 'analyst'] as const;
  type Assignable = (typeof ASSIGNABLE)[number];

  function readRolesBody(
    body: unknown,
  ): { roles: Assignable[]; partnerCode?: string } | { bad: string } {
    if (typeof body !== 'object' || body === null) return { bad: 'a JSON body is required' };
    const b = body as { roles?: unknown; partnerCode?: unknown };
    if (!Array.isArray(b.roles)) return { bad: 'roles must be an array' };
    const roles: Assignable[] = [];
    for (const r of b.roles) {
      if (typeof r !== 'string' || !(ASSIGNABLE as readonly string[]).includes(r)) {
        return {
          bad: `roles may only contain ${ASSIGNABLE.join(', ')} — admin is granted by ADMIN_EMAILS alone`,
        };
      }
      if (!roles.includes(r as Assignable)) roles.push(r as Assignable);
    }
    const code = typeof b.partnerCode === 'string' ? b.partnerCode.trim() : undefined;
    return code ? { roles, partnerCode: code } : { roles };
  }

  app.put('/investors/:id/roles', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const targetId = c.req.param('id');

    if (targetId === tenant.user.id) {
      return c.json({ error: 'an administrator cannot change their own roles' }, 400);
    }
    const parsed = readRolesBody(await c.req.json().catch(() => null));
    if ('bad' in parsed) return c.json({ error: parsed.bad }, 400);
    const wanted = parsed.roles;
    const needsPartner = wanted.includes('partner_operator');

    const attempted = await attempt(() =>
      withTenant(deps, tenant, async (tx) => {
        const [target] = await tx
          .select({ id: user.id, email: user.email })
          .from(user)
          .where(eq(user.id, targetId))
          .limit(1);
        if (!target) return { error: 'not found' as const, status: 404 as const };

        let partnerId: string | null = null;
        if (needsPartner) {
          const code = parsed.partnerCode?.toUpperCase();
          if (!code)
            return { error: 'partner_operator needs a partnerCode' as const, status: 400 as const };
          const [p] = await tx
            .select({ id: partners.id })
            .from(partners)
            .where(eq(partners.code, code))
            .limit(1);
          if (!p) return { error: `no partner with code ${code}` as const, status: 400 as const };
          partnerId = p.id;
        }

        const before = await tx
          .select({ role: userRoles.role, partnerId: userRoles.partnerId })
          .from(userRoles)
          .where(eq(userRoles.userId, targetId));

        // `admin` is never touched from here, in either direction: it is filtered
        // out of what may be removed as well as what may be added, so an
        // administrator's own grant survives an edit to their other roles.
        for (const row of before) {
          if (row.role === 'admin') continue;
          if (wanted.includes(row.role as Assignable)) continue;
          await tx
            .delete(userRoles)
            .where(and(eq(userRoles.userId, targetId), eq(userRoles.role, row.role)));
        }
        for (const role of wanted) {
          const existing = before.find((r) => r.role === role);
          if (existing && (role !== 'partner_operator' || existing.partnerId === partnerId))
            continue;
          if (existing) {
            // Rebinding an operator to a different partner: remove and re-add,
            // because the pair is the fact, not the role alone.
            await tx
              .delete(userRoles)
              .where(and(eq(userRoles.userId, targetId), eq(userRoles.role, role)));
          }
          await tx
            .insert(userRoles)
            .values({
              userId: targetId,
              role,
              partnerId: role === 'partner_operator' ? partnerId : null,
            })
            .onConflictDoNothing();
        }

        const after = await tx
          .select({ role: userRoles.role, partnerId: userRoles.partnerId })
          .from(userRoles)
          .where(eq(userRoles.userId, targetId));

        await auditAppend(tx, {
          actorType: 'user',
          actorId: tenant.user.id,
          userId: targetId,
          partnerId,
          action: 'user_roles.changed',
          entityType: 'user_roles',
          entityId: targetId,
          detail: {
            before: before.map((r) => r.role),
            after: after.map((r) => r.role),
            partnerCode: parsed.partnerCode?.toUpperCase() ?? null,
            by: tenant.user.email,
          },
        });

        return { roles: after };
      }),
    );
    if ('pending' in attempted) return c.json({ error: MIGRATION_PENDING }, 503);
    const result = attempted.ok;

    if ('error' in result) return c.json({ error: result.error }, result.status);
    deps.logger.info('administrator changed roles', {
      actor: tenant.user.id,
      target: targetId,
      roles: result.roles.map((r) => r.role),
    });
    return c.json(result);
  });

  /**
   * Load the catalog: partners, instruments, planning products, FX rates.
   *
   * A freshly migrated database has none of them, because migrations create
   * tables and the seed is a separate manual step. That is not cosmetic — with
   * no partners there is no institution side of the product at all, since
   * `partner_operator` requires one, and the opportunities and planning screens
   * have nothing to list. The only route to fixing it was someone running a
   * script against production from a laptop, which is the out-of-band database
   * access this system is otherwise built to avoid.
   *
   * The rows come from `@ccn/db`'s reference module — the same definition
   * `db:seed` uses, so the two cannot drift — and none of it is invented: real
   * institutions, real product shapes, and every figure the product cannot
   * compute left absent rather than filled in.
   *
   * Idempotent, so the button is safe to press twice: partners upsert on their
   * code (their reference columns have no other writer and would otherwise
   * freeze at whatever the first load contained), everything else conflicts to
   * nothing. 0010 grants exactly these four tables and no DELETE anywhere.
   */
  app.post('/reference-data', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);

    const attempted = await attempt(() =>
      withTenant(deps, tenant, async (tx) => {
        const loaded = await seedReferenceData(tx);
        await auditAppend(tx, {
          actorType: 'user',
          actorId: tenant.user.id,
          userId: tenant.user.id,
          partnerId: null,
          action: 'reference_data.loaded',
          entityType: 'partners',
          entityId: null,
          detail: { ...loaded, by: tenant.user.email },
        });
        const [row] = (await tx.execute(sql`
        select
          (select count(*) from partners)          as partners,
          (select count(*) from instruments)       as instruments,
          (select count(*) from planning_products) as planning_products,
          (select count(*) from fx_rates)          as fx_rates
      `)) as unknown as [Record<string, string>];
        return row;
      }),
    );
    if ('pending' in attempted) return c.json({ error: MIGRATION_PENDING }, 503);
    const counts = attempted.ok;

    deps.logger.info('administrator loaded reference data', { actor: tenant.user.id });
    return c.json({
      partners: Number(counts?.partners ?? 0),
      instruments: Number(counts?.instruments ?? 0),
      planningProducts: Number(counts?.planning_products ?? 0),
      fxRates: Number(counts?.fx_rates ?? 0),
    });
  });

  /**
   * Pull today's rates from the central banks that publish them.
   *
   * The currency switcher used to convert at three bigints compiled into
   * @ccn/money from the prototype, because every `convert()` call omitted the
   * optional table and the seeded `fx_rates` rows were read by nothing. CCN
   * routes orders and holds no money, so the rate it shows should be the
   * publisher's, with the publisher's date on it.
   *
   * A source that cannot be reached is reported, not papered over: the stored
   * rate stays exactly as it was and the portfolio screen shows it as stale.
   * Substituting a plausible number is the failure this replaced.
   *
   * Also runs on a schedule; this is the button for when someone needs it now.
   */
  app.post('/fx/refresh', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);

    const result = await refreshFxRates(deps, createOutboundGuard(deps.config).fetch);

    await withTenant(deps, tenant, (tx) =>
      auditAppend(tx, {
        actorType: 'user',
        actorId: tenant.user.id,
        userId: tenant.user.id,
        partnerId: null,
        action: 'fx_rates.refreshed',
        entityType: 'fx_rates',
        entityId: null,
        detail: { updated: result.updated, failed: result.failed.map((f) => f.source) },
      }),
    );

    deps.logger.info('administrator refreshed fx rates', {
      actor: tenant.user.id,
      updated: result.updated,
      failed: result.failed.length,
    });
    return c.json(result);
  });

  /** One person's audit trail, newest first — what they did and what was done to them. */
  app.get('/investors/:id/activity', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const id = c.req.param('id');
    const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);

    const rows = await withTenant(deps, tenant, (tx) =>
      tx
        .select({
          id: auditLog.id,
          seq: auditLog.seq,
          action: auditLog.action,
          entityType: auditLog.entityType,
          actorType: auditLog.actorType,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .where(eq(auditLog.userId, id))
        .orderBy(desc(auditLog.seq))
        .limit(limit),
    );
    return c.json({ entries: rows.map((r) => ({ ...r, seq: String(r.seq) })) });
  });

  return app;
}
