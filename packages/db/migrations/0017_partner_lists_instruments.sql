-- A product a partner lists is a product an investor can see.
--
-- "List a product" wrote a `product_listings` row carrying a name and a type.
-- The marketplace reads `instruments`. The two tables have no foreign key in
-- either direction and nothing joined them, so a firm could list a fund, watch
-- it appear on their own Products tab, and no investor would ever see it. The
-- pause switch beside it changed nothing on the customer side either, because
-- there was nothing there to pause.
--
-- So the console moves onto the table the marketplace actually reads.
-- `product_listings` is left in place and untouched — it holds audited history,
-- and dropping a table to fix a join is not a trade worth making — but nothing
-- writes it from here on.
--
-- Two things make this a migration rather than a route change:
--
--   1. `instruments` also holds the seeded reference catalogue, which no partner
--      may edit. The app role has SELECT and INSERT but the only INSERT policy
--      is `instruments_admin_write` (`app_current_role() = 'admin'`), and there
--      is no UPDATE grant at all — a partner_operator's write fails at the
--      database, which is correct and is why this follows the 0014 precedent: a
--      SECURITY DEFINER function that reads the partner from the GUC rather than
--      taking it as an argument, so no id can be substituted.
--
--   2. The marketplace had no notion of a listing being live. `blocked` is not
--      it — that means "screened out for your suitability" and renders as a
--      refusal with reasons. A paused listing is simply not offered.

CREATE TYPE "listing_status" AS ENUM ('live', 'paused');--> statement-breakpoint

ALTER TABLE "instruments"
  ADD COLUMN IF NOT EXISTS "listing_status" "listing_status" NOT NULL DEFAULT 'live';--> statement-breakpoint

-- Everything already in the catalogue keeps being offered, which is what the
-- default gives us; the column is stated explicitly so a reader of this file
-- does not have to infer the backfill.
UPDATE "instruments" SET "listing_status" = 'live' WHERE "listing_status" IS NULL;--> statement-breakpoint

-- The marketplace filters on it, so an index earns its place immediately.
CREATE INDEX IF NOT EXISTS "instruments_listing_status_idx"
  ON "instruments" ("listing_status");--> statement-breakpoint

/**
 * Create or amend one of this partner's instruments.
 *
 * `p_id` null creates; otherwise it amends, and only a row this partner already
 * owns — a seeded reference instrument belongs to nobody's console and is
 * refused. `slug` is NOT NULL UNIQUE and is derived once at creation and never
 * changed afterwards: it is the key `reconcile_match` and the holdings pull join
 * on, so renaming a product must not silently orphan what people already hold.
 */
CREATE OR REPLACE FUNCTION partner_upsert_instrument(
  p_id uuid,
  p_name text,
  p_type instrument_type,
  p_abbr text,
  p_currency currency,
  p_min_investment_minor bigint,
  p_term text,
  p_metric text,
  p_metric_label text,
  p_risk risk_rating,
  p_description text,
  p_region text
) RETURNS instruments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner uuid;
  v_row instruments;
  v_slug text;
  v_regulator regulator;
BEGIN
  v_partner := app_current_partner_id();
  IF v_partner IS NULL THEN
    RAISE EXCEPTION 'no partner in scope; partner_upsert_instrument is for the console only';
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_row FROM instruments WHERE id = p_id AND partner_id = v_partner;
    IF v_row.id IS NULL THEN
      -- Not found and not-yours are deliberately the same answer, so ids cannot
      -- be probed by watching which one comes back.
      RAISE EXCEPTION 'instrument % is not listed by this partner', p_id;
    END IF;

    UPDATE instruments SET
      name                 = p_name,
      type                 = p_type,
      abbr                 = p_abbr,
      currency             = p_currency,
      min_investment_minor = p_min_investment_minor,
      term                 = p_term,
      metric               = p_metric,
      metric_label         = p_metric_label,
      risk                 = p_risk,
      description          = p_description,
      region               = p_region,
      updated_at           = now()
    WHERE id = p_id
    RETURNING * INTO v_row;

    PERFORM audit_append('user', app_current_user_id(), NULL, v_partner,
      'instrument.updated', 'instruments', v_row.id,
      jsonb_build_object('name', p_name, 'type', p_type));
    RETURN v_row;
  END IF;

  -- A slug a human can read, unique per partner by construction. The suffix is
  -- the partner's own code, so two firms may both list "USD Income Fund".
  SELECT lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || lower(code)
    INTO v_slug FROM partners WHERE id = v_partner;
  v_slug := trim(both '-' from v_slug);

  -- The regulator shown on the deal card is the firm's own, never typed in: it
  -- is a compliance claim about the executing partner, and a console that could
  -- set it freely would be a console that could claim any regulator it liked.
  SELECT regulator INTO v_regulator FROM partners WHERE id = v_partner;

  INSERT INTO instruments (
    slug, abbr, type, partner_id, regulator, name, region,
    metric_label, metric, min_investment_minor, currency, term, risk, description
  ) VALUES (
    v_slug, p_abbr, p_type, v_partner, v_regulator, p_name, p_region,
    p_metric_label, p_metric, p_min_investment_minor, p_currency, p_term, p_risk, p_description
  )
  RETURNING * INTO v_row;

  PERFORM audit_append('user', app_current_user_id(), NULL, v_partner,
    'instrument.listed', 'instruments', v_row.id,
    jsonb_build_object('name', p_name, 'slug', v_slug, 'type', p_type));
  RETURN v_row;
END $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION partner_upsert_instrument(uuid, text, instrument_type, text, currency, bigint, text, text, text, risk_rating, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION partner_upsert_instrument(uuid, text, instrument_type, text, currency, bigint, text, text, text, risk_rating, text, text) TO ccn_app;--> statement-breakpoint

/**
 * Take one of this partner's instruments off the marketplace, or put it back.
 *
 * Toggling rather than setting, matching what the console already did for
 * `product_listings`: the operator presses a switch, and the server decides what
 * the other side of it is, so two clicks in flight cannot land on the same
 * state twice.
 */
CREATE OR REPLACE FUNCTION partner_toggle_instrument(p_id uuid) RETURNS listing_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner uuid;
  v_status listing_status;
BEGIN
  v_partner := app_current_partner_id();
  IF v_partner IS NULL THEN
    RAISE EXCEPTION 'no partner in scope; partner_toggle_instrument is for the console only';
  END IF;

  -- Both arms cast explicitly: inside plpgsql the bare literals resolve as
  -- `text`, and a CASE of two texts will not assign to a listing_status column.
  UPDATE instruments
     SET listing_status = CASE
           WHEN listing_status = 'live' THEN 'paused'::listing_status
           ELSE 'live'::listing_status
         END,
         updated_at = now()
   WHERE id = p_id AND partner_id = v_partner
  RETURNING listing_status INTO v_status;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'instrument % is not listed by this partner', p_id;
  END IF;

  PERFORM audit_append('user', app_current_user_id(), NULL, v_partner,
    'instrument.' || v_status::text, 'instruments', p_id, '{}'::jsonb);
  RETURN v_status;
END $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION partner_toggle_instrument(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION partner_toggle_instrument(uuid) TO ccn_app;
