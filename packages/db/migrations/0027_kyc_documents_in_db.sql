-- KYC documents become real.
--
-- `kyc_documents` has existed since 0000 as metadata pointing at a Storage
-- bucket ("the file itself is in Storage") — and no bucket, no upload path and
-- no reader was ever built, so the KYC package CCN passes to a firm carried
-- declarations with not one document behind them. A desk reviewing a client
-- had the person's word, tiered, and nothing to look at.
--
-- The file now lives in the row, capped at 2MB. That is a deliberate trade:
-- an ID photo or a PDF statement fits comfortably, the bytes inherit the
-- table's RLS instead of a bucket's separate ACL surface (one policy model,
-- not two that can disagree), and no signed-URL machinery exists to leak.
--
-- Who reads them:
--   * the owner (existing tenant policy),
--   * CCN admin (0008),
--   * NEW: a firm where the owner is an ACTIVE client — the firm is the
--     regulated KYC owner and reviews these before accepting; pending is
--     enough, since review happens before acceptance.
--
-- `step` doubles as the document kind (identity / funds / compliance for
-- address-and-tax) — the enum already exists and maps one-to-one onto what a
-- desk asks for.

ALTER TABLE "kyc_documents" ALTER COLUMN "storage_path" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD COLUMN IF NOT EXISTS "mime" text;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD COLUMN IF NOT EXISTS "bytes" bytea;--> statement-breakpoint
ALTER TABLE "kyc_documents"
  ADD CONSTRAINT "kyc_documents_size" CHECK ("bytes" IS NULL OR octet_length("bytes") <= 2097152);--> statement-breakpoint

COMMENT ON COLUMN "kyc_documents"."bytes" IS 'The document itself, <=2MB. RLS-governed like every other column; no separate storage ACL to disagree with.';--> statement-breakpoint

-- The firm the person is connecting to (or connected at) may read the
-- package. Pending included: partner_review_client is the accept gate, and
-- the review is exactly when the desk needs to see the documents.
CREATE POLICY "kyc_documents_partner_read" ON "kyc_documents" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "connected_accounts" ca
     WHERE ca."user_id" = "kyc_documents"."user_id"
       AND ca."partner_id" = app_current_partner_id()
       AND ca."status" IN ('pending', 'active')
  ));--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "kyc_documents_user_idx" ON "kyc_documents" ("user_id", "created_at");
