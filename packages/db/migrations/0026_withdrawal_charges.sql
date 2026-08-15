-- Withdrawal charges: the firm's fee, and the tax on it.
--
-- A withdrawal is a service the firm charges for, and in most of CCN's
-- jurisdictions that service attracts consumption tax (Jamaica's GCT at 15%
-- being the canonical case). Without these columns the platform showed a
-- client "withdraw US$500" and the firm paid something different — the fee and
-- tax existed only in the firm's own books, which is exactly the kind of
-- off-record money movement a compliance officer cannot sign off on.
--
-- Three settings on the partner, set by the firm itself through
-- `partner_update_profile`:
--
--   * `withdrawal_fee_flat_minor` — a flat per-withdrawal fee, minor units.
--   * `withdrawal_fee_bps`        — a percentage of the amount, basis points.
--   * `gct_bps`                   — the consumption-tax rate applied TO THE FEE
--                                   (tax on the service, not on the principal).
--
-- And two snapshot columns on each request, computed by `request_withdrawal`
-- from the partner's settings AT REQUEST TIME. A firm changing its fees must
-- not change what an in-flight request costs — the client consented to the
-- figures shown when they asked, so those figures are frozen on the row.
--
-- The client's payout is amount − fee − gct; the firm keeps fee + gct and the
-- recorded cash falls by the full amount. A request whose charges would eat it
-- entirely is refused at the door.

ALTER TABLE "partners"
  ADD COLUMN IF NOT EXISTS "withdrawal_fee_flat_minor" bigint NOT NULL DEFAULT 0
    CHECK ("withdrawal_fee_flat_minor" >= 0);--> statement-breakpoint
ALTER TABLE "partners"
  ADD COLUMN IF NOT EXISTS "withdrawal_fee_bps" integer NOT NULL DEFAULT 0
    CHECK ("withdrawal_fee_bps" BETWEEN 0 AND 10000);--> statement-breakpoint
ALTER TABLE "partners"
  ADD COLUMN IF NOT EXISTS "gct_bps" integer NOT NULL DEFAULT 0
    CHECK ("gct_bps" BETWEEN 0 AND 10000);--> statement-breakpoint

COMMENT ON COLUMN "partners"."withdrawal_fee_flat_minor" IS 'Flat per-withdrawal fee in minor units of the withdrawal currency.';--> statement-breakpoint
COMMENT ON COLUMN "partners"."withdrawal_fee_bps" IS 'Percentage fee on the withdrawal amount, in basis points (100 = 1%).';--> statement-breakpoint
COMMENT ON COLUMN "partners"."gct_bps" IS 'Consumption tax (e.g. GCT) applied to the fee, in basis points (1500 = 15%).';--> statement-breakpoint

ALTER TABLE "withdrawal_requests"
  ADD COLUMN IF NOT EXISTS "fee_minor" bigint NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "withdrawal_requests"
  ADD COLUMN IF NOT EXISTS "gct_minor" bigint NOT NULL DEFAULT 0;--> statement-breakpoint

