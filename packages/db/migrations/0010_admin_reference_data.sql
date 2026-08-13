-- ---------------------------------------------------------------------------
-- Administration: loading the catalog.
--
-- A freshly migrated database has no partners, no instruments, no planning
-- products and no FX rates, because migrations create tables and the seed is a
-- separate manual step that a deployment has no shell to run. The result is not
-- a cosmetic gap: `partner_operator` requires a partner, so with none in the
-- table there is no institution side of the product at all, and the
-- opportunities and planning screens have nothing to list.
--
-- That left one route to a working deployment — someone with the production
-- connection string running a script from a laptop — which is exactly the kind
-- of out-of-band database access this system is otherwise built to avoid. So an
-- administrator may load the catalog from the administration surface, and these
-- are the grants that let them.
--
-- **This is a catalog write, not a tenant write.** Four tables, all of them
-- network-wide reference data that no tenant owns:
--
--   * `partners`, `instruments`, `planning_products`, `fx_rates` — every one of
--     them already readable by everyone (`USING (true)` in 0001_security.sql),
--     because they are the shared catalog rather than anybody's rows.
--
-- Nothing here widens what an administrator can see or do to a *person*. 0008
-- gave admin a read across tenants; 0009 gave it one write, to `user_roles`.
-- This adds a write to the catalog and to nothing else — no holdings, no
-- orders, no profiles, no KYC.
--
-- UPDATE is granted on `partners` alone, and deliberately. Partner reference
-- columns (`kind`, `regulator`, `residency`, `agreement_status`) have no writer
-- anywhere in the product, so an insert that conflicted-to-nothing would freeze
-- whatever the first load contained — a partner with no line of business and no
-- agreement chip on the console, forever. The load upserts them instead. The
-- other three conflict to nothing: an instrument's terms are not ours to
-- rewrite once listed.
--
-- No DELETE, anywhere. Removing a partner or an instrument that orders already
-- reference is not a thing an administrative screen should be able to do by
-- accident, and the product has no notion of an unlisted instrument.
--
-- The load itself is idempotent and audited: the API appends
-- `reference_data.loaded` through `audit_append`, which is append-only by
-- trigger.
-- ---------------------------------------------------------------------------

GRANT INSERT ON TABLE "partners", "instruments", "planning_products", "fx_rates" TO ccn_app;--> statement-breakpoint
GRANT UPDATE ON TABLE "partners" TO ccn_app;--> statement-breakpoint

CREATE POLICY "partners_admin_write" ON "partners" FOR INSERT
  WITH CHECK (app_current_role() = 'admin');--> statement-breakpoint
CREATE POLICY "partners_admin_correct" ON "partners" FOR UPDATE
  USING (app_current_role() = 'admin')
  WITH CHECK (app_current_role() = 'admin');--> statement-breakpoint

CREATE POLICY "instruments_admin_write" ON "instruments" FOR INSERT
  WITH CHECK (app_current_role() = 'admin');--> statement-breakpoint

CREATE POLICY "planning_products_admin_write" ON "planning_products" FOR INSERT
  WITH CHECK (app_current_role() = 'admin');--> statement-breakpoint

CREATE POLICY "fx_rates_admin_write" ON "fx_rates" FOR INSERT
  WITH CHECK (app_current_role() = 'admin');
