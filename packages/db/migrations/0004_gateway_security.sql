-- ============================================================================
-- Gateway security layer: RLS for the tables in 0003_gateway_schema.sql. Same
-- discipline as 0001_security.sql — enabled AND forced on every table, reusing
-- the app_current_user_id()/app_current_role() accessors already defined there.
-- No SECURITY DEFINER choke point is needed here: unlike orders (real money
-- movement), gateway writes are plain tenant-scoped INSERT/UPDATE guarded by
-- these policies, the same shape as approvals/goals/limits.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Privileges. Claims/evidence/documents/agent-runs are append-only from the
-- app's perspective (no UPDATE grant) — a re-run of a pass inserts new rows
-- rather than editing history, the same posture as audit_log/orders.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON TABLE
  "investor_mandates", "gateway_opportunities", "gateway_matches",
  "gateway_introduction_requests", "gateway_deals" TO ccn_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE
  "gateway_claims", "gateway_evidence", "gateway_documents", "gateway_agent_runs" TO ccn_app;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS: investor_mandates — owner-only, same shape as limits/goals.
-- ---------------------------------------------------------------------------
ALTER TABLE "investor_mandates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "investor_mandates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "investor_mandates_tenant" ON "investor_mandates"
  USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS: gateway_opportunities — approved rows are marketplace-visible to any
-- authenticated user; submitted_by sees their own at any status; analyst/
-- compliance/admin see everything (the review queue).
-- ---------------------------------------------------------------------------
ALTER TABLE "gateway_opportunities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gateway_opportunities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gateway_opportunities_read" ON "gateway_opportunities" FOR SELECT USING (
  "status" = 'approved'
  OR "submitted_by" = app_current_user_id()
  OR app_current_role() IN ('analyst', 'compliance', 'admin')
);--> statement-breakpoint
CREATE POLICY "gateway_opportunities_insert" ON "gateway_opportunities" FOR INSERT WITH CHECK (
  "submitted_by" = app_current_user_id() OR app_current_role() IN ('analyst', 'compliance', 'admin')
);--> statement-breakpoint
CREATE POLICY "gateway_opportunities_update" ON "gateway_opportunities" FOR UPDATE USING (
  "submitted_by" = app_current_user_id() OR app_current_role() IN ('analyst', 'compliance', 'admin')
) WITH CHECK (
  "submitted_by" = app_current_user_id() OR app_current_role() IN ('analyst', 'compliance', 'admin')
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS: gateway_claims / gateway_evidence / gateway_documents — visibility and
-- write access derive from the parent opportunity (join, since these tables
-- carry no user_id/partner_id of their own).
-- ---------------------------------------------------------------------------
ALTER TABLE "gateway_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gateway_claims" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gateway_claims_read" ON "gateway_claims" FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM "gateway_opportunities" o WHERE o."id" = "gateway_claims"."opportunity_id"
      AND (o."status" = 'approved' OR o."submitted_by" = app_current_user_id()
        OR app_current_role() IN ('analyst', 'compliance', 'admin'))
  )
);--> statement-breakpoint
CREATE POLICY "gateway_claims_insert" ON "gateway_claims" FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM "gateway_opportunities" o WHERE o."id" = "gateway_claims"."opportunity_id"
      AND (o."submitted_by" = app_current_user_id() OR app_current_role() IN ('analyst', 'compliance', 'admin'))
  )
);--> statement-breakpoint

ALTER TABLE "gateway_evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gateway_evidence" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gateway_evidence_read" ON "gateway_evidence" FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM "gateway_claims" c JOIN "gateway_opportunities" o ON o."id" = c."opportunity_id"
      WHERE c."id" = "gateway_evidence"."claim_id"
        AND (o."status" = 'approved' OR o."submitted_by" = app_current_user_id()
          OR app_current_role() IN ('analyst', 'compliance', 'admin'))
  )
);--> statement-breakpoint
CREATE POLICY "gateway_evidence_insert" ON "gateway_evidence" FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM "gateway_claims" c JOIN "gateway_opportunities" o ON o."id" = c."opportunity_id"
      WHERE c."id" = "gateway_evidence"."claim_id"
        AND (o."submitted_by" = app_current_user_id() OR app_current_role() IN ('analyst', 'compliance', 'admin'))
  )
);--> statement-breakpoint

