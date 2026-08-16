-- Equity over time, recorded honestly.
--
-- Nothing in the schema has ever kept a valuation history, so no screen could
-- answer the question an investor actually returns for — "is this making a
-- difference?" — and no firm could see the money its clients hold through CCN
-- move over time. The home screen even documents the gap ("no valuation
-- history in the schema").
--
-- This is the smallest honest answer: one row per investor per day and one
-- per firm per day, written by a single SECURITY DEFINER recorder the API
-- calls once a day. History begins the day this ships — there is no backfill,
-- because inventing yesterday's valuations is exactly the kind of fabricated
-- figure this product refuses to render. Charts grow a point at a time.

CREATE TABLE IF NOT EXISTS value_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('user', 'partner')),
  user_id uuid REFERENCES "user"(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES partners(id) ON DELETE CASCADE,
  taken_on date NOT NULL,
  -- For a user: everything they hold, and the cash slice of it.
  -- For a partner: everything clients hold through accounts at that firm
  -- (net_worth_minor), cash_minor unused (0), plus the client count.
  net_worth_minor bigint NOT NULL DEFAULT 0,
  cash_minor bigint NOT NULL DEFAULT 0,
  clients integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'user') = (user_id IS NOT NULL)),
  CHECK ((scope = 'partner') = (partner_id IS NOT NULL))
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS value_snapshots_user_day
  ON value_snapshots (user_id, taken_on) WHERE scope = 'user';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS value_snapshots_partner_day
  ON value_snapshots (partner_id, taken_on) WHERE scope = 'partner';--> statement-breakpoint

ALTER TABLE value_snapshots ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Read your own curve; a firm reads its own; writes happen only through the
-- recorder below, so the app role gets SELECT and nothing else.
CREATE POLICY value_snapshots_own_read ON value_snapshots FOR SELECT
  USING (
    (scope = 'user' AND user_id = app_current_user_id())
    OR (scope = 'partner' AND partner_id = app_current_partner_id())
    OR app_current_role() = 'admin'
  );--> statement-breakpoint
GRANT SELECT ON value_snapshots TO ccn_app;--> statement-breakpoint

-- The recorder: today's valuation for every investor and every firm, from
-- the holdings that exist right now, idempotent per day (a re-run refreshes
-- today's rows rather than duplicating them). One function so there is one
-- choke point and one grant — the same discipline as create_order.
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
  RETURN v_count + v_rows;
END $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION record_value_snapshots() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION record_value_snapshots() TO ccn_app;
