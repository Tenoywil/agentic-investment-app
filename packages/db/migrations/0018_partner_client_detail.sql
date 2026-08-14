-- A firm can open a client and see where their money actually is, and can end
-- the relationship afterwards.
--
-- Two gaps, both of which made the Clients tab a list you could look at and not
-- much else:
--
--   1. `partner_clients()` aggregates a client's holdings to a count and a sum,
--      so the console could say "4 holdings · US$12,400" and could not say what
--      any of them were. An operator asking "what is this person actually in
--      with us?" — the first question anyone asks about a client — had no
--      answer on this surface. `holdings` has a tenant policy and an admin
--      policy and no partner policy at all, so it cannot be read directly; the
--      drill-down is another SECURITY DEFINER function, resolving the partner
--      from the GUC exactly as `partner_clients()` does.
--
--   2. `partner_review_client` hard-codes `status = 'pending'`, so `active →
--      declined` raises. Accepting a client was a one-way door: a firm that
--      needed to end a relationship — a failed periodic review, a client who
--      asked to leave — had no control anywhere in the console, and the row it
--      would have written is the one a regulator asks for.
--
-- Revoking is not the same event as declining, and reinstating is not the same
-- as accepting, so they are audited under their own names rather than reusing
-- `client.accepted` / `client.declined` for four different things.

-- ---------------------------------------------------------------------------
-- partner_client_holdings: what one client holds through this firm.
--
-- Returns the holding rows behind the count and the sum, joined to the
-- instrument so the operator sees the product's name rather than a UUID. Rows
-- are scoped to one connected account, and that account must belong to the
-- caller's partner — an account id from another firm returns nothing rather
-- than raising, so ids cannot be probed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION partner_client_holdings(p_account_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  instrument_id uuid,
  instrument_name text,
  instrument_abbr text,
  value_minor bigint,
  currency currency,
  return_label text,
  created_at timestamptz,
  updated_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_partner uuid := app_current_partner_id();
BEGIN
  IF v_partner IS NULL THEN
    RAISE EXCEPTION 'partner_client_holdings requires a partner scope';
  END IF;
  RETURN QUERY
    SELECT
      h.id, h.name, h.instrument_id, i.name, i.abbr,
      h.value_minor, h.currency, h.return_label, h.created_at, h.updated_at
    FROM holdings h
    JOIN connected_accounts ca ON ca.id = h.connected_account_id
    LEFT JOIN instruments i ON i.id = h.instrument_id
    WHERE ca.id = p_account_id
      AND ca.partner_id = v_partner
    ORDER BY h.value_minor DESC, h.created_at DESC;
END $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION partner_client_holdings(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION partner_client_holdings(uuid) TO ccn_app;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- partner_review_client, re-declared to cover the whole relationship.
--
-- Legal transitions, all of them the partner's own decision:
--
--   pending  → active    accept
--   pending  → declined  decline
--   active   → declined  revoke      (new)
--   declined → active    reinstate   (new)
--
-- What does not change: the partner comes from the GUC, the KYC floor applies
-- to anything that grants access, and the audit row copies the package as it
-- stood at the moment of the decision — six months later the question is what
-- the operator was looking at, and only a copy taken here can answer it.
--
-- Revoking stops the holdings pull (`connected_accounts.status = 'active'` is
-- what gates it) but deliberately deletes nothing. The client's existing
-- positions are facts about their money, not the firm's to erase, and the
-- investor's own portfolio keeps showing what they hold.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION partner_review_client(
  p_account_id uuid, p_accept boolean, p_reason text
) RETURNS connection_status
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_partner uuid := app_current_partner_id();
  v_actor uuid := app_current_user_id();
  v_acct connected_accounts;
  v_kyc kyc_status;
  v_next connection_status;
  v_action text;
BEGIN
  IF v_partner IS NULL THEN
    RAISE EXCEPTION 'partner_review_client requires a partner scope';
  END IF;
  SELECT * INTO v_acct FROM connected_accounts
    WHERE id = p_account_id AND partner_id = v_partner;
  IF v_acct.id IS NULL THEN
    RAISE EXCEPTION 'connection % is not at this partner', p_account_id;
  END IF;

  v_next := CASE WHEN p_accept THEN 'active' ELSE 'declined' END::connection_status;
  IF v_acct.status = v_next THEN
    -- Nothing to decide. Raising rather than returning quietly, so a
    -- double-submit is visible to the caller instead of looking like a second
    -- decision that was made.
    RAISE EXCEPTION 'connection % is already %', p_account_id, v_next;
  END IF;

  SELECT * INTO v_kyc FROM kyc_status WHERE user_id = v_acct.user_id;
  IF p_accept AND coalesce(v_kyc.tier, 'none'::kyc_tier) = 'none'::kyc_tier THEN
    RAISE EXCEPTION 'client % has completed no KYC, so there is nothing to accept', v_acct.user_id;
  END IF;

  v_action := CASE
    WHEN p_accept AND v_acct.status = 'declined' THEN 'client.reinstated'
    WHEN p_accept THEN 'client.accepted'
    WHEN v_acct.status = 'active' THEN 'client.revoked'
    ELSE 'client.declined'
  END;

  UPDATE connected_accounts
     SET status = v_next,
         reviewed_at = now(),
         updated_at = now(),
         decline_reason = CASE WHEN p_accept THEN NULL ELSE p_reason END
   WHERE id = p_account_id;

  PERFORM audit_append(
    'user', v_actor, v_acct.user_id, v_partner,
    v_action,
    'connected_accounts', p_account_id,
    jsonb_build_object(
      'from', v_acct.status::text,
      'to', v_next::text,
      'kyc_tier', coalesce(v_kyc.tier::text, 'none'),
      'identity_verified', coalesce(v_kyc.identity_verified, false),
      'compliance_confirmed', coalesce(v_kyc.compliance_confirmed, false),
      'risk_completed', coalesce(v_kyc.risk_completed, false),
      'funds_confirmed', coalesce(v_kyc.funds_confirmed, false),
      'is_pep', coalesce(v_kyc.is_pep, false),
      'reason', p_reason));
  RETURN v_next;
END $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION partner_review_client(uuid, boolean, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION partner_review_client(uuid, boolean, text) TO ccn_app;
