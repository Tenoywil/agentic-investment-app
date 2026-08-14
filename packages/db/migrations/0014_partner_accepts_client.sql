-- ============================================================================
-- The partner accepts a client.
--
-- An investor could link an account at a firm and the firm was never told. The
-- row appeared in `connected_accounts`, holdings were pulled, and the console
-- — whose Clients tab is titled "Clients & KYC" — showed a seeded funnel of
-- counts and no client. The institution side of a two-sided network had no way
-- to see, review or refuse the people arriving on it.
--
-- What this adds is the relationship itself. A connection is now `pending`
-- until an operator at that firm reviews the KYC package CCN passes across and
-- accepts or declines it. That is the honest order of events: CCN is not the
-- KYC owner, the partner is, and a client is theirs only once they have said so.
--
-- Three things the partner must not be able to do, enforced here rather than in
-- the API:
--   * see a connection at another firm — the read policy pins `partner_id` to
--     the caller's own scope;
--   * see the KYC of anyone who has not connected to them — the package comes
--     from a SECURITY DEFINER function whose WHERE clause is that connection,
--     not from widened policies on `kyc_status` and `user`;
--   * edit the connection — the app role still has no UPDATE it can aim at
--     another user's row, and the review is a guarded function call.
-- ============================================================================

CREATE TYPE "connection_status" AS ENUM ('pending', 'active', 'declined');--> statement-breakpoint

-- `pending` is the default because a fail-open default on a permission column
-- is exactly the kind of thing that is discovered late. Both places that create
-- a connection say what they mean explicitly: the customer's connect route
-- leaves it pending, `reconcile_match` (below) sets it active, because there the
-- partner is the one doing the matching.
ALTER TABLE "connected_accounts"
  ADD COLUMN "status" "connection_status" NOT NULL DEFAULT 'pending',
  ADD COLUMN "reviewed_at" timestamptz,
  ADD COLUMN "decline_reason" text;--> statement-breakpoint

-- Every connection that already exists was already working: seeded demo
-- accounts and anything linked before this migration. Leaving them pending
-- would empty a live investor's portfolio, which is not a migration's job.
UPDATE "connected_accounts" SET "status" = 'active';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "connected_accounts_partner_idx"
  ON "connected_accounts" ("partner_id");--> statement-breakpoint

-- The operator reads their own firm's connections. SELECT only: the tenant
-- policy still governs writes, so an operator cannot rename or re-point a
-- client's account — the review below is the one transition they can make.
CREATE POLICY "connected_accounts_partner_read" ON "connected_accounts"
  FOR SELECT USING ("partner_id" = app_current_partner_id());--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- reconcile_match, re-declared so a connection it creates starts `active`.
-- Unchanged otherwise. A statement line matched by an operator is a client the
-- partner already has — inventing a pending review for a relationship that
-- predates CCN would be theatre, and would strand the holding behind it.
-- ---------------------------------------------------------------------------
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

  PERFORM audit_append('system', NULL, v_item.user_id, v_item.partner_id, 'reconciliation.matched',
    'holding', v_holding, jsonb_build_object('item_id', p_item_id, 'value_minor', v_item.parsed->>'valueMinor'));
  RETURN v_holding;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- partner_clients: the KYC package CCN passes across, for this firm's clients.
