-- CCN — apply the administration migrations (0010, 0011) to a database that
-- missed them, from the Supabase SQL Editor.
--
-- WHEN TO RUN THIS. The API returned:
--
--     PostgresError: permission denied for table partners   (code 42501)
--     insert into "partners" … params: SAG, Sagicor Investments, …
--
-- on POST /api/admin/partners, while every read on the same surface returned
-- 200. That combination means one thing: the app role has SELECT on the table
-- and not INSERT, so 0010_admin_reference_data.sql was never applied.
--
-- WHY A DATABASE CAN MISS A MIGRATION HERE. `preDeployCommand: db:migrate` is
-- declared in apps/api/render.yaml — a Blueprint. A service Render created from
-- the dashboard rather than from that Blueprint does not have it, so migrations
-- only ever run when a person runs them. Nothing in the deploy log says so: the
-- build is green, the new code ships, and the first request that needs a new
-- grant is where it surfaces. Fixing the deploy source is the real repair; this
-- is the one that takes thirty seconds.
--
-- PREFER THE MIGRATOR. If you can run a terminal against the repo:
--
--     cd packages/db && DATABASE_URL='<production url>' bun run db:migrate
--
-- That applies exactly what is missing, in order, and records it. Use this file
-- only when you have the SQL Editor and nothing else.
--
-- SAFE TO RUN TWICE. Every statement checks first, and the journal rows are
-- inserted only if absent — so a later `db:migrate` sees these as applied and
-- stays a clean no-op rather than replaying them and dying on
-- "policy already exists".
--
-- CHANGES NO APPLICATION DATA. Grants, policies, one column type, one CHECK.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0010_admin_reference_data — an administrator may load the catalog.
--
-- Four tables of network-wide reference data that no tenant owns, all of them
-- already readable by everyone. Nothing here touches a person's rows.
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
--
-- The set of licensed institutions is the business, not a schema constant.
-- Shape and uniqueness are what the enum was really protecting, and both stay.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'partners' AND column_name = 'code' AND data_type <> 'text'
  ) THEN
    ALTER TABLE "partners" ALTER COLUMN "code" TYPE text USING "code"::text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'partners_code_shape'
  ) THEN
    ALTER TABLE "partners" ADD CONSTRAINT "partners_code_shape"
      CHECK ("code" ~ '^[A-Z][A-Z0-9]{1,11}$');
  END IF;
END $$;

DROP TYPE IF EXISTS "public"."partner_code";

-- ---------------------------------------------------------------------------
-- Tell Drizzle these are applied.
--
-- The hashes and timestamps are the ones the migrator itself records — read
-- back from a database it migrated, not computed by hand — so a later
-- `db:migrate` treats both as done.
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
  ('41e2ed9119a4c73a1ec16de553e862d4b84c609c7f3d99bb7388ddf4bc7bd2fd'::text, 1786530000000::bigint), -- 0010_admin_reference_data
  ('b2615dc36521a4569f8bc27fcbebd858b002703e8967ad89501f2aa5497e2e4f',       1786540000000)          -- 0011_partner_onboarding
) AS v(hash, created_at)
WHERE NOT EXISTS (
  SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.hash = v.hash
);

COMMIT;

-- Confirm. Expect: code_type = text, partner_write_policies = 2, journal rows present.
SELECT
  (SELECT data_type FROM information_schema.columns
    WHERE table_name = 'partners' AND column_name = 'code')                     AS code_type,
  (SELECT count(*) FROM pg_policies
    WHERE tablename = 'partners' AND policyname LIKE 'partners_admin_%')        AS partner_write_policies,
  has_table_privilege('ccn_app', 'partners', 'INSERT')                          AS ccn_app_can_insert,
  (SELECT count(*) FROM drizzle.__drizzle_migrations
    WHERE created_at IN (1786530000000, 1786540000000))                         AS journal_rows;
