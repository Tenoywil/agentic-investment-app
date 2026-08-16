-- Partners get a face.
--
-- Every surface that names an executing firm renders a text code where a brand
-- should be. The bytes live in the row (same decision as 0027's KYC
-- documents): a logo is small, it inherits the table's RLS instead of growing
-- a parallel storage ACL, and there is no external URL for a console operator
-- to point at something CCN never vetted. 256KB is generous for a logo and
-- small enough that reading partner rows stays cheap.
--
-- Writes go through partner_update_logo — the same shape as
-- partner_update_profile: partner-scoped, validated, audited. `code`,
-- `regulator` and `agreement_status` remain admin-only; a logo is the one
-- piece of brand identity a firm should own outright.

ALTER TABLE partners ADD COLUMN IF NOT EXISTS logo bytea;--> statement-breakpoint
ALTER TABLE partners ADD COLUMN IF NOT EXISTS logo_mime text;--> statement-breakpoint
ALTER TABLE partners
  ADD CONSTRAINT partners_logo_size CHECK (logo IS NULL OR octet_length(logo) <= 262144);--> statement-breakpoint
ALTER TABLE partners
  ADD CONSTRAINT partners_logo_mime CHECK (
    logo_mime IS NULL OR logo_mime IN ('image/png', 'image/jpeg', 'image/svg+xml', 'image/webp')
  );--> statement-breakpoint
ALTER TABLE partners
  ADD CONSTRAINT partners_logo_pair CHECK ((logo IS NULL) = (logo_mime IS NULL));--> statement-breakpoint
COMMENT ON COLUMN partners.logo IS 'The firm''s logo, <=256KB. NULL means the UI renders its monogram mark.';--> statement-breakpoint

CREATE OR REPLACE FUNCTION partner_update_logo(
  p_logo bytea, p_mime text
) RETURNS partners
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_partner uuid := app_current_partner_id();
  v_row partners;
BEGIN
  IF v_partner IS NULL THEN
    RAISE EXCEPTION 'partner_update_logo requires a partner scope';
  END IF;
  IF (p_logo IS NULL) <> (p_mime IS NULL) THEN
    RAISE EXCEPTION 'logo bytes and mime type travel together';
  END IF;

  UPDATE partners SET
      logo = p_logo,
      logo_mime = p_mime,
      updated_at = now()
    WHERE id = v_partner
    RETURNING * INTO v_row;

  -- Sizes only in the audit detail — the log records that the brand changed
  -- and by whom, not a base64 blob.
  PERFORM audit_append('user', app_current_user_id(), NULL, v_partner,
    'partner.logo_updated', 'partners', v_partner,
    jsonb_build_object(
      'mime', p_mime,
      'size', CASE WHEN p_logo IS NULL THEN 0 ELSE octet_length(p_logo) END));
  RETURN v_row;
END $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION partner_update_logo(bytea, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION partner_update_logo(bytea, text) TO ccn_app;
