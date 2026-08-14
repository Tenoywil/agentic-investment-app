-- Why is the partner console failing to save?
--
-- Run this against the environment that is failing. It calls the same function
-- the console calls, as the same role, inside a transaction that is ROLLED BACK
-- — so it writes nothing and tells you the real Postgres error instead of the
-- 500 the browser shows.
--
-- Self-contained: it finds a partner operator itself. Paste the whole block.

BEGIN;
CREATE TEMP TABLE _who ON COMMIT DROP AS
  SELECT ur.user_id, ur.partner_id
    FROM user_roles ur
   WHERE ur.role = 'partner_operator' AND ur.partner_id IS NOT NULL
   LIMIT 1;
GRANT SELECT ON _who TO ccn_app;
SET LOCAL ROLE ccn_app;
SELECT set_config('app.current_user_id',    user_id::text,      true),
       set_config('app.current_partner_id', partner_id::text,   true),
       set_config('app.current_role',       'partner_operator', true)
  FROM _who;
SELECT id, slug, name
  FROM partner_upsert_instrument(
    NULL, 'Diagnostic Fund', 'fund', 'DIAG', 'USD', 0,
    NULL, NULL, NULL, NULL, NULL, NULL);
ROLLBACK;

-- What the answers mean:
--
--   a row comes back
--       The function works, and the failure is above the database. Check the
--       API log for that request, and confirm the deployed build matches this
--       schema. Note the row is rolled back, so nothing was actually listed.
--
--   ERROR: new row violates row-level security policy for table "instruments"
--       The function is SECURITY DEFINER, but `instruments` carries FORCE ROW
--       LEVEL SECURITY, so even the table's owner obeys its policies — and the
--       only INSERT policy requires the admin role. This appears only where the
--       owning role is not a superuser and lacks BYPASSRLS, which is why it
--       does not reproduce on a local Postgres. Fix: grant BYPASSRLS to the
--       owning role, or add a partner-scoped INSERT policy.
--
--   ERROR: permission denied for function partner_upsert_instrument
--       The GRANT at the end of 0017 did not run. Re-run that line alone.
--
--   ERROR: function partner_upsert_instrument(...) does not exist
--       0017 did not apply. Pasted into a SQL editor the whole file is one
--       transaction, so a failure anywhere rolls back all of it.
--
--   ERROR: duplicate key value violates unique constraint "instruments_slug_unique"
--       0020 has not been applied. Two products under one name collide.
--
--   no rows in _who
--       Nobody holds partner_operator with a partner binding in `user_roles`,
--       so no console user exists to act as.
