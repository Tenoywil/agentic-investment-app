-- An administrator can take a listing off the marketplace.
--
-- The network had no takedown control. A firm can pause its own product, and
-- nobody else could: `instruments` has an admin INSERT policy (0010, for the
-- reference-data load) and no UPDATE policy at all, so even the administration
-- console — the surface that exists to run the network — could not withdraw a
-- listing that a regulator flagged, a partner asked CCN to pull while their
-- console access was broken, or that was simply listed in error. The only path
-- was SQL against production, which is the out-of-band access this system is
-- built to avoid.
--
-- UPDATE, not DELETE. A listing that has ever been offered is joined to by
-- holdings and orders, and the take-down that erases the record of what was
-- offered is worse than the listing. Pausing is reversible and leaves history
-- intact, which is why it is the same verb the partner console uses.
--
-- RLS cannot restrict columns, so this policy admits any column change by an
-- admin. That is the same trust already extended on `partners` (0010's
-- partners_admin_correct): an administrator who corrects firm records may
-- correct listing records. The API route built on this writes only
-- `listing_status`, and every change lands in the append-only audit log.

GRANT UPDATE ON TABLE "instruments" TO ccn_app;--> statement-breakpoint

CREATE POLICY "instruments_admin_correct" ON "instruments" FOR UPDATE
  USING (app_current_role() = 'admin')
  WITH CHECK (app_current_role() = 'admin');
