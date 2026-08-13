-- ============================================================================
-- CCN security layer: application role, RLS, immutable hash-chained audit,
-- the single order-creation choke point, and the pgvector index.
--
-- Enforced in the database, not the application: tenant isolation (RLS), audit
-- immutability (trigger + hash chain), and orders/audit writable only through
-- SECURITY DEFINER functions. The model can propose; only these paths mutate.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Application role. The API connects (or SET LOCAL ROLE's) to this NON-superuser
-- role so RLS is actually enforced; migrations and the SECURITY DEFINER
-- functions run as the privileged owner. NOLOGIN: it is a privilege/policy
-- anchor reached via SET ROLE (tests/dev) or granted to a login role (prod).
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ccn_app') THEN
    CREATE ROLE ccn_app NOLOGIN;
  END IF;
END $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO ccn_app;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Tenant context accessors. Read the per-transaction GUCs set by withRls().
-- NULLIF maps the empty string (unset) to NULL so an un-scoped query matches no
-- rows rather than erroring on an empty ::uuid cast.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_partner_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.current_partner_id', true), '')::uuid $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_role() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.current_role', true), '') $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Constraints deferred out of the generated migration.
-- ---------------------------------------------------------------------------
ALTER TABLE "user_roles"
  ADD CONSTRAINT "user_roles_partner_id_partners_id_fk"
  FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "agent_messages"
  ADD CONSTRAINT "agent_messages_role_chk" CHECK ("role" IN ('agent', 'user'));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Privileges. Customer + console tables: SELECT/INSERT/UPDATE, never DELETE.
-- orders/audit_log are read-only here; writes flow through the functions below.
-- Auth tables (user/session/account/verification) are intentionally omitted —
-- Better Auth uses the privileged connection, before any tenant context exists.
-- ---------------------------------------------------------------------------
GRANT SELECT ON TABLE "partners", "instruments", "fx_rates", "planning_products" TO ccn_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE
  "user_profiles", "user_roles", "risk_profiles", "kyc_status", "kyc_documents",
  "connected_accounts", "holdings", "limits", "approvals", "goals",
  "agent_messages", "reconciliation_items" TO ccn_app;--> statement-breakpoint
GRANT SELECT, UPDATE ON TABLE "product_listings" TO ccn_app;--> statement-breakpoint
GRANT SELECT ON TABLE "partner_kpis", "kyc_funnel_stages", "orders", "embeddings",
  "audit_log", "audit_log_checkpoints" TO ccn_app;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS: reference tables — any authenticated app query may read; nobody writes
-- through the app role (no write grant). Enabled + FORCED per the plan.
-- ---------------------------------------------------------------------------
ALTER TABLE "partners" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "partners" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "partners_read" ON "partners" FOR SELECT USING (true);--> statement-breakpoint
ALTER TABLE "instruments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "instruments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "instruments_read" ON "instruments" FOR SELECT USING (true);--> statement-breakpoint
ALTER TABLE "fx_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fx_rates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "fx_rates_read" ON "fx_rates" FOR SELECT USING (true);--> statement-breakpoint
ALTER TABLE "planning_products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "planning_products" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "planning_products_read" ON "planning_products" FOR SELECT USING (true);--> statement-breakpoint
ALTER TABLE "embeddings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "embeddings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "embeddings_read" ON "embeddings" FOR SELECT USING (true);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS: customer-owned tables — a row is visible/writable only to its owner.
-- ---------------------------------------------------------------------------
ALTER TABLE "user_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "user_profiles_tenant" ON "user_profiles"
  USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "user_roles_tenant" ON "user_roles"
  USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "risk_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "risk_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "risk_profiles_tenant" ON "risk_profiles"
  USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "kyc_status" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kyc_status" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "kyc_status_tenant" ON "kyc_status"
  USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "kyc_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kyc_documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "kyc_documents_tenant" ON "kyc_documents"
  USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "connected_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connected_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "connected_accounts_tenant" ON "connected_accounts"
  USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "holdings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "holdings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "holdings_tenant" ON "holdings"
  USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "limits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "limits_tenant" ON "limits"
  USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "approvals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "approvals_tenant" ON "approvals"
  USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "goals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "goals_tenant" ON "goals"
  USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "agent_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "agent_messages_tenant" ON "agent_messages"
  USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
ALTER TABLE "reconciliation_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reconciliation_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "reconciliation_items_tenant" ON "reconciliation_items"
  USING ("user_id" = app_current_user_id() OR "partner_id" = app_current_partner_id())
  WITH CHECK ("user_id" = app_current_user_id() OR "partner_id" = app_current_partner_id());--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS: console (partner-scoped) tables.
-- ---------------------------------------------------------------------------
ALTER TABLE "product_listings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_listings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "product_listings_partner" ON "product_listings"
  USING ("partner_id" = app_current_partner_id()) WITH CHECK ("partner_id" = app_current_partner_id());--> statement-breakpoint
