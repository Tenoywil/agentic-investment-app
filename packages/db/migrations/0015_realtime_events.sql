-- Realtime beyond orders.
--
-- `ccn_events` carried exactly four notifications — create/accept/settle/reject
-- order — because those are the four SECURITY DEFINER functions someone
-- remembered to add a `pg_notify` to. Everything else a person waits on was
-- silent: the approval card that appears for them, the firm accepting them as a
-- client, a statement landing in the reconciliation queue, a listing going live.
--
-- Triggers rather than more calls inside functions. A notify written into a
-- function covers that function; a trigger covers the table, including the write
-- path someone adds next year without reading this file. The four order
-- notifications stay where they are: they carry a status the trigger would have
-- to reconstruct, and duplicating them here would double every order event.
--
-- Payload is the envelope `ws/hub.ts:shouldReceive` already understands —
-- `{type, user_id, partner_id, status}` — so the fan-out needs no change. A row
-- with a null tenant column simply matches nobody, which is the correct
-- behaviour for a subscriber that owns neither side.

CREATE OR REPLACE FUNCTION ccn_notify_row() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_row jsonb;
  v_user text;
  v_partner text;
BEGIN
  -- The row is read as jsonb rather than through dynamic field access: each of
  -- these tables names its tenant columns differently and not all have both, and
  -- `($1).%I` against a record depends on the planner inferring a composite type
  -- it has no reason to know. TG_ARGV[0] is the event prefix, [1] the user
  -- column, [2] the partner column; an empty name means the table has none.
  v_row := to_jsonb(NEW);
  v_user := CASE WHEN TG_ARGV[1] = '' THEN NULL ELSE v_row ->> TG_ARGV[1] END;
  v_partner := CASE WHEN TG_ARGV[2] = '' THEN NULL ELSE v_row ->> TG_ARGV[2] END;

  PERFORM pg_notify('ccn_events', jsonb_build_object(
    'type', TG_ARGV[0] || '.' || lower(TG_OP),
    'user_id', v_user,
    'partner_id', v_partner,
    'status', v_row ->> 'status'
  )::text);

  RETURN NULL; -- AFTER trigger; the return value is discarded
END $$;--> statement-breakpoint

-- An approval is the one thing in the product that exists purely to be waited
-- on, and it had no event at all.
CREATE TRIGGER approvals_notify
AFTER INSERT OR UPDATE ON approvals
FOR EACH ROW EXECUTE FUNCTION ccn_notify_row('approval', 'user_id', '');--> statement-breakpoint

-- Both sides wait on this one: the investor for the firm's decision, the
-- operator for a new request arriving in their queue.
CREATE TRIGGER connected_accounts_notify
AFTER INSERT OR UPDATE ON connected_accounts
FOR EACH ROW EXECUTE FUNCTION ccn_notify_row('connection', 'user_id', 'partner_id');--> statement-breakpoint

CREATE TRIGGER reconciliation_items_notify
AFTER INSERT OR UPDATE ON reconciliation_items
FOR EACH ROW EXECUTE FUNCTION ccn_notify_row('reconciliation', 'user_id', 'partner_id');--> statement-breakpoint

-- Partner-only: a listing has no user. The empty user column means an investor
-- never receives it, which is right — they see the marketplace, not the desk.
CREATE TRIGGER product_listings_notify
AFTER INSERT OR UPDATE ON product_listings
FOR EACH ROW EXECUTE FUNCTION ccn_notify_row('listing', '', 'partner_id');
