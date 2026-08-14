-- Listing a product must not fail because of a name somebody already used.
--
-- `0017` derived the slug from the product's name and the firm's code, and
-- `instruments.slug` is NOT NULL UNIQUE. So the second product a firm listed
-- under the same name raised 23505 and the console answered an unexplained 500
-- — and because an operator who has just seen a failure retries, the *first*
-- success made every subsequent attempt fail too. That is the shape it took in
-- production: "saving a product is broken", on a database where everything had
-- been applied correctly.
--
-- Names collide for ordinary reasons. A firm lists "USD Income Fund" for two
-- share classes; a name is re-used after a product is delisted; two names
-- normalise to the same slug because the difference between them was
-- punctuation. None of those is an error worth refusing a listing over.
--
-- The slug is an internal key — it is what `reconcile_match` and the holdings
-- pull join on, and it is never shown to anyone — so making it unique by
-- construction costs nothing a human would notice. The NAME stays exactly what
-- the operator typed; only the key behind it gains a suffix.
--
-- Two mechanisms, because they cover different failures:
--
--   1. A lookup loop that skips slugs already taken. This handles the ordinary
--      case and produces a readable key (`usd-income-fund-sag-2`).
--   2. An exception handler around the INSERT that retries. The loop above has
--      a race — two operators listing the same name at the same instant both
--      see the slug free — and the unique index is what actually decides. A
--      constraint you can lose a race against needs a retry, not just a check.

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
  v_code text;
  v_base text;
  v_slug text;
  v_regulator regulator;
  v_try int := 0;
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

    -- The slug is deliberately not re-derived on an amend: holdings and
    -- reconciliation join on it, so renaming a product must not orphan what
    -- people already hold.
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

  SELECT code, regulator INTO v_code, v_regulator FROM partners WHERE id = v_partner;

  -- A slug a human can read. `coalesce`/`nullif` cover a name made entirely of
  -- punctuation, which would otherwise trim away to nothing and violate NOT NULL.
  v_base := trim(both '-' from
    lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || lower(coalesce(v_code, 'ccn')));
  v_base := coalesce(nullif(v_base, ''), 'listing-' || lower(coalesce(v_code, 'ccn')));

  -- Up to 50 attempts. Past that something is wrong that a 51st insert will not
  -- fix, and raising is better than looping in a transaction holding locks.
  LOOP
    v_try := v_try + 1;
    v_slug := CASE WHEN v_try = 1 THEN v_base ELSE v_base || '-' || v_try END;
    -- Skip what is visibly taken; the INSERT below is what actually decides.
    CONTINUE WHEN v_try < 50 AND EXISTS (SELECT 1 FROM instruments WHERE slug = v_slug);

    BEGIN
      INSERT INTO instruments (
        slug, abbr, type, partner_id, regulator, name, region,
        metric_label, metric, min_investment_minor, currency, term, risk, description
      ) VALUES (
        v_slug, p_abbr, p_type, v_partner, v_regulator, p_name, p_region,
        p_metric_label, p_metric, p_min_investment_minor, p_currency, p_term, p_risk, p_description
      )
      RETURNING * INTO v_row;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      -- Lost the race to a concurrent listing. Try the next suffix.
      IF v_try >= 50 THEN
        RAISE EXCEPTION 'could not find a free slug for % after % attempts', p_name, v_try;
      END IF;
    END;
  END LOOP;

  PERFORM audit_append('user', app_current_user_id(), NULL, v_partner,
    'instrument.listed', 'instruments', v_row.id,
    jsonb_build_object('name', p_name, 'slug', v_slug, 'type', p_type));
  RETURN v_row;
END $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION partner_upsert_instrument(uuid, text, instrument_type, text, currency, bigint, text, text, text, risk_rating, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION partner_upsert_instrument(uuid, text, instrument_type, text, currency, bigint, text, text, text, risk_rating, text, text) TO ccn_app;