ALTER TABLE "gateway_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gateway_documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gateway_documents_read" ON "gateway_documents" FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM "gateway_opportunities" o WHERE o."id" = "gateway_documents"."opportunity_id"
      AND (o."status" = 'approved' OR o."submitted_by" = app_current_user_id()
        OR app_current_role() IN ('analyst', 'compliance', 'admin'))
  )
);--> statement-breakpoint
CREATE POLICY "gateway_documents_insert" ON "gateway_documents" FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM "gateway_opportunities" o WHERE o."id" = "gateway_documents"."opportunity_id"
      AND (o."submitted_by" = app_current_user_id() OR app_current_role() IN ('analyst', 'compliance', 'admin'))
  )
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS: gateway_agent_runs — visible to the run's own user (mandate-extraction
-- passes), the opportunity's submitter, or analyst/compliance/admin.
-- ---------------------------------------------------------------------------
ALTER TABLE "gateway_agent_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gateway_agent_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gateway_agent_runs_read" ON "gateway_agent_runs" FOR SELECT USING (
  "user_id" = app_current_user_id()
  OR app_current_role() IN ('analyst', 'compliance', 'admin')
  OR EXISTS (
    SELECT 1 FROM "gateway_opportunities" o WHERE o."id" = "gateway_agent_runs"."opportunity_id"
      AND o."submitted_by" = app_current_user_id()
  )
);--> statement-breakpoint
CREATE POLICY "gateway_agent_runs_insert" ON "gateway_agent_runs" FOR INSERT WITH CHECK (
  "user_id" = app_current_user_id()
  OR app_current_role() IN ('analyst', 'compliance', 'admin')
  OR EXISTS (
    SELECT 1 FROM "gateway_opportunities" o WHERE o."id" = "gateway_agent_runs"."opportunity_id"
      AND o."submitted_by" = app_current_user_id()
  )
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS: gateway_matches — investor-owned; analyst/compliance/admin read for
-- introduction-request review context.
-- ---------------------------------------------------------------------------
ALTER TABLE "gateway_matches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gateway_matches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gateway_matches_read" ON "gateway_matches" FOR SELECT USING (
  "user_id" = app_current_user_id() OR app_current_role() IN ('analyst', 'compliance', 'admin')
);--> statement-breakpoint
CREATE POLICY "gateway_matches_insert" ON "gateway_matches" FOR INSERT WITH CHECK (
  "user_id" = app_current_user_id()
);--> statement-breakpoint
CREATE POLICY "gateway_matches_update" ON "gateway_matches" FOR UPDATE
  USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS: gateway_introduction_requests — investor creates their own; analyst/
-- compliance/admin read and decide (approve/reject) any request.
-- ---------------------------------------------------------------------------
ALTER TABLE "gateway_introduction_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gateway_introduction_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gateway_introduction_requests_read" ON "gateway_introduction_requests" FOR SELECT USING (
  "user_id" = app_current_user_id() OR app_current_role() IN ('analyst', 'compliance', 'admin')
);--> statement-breakpoint
CREATE POLICY "gateway_introduction_requests_insert" ON "gateway_introduction_requests" FOR INSERT WITH CHECK (
  "user_id" = app_current_user_id()
);--> statement-breakpoint
CREATE POLICY "gateway_introduction_requests_update" ON "gateway_introduction_requests" FOR UPDATE USING (
  "user_id" = app_current_user_id() OR app_current_role() IN ('analyst', 'compliance', 'admin')
) WITH CHECK (
  "user_id" = app_current_user_id() OR app_current_role() IN ('analyst', 'compliance', 'admin')
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS: gateway_deals — investor-owned; analyst/compliance/admin read and
-- write (a deal is created by the analyst action that approves the intro).
-- ---------------------------------------------------------------------------
ALTER TABLE "gateway_deals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gateway_deals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gateway_deals_read" ON "gateway_deals" FOR SELECT USING (
  "user_id" = app_current_user_id() OR app_current_role() IN ('analyst', 'compliance', 'admin')
);--> statement-breakpoint
CREATE POLICY "gateway_deals_insert" ON "gateway_deals" FOR INSERT WITH CHECK (
  "user_id" = app_current_user_id() OR app_current_role() IN ('analyst', 'compliance', 'admin')
);--> statement-breakpoint
CREATE POLICY "gateway_deals_update" ON "gateway_deals" FOR UPDATE USING (
  "user_id" = app_current_user_id() OR app_current_role() IN ('analyst', 'compliance', 'admin')
) WITH CHECK (
  "user_id" = app_current_user_id() OR app_current_role() IN ('analyst', 'compliance', 'admin')
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Indexes: FK / tenant-filter hot paths.
-- ---------------------------------------------------------------------------
CREATE INDEX "gateway_opportunities_status_idx" ON "gateway_opportunities" ("status");--> statement-breakpoint
CREATE INDEX "gateway_opportunities_submitted_by_idx" ON "gateway_opportunities" ("submitted_by");--> statement-breakpoint
CREATE INDEX "gateway_claims_opportunity_idx" ON "gateway_claims" ("opportunity_id");--> statement-breakpoint
CREATE INDEX "gateway_evidence_claim_idx" ON "gateway_evidence" ("claim_id");--> statement-breakpoint
CREATE INDEX "gateway_documents_opportunity_idx" ON "gateway_documents" ("opportunity_id");--> statement-breakpoint
CREATE INDEX "gateway_agent_runs_opportunity_idx" ON "gateway_agent_runs" ("opportunity_id");--> statement-breakpoint
CREATE INDEX "gateway_agent_runs_user_idx" ON "gateway_agent_runs" ("user_id");--> statement-breakpoint
CREATE INDEX "gateway_matches_user_idx" ON "gateway_matches" ("user_id");--> statement-breakpoint
CREATE INDEX "gateway_matches_opportunity_idx" ON "gateway_matches" ("opportunity_id");--> statement-breakpoint
CREATE INDEX "gateway_introduction_requests_user_idx" ON "gateway_introduction_requests" ("user_id");--> statement-breakpoint
CREATE INDEX "gateway_introduction_requests_match_idx" ON "gateway_introduction_requests" ("match_id");--> statement-breakpoint
CREATE INDEX "gateway_deals_user_idx" ON "gateway_deals" ("user_id");
