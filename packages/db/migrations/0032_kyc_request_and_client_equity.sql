-- A firm can ask a client to finish KYC, and can see that client's curve.
--
-- Two gaps on the same desk. First: an operator reviewing a half-finished KYC
-- package had no move at all. The review screen showed "identity unverified,
-- funds undeclared" and offered accept (refused for an empty package) or
-- decline (which reads to the client as rejection, not "please finish"). The
-- honest third verb is a request: the firm asks, the client is told, and the
-- asking is on the audit trail like every other decision at the desk.
--
-- Second: the console's equity curve exists only for the whole firm. A client
-- opened in detail showed holdings as they stand today, with no way to see
-- the relationship move over time. A per-client daily snapshot (scope
-- 'client': one partner, one user) records the value held THROUGH THIS FIRM —
-- deliberately not the person's cross-firm net worth, which is theirs and not
-- any one firm's to see. History begins the day this ships; no backfill,
-- because inventing yesterday's valuations is the fabricated figure this
-- product refuses to render.

-- ---------------------------------------------------------------------------
-- The request column. The connected_accounts UPDATE trigger (0015) already
-- notifies the client's open screens, so writing it is also announcing it.
-- ---------------------------------------------------------------------------
ALTER TABLE connected_accounts
  ADD COLUMN IF NOT EXISTS kyc_requested_at timestamptz;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- partner_clients() grows the column. Postgres will not change a function's
-- OUT signature under OR REPLACE, so it is dropped and recreated — the body
-- is 0014's, plus kyc_requested_at.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS partner_clients();--> statement-breakpoint
CREATE FUNCTION partner_clients()
RETURNS TABLE (
  account_id uuid,
  status connection_status,
  label text,
  requested_at timestamptz,
  reviewed_at timestamptz,
  decline_reason text,
  kyc_requested_at timestamptz,
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
      ca.kyc_requested_at,
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
    LEFT JOIN LATERAL (
      SELECT r.band FROM risk_profiles r
       WHERE r.user_id = ca.user_id ORDER BY r.created_at DESC LIMIT 1
    ) rp ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS n, coalesce(sum(x.value_minor), 0)::bigint AS v
        FROM holdings x WHERE x.connected_account_id = ca.id
    ) h ON true
    WHERE ca.partner_id = v_partner;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- partner_request_kyc: ask one client to finish verification.
--
-- Guarded like partner_review_client: the account must be the caller's, and
-- the ask must have a point — a package with all four checks true has nothing
-- left to finish, and re-sending the same request every hour would be
-- badgering, so a request younger than a day is refused too. The audit row
-- carries the package as it stood when the firm asked.
-- ---------------------------------------------------------------------------
CREATE FUNCTION partner_request_kyc(p_account_id uuid) RETURNS timestamptz
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_partner uuid := app_current_partner_id();
  v_actor uuid := app_current_user_id();
  v_acct connected_accounts;
  v_kyc kyc_status;
  v_now timestamptz := now();
BEGIN
  IF v_partner IS NULL THEN
    RAISE EXCEPTION 'partner_request_kyc requires a partner scope';
  END IF;
  SELECT * INTO v_acct FROM connected_accounts
    WHERE id = p_account_id AND partner_id = v_partner
      AND status IN ('pending', 'active');
  IF v_acct.id IS NULL THEN
    RAISE EXCEPTION 'connection % is not reviewable at this partner', p_account_id;
  END IF;

  SELECT * INTO v_kyc FROM kyc_status WHERE user_id = v_acct.user_id;
  IF coalesce(v_kyc.identity_verified, false)
     AND coalesce(v_kyc.compliance_confirmed, false)
     AND coalesce(v_kyc.risk_completed, false)
     AND coalesce(v_kyc.funds_confirmed, false) THEN
    RAISE EXCEPTION 'client % has already completed KYC', v_acct.user_id;
  END IF;
  IF v_acct.kyc_requested_at IS NOT NULL
     AND v_acct.kyc_requested_at > v_now - interval '1 day' THEN
    RAISE EXCEPTION 'kyc was already requested recently for %', p_account_id;
  END IF;

  UPDATE connected_accounts
     SET kyc_requested_at = v_now, updated_at = v_now
   WHERE id = p_account_id;

  PERFORM audit_append(
    'user', v_actor, v_acct.user_id, v_partner,
    'kyc.requested',
    'connected_accounts', p_account_id,
    jsonb_build_object(
      'kyc_tier', coalesce(v_kyc.tier::text, 'none'),
      'identity_verified', coalesce(v_kyc.identity_verified, false),
      'compliance_confirmed', coalesce(v_kyc.compliance_confirmed, false),
      'risk_completed', coalesce(v_kyc.risk_completed, false),
      'funds_confirmed', coalesce(v_kyc.funds_confirmed, false)));
  RETURN v_now;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Per-client snapshots: scope 'client' carries BOTH tenant columns, so the
