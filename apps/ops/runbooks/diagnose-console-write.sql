-- Why is the partner console failing to save?
--
-- Run this against the environment that is failing. It calls the same function
-- the console calls, as the same role, inside a transaction that is ROLLED BACK
-- — so it writes nothing and tells you the real Postgres error instead of the
-- 500 the browser shows.
--
-- Replace the two ids first: the operator's user id, and their partner id.
--   select id, email from "user" where email = 'operator@example.com';
--   select id, code from partners;

BEGIN;
SET LOCAL ROLE ccn_app;
SELECT set_config('app.current_user_id',    '<OPERATOR USER ID>', true),
       set_config('app.current_partner_id', '<PARTNER ID>',       true),
       set_config('app.current_role',       'partner_operator',   true);

SELECT id, slug, name
  FROM partner_upsert_instrument(
    NULL, 'Diagnostic Fund', 'fund', 'DIAG', 'USD', 0,
    NULL, NULL, NULL, NULL, NULL, NULL);
ROLLBACK;

-- What the answers mean:
--
--   a row comes back
--       The function works. The failure is above the database — check the API
--       log for the request, and whether the deployed build matches this schema.
--
--   ERROR: new row violates row-level security policy for table "instruments"
--       The function is SECURITY DEFINER, but `instruments` carries FORCE ROW
--       LEVEL SECURITY, so even the table's owner is subject to its policies —
--       and the only INSERT policy requires the admin role. This appears only
--       where the owner is not a superuser and lacks BYPASSRLS, which is why it
--       does not reproduce on a local Postgres. Fix: grant BYPASSRLS to the
--       owning role, or add a partner-scoped INSERT policy.
--
--   ERROR: permission denied for function partner_upsert_instrument
--       The GRANT at the end of 0017 did not run. Re-run just that line.
--
--   ERROR: function partner_upsert_instrument(...) does not exist
--       0017 did not apply. If it was pasted into a SQL editor, the whole file
--       is one transaction: a failure anywhere rolls back all of it.
--
--   ERROR: no partner in scope
--       The ids above were not substituted, or the operator holds no partner
--       binding in `user_roles`.
