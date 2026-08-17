import { partners, withRls } from '@ccn/db';
import type { Transaction } from '@ccn/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../context';

/**
 * The unauthenticated brand surface: partner names, colors and logos.
 *
 * The landing page shows "Institutions on the network", and it used to show
 * seven hardcoded ticker codes with derived monogram tiles — while the real
 * firms' full names, brand colors and uploaded logos sat in the partners table
 * behind an auth-gated endpoint no signed-out visitor could call. A firm's
 * public brand is exactly the data that has no business being private, so
 * these two endpoints serve it without a session.
 *
 * Brand data only, and nothing else: no client counts, no AUM, no agreement
 * status. Reads still go through RLS (`partners_read` is USING (true) — the
 * partner list is reference data for every tenant) with an anonymous context,
 * so this surface cannot accidentally widen: a column an RLS policy would hide
 * from an anonymous transaction stays hidden.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function publicRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  /** An RLS transaction with no tenant: only USING (true) policies answer. */
  const anon = <T>(fn: (tx: Transaction) => Promise<T>) =>
    withRls(deps.db, { dbRole: deps.config.DB_APP_ROLE }, fn);

  app.get('/partner-marks', async (c) => {
    const rows = await anon((tx) =>
      tx
        .select({
          id: partners.id,
          code: partners.code,
          name: partners.name,
          kind: partners.kind,
          color: partners.color,
          tint: partners.tint,
          logoMime: partners.logoMime,
        })
        .from(partners)
        .orderBy(partners.name),
    );
    return c.json(
      {
        marks: rows.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          kind: r.kind,
          color: r.color,
          tint: r.tint,
          hasLogo: r.logoMime !== null,
        })),
      },
      200,
      // Public and cacheable: the list changes when a firm rebrands, not per
      // request, and the landing is the hottest unauthenticated page.
      { 'cache-control': 'public, max-age=300' },
    );
  });

  app.get('/partner-logo/:id', async (c) => {
    const id = c.req.param('id');
    // A malformed id is a 404, not a Postgres cast error surfacing as a 500.
    if (!UUID.test(id)) return c.json({ error: 'no logo' }, 404);
    const [row] = await anon((tx) =>
      tx
        .select({ logo: partners.logo, mime: partners.logoMime })
        .from(partners)
        .where(eq(partners.id, id)),
    );
    if (!row?.logo || !row.mime) return c.json({ error: 'no logo' }, 404);
    return c.body(new Uint8Array(row.logo).buffer as ArrayBuffer, 200, {
      'content-type': row.mime,
      'cache-control': 'public, max-age=3600',
    });
  });

  return app;
}
