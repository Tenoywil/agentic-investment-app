import { instruments, partners, riskProfiles } from '@ccn/db';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../context';
import { withTenant } from '../context';
import { requireAuth } from '../middleware';
import { readOrDegrade } from '../migrations';

const RISK_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' };

/**
 * The opportunities marketplace. Reference data (instruments), joined with the
 * executing partner and returned alongside the caller's own suitability band so
 * the client can explain "why this fits you" without a second round trip.
 * `blocked`/`blockReasons` ride straight through — same data the Limits Engine's
 * Blocked branch (packages/limits-engine) reasons over on the order path.
 * Execution itself is unchanged: POST /api/orders, keyed by the `id` returned here.
 */
export function opportunitiesRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', requireAuth(deps));

  app.get('/', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);

    const { rows, profile } = await withTenant(deps, tenant, async (tx) => {
      const columns = {
        id: instruments.id,
        slug: instruments.slug,
        abbr: instruments.abbr,
        type: instruments.type,
        partnerName: partners.name,
        regulator: instruments.regulator,
        name: instruments.name,
        region: instruments.region,
        metricLabel: instruments.metricLabel,
        metric: instruments.metric,
        minInvestmentMinor: instruments.minInvestmentMinor,
        currency: instruments.currency,
        term: instruments.term,
        risk: instruments.risk,
        description: instruments.description,
        agentNote: instruments.agentNote,
        blocked: instruments.blocked,
        blockReasons: instruments.blockReasons,
      };
      /**
       * A paused listing is off the shelf: the firm has withdrawn it, so it is
       * not offered at all. This is not `blocked`, which means "screened out
       * for your suitability" and is deliberately still returned — that one
       * renders as a refusal with reasons, and hiding it would turn an
       * explained decision into a silent absence.
       *
       * On a database without `0017` the filter cannot run. Falling back to the
       * unfiltered query is exactly the behaviour that shipped before that
       * migration, and it is safe for the same reason it was safe then: a
       * column that does not exist is a column nothing can be paused in. The
       * alternative is a 500, and an empty marketplace is not a better answer
       * than a complete one.
       */
      const rows = await readOrDegrade(
        deps,
        'the opportunities marketplace',
        tx,
        (t) =>
          t
            .select(columns)
            .from(instruments)
            .leftJoin(partners, eq(instruments.partnerId, partners.id))
            .where(eq(instruments.listingStatus, 'live')),
        (t) =>
          t
            .select(columns)
            .from(instruments)
            .leftJoin(partners, eq(instruments.partnerId, partners.id)),
      );
      // Newest assessment wins — risk profiles are appended, never replaced.
      const [profile] = await tx
        .select({ band: riskProfiles.band })
        .from(riskProfiles)
        .where(eq(riskProfiles.userId, tenant.user.id))
        .orderBy(desc(riskProfiles.createdAt))
        .limit(1);
      return { rows, profile };
    });

    return c.json({
      suitabilityBand: profile?.band ?? null,
      opportunities: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        abbr: r.abbr,
        type: r.type,
        partner: r.partnerName,
        regulator: r.regulator,
        name: r.name,
        region: r.region,
        metricLabel: r.metricLabel,
        metric: r.metric,
        minInvestmentMinor: r.minInvestmentMinor.toString(),
        currency: r.currency,
        term: r.term,
        risk: r.risk ? (RISK_LABEL[r.risk] ?? r.risk) : null,
        description: r.description,
        agentNote: r.agentNote,
        blocked: r.blocked,
        blockReasons: r.blockReasons,
      })),
    });
  });

  return app;
}
