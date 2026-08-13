-- ---------------------------------------------------------------------------
-- Administration: changing someone's roles.
--
-- 0008 gave `admin` a read across every tenant and deliberately nothing more.
-- Running the network needs one write: putting a person on the right surface —
-- making an operator, binding them to a partner, taking it back.
--
-- The narrowest possible opening. `user_roles` is the only table an admin may
-- write, and even there three conditions are enforced by the database rather
-- than by a handler remembering them:
--
--   1. **An admin cannot mint an admin.** `role <> 'admin'` on both the insert
--      and the delete. The only way to become an administrator remains the
--      ADMIN_EMAILS environment variable, so a compromised admin account cannot
--      promote a second one, and cannot quietly remove a colleague either. This
--      is the property the whole surface rests on and it does not belong in
--      TypeScript.
--   2. **These policies grant an admin nothing over their own row.** The
--      `user_id <> app_current_user_id()` clause keeps this grant strictly
--      about other people.
--
--      Be precise about what that does and does not buy, because it is easy to
--      misread as a self-escalation guarantee and it is not one. Policies are
--      PERMISSIVE and OR together, and the pre-existing `user_roles_tenant`
--      policy is FOR ALL with `WITH CHECK (user_id = app_current_user_id())` —
--      so *any* authenticated user could already insert their own role rows,
--      including `admin`, at the database level. That predates this migration
--      and is not opened up by it. What actually prevents it is that no route
--      writes arbitrary roles: provisioning writes from the environment
--      allowlist only, and the administration endpoint refuses a self-target
--      and refuses `admin` before it reaches SQL.
--
--      The durable fix is to move provisioning behind a SECURITY DEFINER
--      function, as `create_order` already is, and reduce `user_roles_tenant`
--      to SELECT. That is a change to the sign-in path and does not belong in
--      the same migration as an administrative feature.
--   3. Everything else an admin can see is still read-only. No policy is added
--      anywhere else, and no UPDATE policy is added here: a role change is an
--      insert and a delete, both of which leave the audit trail intact.
--
-- DELETE is granted to the app role for this one table. It has none anywhere
-- else by design (0001_security.sql), and that stays true — revoking a role is
-- the single case where removing a row is the correct representation, because a
-- role someone no longer holds should not linger as a tombstone the surface
-- resolver has to reason about.
--
-- Every change is written to `audit_log` by the API through `audit_append`,
-- which is append-only by trigger.
-- ---------------------------------------------------------------------------

GRANT DELETE ON TABLE "user_roles" TO ccn_app;--> statement-breakpoint

CREATE POLICY "user_roles_admin_grant" ON "user_roles" FOR INSERT
  WITH CHECK (
    app_current_role() = 'admin'
    AND "role" <> 'admin'
    AND "user_id" <> app_current_user_id()
  );--> statement-breakpoint

CREATE POLICY "user_roles_admin_revoke" ON "user_roles" FOR DELETE
  USING (
    app_current_role() = 'admin'
    AND "role" <> 'admin'
    AND "user_id" <> app_current_user_id()
  );
