-- Settling an order says what was actually done, and a firm can correct its own
-- record.
--
-- Two unrelated gaps that both need the database, so they land together rather
-- than as two migrations against the same deploy step.
--
-- 1. SETTLEMENT DETAIL. `settle_order` wrote exactly three columns: status,
--    settled_at, updated_at. There was nowhere to record the price, the units,
--    the fee, or the firm's own reference — so an investor was told "settled"
--    and nothing else, and the desk that executed the trade had no field to put
--    the execution in. "Settled" without a price is a claim the product cannot
--    substantiate, which is the thing this codebase keeps deciding not to do.
--
--    `settlement_eta` is the same failure from the other end: the column has
--    existed since 0001, the exec dialog tells investors the firm sets it on
--    acceptance, and nothing has ever written it. Accepting takes one now.
--
--    Every field is optional. A firm that settles without telling us the unit
--    price is a firm we still have to let settle; what we must not do is invent
--    the number to fill the column.
--
-- 2. FIRM PROFILE. `partners` has an UPDATE grant to ccn_app and exactly one
--    UPDATE policy — `partners_admin_correct`, requiring app_current_role() =
--    'admin' — so an operator's transaction fails it and a firm cannot correct
--    its own name. A partner-scoped UPDATE policy would work but would let a
--    firm write every column on the row, and three of them must not be a
--    firm's to set: `code` is the adapter registry's key, `regulator` is
--    rendered to investors on every deal card as a compliance claim, and
--    `agreement_status` gates live order routing. RLS cannot restrict columns,
--    so this is a function — the same shape as 0014 and 0017, for the same
--    reason.

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "unit_price_minor" bigint,
  ADD COLUMN IF NOT EXISTS "units" numeric(20, 6),
  ADD COLUMN IF NOT EXISTS "fee_minor" bigint,
  ADD COLUMN IF NOT EXISTS "external_ref" text;--> statement-breakpoint

-- Nullable and no default, deliberately. A zero fee is a statement that no fee
-- was charged; NULL is "the firm did not tell us", and on a record an investor
-- reads those are not the same thing.
COMMENT ON COLUMN "orders"."unit_price_minor" IS 'Execution price per unit in minor units, as reported by the settling firm. NULL = not reported.';--> statement-breakpoint
COMMENT ON COLUMN "orders"."units" IS 'Units allocated. NULL = not reported.';--> statement-breakpoint
COMMENT ON COLUMN "orders"."fee_minor" IS 'Fee charged by the firm in minor units. NULL = not reported, 0 = no fee.';--> statement-breakpoint
COMMENT ON COLUMN "orders"."external_ref" IS 'The firm''s own reference for the trade, for reconciliation against their books.';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- accept_order, re-declared to take the settlement date the firm commits to.
--
-- DROP first, not CREATE OR REPLACE. Postgres identifies a function by its
-- argument types, so adding a defaulted parameter would create a SECOND
-- accept_order beside the old one and every existing two-argument call would
-- then fail as ambiguous rather than resolving to either.
--
-- The new argument is optional so a caller that does not have a date can still
-- accept: NULL leaves the column as it was rather than clearing it.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS accept_order(uuid, uuid);--> statement-breakpoint

