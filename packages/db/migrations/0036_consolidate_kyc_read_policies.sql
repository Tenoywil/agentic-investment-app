-- Keep one permissive SELECT policy per KYC table. Separate write policies
-- preserve the original owner/partner boundaries without evaluating three
-- overlapping read policies for every row.

DROP POLICY IF EXISTS kyc_dossiers_owner ON kyc_dossiers;--> statement-breakpoint
DROP POLICY IF EXISTS kyc_dossiers_partner_read ON kyc_dossiers;--> statement-breakpoint
DROP POLICY IF EXISTS kyc_dossiers_admin_read ON kyc_dossiers;--> statement-breakpoint

CREATE POLICY kyc_dossiers_read ON kyc_dossiers FOR SELECT TO ccn_app
  USING (
    user_id = app_current_user_id()
    OR EXISTS (
      SELECT 1 FROM connected_accounts ca
       WHERE ca.user_id = kyc_dossiers.user_id
         AND ca.partner_id = app_current_partner_id()
         AND ca.status IN ('pending', 'active')
    )
    OR app_current_role() = 'admin'
  );--> statement-breakpoint
CREATE POLICY kyc_dossiers_owner_insert ON kyc_dossiers FOR INSERT TO ccn_app
  WITH CHECK (user_id = app_current_user_id());--> statement-breakpoint
CREATE POLICY kyc_dossiers_owner_update ON kyc_dossiers FOR UPDATE TO ccn_app
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());--> statement-breakpoint

DROP POLICY IF EXISTS partner_kyc_reviews_owner_read ON partner_kyc_reviews;--> statement-breakpoint
DROP POLICY IF EXISTS partner_kyc_reviews_partner ON partner_kyc_reviews;--> statement-breakpoint
DROP POLICY IF EXISTS partner_kyc_reviews_admin_read ON partner_kyc_reviews;--> statement-breakpoint

CREATE POLICY partner_kyc_reviews_read ON partner_kyc_reviews FOR SELECT TO ccn_app
  USING (
    user_id = app_current_user_id()
    OR partner_id = app_current_partner_id()
    OR app_current_role() = 'admin'
  );--> statement-breakpoint
CREATE POLICY partner_kyc_reviews_partner_insert ON partner_kyc_reviews FOR INSERT TO ccn_app
  WITH CHECK (
    partner_id = app_current_partner_id()
    AND EXISTS (
      SELECT 1 FROM connected_accounts ca
       WHERE ca.id = partner_kyc_reviews.connected_account_id
         AND ca.partner_id = app_current_partner_id()
         AND ca.user_id = partner_kyc_reviews.user_id
    )
  );--> statement-breakpoint
CREATE POLICY partner_kyc_reviews_partner_update ON partner_kyc_reviews FOR UPDATE TO ccn_app
  USING (partner_id = app_current_partner_id())
  WITH CHECK (
    partner_id = app_current_partner_id()
    AND EXISTS (
      SELECT 1 FROM connected_accounts ca
       WHERE ca.id = partner_kyc_reviews.connected_account_id
         AND ca.partner_id = app_current_partner_id()
         AND ca.user_id = partner_kyc_reviews.user_id
    )
  );
