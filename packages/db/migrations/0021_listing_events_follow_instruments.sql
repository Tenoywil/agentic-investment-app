-- The listing event fires on the table nothing writes any more.
--
-- `0015` put a realtime trigger on `product_listings`, which was the console's
-- products table at the time. `0017` moved the console onto `instruments` — the
-- table the marketplace actually reads — and left the trigger behind. So since
-- then: listing a product, amending one, and pausing one have emitted no event
-- at all, while `product_listings` sits inert with a trigger watching it.
--
-- The consequence is on the customer side. A firm pauses a product; the
-- marketplace page an investor has open goes on offering it; they tap Review &
-- invest and the order path refuses with "no longer offered by the listing
-- firm" — a correct refusal that reads as a bug, because the screen had no way
-- to know. The whole point of gating orders on `listing_status` was that the
-- two sides agree, and they cannot agree if one is never told.
--
-- Partner-only, as before: the empty user column means the event carries no
-- user id, and `shouldReceive` (apps/api/src/ws/hub.ts) delivers an event only
-- to its own user or its own partner. So this reaches the listing firm's own
-- desk and no investor — which is why the marketplace screen does NOT subscribe
-- to it and refreshes on focus instead. Making listing events public would
-- change the fan-out rule for every event, and that is a decision about the
-- protocol rather than about this trigger.

-- `ccn_notify_row` hard-coded `status` as the column carrying the row's state.
-- `instruments` calls it `listing_status`, so the event would fire with
-- `status: null` — present, and useless to a receiver deciding whether a
-- product just went live or came off the shelf. A fourth, optional argument
-- names the column; every existing trigger passes three and keeps `status`.
CREATE OR REPLACE FUNCTION ccn_notify_row() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_row jsonb;
  v_user text;
  v_partner text;
  v_status_col text;
BEGIN
  v_row := to_jsonb(NEW);
  v_user := CASE WHEN TG_ARGV[1] = '' THEN NULL ELSE v_row ->> TG_ARGV[1] END;
  v_partner := CASE WHEN TG_ARGV[2] = '' THEN NULL ELSE v_row ->> TG_ARGV[2] END;
  v_status_col := CASE WHEN TG_NARGS > 3 THEN TG_ARGV[3] ELSE 'status' END;

  PERFORM pg_notify('ccn_events', jsonb_build_object(
    'type', TG_ARGV[0] || '.' || lower(TG_OP),
    'user_id', v_user,
    'partner_id', v_partner,
    'status', v_row ->> v_status_col
  )::text);

  RETURN NULL; -- AFTER trigger; the return value is discarded
END $$;--> statement-breakpoint

DROP TRIGGER IF EXISTS product_listings_notify ON product_listings;--> statement-breakpoint

CREATE TRIGGER instruments_notify
AFTER INSERT OR UPDATE ON instruments
FOR EACH ROW EXECUTE FUNCTION ccn_notify_row('listing', '', 'partner_id', 'listing_status');
