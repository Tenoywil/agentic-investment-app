-- Optional, partner-owned export of the immutable audit stream.
--
-- Each partner has at most one approved HTTPS endpoint. An AFTER INSERT
-- trigger snapshots audit events into a durable outbox in the same transaction
-- as audit_append(), so a worker crash can delay delivery but cannot lose the
-- committed event. Delivery is at-least-once; event_id is stable and unique per
-- endpoint so receivers can make their side idempotent.

DO $$
BEGIN
  CREATE TYPE webhook_delivery_status AS ENUM (
    'pending', 'processing', 'delivered', 'failed', 'dead'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS partner_webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  url text NOT NULL,
  secret_ciphertext text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_webhook_endpoints_partner_uq UNIQUE (partner_id),
  CONSTRAINT partner_webhook_endpoints_url_length CHECK (length(url) BETWEEN 1 AND 2048),
  CONSTRAINT partner_webhook_endpoints_https CHECK (url ~ '^https://')
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS partner_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id uuid NOT NULL REFERENCES partner_webhook_endpoints(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  audit_log_id uuid REFERENCES audit_log(id) ON DELETE SET NULL,
  event_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status webhook_delivery_status NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  lock_token uuid,
  last_attempt_at timestamptz,
  response_status integer,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_webhook_deliveries_event_uq UNIQUE (endpoint_id, event_id),
  CONSTRAINT partner_webhook_deliveries_attempt_count CHECK (attempt_count >= 0),
  CONSTRAINT partner_webhook_deliveries_response_status
    CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599),
  CONSTRAINT partner_webhook_deliveries_lock_state CHECK (
    (status = 'processing' AND locked_until IS NOT NULL AND lock_token IS NOT NULL)
    OR (status <> 'processing' AND locked_until IS NULL AND lock_token IS NULL)
  ),
  CONSTRAINT partner_webhook_deliveries_payload_size CHECK (pg_column_size(payload) <= 262144)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS partner_webhook_deliveries_dispatch_idx
  ON partner_webhook_deliveries (status, next_attempt_at, locked_until);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_webhook_deliveries_partner_idx
  ON partner_webhook_deliveries (partner_id, created_at DESC);--> statement-breakpoint

ALTER TABLE partner_webhook_endpoints ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE partner_webhook_endpoints FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE partner_webhook_deliveries ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE partner_webhook_deliveries FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY partner_webhook_endpoints_read ON partner_webhook_endpoints FOR SELECT
  USING (partner_id = app_current_partner_id() OR app_current_role() = 'admin');--> statement-breakpoint
CREATE POLICY partner_webhook_endpoints_insert ON partner_webhook_endpoints FOR INSERT
  WITH CHECK (
    partner_id = app_current_partner_id()
    AND created_by = app_current_user_id()
    AND updated_by = app_current_user_id()
  );--> statement-breakpoint
CREATE POLICY partner_webhook_endpoints_update ON partner_webhook_endpoints FOR UPDATE
  USING (partner_id = app_current_partner_id())
  WITH CHECK (
    partner_id = app_current_partner_id()
    AND updated_by = app_current_user_id()
  );--> statement-breakpoint
CREATE POLICY partner_webhook_deliveries_read ON partner_webhook_deliveries FOR SELECT
  USING (partner_id = app_current_partner_id() OR app_current_role() = 'admin');--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON partner_webhook_endpoints TO ccn_app;--> statement-breakpoint
GRANT SELECT ON partner_webhook_deliveries TO ccn_app;--> statement-breakpoint

-- Snapshot the event while the audit row is being committed. Actor name is
-- informational only; actor/user ids remain authoritative and are always
-- present in the envelope when the source event supplied them.
CREATE OR REPLACE FUNCTION enqueue_partner_webhook() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_endpoint partner_webhook_endpoints;
  v_actor_name text;
  v_payload jsonb;
BEGIN
  IF NEW.partner_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_endpoint
    FROM partner_webhook_endpoints
   WHERE partner_id = NEW.partner_id AND active = true;
  IF v_endpoint.id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.actor_id IS NOT NULL THEN
    SELECT name INTO v_actor_name FROM "user" WHERE id = NEW.actor_id;
  END IF;

  v_payload := jsonb_build_object(
    'specversion', '1.0',
    'id', NEW.id::text,
    'type', NEW.action,
    'source', 'urn:ccn:partner:' || NEW.partner_id::text,
    'subject', coalesce(NEW.entity_type || '/' || NEW.entity_id::text, 'audit'),
    'time', NEW.created_at,
    'datacontenttype', 'application/json',
    'data', jsonb_build_object(
      'sequence', NEW.seq::text,
      'actor', jsonb_build_object(
        'type', NEW.actor_type::text,
        'id', NEW.actor_id,
        'name', v_actor_name
      ),
      'userId', NEW.user_id,
      'partnerId', NEW.partner_id,
      'entity', jsonb_build_object('type', NEW.entity_type, 'id', NEW.entity_id),
      'detail', NEW.detail
    )
  );

  INSERT INTO partner_webhook_deliveries (
    endpoint_id, partner_id, audit_log_id, event_id, event_type, payload
  ) VALUES (
    v_endpoint.id, NEW.partner_id, NEW.id, NEW.id, NEW.action, v_payload
  ) ON CONFLICT (endpoint_id, event_id) DO NOTHING;

  RETURN NEW;
END $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION enqueue_partner_webhook() FROM PUBLIC;--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_log_enqueue_partner_webhook ON audit_log;--> statement-breakpoint
CREATE TRIGGER audit_log_enqueue_partner_webhook
  AFTER INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION enqueue_partner_webhook();
--> statement-breakpoint

-- The dispatcher runs with the normal application database role. It claims
-- work through this narrow function rather than receiving broad UPDATE rights
-- over every tenant's outbox. SKIP LOCKED makes multiple API replicas safe.
CREATE OR REPLACE FUNCTION claim_partner_webhook_deliveries(
  p_limit integer, p_lease_ms integer
) RETURNS TABLE (
  delivery_id uuid,
  endpoint_id uuid,
  partner_id uuid,
  event_id uuid,
  event_type text,
  payload jsonb,
  attempt_count integer,
  lock_token uuid,
  endpoint_url text,
  secret_ciphertext text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
    WITH candidates AS (
      SELECT d.id
        FROM partner_webhook_deliveries d
        JOIN partner_webhook_endpoints e ON e.id = d.endpoint_id
       WHERE e.active = true
         AND (
           (d.status IN ('pending', 'failed') AND d.next_attempt_at <= now())
           OR (d.status = 'processing' AND d.locked_until <= now())
         )
       ORDER BY d.next_attempt_at, d.created_at
       FOR UPDATE OF d SKIP LOCKED
       LIMIT greatest(1, least(p_limit, 100))
    ), claimed AS (
      UPDATE partner_webhook_deliveries d
         SET status = 'processing',
             attempt_count = d.attempt_count + 1,
             last_attempt_at = now(),
             locked_until = now() + make_interval(secs => greatest(1, p_lease_ms) / 1000.0),
             lock_token = gen_random_uuid(),
             updated_at = now()
        FROM candidates c
       WHERE d.id = c.id
       RETURNING d.*
    )
    SELECT c.id, c.endpoint_id, c.partner_id, c.event_id, c.event_type,
           c.payload, c.attempt_count, c.lock_token, e.url, e.secret_ciphertext
      FROM claimed c
      JOIN partner_webhook_endpoints e ON e.id = c.endpoint_id;
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION finish_partner_webhook_delivery(
  p_delivery_id uuid,
  p_lock_token uuid,
  p_status webhook_delivery_status,
  p_next_attempt_at timestamptz,
  p_response_status integer,
  p_last_error text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_status NOT IN ('delivered', 'failed', 'dead') THEN
    RAISE EXCEPTION 'invalid finished webhook status %', p_status;
  END IF;
  IF p_response_status IS NOT NULL AND (p_response_status < 100 OR p_response_status > 599) THEN
    RAISE EXCEPTION 'invalid webhook response status %', p_response_status;
  END IF;

  UPDATE partner_webhook_deliveries
     SET status = p_status,
         next_attempt_at = coalesce(p_next_attempt_at, next_attempt_at),
         response_status = p_response_status,
         last_error = left(p_last_error, 500),
         delivered_at = CASE WHEN p_status = 'delivered' THEN now() ELSE delivered_at END,
         locked_until = NULL,
         lock_token = NULL,
         updated_at = now()
   WHERE id = p_delivery_id AND status = 'processing' AND lock_token = p_lock_token;
  RETURN FOUND;
END $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION claim_partner_webhook_deliveries(integer, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION finish_partner_webhook_delivery(
  uuid, uuid, webhook_delivery_status, timestamptz, integer, text
) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION claim_partner_webhook_deliveries(integer, integer) TO ccn_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION finish_partner_webhook_delivery(
  uuid, uuid, webhook_delivery_status, timestamptz, integer, text
) TO ccn_app;