ALTER TABLE "partner_kpis" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "partner_kpis" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "partner_kpis_partner" ON "partner_kpis"
  USING ("partner_id" = app_current_partner_id());--> statement-breakpoint
ALTER TABLE "kyc_funnel_stages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kyc_funnel_stages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "kyc_funnel_stages_partner" ON "kyc_funnel_stages"
  USING ("partner_id" = app_current_partner_id());--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS: orders — customer sees own, partner operator sees their partner's.
-- No write policy: inserts/transitions go only through the functions below.
-- ---------------------------------------------------------------------------
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "orders_read" ON "orders" FOR SELECT
  USING ("user_id" = app_current_user_id() OR "partner_id" = app_current_partner_id());--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS: audit — subject (customer/partner) reads their own; compliance/admin all.
-- ---------------------------------------------------------------------------
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "audit_log_read" ON "audit_log" FOR SELECT USING (
  "user_id" = app_current_user_id()
  OR "partner_id" = app_current_partner_id()
  OR app_current_role() IN ('compliance', 'admin')
);--> statement-breakpoint
ALTER TABLE "audit_log_checkpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log_checkpoints" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "audit_log_checkpoints_read" ON "audit_log_checkpoints" FOR SELECT
  USING (app_current_role() IN ('compliance', 'admin'));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Audit immutability: BEFORE UPDATE OR DELETE raises. Triggers fire for the