COMMENT ON COLUMN "withdrawal_requests"."fee_minor" IS 'The firm''s fee, frozen at request time from the partner''s settings then.';--> statement-breakpoint
COMMENT ON COLUMN "withdrawal_requests"."gct_minor" IS 'Consumption tax on the fee, frozen at request time.';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- request_withdrawal now computes and freezes the charges. Same signature, so
-- CREATE OR REPLACE is safe — no caller changes shape.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION request_withdrawal(
  p_account_id uuid, p_amount_minor bigint, p_currency currency
) RETURNS withdrawal_requests
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := app_current_user_id();
  v_acct connected_accounts;
  v_partner partners;
  v_cash bigint;
  v_fee bigint;
  v_gct bigint;
  v_row withdrawal_requests;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'request_withdrawal requires a signed-in user';
  END IF;
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 THEN
    RAISE EXCEPTION 'a withdrawal must be a positive amount';
  END IF;

  SELECT * INTO v_acct FROM connected_accounts
    WHERE id = p_account_id AND user_id = v_user;
  IF v_acct.id IS NULL THEN
    RAISE EXCEPTION 'account % is not one of yours', p_account_id;
  END IF;
  IF v_acct.status <> 'active' THEN
    RAISE EXCEPTION 'account % is not active', p_account_id;
  END IF;

  SELECT coalesce(sum(value_minor), 0) INTO v_cash FROM holdings
    WHERE connected_account_id = p_account_id
      AND instrument_id IS NULL AND currency = p_currency;
  IF v_cash < p_amount_minor THEN
    RAISE EXCEPTION 'insufficient recorded cash: % available', v_cash;
  END IF;

  -- One open request per account: a second while the first is undecided is a
  -- duplicate, not a new intention.
  IF EXISTS (SELECT 1 FROM withdrawal_requests
              WHERE connected_account_id = p_account_id AND status = 'pending') THEN
    RAISE EXCEPTION 'a withdrawal is already pending on this account';
  END IF;

  -- The charges, frozen now. Bankers'-neutral integer arithmetic: round half
  -- away from the client's favour would be a policy choice nobody made, so
  -- plain truncating division — the firm loses the fraction of a cent, not
  -- the client.
  SELECT * INTO v_partner FROM partners WHERE id = v_acct.partner_id;
  v_fee := coalesce(v_partner.withdrawal_fee_flat_minor, 0)
         + (p_amount_minor * coalesce(v_partner.withdrawal_fee_bps, 0)) / 10000;
  v_gct := (v_fee * coalesce(v_partner.gct_bps, 0)) / 10000;
  IF v_fee + v_gct >= p_amount_minor THEN
    RAISE EXCEPTION 'the firm''s charges (%) would consume this withdrawal', v_fee + v_gct;
  END IF;

  INSERT INTO withdrawal_requests(
      user_id, partner_id, connected_account_id, amount_minor, currency, fee_minor, gct_minor)
    VALUES (v_user, v_acct.partner_id, p_account_id, p_amount_minor, p_currency, v_fee, v_gct)
    RETURNING * INTO v_row;

  PERFORM audit_append('user', v_user, v_user, v_acct.partner_id, 'withdrawal.requested',
    'withdrawal_request', v_row.id,
    jsonb_build_object('amount_minor', p_amount_minor::text, 'currency', p_currency::text,
                       'fee_minor', v_fee::text, 'gct_minor', v_gct::text));
  RETURN v_row;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- partner_decide_withdrawal: unchanged logic, but the audit entry now records
-- the frozen charges beside the amount — the payout a compliance reviewer
-- reconstructs from the trail must match the one the firm made.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION partner_decide_withdrawal(
  p_request_id uuid, p_paid boolean, p_reason text DEFAULT NULL, p_reference text DEFAULT NULL
) RETURNS withdrawal_requests
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_partner uuid := app_current_partner_id();
  v_actor uuid := app_current_user_id();
  v_row withdrawal_requests;
  v_cash_row uuid;
  v_cash bigint;
