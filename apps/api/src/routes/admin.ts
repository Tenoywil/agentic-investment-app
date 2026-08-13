import {
  approvals,
  auditLog,
  holdings,
  kycStatus,
  orders,
  partners,
  productListings,
  user,
  userProfiles,
  userRoles,
} from '@ccn/db';
import { desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../context';
import { withTenant } from '../context';

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
 * What is deliberately absent: subscriptions and billing. There is no such
 * table in this schema, and inventing a figure on an administrative screen —
 * where it would be read as the authoritative one — is the exact failure this
 * product has already had once.
 */
export function adminRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** The shape of the network in one request. */
  app.get('/overview', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);

    const data = await withTenant(deps, tenant, async (tx) => {
      const [roleCounts] = (await tx.execute(sql`
        select
          count(*) filter (where role = 'customer')          as customers,
          count(*) filter (where role = 'partner_operator')  as operators,
          count(*) filter (where role = 'admin')             as admins
        from user_roles
      `)) as unknown as [{ customers: string; operators: string; admins: string }];

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

      const [productRow] = (await tx.execute(
        sql`select count(*) as total from product_listings`,
      )) as unknown as [{ total: string }];

      const [approvalRow] = (await tx.execute(
        sql`select count(*) filter (where status = 'pending') as pending from approvals`,
      )) as unknown as [{ pending: string }];

      return { roleCounts, orderCounts, onboarding, partnerRow, productRow, approvalRow };
    });

    const n = (v: unknown) => Number(v ?? 0);
    return c.json({
      people: {
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
      products: { total: n(data.productRow?.total) },
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

    const rows = await withTenant(deps, tenant, (tx) =>
      tx
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          createdAt: user.createdAt,
          role: userRoles.role,
          partnerId: userRoles.partnerId,
          kycTier: kycStatus.tier,
          identityVerified: kycStatus.identityVerified,
          complianceConfirmed: kycStatus.complianceConfirmed,
          riskCompleted: kycStatus.riskCompleted,
          fundsConfirmed: kycStatus.fundsConfirmed,
          residency: userProfiles.residencyCountry,
        })
        .from(user)
        .leftJoin(userRoles, eq(userRoles.userId, user.id))
        .leftJoin(kycStatus, eq(kycStatus.userId, user.id))
        .leftJoin(userProfiles, eq(userProfiles.userId, user.id))
        .orderBy(desc(user.createdAt))
        .limit(limit),
    );

    // One row per person, with every role they hold — the join above fans out.
    const byId = new Map<string, Record<string, unknown> & { roles: string[] }>();
    for (const r of rows) {
      const existing = byId.get(r.id);
      if (existing) {
        if (r.role && !existing.roles.includes(r.role)) existing.roles.push(r.role);
        continue;
      }
      const { role, ...rest } = r;
      byId.set(r.id, { ...rest, roles: role ? [role] : [] });
    }
    return c.json({ investors: [...byId.values()] });
  });

  /** Every partner, and what each is actually offering. */
  app.get('/partners', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);

    const rows = await withTenant(deps, tenant, async (tx) => {
      const list = await tx.select().from(partners).orderBy(partners.name);
      const counts = (await tx.execute(sql`
        select p.id::text as partner_id,
               count(distinct pl.id) as products,
               count(distinct o.id)  as orders
          from partners p
          left join product_listings pl on pl.partner_id = p.id
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

  /** Everything on offer, across every partner. */
  app.get('/products', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);

    const rows = await withTenant(deps, tenant, (tx) =>
      tx
        .select({
          id: productListings.id,
          name: productListings.name,
          type: productListings.type,
          status: productListings.status,
          partnerId: productListings.partnerId,
          partnerName: partners.name,
          partnerCode: partners.code,
        })
        .from(productListings)
        .leftJoin(partners, eq(partners.id, productListings.partnerId))
        .orderBy(partners.name, productListings.name),
    );
    return c.json({ products: rows });
  });

  /** Recent orders across every partner. */
  app.get('/orders', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);

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
        })
        .from(orders)
        .leftJoin(partners, eq(partners.id, orders.partnerId))
        .leftJoin(user, eq(user.id, orders.userId))
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
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
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

  return app;
}