-- table owner and superusers too, so the log is append-only for everyone.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_log_block_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only; % is not permitted', TG_OP;
END $$;--> statement-breakpoint
CREATE TRIGGER "audit_log_immutable" BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- audit_append: the only way to write an audit row. Serialized per transaction
-- so the SHA-256 chain (prev_hash -> hash over the row's content) is linear.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_append(
  p_actor_type actor_type, p_actor_id uuid, p_user_id uuid, p_partner_id uuid,
  p_action text, p_entity_type text, p_entity_id uuid, p_detail jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prev text;
  v_hash text;
  v_ts timestamptz := now();
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ccn_audit_append'));
  SELECT hash INTO v_prev FROM audit_log ORDER BY seq DESC LIMIT 1;
  v_hash := encode(digest(
    coalesce(v_prev, '') || '|' || p_actor_type::text || '|' || coalesce(p_actor_id::text, '')
      || '|' || coalesce(p_user_id::text, '') || '|' || coalesce(p_partner_id::text, '')
      || '|' || p_action || '|' || coalesce(p_entity_type, '') || '|' || coalesce(p_entity_id::text, '')
      || '|' || coalesce(p_detail::text, '{}') || '|' || v_ts::text,
    'sha256'), 'hex');
  INSERT INTO audit_log(actor_type, actor_id, user_id, partner_id, action, entity_type,
    entity_id, detail, prev_hash, hash, created_at)
  VALUES (p_actor_type, p_actor_id, p_user_id, p_partner_id, p_action, p_entity_type,
    p_entity_id, coalesce(p_detail, '{}'::jsonb), v_prev, v_hash, v_ts)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION audit_append(actor_type, uuid, uuid, uuid, text, text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION audit_append(actor_type, uuid, uuid, uuid, text, text, uuid, jsonb) TO ccn_app;--> statement-breakpoint

-- audit_verify: recompute the chain in seq order; returns true iff intact.
CREATE OR REPLACE FUNCTION audit_verify() RETURNS boolean
  LANGUAGE plpgsql STABLE AS $$
DECLARE
  r record;
  v_prev text := NULL;
  v_calc text;
BEGIN
  FOR r IN SELECT * FROM audit_log ORDER BY seq ASC LOOP
    IF r.prev_hash IS DISTINCT FROM v_prev THEN RETURN false; END IF;
    v_calc := encode(digest(
      coalesce(v_prev, '') || '|' || r.actor_type::text || '|' || coalesce(r.actor_id::text, '')
        || '|' || coalesce(r.user_id::text, '') || '|' || coalesce(r.partner_id::text, '')
        || '|' || r.action || '|' || coalesce(r.entity_type, '') || '|' || coalesce(r.entity_id::text, '')
        || '|' || coalesce(r.detail::text, '{}') || '|' || r.created_at::text,
      'sha256'), 'hex');
    IF v_calc IS DISTINCT FROM r.hash THEN RETURN false; END IF;
    v_prev := r.hash;
  END LOOP;
  RETURN true;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- create_order: the single order-creation choke point. Called only after the
-- deterministic Limits Engine passes (auto-act) or an approval is granted.
-- Idempotent on idempotency_key; audits + notifies exactly once per new order.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_order(
  p_user_id uuid, p_partner_id uuid, p_instrument_id uuid, p_approval_id uuid,
  p_amount_minor bigint, p_currency currency, p_idempotency_key text,
  p_client_ref text, p_created_by actor_type
) RETURNS orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order orders;
BEGIN
  INSERT INTO orders(user_id, partner_id, instrument_id, approval_id, status, amount_minor,
    currency, idempotency_key, client_ref, settlement_eta, created_by)
  VALUES (p_user_id, p_partner_id, p_instrument_id, p_approval_id, 'created', p_amount_minor,
    p_currency, p_idempotency_key, p_client_ref, now() + interval '2 days', p_created_by)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING * INTO v_order;

  IF v_order.id IS NULL THEN
    -- Idempotent replay: return the existing order, no duplicate audit/notify.
    SELECT * INTO v_order FROM orders WHERE idempotency_key = p_idempotency_key;
    RETURN v_order;
  END IF;

  PERFORM audit_append(p_created_by, p_user_id, p_user_id, p_partner_id, 'order.created',
    'order', v_order.id, jsonb_build_object('amount_minor', p_amount_minor, 'currency', p_currency));
  PERFORM pg_notify('ccn_events', jsonb_build_object('type', 'order.created',
    'order_id', v_order.id, 'user_id', p_user_id, 'partner_id', p_partner_id, 'status', 'created')::text);
  RETURN v_order;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION create_order(uuid, uuid, uuid, uuid, bigint, currency, text, text, actor_type) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION create_order(uuid, uuid, uuid, uuid, bigint, currency, text, text, actor_type) TO ccn_app;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Order state transitions (guarded). Each verifies the acting tenant, moves the
-- state machine forward, and writes an audit entry + a notify event.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION accept_order(p_order_id uuid, p_partner_id uuid) RETURNS orders
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order orders;
BEGIN
  UPDATE orders SET status = 'accepted', accepted_at = now(), updated_at = now()
    WHERE id = p_order_id AND partner_id = p_partner_id AND status = 'created'
    RETURNING * INTO v_order;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'order % is not in a state partner % can accept', p_order_id, p_partner_id;
  END IF;
  PERFORM audit_append('user', NULL, v_order.user_id, p_partner_id, 'order.accepted', 'order', v_order.id, '{}'::jsonb);
  PERFORM pg_notify('ccn_events', jsonb_build_object('type', 'order.accepted',
    'order_id', v_order.id, 'user_id', v_order.user_id, 'partner_id', p_partner_id, 'status', 'accepted')::text);
  RETURN v_order;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION settle_order(p_order_id uuid, p_partner_id uuid) RETURNS orders
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order orders;
BEGIN
  UPDATE orders SET status = 'settled', settled_at = now(), updated_at = now()
    WHERE id = p_order_id AND partner_id = p_partner_id AND status = 'accepted'
    RETURNING * INTO v_order;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'order % is not in a state partner % can settle', p_order_id, p_partner_id;
  END IF;
  PERFORM audit_append('system', NULL, v_order.user_id, p_partner_id, 'order.settled', 'order', v_order.id, '{}'::jsonb);
  PERFORM pg_notify('ccn_events', jsonb_build_object('type', 'order.settled',
    'order_id', v_order.id, 'user_id', v_order.user_id, 'partner_id', p_partner_id, 'status', 'settled')::text);
  RETURN v_order;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_order(p_order_id uuid, p_partner_id uuid, p_reason text) RETURNS orders
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order orders;
BEGIN
  UPDATE orders SET status = 'rejected', rejected_reason = p_reason, updated_at = now()
    WHERE id = p_order_id AND partner_id = p_partner_id AND status IN ('created', 'accepted')
    RETURNING * INTO v_order;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'order % is not in a state partner % can reject', p_order_id, p_partner_id;
  END IF;
  PERFORM audit_append('user', NULL, v_order.user_id, p_partner_id, 'order.rejected', 'order', v_order.id,
    jsonb_build_object('reason', p_reason));
  PERFORM pg_notify('ccn_events', jsonb_build_object('type', 'order.rejected',
    'order_id', v_order.id, 'user_id', v_order.user_id, 'partner_id', p_partner_id, 'status', 'rejected')::text);
  RETURN v_order;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION accept_order(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION settle_order(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION reject_order(uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION accept_order(uuid, uuid) TO ccn_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION settle_order(uuid, uuid) TO ccn_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION reject_order(uuid, uuid, text) TO ccn_app;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Indexes: pgvector HNSW (cosine) for retrieval, plus tenant-filter hot paths.
-- ---------------------------------------------------------------------------
CREATE INDEX "embeddings_embedding_hnsw" ON "embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "holdings_user_idx" ON "holdings" ("user_id");--> statement-breakpoint
CREATE INDEX "connected_accounts_user_idx" ON "connected_accounts" ("user_id");--> statement-breakpoint
CREATE INDEX "approvals_user_idx" ON "approvals" ("user_id");--> statement-breakpoint
CREATE INDEX "goals_user_idx" ON "goals" ("user_id");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" ("user_id");--> statement-breakpoint
CREATE INDEX "orders_partner_idx" ON "orders" ("partner_id");--> statement-breakpoint
CREATE INDEX "audit_log_user_idx" ON "audit_log" ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_partner_idx" ON "audit_log" ("partner_id");--> statement-breakpoint
CREATE INDEX "instruments_type_idx" ON "instruments" ("type");
