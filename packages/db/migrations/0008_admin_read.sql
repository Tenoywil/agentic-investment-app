-- ---------------------------------------------------------------------------
-- Administration: a read across the whole system, for the `admin` role only.
--
-- Every table an operator or an investor touches is scoped to one tenant —
-- `user_id = app_current_user_id()` for investor data, `partner_id =
-- app_current_partner_id()` for partner data — and FORCE ROW LEVEL SECURITY
-- means even the table owner is subject to it. That is exactly right, and it is
-- also why nobody could run the business: there was no way to answer "which
-- investors are stuck in onboarding" or "what is this partner actually
-- offering" without connecting to the database by hand.
--
-- `admin` already had this on `audit_log` and on the gateway tables
-- (0001_security.sql:165, 0004_gateway_security.sql). This extends the same
-- grant to the rest, and nothing more:
--
--   * SELECT only. No admin policy for INSERT, UPDATE or DELETE is added here.
--     Everything that changes state keeps going through the choke points the
--     product already has — create_order, accept_order, settle_order, the
--     limits engine, the approval loop — so an administrative screen cannot
--     become a second, unaudited way to move money.
--   * `app_current_role()` reads a GUC that only the API sets, from roles it
--     read out of `user_roles` itself. A user cannot assert it.
--   * The audit tables are untouched: they are append-only by trigger, and
--     admin could already read them.
--
-- Additive throughout. Existing policies are unchanged, so every current
-- caller keeps exactly the access it had.
-- ---------------------------------------------------------------------------

CREATE POLICY "user_profiles_admin_read" ON "user_profiles" FOR SELECT
  USING (app_current_role() = 'admin');--> statement-breakpoint
CREATE POLICY "user_roles_admin_read" ON "user_roles" FOR SELECT
  USING (app_current_role() = 'admin');--> statement-breakpoint
CREATE POLICY "kyc_status_admin_read" ON "kyc_status" FOR SELECT
  USING (app_current_role() = 'admin');--> statement-breakpoint
CREATE POLICY "risk_profiles_admin_read" ON "risk_profiles" FOR SELECT
  USING (app_current_role() = 'admin');--> statement-breakpoint
CREATE POLICY "limits_admin_read" ON "limits" FOR SELECT
  USING (app_current_role() = 'admin');--> statement-breakpoint
CREATE POLICY "holdings_admin_read" ON "holdings" FOR SELECT
  USING (app_current_role() = 'admin');--> statement-breakpoint
CREATE POLICY "connected_accounts_admin_read" ON "connected_accounts" FOR SELECT
  USING (app_current_role() = 'admin');--> statement-breakpoint
CREATE POLICY "orders_admin_read" ON "orders" FOR SELECT
  USING (app_current_role() = 'admin');--> statement-breakpoint
CREATE POLICY "product_listings_admin_read" ON "product_listings" FOR SELECT
  USING (app_current_role() = 'admin');--> statement-breakpoint
CREATE POLICY "approvals_admin_read" ON "approvals" FOR SELECT
  USING (app_current_role() = 'admin');--> statement-breakpoint
CREATE POLICY "goals_admin_read" ON "goals" FOR SELECT
  USING (app_current_role() = 'admin');--> statement-breakpoint
CREATE POLICY "kyc_documents_admin_read" ON "kyc_documents" FOR SELECT
  USING (app_current_role() = 'admin');
