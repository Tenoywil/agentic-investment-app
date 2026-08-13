-- CCN — bring a database up to date on the administration migrations (0008–0012)
-- from the Supabase SQL Editor, and record them so `db:migrate` agrees.
--
-- PREFER THE MIGRATOR. If you can run a terminal against the repo:
--
--     cd packages/db && DATABASE_URL='<production url>' bun run db:migrate
--
-- Use this only when you have the SQL Editor and nothing else.
--
-- ---------------------------------------------------------------------------
-- WHY THIS COVERS THE WHOLE RANGE, AND NOT JUST THE MIGRATION THAT FAILED
--
-- An earlier version of this file applied 0010 and 0011 alone, because those
-- were the two the error named. That was a mistake with teeth, and it cost a
-- second production failure.
--
-- Drizzle does not check migrations off individually. It takes the newest
-- `created_at` in `drizzle.__drizzle_migrations` and applies everything with a
-- LATER timestamp — so recording 0010 and 0011 on a database that had never
-- received 0009 did not merely skip 0009, it made 0009 permanently
-- unreachable: the journal's high-water mark moved past it. The next
-- `db:migrate` was a clean no-op that left a hole.
--
-- It surfaced as the next write in the sequence failing:
--
--     new row violates row-level security policy for table "user_roles"
--
-- which is 0009's `user_roles_admin_grant` policy missing, leaving only the
-- tenant policy, under which an administrator writing somebody else's role row
-- is exactly what gets refused.
--
-- So this file is now a repair for the whole administration range. Everything
-- is guarded, so applying it to a database that already has some or all of it
-- changes nothing.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 0008_admin_read — `admin` reads across every tenant. SELECT and nothing else.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'user_profiles', 'user_roles', 'kyc_status', 'risk_profiles', 'limits',
    'holdings', 'connected_accounts', 'orders', 'product_listings',
    'approvals', 'goals', 'kyc_documents'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE tablename = t AND policyname = t || '_admin_read'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR SELECT USING (app_current_role() = ''admin'')',
        t || '_admin_read', t
      );
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 0009_admin_role_writes — the one write over people: a person's roles.
--
-- `admin` is refused in both directions at the policy, so a compromised
-- administrator cannot mint a second one or quietly remove a colleague, and the
-- grant says nothing about the caller's own row.
-- ---------------------------------------------------------------------------
GRANT DELETE ON TABLE "user_roles" TO ccn_app;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_roles' AND policyname = 'user_roles_admin_grant') THEN
    CREATE POLICY "user_roles_admin_grant" ON "user_roles" FOR INSERT
      WITH CHECK (
        app_current_role() = 'admin'
        AND "role" <> 'admin'
        AND "user_id" <> app_current_user_id()
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_roles' AND policyname = 'user_roles_admin_revoke') THEN
    CREATE POLICY "user_roles_admin_revoke" ON "user_roles" FOR DELETE
      USING (
        app_current_role() = 'admin'
        AND "role" <> 'admin'
        AND "user_id" <> app_current_user_id()
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 0010_admin_reference_data — an administrator may load the catalog.
--
-- Four tables of network-wide reference data that no tenant owns, all already
-- readable by everyone. Nothing here touches a person's rows.
-- ---------------------------------------------------------------------------
GRANT INSERT ON TABLE "partners", "instruments", "planning_products", "fx_rates" TO ccn_app;
GRANT UPDATE ON TABLE "partners" TO ccn_app;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'partners' AND policyname = 'partners_admin_write') THEN
    CREATE POLICY "partners_admin_write" ON "partners" FOR INSERT
      WITH CHECK (app_current_role() = 'admin');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'partners' AND policyname = 'partners_admin_correct') THEN
    CREATE POLICY "partners_admin_correct" ON "partners" FOR UPDATE
      USING (app_current_role() = 'admin')
      WITH CHECK (app_current_role() = 'admin');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'instruments' AND policyname = 'instruments_admin_write') THEN
    CREATE POLICY "instruments_admin_write" ON "instruments" FOR INSERT
      WITH CHECK (app_current_role() = 'admin');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'planning_products' AND policyname = 'planning_products_admin_write') THEN
    CREATE POLICY "planning_products_admin_write" ON "planning_products" FOR INSERT
      WITH CHECK (app_current_role() = 'admin');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'fx_rates' AND policyname = 'fx_rates_admin_write') THEN
    CREATE POLICY "fx_rates_admin_write" ON "fx_rates" FOR INSERT
      WITH CHECK (app_current_role() = 'admin');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 0011_partner_onboarding — `partners.code` stops being a closed enum.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'partners' AND column_name = 'code' AND data_type <> 'text'
  ) THEN
    ALTER TABLE "partners" ALTER COLUMN "code" TYPE text USING "code"::text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partners_code_shape') THEN
    ALTER TABLE "partners" ADD CONSTRAINT "partners_code_shape"
      CHECK ("code" ~ '^[A-Z][A-Z0-9]{1,11}$');
  END IF;
END $$;

DROP TYPE IF EXISTS "public"."partner_code";