--
-- A function rather than policies on `kyc_status`, `risk_profiles`,
-- `user_profiles` and `user`, because the join *is* the authorisation: a
-- partner sees a person's compliance status precisely because that person
-- linked an account at their firm, and for exactly as long as that row exists.
-- Widening four tenant policies to express the same rule would leave four
-- places for it to drift. `user` is not granted to the app role at all.
--
-- The partner is read from the transaction GUC, never from an argument, so
-- there is no id an operator can substitute.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION partner_clients()
RETURNS TABLE (
  account_id uuid,
  status connection_status,
  label text,
  requested_at timestamptz,
  reviewed_at timestamptz,
  decline_reason text,
  user_id uuid,
  client_name text,
  client_email text,
  residency_country text,
  kyc_tier kyc_tier,
  identity_verified boolean,
  compliance_confirmed boolean,
  risk_completed boolean,
  funds_confirmed boolean,
  is_pep boolean,
  tax_residency_declared boolean,
  sources source_of_funds[],
  risk_band risk_band,
  holdings_count integer,
  holdings_value_minor bigint
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_partner uuid := app_current_partner_id();
BEGIN
  IF v_partner IS NULL THEN
    RAISE EXCEPTION 'partner_clients requires a partner scope';
  END IF;
  RETURN QUERY
    SELECT
      ca.id, ca.status, ca.label, ca.created_at, ca.reviewed_at, ca.decline_reason,
      u.id, u.name, u.email,
      up.residency_country,
      coalesce(k.tier, 'none'::kyc_tier),
      coalesce(k.identity_verified, false),
      coalesce(k.compliance_confirmed, false),
      coalesce(k.risk_completed, false),
      coalesce(k.funds_confirmed, false),
      coalesce(k.is_pep, false),
      coalesce(k.tax_residency_declared, false),
      coalesce(k.sources, ARRAY[]::source_of_funds[]),
      rp.band,
      coalesce(h.n, 0),
      coalesce(h.v, 0::bigint)
    FROM connected_accounts ca
    JOIN "user" u ON u.id = ca.user_id
    LEFT JOIN user_profiles up ON up.user_id = ca.user_id
    LEFT JOIN kyc_status k ON k.user_id = ca.user_id
    -- Newest assessment. A person may retake the quiz, and the band a partner
    -- reviews must be the one that is true now.
    LEFT JOIN LATERAL (
      SELECT r.band FROM risk_profiles r
       WHERE r.user_id = ca.user_id ORDER BY r.created_at DESC LIMIT 1
    ) rp ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS n, coalesce(sum(x.value_minor), 0)::bigint AS v
        FROM holdings x WHERE x.connected_account_id = ca.id
    ) h ON true
    WHERE ca.partner_id = v_partner
    ORDER BY (ca.status = 'pending') DESC, ca.created_at DESC;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- partner_review_client: accept or decline one pending connection.
--
-- The audit row records the package as it stood at the moment of the decision —
-- tier, the four checks, the PEP declaration. Six months later the question a
-- regulator asks is not what this client's KYC says today, it is what the
-- operator was looking at when they accepted them, and only a copy taken here
-- can answer that.
--
-- Accepting someone with no KYC at all is refused. That is not CCN setting a
-- partner's admission policy — it is that there is nothing to review: the
-- person has not finished onboarding, so no package exists to pass across.
-- Every judgement above that floor is the partner's to make, which is why an
-- unverified identity or an undeclared source of funds is surfaced to the
-- operator rather than blocked here.
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
BEGIN
  IF v_partner IS NULL THEN
    RAISE EXCEPTION 'partner_review_client requires a partner scope';
  END IF;
  SELECT * INTO v_acct FROM connected_accounts
    WHERE id = p_account_id AND partner_id = v_partner AND status = 'pending';
  IF v_acct.id IS NULL THEN
    RAISE EXCEPTION 'connection % is not pending at this partner', p_account_id;
  END IF;

  SELECT * INTO v_kyc FROM kyc_status WHERE user_id = v_acct.user_id;
  IF p_accept AND coalesce(v_kyc.tier, 'none'::kyc_tier) = 'none'::kyc_tier THEN
    RAISE EXCEPTION 'client % has completed no KYC, so there is nothing to accept', v_acct.user_id;
  END IF;

  v_next := CASE WHEN p_accept THEN 'active' ELSE 'declined' END::connection_status;
  UPDATE connected_accounts
     SET status = v_next,
         reviewed_at = now(),
         updated_at = now(),
         decline_reason = CASE WHEN p_accept THEN NULL ELSE p_reason END
   WHERE id = p_account_id;

  PERFORM audit_append(
    'user', v_actor, v_acct.user_id, v_partner,
    CASE WHEN p_accept THEN 'client.accepted' ELSE 'client.declined' END,
    'connected_accounts', p_account_id,
    jsonb_build_object(
      'kyc_tier', coalesce(v_kyc.tier::text, 'none'),
      'identity_verified', coalesce(v_kyc.identity_verified, false),
      'compliance_confirmed', coalesce(v_kyc.compliance_confirmed, false),
      'risk_completed', coalesce(v_kyc.risk_completed, false),
      'funds_confirmed', coalesce(v_kyc.funds_confirmed, false),
      'is_pep', coalesce(v_kyc.is_pep, false),
      'reason', p_reason));
  RETURN v_next;
END $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION partner_clients() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION partner_review_client(uuid, boolean, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION partner_clients() TO ccn_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION partner_review_client(uuid, boolean, text) TO ccn_app;
