-- CCN — baseline Drizzle's migration journal against an already-migrated database.
-- Recovery script; see apps/ops/runbooks/database-migrations.md.
--
-- WHEN TO RUN THIS: migrations 0000-0005 were applied to a database by some
-- route other than `bun run db:migrate` (typically pasted into the Supabase SQL
-- Editor). That creates the tables and types but leaves Drizzle's journal empty,
-- so the next `db:migrate` believes the database is untouched, replays 0000, and
-- dies on `type "actor_type" already exists`. Because Render runs db:migrate as
-- its preDeployCommand, that exit code FAILS THE WHOLE DEPLOY — the API silently
-- keeps serving the previously-deployed image while new commits appear merged.
--
-- This records those six migrations as already-applied, using the exact hashes
-- Drizzle computes for them, so db:migrate becomes a clean no-op and later
-- migrations apply normally.
--
-- Safe to run more than once: it inserts only hashes that aren't already present,
-- and it changes NO application data or schema — it writes solely to Drizzle's
-- own bookkeeping table.
--
-- It does NOT verify that the database's shape actually matches those migrations.
-- Only run it when the schema really was created from these exact files; if the
-- schema drifted, baselining hides the drift rather than fixing it.

CREATE SCHEMA IF NOT EXISTS drizzle;

CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);

INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT v.hash, v.created_at
FROM (VALUES
  ('ae9df9e40e80b7eb3a2d5d4c8908b2580fdd93859a983935b31ca58056ca7521'::text, 1785936589816::bigint), -- 0000_initial
  ('6a79a17de9eeffaa65d22e01ea6e37a367ed0b1b8b7a98d331810965400ea02c',       1785936611384),         -- 0001_security
  ('dd4082fc27dc9ed44079fe6d062f064b6594131218221519906630c880516a02',       1785936700000),         -- 0002
  ('7600abf3cae45b372060806a2a8098da06043285f6ba81eb62a1f6ef31e8252e',       1786468921157),         -- 0003
  ('b1f1687d08363e45349f08da74623dc305cdf31a4913dba4fb4de6ed1313b642',       1786468921158),         -- 0004
  ('33405b62cadc367745daef7a2c3f513a2e2c4c566510f62b922ed168bb79b79a',       1786480000000)          -- 0005_auth_grants
) AS v(hash, created_at)
WHERE NOT EXISTS (
  SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.hash = v.hash
)
ORDER BY v.created_at;

-- Verify: expect 6 rows.
SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id;
