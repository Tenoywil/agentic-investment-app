-- The two open edges of the money loop: how money gets in, and how it gets out.
--
-- IN. The platform could record settled funding (0023) but nothing told the
-- investor HOW to send money — no bank details, no reference to quote, no
-- state between "I wired it" and "the firm confirmed it". Two additions:
--
--   * `partners.funding_instructions` — the firm's own words for how a client
--     funds an account (bank, account name/number, what to reference). Set by
--     the firm through `partner_update_profile`, shown to its clients on the
--     portfolio card. Free text because every firm words this differently, and
--     inventing a schema for another firm's banking details is how half of
--     them end up unrepresentable.
--   * An investor's "I've sent it" notice lands in the console's EXISTING
--     reconciliation queue (source `investor_notice`) — the same human-review
--     choke point statements flow through, so the desk sees it beside its
--     other unmatched lines and Match creates the cash. No new queue to
--     forget; no new table at all. (API change only; noted here for the record.)
--
-- OUT. Withdrawals did not exist in any form. A request/decide pair, both
-- SECURITY DEFINER in the house style: the investor asks, the firm decides,
-- and recorded cash falls only when the firm says it actually paid.

ALTER TABLE "partners"
  ADD COLUMN IF NOT EXISTS "funding_instructions" text;--> statement-breakpoint
COMMENT ON COLUMN "partners"."funding_instructions" IS 'The firm''s own instructions for funding an account (bank, account, reference). Shown to its accepted clients.';--> statement-breakpoint

CREATE TYPE "withdrawal_status" AS ENUM ('pending', 'paid', 'declined');--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "withdrawal_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "partner_id" uuid NOT NULL REFERENCES "partners"("id"),
  "connected_account_id" uuid NOT NULL REFERENCES "connected_accounts"("id") ON DELETE CASCADE,
  "amount_minor" bigint NOT NULL,
  "currency" "currency" NOT NULL DEFAULT 'USD',
  "status" "withdrawal_status" NOT NULL DEFAULT 'pending',
  -- The firm's words when it declines, shown to the investor.
  "reason" text,
  -- The firm's payment reference when it pays, for the investor's records.
  "reference" text,
  "decided_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE "withdrawal_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "withdrawal_requests" TO ccn_app;--> statement-breakpoint

-- Reads only. Every write goes through the two functions below.
CREATE POLICY "withdrawals_tenant_read" ON "withdrawal_requests"
  FOR SELECT USING ("user_id" = app_current_user_id());--> statement-breakpoint
CREATE POLICY "withdrawals_partner_read" ON "withdrawal_requests"
  FOR SELECT USING ("partner_id" = app_current_partner_id());--> statement-breakpoint
CREATE POLICY "withdrawals_admin_read" ON "withdrawal_requests"
  FOR SELECT USING (app_current_role() = 'admin');--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "withdrawals_partner_pending_idx"
  ON "withdrawal_requests" ("partner_id", "status");--> statement-breakpoint

-- Realtime: the investor watches for the decision, the desk for the request.
CREATE TRIGGER "withdrawal_requests_notify"
AFTER INSERT OR UPDATE ON "withdrawal_requests"
FOR EACH ROW EXECUTE FUNCTION ccn_notify_row('withdrawal', 'user_id', 'partner_id', 'status');--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- request_withdrawal: the investor asks their firm for money back.
--
-- The caller's identity comes from the GUC; the account must be theirs, at the
-- firm, and active. The recorded cash at that account in that currency must
-- cover the amount — the platform must not relay a request its own books say
-- is impossible — but nothing is deducted here: money moves when the firm
-- says it moved, exactly as funding works in the other direction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION request_withdrawal(
  p_account_id uuid, p_amount_minor bigint, p_currency currency
) RETURNS withdrawal_requests
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := app_current_user_id();
  v_acct connected_accounts;
  v_cash bigint;
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

  INSERT INTO withdrawal_requests(user_id, partner_id, connected_account_id, amount_minor, currency)
    VALUES (v_user, v_acct.partner_id, p_account_id, p_amount_minor, p_currency)
    RETURNING * INTO v_row;

  PERFORM audit_append('user', v_user, v_user, v_acct.partner_id, 'withdrawal.requested',
    'withdrawal_request', v_row.id,
    jsonb_build_object('amount_minor', p_amount_minor::text, 'currency', p_currency::text));
  RETURN v_row;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- partner_decide_withdrawal: the firm pays it or declines it.
--
-- Paying decrements the recorded cash it was requested from. The guard is
-- deliberate: if CCN's record no longer covers the amount (a settle spent it
-- first), the decision is refused with the current figure rather than paid
-- into a negative balance — the desk records the missing funding first, or
-- declines. Declining requires a reason, because the investor reads it.
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
                       'reason', v_row.reason, 'reference', v_row.reference));
  RETURN v_row;
END $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION request_withdrawal(uuid, bigint, currency) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION partner_decide_withdrawal(uuid, boolean, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION request_withdrawal(uuid, bigint, currency) TO ccn_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION partner_decide_withdrawal(uuid, boolean, text, text) TO ccn_app;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- partner_update_profile grows the funding-instructions field. DROP first:
-- Postgres identifies a function by its argument types, and a defaulted fourth
-- parameter beside the old three-argument version would make every existing
-- call ambiguous (see 0019, same move).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS partner_update_profile(text, text, text);--> statement-breakpoint

CREATE FUNCTION partner_update_profile(
  p_name text, p_kind text, p_residency text, p_funding_instructions text DEFAULT NULL
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
      -- NULL leaves the stored instructions alone (a profile save that did not
      -- touch them must not blank them); an empty string clears them.
      funding_instructions = CASE
        WHEN p_funding_instructions IS NULL THEN funding_instructions
        ELSE nullif(btrim(p_funding_instructions), '')
      END,
      updated_at = now()
    WHERE id = v_partner
    RETURNING * INTO v_row;

  PERFORM audit_append('user', app_current_user_id(), NULL, v_partner, 'partner.profile_updated',
    'partner', v_partner,
    jsonb_build_object(
      'before', jsonb_build_object('name', v_before.name, 'kind', v_before.kind, 'residency', v_before.residency),
      'after',  jsonb_build_object('name', v_row.name, 'kind', v_row.kind, 'residency', v_row.residency),
      'funding_instructions_changed', (coalesce(v_before.funding_instructions, '') IS DISTINCT FROM coalesce(v_row.funding_instructions, ''))));
  RETURN v_row;
END $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION partner_update_profile(text, text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION partner_update_profile(text, text, text, text) TO ccn_app;