BEGIN
  IF v_partner IS NULL THEN
    RAISE EXCEPTION 'partner_decide_withdrawal requires a partner scope';
  END IF;

  SELECT * INTO v_row FROM withdrawal_requests
    WHERE id = p_request_id AND partner_id = v_partner AND status = 'pending';
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'request % is not pending at this partner', p_request_id;
  END IF;

  IF p_paid THEN
    SELECT id, value_minor INTO v_cash_row, v_cash FROM holdings
      WHERE connected_account_id = v_row.connected_account_id
        AND instrument_id IS NULL AND currency = v_row.currency
      ORDER BY created_at LIMIT 1;
    IF v_cash_row IS NULL OR v_cash < v_row.amount_minor THEN
      RAISE EXCEPTION 'recorded cash (%) no longer covers this withdrawal', coalesce(v_cash, 0);
    END IF;
    UPDATE holdings SET value_minor = value_minor - v_row.amount_minor, updated_at = now()
      WHERE id = v_cash_row;
  ELSIF btrim(coalesce(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'declining needs a reason the client will read';
  END IF;

  UPDATE withdrawal_requests SET
      status = CASE WHEN p_paid THEN 'paid' ELSE 'declined' END::withdrawal_status,
      reason = CASE WHEN p_paid THEN NULL ELSE btrim(p_reason) END,
      reference = nullif(btrim(coalesce(p_reference, '')), ''),
      decided_at = now(),
      updated_at = now()
    WHERE id = p_request_id
    RETURNING * INTO v_row;

  PERFORM audit_append('user', v_actor, v_row.user_id, v_partner,
    CASE WHEN p_paid THEN 'withdrawal.paid' ELSE 'withdrawal.declined' END,
    'withdrawal_request', v_row.id,
    jsonb_build_object('amount_minor', v_row.amount_minor::text, 'currency', v_row.currency::text,
                       'fee_minor', v_row.fee_minor::text, 'gct_minor', v_row.gct_minor::text,
                       'net_minor', (v_row.amount_minor - v_row.fee_minor - v_row.gct_minor)::text,
                       'reason', v_row.reason, 'reference', v_row.reference));
  RETURN v_row;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- partner_update_profile grows the three charge settings. DROP first — the
-- defaulted parameters change the identity (see 0019 and 0025, same move).
-- NULL keeps the stored value for every one of them, so an older client that
-- never sends fees cannot silently zero a firm's charges.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS partner_update_profile(text, text, text, text);--> statement-breakpoint

CREATE FUNCTION partner_update_profile(
  p_name text, p_kind text, p_residency text, p_funding_instructions text DEFAULT NULL,
  p_withdrawal_fee_flat_minor bigint DEFAULT NULL,
  p_withdrawal_fee_bps integer DEFAULT NULL,
  p_gct_bps integer DEFAULT NULL
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
  IF p_withdrawal_fee_flat_minor IS NOT NULL AND p_withdrawal_fee_flat_minor < 0 THEN
    RAISE EXCEPTION 'a fee cannot be negative';
  END IF;
  IF p_withdrawal_fee_bps IS NOT NULL AND (p_withdrawal_fee_bps < 0 OR p_withdrawal_fee_bps > 10000) THEN
    RAISE EXCEPTION 'the percentage fee must be between 0 and 10000 basis points';
  END IF;
  IF p_gct_bps IS NOT NULL AND (p_gct_bps < 0 OR p_gct_bps > 10000) THEN
    RAISE EXCEPTION 'the tax rate must be between 0 and 10000 basis points';
  END IF;

  SELECT * INTO v_before FROM partners WHERE id = v_partner;

  UPDATE partners SET
      name = btrim(p_name),
      kind = nullif(btrim(coalesce(p_kind, '')), ''),
      residency = nullif(btrim(coalesce(p_residency, '')), ''),
      -- NULL leaves the stored instructions alone (a profile save that did not
      -- touch them must not blank them); an empty string clears them.
      funding_instructions = CASE
        WHEN p_funding_instructions IS NULL THEN funding_instructions
        ELSE nullif(btrim(p_funding_instructions), '')
      END,
      withdrawal_fee_flat_minor = coalesce(p_withdrawal_fee_flat_minor, withdrawal_fee_flat_minor),
      withdrawal_fee_bps = coalesce(p_withdrawal_fee_bps, withdrawal_fee_bps),
      gct_bps = coalesce(p_gct_bps, gct_bps),
      updated_at = now()
    WHERE id = v_partner
    RETURNING * INTO v_row;

  PERFORM audit_append('user', app_current_user_id(), NULL, v_partner, 'partner.profile_updated',
    'partner', v_partner,
    jsonb_build_object(
      'before', jsonb_build_object('name', v_before.name, 'kind', v_before.kind, 'residency', v_before.residency,
        'withdrawal_fee_flat_minor', v_before.withdrawal_fee_flat_minor::text,
        'withdrawal_fee_bps', v_before.withdrawal_fee_bps, 'gct_bps', v_before.gct_bps),
      'after',  jsonb_build_object('name', v_row.name, 'kind', v_row.kind, 'residency', v_row.residency,
        'withdrawal_fee_flat_minor', v_row.withdrawal_fee_flat_minor::text,
        'withdrawal_fee_bps', v_row.withdrawal_fee_bps, 'gct_bps', v_row.gct_bps),
      'funding_instructions_changed', (coalesce(v_before.funding_instructions, '') IS DISTINCT FROM coalesce(v_row.funding_instructions, ''))));
  RETURN v_row;
END $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION partner_update_profile(text, text, text, text, bigint, integer, integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION partner_update_profile(text, text, text, text, bigint, integer, integer) TO ccn_app;