-- ---------------------------------------------------------------------------
-- 0012_audit_hash_builtin — the audit chain stops depending on pgcrypto.
--
-- On Supabase pgcrypto lives in `extensions`, and these functions are pinned to
-- `search_path = public`, so `digest()` is not resolvable and NO audited write
-- can complete. Postgres's built-in sha256 produces identical hashes, so
-- existing chains stay valid. CREATE OR REPLACE, so this is idempotent as-is.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION
      'audit hashing assumes a UTF8 database; this one is %. Migrating it would change every future hash and break the chain against existing rows.',
      current_setting('server_encoding');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION audit_append(
  p_actor_type actor_type, p_actor_id uuid, p_user_id uuid, p_partner_id uuid,
  p_action text, p_entity_type text, p_entity_id uuid, p_detail jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_prev text;
  v_hash text;
  v_ts timestamptz := now();
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ccn_audit_append'));
  SELECT hash INTO v_prev FROM audit_log ORDER BY seq DESC LIMIT 1;
  v_hash := encode(sha256(convert_to(
    coalesce(v_prev, '') || '|' || p_actor_type::text || '|' || coalesce(p_actor_id::text, '')
      || '|' || coalesce(p_user_id::text, '') || '|' || coalesce(p_partner_id::text, '')
      || '|' || p_action || '|' || coalesce(p_entity_type, '') || '|' || coalesce(p_entity_id::text, '')
      || '|' || coalesce(p_detail::text, '{}') || '|' || v_ts::text,
    'UTF8')), 'hex');
  INSERT INTO audit_log(actor_type, actor_id, user_id, partner_id, action, entity_type,
    entity_id, detail, prev_hash, hash, created_at)
  VALUES (p_actor_type, p_actor_id, p_user_id, p_partner_id, p_action, p_entity_type,
    p_entity_id, coalesce(p_detail, '{}'::jsonb), v_prev, v_hash, v_ts)
  RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

REVOKE ALL ON FUNCTION audit_append(actor_type, uuid, uuid, uuid, text, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit_append(actor_type, uuid, uuid, uuid, text, text, uuid, jsonb) TO ccn_app;

CREATE OR REPLACE FUNCTION audit_verify() RETURNS boolean
  LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  r record;
  v_prev text := NULL;
  v_calc text;
BEGIN
  FOR r IN SELECT * FROM audit_log ORDER BY seq ASC LOOP
    IF r.prev_hash IS DISTINCT FROM v_prev THEN RETURN false; END IF;
    v_calc := encode(sha256(convert_to(
      coalesce(v_prev, '') || '|' || r.actor_type::text || '|' || coalesce(r.actor_id::text, '')
        || '|' || coalesce(r.user_id::text, '') || '|' || coalesce(r.partner_id::text, '')
        || '|' || r.action || '|' || coalesce(r.entity_type, '') || '|' || coalesce(r.entity_id::text, '')
        || '|' || coalesce(r.detail::text, '{}') || '|' || r.created_at::text,
      'UTF8')), 'hex');
    IF v_calc IS DISTINCT FROM r.hash THEN RETURN false; END IF;
    v_prev := r.hash;
  END LOOP;
  RETURN true;
END $fn$;

-- ---------------------------------------------------------------------------
-- Tell Drizzle all five are applied.
--
-- The hashes and timestamps are the ones the migrator itself records — read
-- back from a database it migrated, not computed by hand. Recording the whole
-- range is the point: leaving a gap below the high-water mark is what made
-- 0009 unreachable the first time.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS drizzle;

CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);

INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT v.hash, v.created_at
FROM (VALUES
  ('465cbac63b482d9fc571eb524d843d78281342ddcb99ba0993b6559293e6a9c9'::text, 1786510000000::bigint), -- 0008_admin_read
  ('ad363127fd87c36728ab819cfdce237614d382748b2c7b20819228fa580ff380',       1786520000000),         -- 0009_admin_role_writes
  ('41e2ed9119a4c73a1ec16de553e862d4b84c609c7f3d99bb7388ddf4bc7bd2fd',       1786530000000),         -- 0010_admin_reference_data
  ('b2615dc36521a4569f8bc27fcbebd858b002703e8967ad89501f2aa5497e2e4f',       1786540000000),         -- 0011_partner_onboarding
  ('89f0129eb915d34f3a10e2626a6c916ebd9f65c3a9a74f5b947c6df1c410e1f3',       1786550000000)          -- 0012_audit_hash_builtin
) AS v(hash, created_at)
WHERE NOT EXISTS (
  SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.hash = v.hash
);

COMMIT;

-- Confirm. Every column should read as noted.
SELECT
  (SELECT count(*) FROM pg_policies WHERE policyname LIKE '%\_admin\_read')        AS admin_read_policies,   -- 12
  (SELECT count(*) FROM pg_policies
    WHERE tablename = 'user_roles' AND policyname LIKE 'user_roles_admin_%')       AS role_write_policies,    -- 3 (read+grant+revoke)
  (SELECT data_type FROM information_schema.columns
    WHERE table_name = 'partners' AND column_name = 'code')                        AS code_type,             -- text
  has_table_privilege('ccn_app', 'partners', 'INSERT')                             AS can_insert_partners,   -- t
  has_table_privilege('ccn_app', 'user_roles', 'DELETE')                           AS can_revoke_roles,      -- t
  (SELECT count(*) FROM drizzle.__drizzle_migrations
    WHERE created_at BETWEEN 1786510000000 AND 1786550000000)                      AS journal_rows,          -- 5
  audit_verify()                                                                   AS audit_chain_intact;    -- t
