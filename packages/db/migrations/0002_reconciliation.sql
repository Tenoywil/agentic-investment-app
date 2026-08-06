-- ============================================================================
-- Statement-ingestion reconciliation: the choke point that turns a human-matched
-- reconciliation_item into a holding. Like create_order, holdings are written
-- ONLY through this SECURITY DEFINER function — never a direct INSERT by the app
-- role for an imported holding — and every match is audited. Ingested statement
-- text stays DATA until a person matches it here (the prompt-injection firebreak).
-- ============================================================================

-- reconcile_match: match a pending item → insert the holding for its user, link
-- the instrument when the slug is known, find-or-create the partner connection,
-- mark the item matched, and audit. Returns the new holding id.
CREATE OR REPLACE FUNCTION reconcile_match(p_item_id uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item reconciliation_items;
  v_acct uuid;
  v_instrument uuid;
  v_holding uuid;
  v_slug text;
BEGIN
  SELECT * INTO v_item FROM reconciliation_items WHERE id = p_item_id AND status = 'pending';
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'reconciliation item % is not pending', p_item_id;
  END IF;
  IF v_item.user_id IS NULL OR v_item.partner_id IS NULL THEN
    RAISE EXCEPTION 'reconciliation item % lacks a user or partner', p_item_id;
  END IF;

  SELECT id INTO v_acct FROM connected_accounts
    WHERE user_id = v_item.user_id AND partner_id = v_item.partner_id LIMIT 1;
  IF v_acct IS NULL THEN
    INSERT INTO connected_accounts(user_id, partner_id, label)
      VALUES (v_item.user_id, v_item.partner_id, v_item.parsed->>'name')
      RETURNING id INTO v_acct;
  END IF;

  v_slug := v_item.parsed->>'instrumentSlug';
  IF v_slug IS NOT NULL THEN
    SELECT id INTO v_instrument FROM instruments WHERE slug = v_slug;
  END IF;

  INSERT INTO holdings(user_id, connected_account_id, instrument_id, name, value_minor, currency, return_label)
    VALUES (
      v_item.user_id, v_acct, v_instrument,
      coalesce(v_item.parsed->>'name', 'Imported holding'),
      coalesce((v_item.parsed->>'valueMinor')::bigint, 0),
      coalesce((v_item.parsed->>'currency')::currency, 'USD'::currency),
      v_item.parsed->>'returnLabel')
    RETURNING id INTO v_holding;

  UPDATE reconciliation_items SET status = 'matched', updated_at = now() WHERE id = p_item_id;

  PERFORM audit_append('system', NULL, v_item.user_id, v_item.partner_id, 'reconciliation.matched',
    'holding', v_holding, jsonb_build_object('item_id', p_item_id, 'value_minor', v_item.parsed->>'valueMinor'));
  RETURN v_holding;
END $$;--> statement-breakpoint

-- reconcile_reject: dismiss a pending item without creating a holding; audited.
CREATE OR REPLACE FUNCTION reconcile_reject(p_item_id uuid, p_reason text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item reconciliation_items;
BEGIN
  SELECT * INTO v_item FROM reconciliation_items WHERE id = p_item_id AND status = 'pending';
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'reconciliation item % is not pending', p_item_id;
  END IF;
  UPDATE reconciliation_items SET status = 'rejected', updated_at = now() WHERE id = p_item_id;
  PERFORM audit_append('system', NULL, v_item.user_id, v_item.partner_id, 'reconciliation.rejected',
    'reconciliation_item', p_item_id, jsonb_build_object('reason', p_reason));
END $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION reconcile_match(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION reconcile_reject(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION reconcile_match(uuid) TO ccn_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION reconcile_reject(uuid, text) TO ccn_app;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "reconciliation_items_partner_idx" ON "reconciliation_items" ("partner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reconciliation_items_user_idx" ON "reconciliation_items" ("user_id");
