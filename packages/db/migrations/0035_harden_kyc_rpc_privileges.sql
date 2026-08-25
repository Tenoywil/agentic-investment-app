-- Supabase projects may carry direct EXECUTE/default grants for Data API roles.
-- Revoking PUBLIC alone does not remove those role-specific privileges, so the
-- KYC and webhook SECURITY DEFINER functions are explicitly application-only.

REVOKE ALL ON FUNCTION partner_clients() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION partner_request_kyc(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION record_value_snapshots() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION enqueue_partner_webhook() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION claim_partner_webhook_deliveries(integer, integer)
  FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION finish_partner_webhook_delivery(
  uuid, uuid, webhook_delivery_status, timestamptz, integer, text
) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION partner_review_client(uuid, boolean, text)
  FROM PUBLIC;--> statement-breakpoint

DO $$
DECLARE v_role name;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated']::name[]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION partner_clients() FROM %I', v_role);
      EXECUTE format('REVOKE ALL ON FUNCTION partner_request_kyc(uuid) FROM %I', v_role);
      EXECUTE format('REVOKE ALL ON FUNCTION record_value_snapshots() FROM %I', v_role);
      EXECUTE format('REVOKE ALL ON FUNCTION enqueue_partner_webhook() FROM %I', v_role);
      EXECUTE format(
        'REVOKE ALL ON FUNCTION claim_partner_webhook_deliveries(integer, integer) FROM %I',
        v_role
      );
      EXECUTE format(
        'REVOKE ALL ON FUNCTION finish_partner_webhook_delivery(uuid, uuid, webhook_delivery_status, timestamptz, integer, text) FROM %I',
        v_role
      );
      EXECUTE format(
        'REVOKE ALL ON FUNCTION partner_review_client(uuid, boolean, text) FROM %I',
        v_role
      );
      EXECUTE format(
        'REVOKE ALL ON TABLE kyc_dossiers, partner_kyc_reviews, partner_webhook_endpoints, partner_webhook_deliveries FROM %I',
        v_role
      );
    END IF;
  END LOOP;
END $$;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION partner_clients() TO ccn_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION partner_request_kyc(uuid) TO ccn_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION record_value_snapshots() TO ccn_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION claim_partner_webhook_deliveries(integer, integer) TO ccn_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION finish_partner_webhook_delivery(
  uuid, uuid, webhook_delivery_status, timestamptz, integer, text
) TO ccn_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION partner_review_client(uuid, boolean, text) TO ccn_app;--> statement-breakpoint

ALTER POLICY kyc_dossiers_owner ON kyc_dossiers TO ccn_app;--> statement-breakpoint
ALTER POLICY kyc_dossiers_partner_read ON kyc_dossiers TO ccn_app;--> statement-breakpoint
ALTER POLICY kyc_dossiers_admin_read ON kyc_dossiers TO ccn_app;--> statement-breakpoint
ALTER POLICY partner_kyc_reviews_owner_read ON partner_kyc_reviews TO ccn_app;--> statement-breakpoint
ALTER POLICY partner_kyc_reviews_partner ON partner_kyc_reviews TO ccn_app;--> statement-breakpoint
ALTER POLICY partner_kyc_reviews_admin_read ON partner_kyc_reviews TO ccn_app;--> statement-breakpoint
ALTER POLICY partner_webhook_endpoints_read ON partner_webhook_endpoints TO ccn_app;--> statement-breakpoint
ALTER POLICY partner_webhook_endpoints_insert ON partner_webhook_endpoints TO ccn_app;--> statement-breakpoint
ALTER POLICY partner_webhook_endpoints_update ON partner_webhook_endpoints TO ccn_app;--> statement-breakpoint
ALTER POLICY partner_webhook_deliveries_read ON partner_webhook_deliveries TO ccn_app;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS partner_kyc_reviews_reviewed_by_idx
  ON partner_kyc_reviews (reviewed_by);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_webhook_deliveries_audit_log_idx
  ON partner_webhook_deliveries (audit_log_id);
