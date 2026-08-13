-- ============================================================================
-- Fix: ccn_app was never granted privileges on Better Auth's own tables.
--
-- 0001_security.sql created the ccn_app role and granted it every app table
-- except the four Better Auth owns (user, session, account, verification) —
-- an oversight, not a deliberate exclusion. Invisible in every environment
-- that ran migrations + tests, because both connect as the Postgres
-- superuser (local dev's DATABASE_URL, and CI's trust-auth `postgres` user),
-- which bypasses grants entirely. It only surfaces once the API connects as
-- a real non-superuser role scoped to ccn_app (as production must, or RLS
-- does nothing) — every sign-in then hits "permission denied for table
-- user/session/account/verification" the instant Better Auth's Drizzle
-- adapter tries to read or write them, a 500 on every /api/auth/* call.
--
-- No RLS here, deliberately: unlike the tenant tables, a caller isn't
-- authenticated yet when Better Auth is reading/creating their own session,
-- so there is no app.current_user_id to filter by. Better Auth's own token
-- validation is what stands in place of RLS for these four tables.
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "user", "session", "account", "verification"
  TO ccn_app;--> statement-breakpoint
