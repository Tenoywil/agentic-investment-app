-- Settlement moves the money.
--
-- The deepest "nothing connects" gap in the product: an investor authorized an
-- order, the firm accepted and settled it, and their portfolio never changed.
-- No position appeared, cash never fell — the screens told a story whose
-- ending never arrived, and the platform read as disconnected data instead of
-- one system. The position only ever appeared if a statement was later pulled
-- and reconciled by hand.
--
-- `settle_order` now finishes the story it starts. When the firm confirms
-- settlement:
--
--   * the instrument becomes (or grows) a holding under the client's account
--     at that firm, so the portfolio shows the position the moment the desk
--     presses Settle — the same pg_notify the function already emits is what
--     refreshes the investor's open screens;
--   * the client's cash at that firm (the no-instrument holding
--     `partner_confirm_funds` feeds) falls by the amount plus any reported
--     fee. Floored at zero: if CCN's cash record is short because a funding
--     was never recorded here, a negative balance would read as a bug rather
--     than the truth ("our record of your cash was incomplete"), and the firm
--     remains the book of record either way.
--
-- Reconciliation stays the corrective path for everything a settlement cannot
-- know (dividends, off-platform trades, corrections); it is no longer the only
-- way an investment the platform itself routed reaches the portfolio.
--
-- Same signature as 0019, so CREATE OR REPLACE swaps the body and existing
-- grants stand.

CREATE OR REPLACE FUNCTION settle_order(
  p_order_id uuid,
  p_partner_id uuid,
  p_unit_price_minor bigint DEFAULT NULL,
  p_units numeric DEFAULT NULL,
  p_fee_minor bigint DEFAULT NULL,
  p_external_ref text DEFAULT NULL
) RETURNS orders
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order orders;
  v_acct uuid;
  v_position uuid;
  v_cash uuid;
  v_name text;
BEGIN
  IF p_unit_price_minor IS NOT NULL AND p_unit_price_minor < 0 THEN
    RAISE EXCEPTION 'a unit price cannot be negative';
  END IF;
  IF p_units IS NOT NULL AND p_units <= 0 THEN
    RAISE EXCEPTION 'units must be greater than zero';
  END IF;
  IF p_fee_minor IS NOT NULL AND p_fee_minor < 0 THEN
    RAISE EXCEPTION 'a fee cannot be negative';
  END IF;

  UPDATE orders SET
      status = 'settled',
      settled_at = now(),
      -- coalesce, not assignment: settling twice is already refused by the
      -- status guard, but a NULL argument must never blank a figure a firm
      -- has already given us.
      unit_price_minor = coalesce(p_unit_price_minor, unit_price_minor),
      units = coalesce(p_units, units),
      fee_minor = coalesce(p_fee_minor, fee_minor),
      external_ref = coalesce(nullif(btrim(p_external_ref), ''), external_ref),
      updated_at = now()
    WHERE id = p_order_id AND partner_id = p_partner_id AND status = 'accepted'
    RETURNING * INTO v_order;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'order % is not in a state partner % can settle', p_order_id, p_partner_id;
  END IF;

  -- The client's account at this firm. Settlement can only move recorded money
  -- into a recorded relationship; without an account row there is nowhere to
  -- put the position, and the reconciliation path remains the way it arrives.
  SELECT id INTO v_acct FROM connected_accounts
    WHERE user_id = v_order.user_id AND partner_id = p_partner_id
    ORDER BY created_at LIMIT 1;

  IF v_acct IS NOT NULL AND v_order.instrument_id IS NOT NULL THEN
    -- The position: one row per instrument per account, grown on each settle.
    SELECT id INTO v_position FROM holdings
      WHERE connected_account_id = v_acct AND instrument_id = v_order.instrument_id
      ORDER BY created_at LIMIT 1;
    IF v_position IS NULL THEN
      SELECT name INTO v_name FROM instruments WHERE id = v_order.instrument_id;
      INSERT INTO holdings(user_id, connected_account_id, instrument_id, name, value_minor, currency)
        VALUES (v_order.user_id, v_acct, v_order.instrument_id,
                coalesce(v_name, 'Settled position'), v_order.amount_minor, v_order.currency);
    ELSE
      UPDATE holdings
         SET value_minor = value_minor + v_order.amount_minor, updated_at = now()
       WHERE id = v_position;
    END IF;

    -- The cash it was paid from: the same no-instrument row per currency that
    -- partner_confirm_funds feeds. Floored at zero — see the header.
    SELECT id INTO v_cash FROM holdings
      WHERE connected_account_id = v_acct AND instrument_id IS NULL
        AND currency = v_order.currency
      ORDER BY created_at LIMIT 1;
    IF v_cash IS NOT NULL THEN
      UPDATE holdings
         SET value_minor = greatest(0, value_minor - v_order.amount_minor - coalesce(v_order.fee_minor, 0)),
             updated_at = now()
       WHERE id = v_cash;
    END IF;
  END IF;

  PERFORM audit_append('system', NULL, v_order.user_id, p_partner_id, 'order.settled', 'order', v_order.id,
    -- ::text on the numerics — see 0019: every reader parses JSON with doubles,
    -- and minor-unit figures cross boundaries as strings everywhere else.
    jsonb_build_object(
      'unit_price_minor', v_order.unit_price_minor::text,
      'units', v_order.units::text,
      'fee_minor', v_order.fee_minor::text,
      'external_ref', v_order.external_ref,
      'moved_to_portfolio', (v_acct IS NOT NULL AND v_order.instrument_id IS NOT NULL)));
  PERFORM pg_notify('ccn_events', jsonb_build_object('type', 'order.settled',
    'order_id', v_order.id, 'user_id', v_order.user_id, 'partner_id', p_partner_id, 'status', 'settled')::text);
  RETURN v_order;
END $$;