-- 0031 CHECKs (each scope names exactly one) are widened rather than added to.
-- ---------------------------------------------------------------------------
-- 0031 left its CHECKs under Postgres's auto-generated names, which depend on
-- creation order — so they are found and dropped by type, not guessed by name.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
   WHERE conrelid = 'value_snapshots'::regclass AND contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE value_snapshots DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE value_snapshots
  ADD CONSTRAINT value_snapshots_scope_check
  CHECK (scope IN ('user', 'partner', 'client'));--> statement-breakpoint
ALTER TABLE value_snapshots
  ADD CONSTRAINT value_snapshots_user_scope_check
  CHECK ((user_id IS NOT NULL) = (scope IN ('user', 'client')));--> statement-breakpoint
ALTER TABLE value_snapshots
  ADD CONSTRAINT value_snapshots_partner_scope_check
  CHECK ((partner_id IS NOT NULL) = (scope IN ('partner', 'client')));--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS value_snapshots_client_day
  ON value_snapshots (partner_id, user_id, taken_on) WHERE scope = 'client';--> statement-breakpoint

-- The firm reads its own client curves; the client may read their own too
-- (it is their money, held at that firm).
DROP POLICY IF EXISTS value_snapshots_own_read ON value_snapshots;--> statement-breakpoint
CREATE POLICY value_snapshots_own_read ON value_snapshots FOR SELECT
  USING (
    (scope = 'user' AND user_id = app_current_user_id())
    OR (scope = 'partner' AND partner_id = app_current_partner_id())
    OR (scope = 'client' AND (
      partner_id = app_current_partner_id()
      OR user_id = app_current_user_id()
    ))
    OR app_current_role() = 'admin'
  );--> statement-breakpoint

-- The recorder grows a third insert: what each client holds through each firm,
-- one row per (firm, client) per day. Same idempotency as the other two.
CREATE OR REPLACE FUNCTION record_value_snapshots() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count integer := 0;
  v_rows integer;
BEGIN
  INSERT INTO value_snapshots (scope, user_id, taken_on, net_worth_minor, cash_minor)
  SELECT 'user', h.user_id, current_date,
         coalesce(sum(h.value_minor), 0),
         coalesce(sum(h.value_minor) FILTER (WHERE h.instrument_id IS NULL), 0)
  FROM holdings h
  GROUP BY h.user_id
  ON CONFLICT (user_id, taken_on) WHERE scope = 'user'
  DO UPDATE SET net_worth_minor = EXCLUDED.net_worth_minor,
                cash_minor = EXCLUDED.cash_minor;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  INSERT INTO value_snapshots (scope, partner_id, taken_on, net_worth_minor, clients)
  SELECT 'partner', ca.partner_id, current_date,
         coalesce(sum(h.value_minor), 0),
         count(DISTINCT h.user_id)
  FROM holdings h
  JOIN connected_accounts ca ON ca.id = h.connected_account_id
  GROUP BY ca.partner_id
  ON CONFLICT (partner_id, taken_on) WHERE scope = 'partner'
  DO UPDATE SET net_worth_minor = EXCLUDED.net_worth_minor,
                clients = EXCLUDED.clients;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_count := v_count + v_rows;

  INSERT INTO value_snapshots (scope, partner_id, user_id, taken_on, net_worth_minor)
  SELECT 'client', ca.partner_id, h.user_id, current_date,
         coalesce(sum(h.value_minor), 0)
  FROM holdings h
  JOIN connected_accounts ca ON ca.id = h.connected_account_id
  GROUP BY ca.partner_id, h.user_id
  ON CONFLICT (partner_id, user_id, taken_on) WHERE scope = 'client'
  DO UPDATE SET net_worth_minor = EXCLUDED.net_worth_minor;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_count + v_rows;
END $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION partner_clients() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION partner_request_kyc(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION partner_clients() TO ccn_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION partner_request_kyc(uuid) TO ccn_app;
