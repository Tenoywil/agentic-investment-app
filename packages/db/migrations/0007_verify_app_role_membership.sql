-- ============================================================================
-- Enforce what 0006 was supposed to guarantee.
--
-- 0006 granted ccn_app membership to the connecting role, but its first
-- revision caught insufficient_privilege and continued with a NOTICE. On a
-- managed Postgres where the grant is refused, that meant the migration
-- recorded itself as applied while the grant had not happened — the deploy went
-- green and every authenticated request kept failing with
-- "permission denied to set role \"ccn_app\"".
--
-- Correcting 0006 in place does not help any database that already ran it:
-- Drizzle decides what to apply by the journal's `when` timestamp, not by
-- re-hashing the file, so an edited migration with an unchanged timestamp is
-- never executed again. Hence a new one.
--
-- This raises rather than warns. `SET LOCAL ROLE ccn_app` is the first
-- statement of every RLS-scoped transaction, so a database without this
-- membership cannot serve a single authenticated request — a deploy against it
-- is not a success worth reporting.
-- ============================================================================

DO $$
BEGIN
  IF pg_has_role(current_user, 'ccn_app', 'MEMBER') THEN
    RETURN; -- already usable; nothing to do
  END IF;

  BEGIN
    EXECUTE format('GRANT ccn_app TO %I', current_user);
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION
        -- RAISE only understands %, not format()'s %I, so the identifier is
        -- quoted explicitly rather than leaving a stray letter in the command
        -- the reader is meant to copy.
        'cannot grant ccn_app to %, and it is not already a member. Every authenticated request begins with SET LOCAL ROLE ccn_app and will fail until this is granted. Run once as a role with ADMIN OPTION on ccn_app (in Supabase the SQL Editor runs as postgres): GRANT ccn_app TO %;',
        current_user, quote_ident(current_user);
  END;

  -- A GRANT that reports success but leaves the switch unusable (NOINHERIT, or
  -- granted without the needed options) is the same outage with a cleaner log.
  IF NOT pg_has_role(current_user, 'ccn_app', 'MEMBER') THEN
    RAISE EXCEPTION
      'granted ccn_app to % but the membership is still not usable; SET ROLE will fail',
      current_user;
  END IF;
END $$;
