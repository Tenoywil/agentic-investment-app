-- Regulatory KYC lifecycle: encrypted intake, typed evidence and an explicit
-- licensed-firm decision. Intake completion alone must never activate a client.

ALTER TYPE "regulator" ADD VALUE IF NOT EXISTS 'GSC_GUYANA';--> statement-breakpoint
ALTER TYPE "regulator" ADD VALUE IF NOT EXISTS 'TTSEC_TRINIDAD_TOBAGO';--> statement-breakpoint
CREATE TABLE "kyc_dossiers" (
  "user_id" uuid PRIMARY KEY REFERENCES "user"("id") ON DELETE cascade,
  "identity_ciphertext" text,
  "compliance_ciphertext" text,
  "funds_ciphertext" text,
  "profile_version" integer NOT NULL DEFAULT 1,
  "consented_at" timestamptz,
  "next_review_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "kyc_dossiers_has_section" CHECK (
    "identity_ciphertext" IS NOT NULL OR
    "compliance_ciphertext" IS NOT NULL OR
    "funds_ciphertext" IS NOT NULL
  )
);--> statement-breakpoint

ALTER TABLE "kyc_documents" ADD COLUMN IF NOT EXISTS "document_type" text;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD COLUMN IF NOT EXISTS "issuing_country" text;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD COLUMN IF NOT EXISTS "expires_at" date;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_type_check" CHECK (
  "document_type" IS NULL OR "document_type" IN (
    'government_id', 'proof_of_address', 'source_of_funds',
    'source_of_wealth', 'tax_form', 'other'
  )
);--> statement-breakpoint

CREATE TABLE "partner_kyc_reviews" (
  "connected_account_id" uuid PRIMARY KEY REFERENCES "connected_accounts"("id") ON DELETE cascade,
  "partner_id" uuid NOT NULL REFERENCES "partners"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "policy_key" text NOT NULL,
  "status" text NOT NULL,
  "aml_risk_rating" text,
  "identity_verified" boolean NOT NULL DEFAULT false,
  "address_verified" boolean NOT NULL DEFAULT false,
  "sanctions_clear" boolean NOT NULL DEFAULT false,
  "pep_review_complete" boolean NOT NULL DEFAULT false,
  "funds_verified" boolean NOT NULL DEFAULT false,
  "tax_documentation_complete" boolean NOT NULL DEFAULT false,
  "senior_approval" boolean NOT NULL DEFAULT false,
  "notes" text,
  "reviewed_by" uuid REFERENCES "user"("id"),
  "reviewed_at" timestamptz,
  "next_review_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "partner_kyc_reviews_status_check" CHECK (
    "status" IN ('pending', 'needs_info', 'edd', 'approved', 'declined')
  ),
  CONSTRAINT "partner_kyc_reviews_risk_check" CHECK (
    "aml_risk_rating" IS NULL OR "aml_risk_rating" IN ('low', 'medium', 'high')
  ),
  CONSTRAINT "partner_kyc_reviews_high_risk_approval" CHECK (
    "status" <> 'approved' OR "aml_risk_rating" <> 'high' OR "senior_approval"
  )
);--> statement-breakpoint

CREATE INDEX "partner_kyc_reviews_partner_idx" ON "partner_kyc_reviews" ("partner_id", "status");--> statement-breakpoint
CREATE INDEX "partner_kyc_reviews_user_idx" ON "partner_kyc_reviews" ("user_id");--> statement-breakpoint

ALTER TABLE "kyc_dossiers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kyc_dossiers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "kyc_dossiers_owner" ON "kyc_dossiers"
  USING ("user_id" = app_current_user_id())
  WITH CHECK ("user_id" = app_current_user_id());--> statement-breakpoint
CREATE POLICY "kyc_dossiers_partner_read" ON "kyc_dossiers" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "connected_accounts" ca
     WHERE ca."user_id" = "kyc_dossiers"."user_id"
       AND ca."partner_id" = app_current_partner_id()
       AND ca."status" IN ('pending', 'active')
  ));--> statement-breakpoint
CREATE POLICY "kyc_dossiers_admin_read" ON "kyc_dossiers" FOR SELECT
  USING (app_current_role() = 'admin');--> statement-breakpoint

ALTER TABLE "partner_kyc_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "partner_kyc_reviews" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "partner_kyc_reviews_owner_read" ON "partner_kyc_reviews" FOR SELECT
  USING ("user_id" = app_current_user_id());--> statement-breakpoint
CREATE POLICY "partner_kyc_reviews_partner" ON "partner_kyc_reviews"
  USING ("partner_id" = app_current_partner_id())
  WITH CHECK (
    "partner_id" = app_current_partner_id()
    AND EXISTS (
      SELECT 1 FROM "connected_accounts" ca
       WHERE ca."id" = "partner_kyc_reviews"."connected_account_id"
         AND ca."partner_id" = app_current_partner_id()
         AND ca."user_id" = "partner_kyc_reviews"."user_id"
    )
  );--> statement-breakpoint
