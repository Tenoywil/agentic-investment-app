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

-- This deliberately does NOT swallow a privilege error. An earlier revision
-- caught insufficient_privilege and carried on with a NOTICE, which made the
-- deploy succeed while the grant silently did not happen — the exact
-- silent-failure shape this file exists to remove. If the grant cannot be made,
-- the migration fails, the deploy fails, and the message says what to run by
-- hand. A deploy that cannot serve an authenticated request should not be
-- reported as a success.
DO $$
BEGIN
  EXECUTE format('GRANT ccn_app TO %I', current_user);
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE EXCEPTION
      'cannot grant ccn_app to %. Every authenticated request begins with SET LOCAL ROLE ccn_app and will fail with "permission denied to set role" until this is granted. Run this once as a role with ADMIN OPTION on ccn_app (in Supabase, the SQL Editor runs as postgres): GRANT ccn_app TO %I;',
      current_user, current_user;
END $$;

-- Prove it, in the same transaction. GRANT can succeed while membership is
-- still not usable (NOINHERIT, or a grant made WITHOUT the right options), and
-- the only thing that matters is whether the switch the API performs on every
-- request actually works.
DO $$
BEGIN
  IF NOT pg_has_role(current_user, 'ccn_app', 'MEMBER') THEN
    RAISE EXCEPTION '% is still not a member of ccn_app after the grant', current_user;
  END IF;
END $$;