CREATE FUNCTION accept_order(
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
  PERFORM audit_append('user', NULL, v_order.user_id, p_partner_id, 'order.accepted', 'order', v_order.id,
    jsonb_build_object('settlement_eta', v_order.settlement_eta));
  PERFORM pg_notify('ccn_events', jsonb_build_object('type', 'order.accepted',
    'order_id', v_order.id, 'user_id', v_order.user_id, 'partner_id', p_partner_id, 'status', 'accepted')::text);
  RETURN v_order;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- settle_order, re-declared to record what was actually executed.
--
-- The audit row carries the detail as well as the columns. The columns are the
-- current truth and are what the screens read; the audit row is what the
-- figures were at the moment of settlement, and it is the one a regulator asks
-- for six months later.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS settle_order(uuid, uuid);--> statement-breakpoint

CREATE FUNCTION settle_order(
  p_order_id uuid,
  p_partner_id uuid,
  p_unit_price_minor bigint DEFAULT NULL,
  p_units numeric DEFAULT NULL,
  p_fee_minor bigint DEFAULT NULL,
  p_external_ref text DEFAULT NULL
) RETURNS orders
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order orders;
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

  PERFORM audit_append('system', NULL, v_order.user_id, p_partner_id, 'order.settled', 'order', v_order.id,
    -- ::text on the numerics. jsonb_build_object would write them as JSON
    -- numbers, and every reader of this log parses JSON with a language whose
    -- number type is a double — a big enough minor-unit figure would come back
    -- rounded. Bigints cross every other boundary in this system as strings for
    -- the same reason; an immutable record is the last place to make an
    -- exception.
    jsonb_build_object(
      'unit_price_minor', v_order.unit_price_minor::text,
      'units', v_order.units::text,
      'fee_minor', v_order.fee_minor::text,
      'external_ref', v_order.external_ref));
  PERFORM pg_notify('ccn_events', jsonb_build_object('type', 'order.settled',
    'order_id', v_order.id, 'user_id', v_order.user_id, 'partner_id', p_partner_id, 'status', 'settled')::text);
  RETURN v_order;
END $$;--> statement-breakpoint

-- Dropping the old signatures took their grants with them, so both are set
-- again here. A function the app role cannot execute is a settle button that
-- 42501s at the desk.
REVOKE ALL ON FUNCTION accept_order(uuid, uuid, timestamptz) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION settle_order(uuid, uuid, bigint, numeric, bigint, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION accept_order(uuid, uuid, timestamptz) TO ccn_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION settle_order(uuid, uuid, bigint, numeric, bigint, text) TO ccn_app;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- partner_update_profile: a firm corrects its own record.
--
-- Three fields, and only three. `code`, `regulator` and `agreement_status` are
-- absent by design and stay admin-only:
--
--   code              the adapter registry resolves an executing firm by it
--   regulator         a compliance claim shown to investors on every deal card
--   agreement_status  the gate on live order routing
--
-- A console that could set the last two could claim any regulator it liked and
-- promote itself to live. That is not a permission an operator is refused for
-- lack of trust; it is a fact about who is asserting what to whom.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION partner_update_profile(
  p_name text, p_kind text, p_residency text
) RETURNS partners
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_partner uuid := app_current_partner_id();
  v_before partners;
  v_row partners;
BEGIN
  IF v_partner IS NULL THEN
    RAISE EXCEPTION 'partner_update_profile requires a partner scope';
  END IF;
  IF btrim(coalesce(p_name, '')) = '' THEN
    RAISE EXCEPTION 'a firm needs a name';
  END IF;

  SELECT * INTO v_before FROM partners WHERE id = v_partner;

  UPDATE partners SET
      name = btrim(p_name),
      kind = nullif(btrim(coalesce(p_kind, '')), ''),
      residency = nullif(btrim(coalesce(p_residency, '')), ''),
      updated_at = now()
    WHERE id = v_partner
    RETURNING * INTO v_row;

  -- Both sides recorded. A firm's own name is what investors see beside every
  -- product it lists, so "who changed it, from what, to what" is the question
  -- worth being able to answer.
  PERFORM audit_append('user', app_current_user_id(), NULL, v_partner,
    'partner.profile_updated', 'partners', v_partner,
    jsonb_build_object(
      'from', jsonb_build_object('name', v_before.name, 'kind', v_before.kind,
                                 'residency', v_before.residency),
      'to', jsonb_build_object('name', v_row.name, 'kind', v_row.kind,
                               'residency', v_row.residency)));
  RETURN v_row;
END $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION partner_update_profile(text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION partner_update_profile(text, text, text) TO ccn_app;