CREATE POLICY "partner_kyc_reviews_admin_read" ON "partner_kyc_reviews" FOR SELECT
  USING (app_current_role() = 'admin');--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON TABLE "kyc_dossiers" TO ccn_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "partner_kyc_reviews" TO ccn_app;--> statement-breakpoint

-- Existing active relationships remain visible, but are deliberately not
-- backfilled as approved. New execution is blocked until the licensed partner
-- records a review under the current policy.

CREATE OR REPLACE FUNCTION partner_review_client(
  p_account_id uuid, p_accept boolean, p_reason text
) RETURNS connection_status
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_partner uuid := app_current_partner_id();
  v_actor uuid := app_current_user_id();
  v_acct connected_accounts;
  v_kyc kyc_status;
  v_review partner_kyc_reviews;
  v_next connection_status;
  v_action text;
BEGIN
  IF v_partner IS NULL THEN
    RAISE EXCEPTION 'partner_review_client requires a partner scope';
  END IF;
  SELECT * INTO v_acct FROM connected_accounts
    WHERE id = p_account_id AND partner_id = v_partner;
  IF v_acct.id IS NULL THEN
    RAISE EXCEPTION 'connection % is not at this partner', p_account_id;
  END IF;

  v_next := CASE WHEN p_accept THEN 'active' ELSE 'declined' END::connection_status;
  IF v_acct.status = v_next THEN
    RAISE EXCEPTION 'connection % is already %', p_account_id, v_next;
  END IF;

  SELECT * INTO v_kyc FROM kyc_status WHERE user_id = v_acct.user_id;
  SELECT * INTO v_review FROM partner_kyc_reviews
    WHERE connected_account_id = p_account_id AND partner_id = v_partner;

  IF p_accept AND NOT (
    coalesce(v_kyc.identity_verified, false)
    AND coalesce(v_kyc.compliance_confirmed, false)
    AND coalesce(v_kyc.risk_completed, false)
    AND coalesce(v_kyc.funds_confirmed, false)
  ) THEN
    RAISE EXCEPTION 'client % has an incomplete KYC intake package', v_acct.user_id;
  END IF;
  IF p_accept AND NOT (
    v_review.status = 'approved'
    AND v_review.identity_verified
    AND v_review.address_verified
    AND v_review.sanctions_clear
    AND v_review.pep_review_complete
    AND v_review.funds_verified
    AND v_review.tax_documentation_complete
    AND v_review.aml_risk_rating IS NOT NULL
    AND v_review.next_review_at > now()
  ) THEN
    RAISE EXCEPTION 'client % has no approved partner KYC review', v_acct.user_id;
  END IF;
  IF p_accept AND (coalesce(v_kyc.is_pep, false) OR v_review.aml_risk_rating = 'high')
      AND NOT v_review.senior_approval THEN
    RAISE EXCEPTION 'client % requires senior approval', v_acct.user_id;
  END IF;

  v_action := CASE
    WHEN p_accept AND v_acct.status = 'declined' THEN 'client.reinstated'
    WHEN p_accept THEN 'client.accepted'
    WHEN v_acct.status = 'active' THEN 'client.revoked'
    ELSE 'client.declined'
  END;

  UPDATE connected_accounts
     SET status = v_next, reviewed_at = now(), updated_at = now(),
         decline_reason = CASE WHEN p_accept THEN NULL ELSE p_reason END
   WHERE id = p_account_id;

  IF NOT p_accept THEN
    INSERT INTO partner_kyc_reviews(
      connected_account_id, partner_id, user_id, policy_key, status,
      reviewed_by, reviewed_at, notes
    ) VALUES (
      p_account_id, v_partner, v_acct.user_id, coalesce(v_review.policy_key, 'not-assessed'),
      'declined', v_actor, now(), p_reason
    ) ON CONFLICT (connected_account_id) DO UPDATE SET
      status = 'declined', reviewed_by = v_actor, reviewed_at = now(),
      notes = p_reason, updated_at = now();
  END IF;

  PERFORM audit_append(
    'user', v_actor, v_acct.user_id, v_partner, v_action,
    'connected_accounts', p_account_id,
    jsonb_build_object(
      'from', v_acct.status::text,
      'to', v_next::text,
      'kyc_tier', coalesce(v_kyc.tier::text, 'none'),
      'identity_verified', coalesce(v_kyc.identity_verified, false),
      'compliance_confirmed', coalesce(v_kyc.compliance_confirmed, false),
      'risk_completed', coalesce(v_kyc.risk_completed, false),
      'funds_confirmed', coalesce(v_kyc.funds_confirmed, false),
      'is_pep', coalesce(v_kyc.is_pep, false),
      'policy_key', v_review.policy_key,
      'aml_risk_rating', v_review.aml_risk_rating,
      'senior_approval', coalesce(v_review.senior_approval, false),
      'reason', p_reason));
  RETURN v_next;
END $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION partner_review_client(uuid, boolean, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION partner_review_client(uuid, boolean, text) TO ccn_app;
