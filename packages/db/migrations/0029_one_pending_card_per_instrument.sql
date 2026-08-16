-- One pending card per instrument, one live introduction per match.
--
-- Nothing has ever prevented duplicates on either table. Approvals are
-- inserted from three places (the approvals route, the background sweep, the
-- demo seed) and only the sweep carries any guard — a read-then-insert with
-- no lock, so a chat raise racing a sweep tick, two API replicas, or a
-- retried POST all produce two identical pending cards for the same
-- instrument. Gateway introduction requests have no uniqueness at all, and
-- since gateway_deals is unique per *request* (not per match), two requests
-- approved for the same match become two deals for the same opportunity.
--
-- Partial unique indexes are the backstop; the application layers its own
-- pre-checks on top so a person gets a readable "this is already waiting"
-- instead of a constraint error. Pre-existing duplicates are resolved first:
-- the newest pending row per key keeps its place, older ones become
-- 'expired' — the status that has existed since 0000 for exactly this kind
-- of card that stopped mattering, and which nothing else has ever used.

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, instrument_id
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM approvals
  WHERE status = 'pending' AND instrument_id IS NOT NULL
)
UPDATE approvals a
SET status = 'expired', decided_at = now()
FROM ranked r
WHERE a.id = r.id AND r.rn > 1;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS approvals_one_pending_per_instrument
  ON approvals (user_id, instrument_id)
  WHERE status = 'pending';
--> statement-breakpoint

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY match_id
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM gateway_introduction_requests
  WHERE status = 'requested'
)
UPDATE gateway_introduction_requests g
SET status = 'rejected', decided_at = now(), decision_reason = 'duplicate request'
FROM ranked r
WHERE g.id = r.id AND r.rn > 1;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS gateway_intro_one_live_per_match
  ON gateway_introduction_requests (match_id)
  WHERE status = 'requested';
