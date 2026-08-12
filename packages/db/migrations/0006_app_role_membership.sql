-- ============================================================================
-- Fix: nothing ever granted MEMBERSHIP of ccn_app to the role the API connects
-- as, so `SET LOCAL ROLE ccn_app` — the first statement of every RLS-scoped
-- transaction — can fail with "permission denied to set role".
--
-- 0001_security.sql creates ccn_app NOLOGIN and grants it table privileges.
-- Because it is NOLOGIN, it can never itself be the connection role: the API
-- always connects as something else and switches into it. In PostgreSQL that
-- switch requires the current role to be a MEMBER of the target (or to be a
-- superuser). Membership was never granted.
--
-- Invisible everywhere it has been run so far. Local dev and CI both connect as
-- `postgres`, a superuser, which may SET ROLE to anything — so withRls has
-- never once been exercised by a role that actually needed this grant. Managed
-- Postgres (Supabase, RDS) deliberately does NOT give you a true superuser, so
-- production is the first place it matters, and the symptom is every
-- authenticated request failing after sign-in finally succeeds.
--
-- GRANT is issued to the current role — whoever runs the migration is whoever
-- the API connects as, since both read the same DATABASE_URL. Membership
-- carries INHERIT by default, so that role also picks up the table privileges
-- granted to ccn_app in 0001 and 0005 without a second grant.
--
-- Re-granting existing membership is a no-op, so this is safe to replay. The
-- exception handler keeps a superuser-only environment (where the grant is
-- unnecessary) from failing the deploy on a privilege error.
-- ============================================================================

DO $$
BEGIN
  EXECUTE format('GRANT ccn_app TO %I', current_user);
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'could not grant ccn_app to %; SET ROLE will only work if it is a superuser', current_user;
  WHEN duplicate_object THEN
    NULL;
END $$;
