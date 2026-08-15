-- Funding is settled off-platform, and the partner says when it has landed.
--
-- CCN holds no money. An investor funds their account directly with the firm —
-- a wire, a branch deposit — and until now nothing on the platform could say
-- that it happened: cash appeared only when a statement line was pulled and
-- matched, so a freshly funded client stared at an empty portfolio until the
-- next statement cycle. The firm knows the moment funds settle; this gives its
-- operator the one write that records it.
--
-- `partner_confirm_funds` follows the shape every partner write here follows:
-- SECURITY DEFINER, partner resolved from the transaction GUC (never an
-- argument), audited, and the only path — the app role has no INSERT or UPDATE
-- on `holdings`. Cash is a holding with no instrument, so repeated deposits
-- accumulate into the same row per currency rather than littering the
-- portfolio with one "Cash" line per wire.
--
-- The currency enum also grows: Guyana (GYD), Barbados (BBD), the Eastern
-- Caribbean dollar (XCD) and The Bahamas (BSD). No central-bank fetcher exists
-- for them yet, so their rates come from the seeded table and every screen
-- reports them as such — stale, source `seed` — rather than pretending a bank
-- published them.

ALTER TYPE "currency" ADD VALUE IF NOT EXISTS 'GYD';--> statement-breakpoint
ALTER TYPE "currency" ADD VALUE IF NOT EXISTS 'BBD';--> statement-breakpoint
ALTER TYPE "currency" ADD VALUE IF NOT EXISTS 'XCD';--> statement-breakpoint
ALTER TYPE "currency" ADD VALUE IF NOT EXISTS 'BSD';--> statement-breakpoint

CREATE OR REPLACE FUNCTION partner_confirm_funds(
  p_account_id uuid, p_amount_minor bigint, p_currency currency, p_reference text
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_partner uuid := app_current_partner_id();
  v_actor uuid := app_current_user_id();
  v_acct connected_accounts;
  v_holding uuid;
BEGIN
  IF v_partner IS NULL THEN
    RAISE EXCEPTION 'partner_confirm_funds requires a partner scope';
  END IF;
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 THEN
    RAISE EXCEPTION 'settled funds must be a positive amount';
  END IF;

  SELECT * INTO v_acct FROM connected_accounts
    WHERE id = p_account_id AND partner_id = v_partner;
  IF v_acct.id IS NULL THEN
    RAISE EXCEPTION 'connection % is not a client of this partner', p_account_id;
  END IF;
  IF v_acct.status <> 'active' THEN
    RAISE EXCEPTION 'client % is not active, so settled funds cannot be recorded', p_account_id;
  END IF;

  -- One cash row per account per currency. Oldest wins as the accumulator so
  -- the row's identity is stable across deposits.
  SELECT id INTO v_holding FROM holdings
    WHERE connected_account_id = p_account_id
      AND instrument_id IS NULL AND currency = p_currency
    ORDER BY created_at LIMIT 1;

  IF v_holding IS NULL THEN
    INSERT INTO holdings(user_id, connected_account_id, instrument_id, name, value_minor, currency)
      VALUES (v_acct.user_id, p_account_id, NULL, 'Cash', p_amount_minor, p_currency)
      RETURNING id INTO v_holding;
  ELSE
    UPDATE holdings
       SET value_minor = value_minor + p_amount_minor, updated_at = now()
     WHERE id = v_holding;
  END IF;

  PERFORM audit_append('user', v_actor, v_acct.user_id, v_partner, 'funds.settled',
    'holding', v_holding, jsonb_build_object(
      'amount_minor', p_amount_minor::text,
      'currency', p_currency::text,
      'reference', p_reference));
  RETURN v_holding;
END $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION partner_confirm_funds(uuid, bigint, currency, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION partner_confirm_funds(uuid, bigint, currency, text) TO ccn_app;
