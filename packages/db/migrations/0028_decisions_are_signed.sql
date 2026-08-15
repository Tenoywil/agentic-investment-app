-- Decisions are signed.
--
-- `audit_log.actor_id` has existed since the first migration, and four of the
-- functions a desk operator actually presses buttons through never filled it:
-- accept_order wrote ('user', NULL), settle_order and reconcile_match/reject
-- wrote ('system', NULL). So the firm's whole record of who accepted an
-- order, who confirmed an execution, and who matched or rejected a statement
-- line was signed by nobody — on the one log a compliance review reads to
-- answer exactly that question.
--
-- Each function now records `app_current_user_id()` as the actor, with actor
-- type 'user' when a person is present and 'system' when not (ingestion jobs
-- and maintenance run without a user GUC, and must not masquerade as one).
-- Bodies are otherwise byte-identical to their latest versions (accept_order
-- from 0019, settle_order from 0024, reconcile_match from 0014,
-- reconcile_reject from 0002). Existing rows keep their NULLs: the log is
-- append-only, and rewriting history to look better signed is exactly what an
-- audit log exists to make impossible.

CREATE OR REPLACE FUNCTION accept_order(
  p_order_id uuid, p_partner_id uuid, p_settlement_eta timestamptz DEFAULT NULL
) RETURNS orders
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order orders;
BEGIN
  UPDATE orders SET
      status = 'accepted',
      accepted_at = now(),
      settlement_eta = coalesce(p_settlement_eta, settlement_eta),
      updated_at = now()
    WHERE id = p_order_id AND partner_id = p_partner_id AND status = 'created'
    RETURNING * INTO v_order;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'order % is not in a state partner % can accept', p_order_id, p_partner_id;
  END IF;
  PERFORM audit_append(
    CASE WHEN app_current_user_id() IS NULL THEN 'system' ELSE 'user' END::actor_type,
    app_current_user_id(),
    v_order.user_id, p_partner_id, 'order.accepted', 'order', v_order.id,
    jsonb_build_object('settlement_eta', v_order.settlement_eta));
  PERFORM pg_notify('ccn_events', jsonb_build_object('type', 'order.accepted',
    'order_id', v_order.id, 'user_id', v_order.user_id, 'partner_id', p_partner_id, 'status', 'accepted')::text);
  RETURN v_order;
END $$;--> statement-breakpoint

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

  PERFORM audit_append(
    CASE WHEN app_current_user_id() IS NULL THEN 'system' ELSE 'user' END::actor_type,
    app_current_user_id(),
    v_order.user_id, p_partner_id, 'order.settled', 'order', v_order.id,
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
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION reconcile_match(p_item_id uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item reconciliation_items;
  v_acct uuid;
  v_instrument uuid;
  v_holding uuid;
  v_slug text;
BEGIN
  SELECT * INTO v_item FROM reconciliation_items WHERE id = p_item_id AND status = 'pending';
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'reconciliation item % is not pending', p_item_id;
  END IF;
  IF v_item.user_id IS NULL OR v_item.partner_id IS NULL THEN
    RAISE EXCEPTION 'reconciliation item % lacks a user or partner', p_item_id;
  END IF;

  SELECT id INTO v_acct FROM connected_accounts
    WHERE user_id = v_item.user_id AND partner_id = v_item.partner_id LIMIT 1;
  IF v_acct IS NULL THEN
    INSERT INTO connected_accounts(user_id, partner_id, label, status, reviewed_at)
      VALUES (v_item.user_id, v_item.partner_id, v_item.parsed->>'name', 'active', now())
      RETURNING id INTO v_acct;
  END IF;

  v_slug := v_item.parsed->>'instrumentSlug';
  IF v_slug IS NOT NULL THEN
    SELECT id INTO v_instrument FROM instruments WHERE slug = v_slug;
  END IF;

  INSERT INTO holdings(user_id, connected_account_id, instrument_id, name, value_minor, currency, return_label)
    VALUES (
      v_item.user_id, v_acct, v_instrument,
      coalesce(v_item.parsed->>'name', 'Imported holding'),
      coalesce((v_item.parsed->>'valueMinor')::bigint, 0),
      coalesce((v_item.parsed->>'currency')::currency, 'USD'::currency),
      v_item.parsed->>'returnLabel')
    RETURNING id INTO v_holding;

  UPDATE reconciliation_items SET status = 'matched', updated_at = now() WHERE id = p_item_id;

  PERFORM audit_append(
    CASE WHEN app_current_user_id() IS NULL THEN 'system' ELSE 'user' END::actor_type,
    app_current_user_id(),
    v_item.user_id, v_item.partner_id, 'reconciliation.matched',
    'holding', v_holding, jsonb_build_object('item_id', p_item_id, 'value_minor', v_item.parsed->>'valueMinor'));
  RETURN v_holding;
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION reconcile_reject(p_item_id uuid, p_reason text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item reconciliation_items;
BEGIN
  SELECT * INTO v_item FROM reconciliation_items WHERE id = p_item_id AND status = 'pending';
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'reconciliation item % is not pending', p_item_id;
  END IF;
  UPDATE reconciliation_items SET status = 'rejected', updated_at = now() WHERE id = p_item_id;
  PERFORM audit_append(
    CASE WHEN app_current_user_id() IS NULL THEN 'system' ELSE 'user' END::actor_type,
    app_current_user_id(),
    v_item.user_id, v_item.partner_id, 'reconciliation.rejected',
    'reconciliation_item', p_item_id, jsonb_build_object('reason', p_reason));
END $$;
