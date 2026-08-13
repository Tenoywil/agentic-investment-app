import {
  approvals,
  auditLog,
  holdings,
  kycStatus,
  orders,
  partners,
  productListings,
  seedReferenceData,
  user,
  userProfiles,
  userRoles,
} from '@ccn/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../context';
import { withTenant } from '../context';
import { auditAppend } from '../db-fns';

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
/**
 * A write refused because the database is behind the code.
 *
 * This surface's writes each depend on a grant added by a migration, and a
 * deployment can be running new code against a database that never received
 * one — `preDeployCommand` is declared in a Blueprint, and a service created
 * from the dashboard instead does not have it, so migrations only run when a
 * person runs them. Nothing in the deploy log says so: the build is green, the
 * code ships, and the first request that needs the grant is where it surfaces.
 *
 * It surfaced as a 500 and a stack trace, which tells an administrator standing
 * in front of the screen nothing at all. Postgres already knows exactly what is
 * wrong, so it is worth saying.
 *
 * A migration can be missing in two ways, and both arrive as `42501`:
 *
 *   - the GRANT never happened — "permission denied for table partners"
 *   - the POLICY never happened — "new row violates row-level security policy
 *     for table user_roles"
 *
 * Only the first was matched at first, and the second reached an administrator
 * as a 500 with a stack trace — the exact failure this function exists to
 * prevent, one migration later.
 *
 * Treating an RLS refusal as "the database is behind" is safe **on this surface
 * specifically**, and nowhere else. Every write here has already been checked
 * against its own rules in TypeScript before any SQL runs: `admin` is refused
 * as a grantable role, a self-target is refused, an unknown partner is refused.
 * So a request that reaches Postgres and is then refused by a policy is not a
 * correctly-refused write — it is a policy that should have permitted it and
 * does not exist. Anywhere an RLS refusal could be legitimate, this reasoning
 * would be wrong, which is why it lives beside these handlers rather than in a
 * global error mapper.
 */
const MIGRATION_PENDING =
  'this database is missing a migration that the administration surface needs. Apply it with `bun run db:migrate` against this database, or run packages/db/scripts/apply-admin-migrations.sql from the SQL editor, then try again.';

function isDatabaseBehind(err: unknown): boolean {
  const seen = new Set<unknown>();
  let e: unknown = err;
  while (e && typeof e === 'object' && !seen.has(e)) {
    seen.add(e);
    const { code, message } = e as { code?: string; message?: string };
    if (
      code === '42501' &&
      /permission denied for|violates row-level security policy/i.test(message ?? '')
    ) {
      return true;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

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
