-- ---------------------------------------------------------------------------
-- The audit hash stops depending on pgcrypto.
--
-- Production could not write an audit row at all:
--
--     PostgresError: function digest(text, unknown) does not exist   (42883)
--     where: PL/pgSQL function audit_append(...) line 10
--
-- `digest()` comes from pgcrypto, and `audit_append` is SECURITY DEFINER with
-- `SET search_path = public`. On a local Postgres, `CREATE EXTENSION IF NOT
-- EXISTS pgcrypto` (0000_init.sql) installs it into `public` and the function
-- resolves it. On Supabase, pgcrypto is already installed — into the
-- `extensions` schema — so that statement is a no-op and `digest` is simply not
-- on the function's search path.
--
-- The result was a dev/prod divergence that no test could catch, because both
-- ran against a Postgres where the extension happened to live in `public`. It
-- stayed invisible until the first audited write reached production, which is
-- also the worst possible moment: `audit_append` is the choke point for orders,
-- role changes and partner onboarding, so it fails the whole transaction.
--
-- The fix removes the dependency rather than chasing the schema. Postgres has
-- had a built-in `sha256(bytea)` since 11, so no extension is needed to hash.
-- `encode(sha256(convert_to(t, 'UTF8')), 'hex')` and
-- `encode(digest(t, 'sha256'), 'hex')` produce the same string for the same
-- input — verified here for ASCII, multi-byte UTF-8 and the empty string — so
-- **existing hash chains stay valid and audit_verify() still passes over rows
-- written the old way.** Nothing is rewritten; only how the next hash is
-- computed.
--
-- The equality holds because `digest(text, ...)` hashes the text's bytes in the
-- server encoding. On a UTF8 database those are exactly the bytes
-- `convert_to(t, 'UTF8')` produces. This asserts that rather than assuming it:
-- a database in another encoding would silently start producing different
-- hashes, which is a corrupted chain, not a bug you find later.
--
-- pgcrypto itself is left installed. `gen_random_uuid()` is built in on the
-- Postgres versions this targets, but the extension is harmless and dropping it
-- is a separate decision from fixing this.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION
      'audit hashing assumes a UTF8 database; this one is %. Migrating it would change every future hash and break the chain against existing rows.',
      current_setting('server_encoding');
  END IF;
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION audit_append(
  p_actor_type actor_type, p_actor_id uuid, p_user_id uuid, p_partner_id uuid,
  p_action text, p_entity_type text, p_entity_id uuid, p_detail jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prev text;
  v_hash text;
  v_ts timestamptz := now();
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ccn_audit_append'));
  SELECT hash INTO v_prev FROM audit_log ORDER BY seq DESC LIMIT 1;
  v_hash := encode(sha256(convert_to(
    coalesce(v_prev, '') || '|' || p_actor_type::text || '|' || coalesce(p_actor_id::text, '')
      || '|' || coalesce(p_user_id::text, '') || '|' || coalesce(p_partner_id::text, '')
      || '|' || p_action || '|' || coalesce(p_entity_type, '') || '|' || coalesce(p_entity_id::text, '')
      || '|' || coalesce(p_detail::text, '{}') || '|' || v_ts::text,
    'UTF8')), 'hex');
  INSERT INTO audit_log(actor_type, actor_id, user_id, partner_id, action, entity_type,
    entity_id, detail, prev_hash, hash, created_at)
  VALUES (p_actor_type, p_actor_id, p_user_id, p_partner_id, p_action, p_entity_type,
    p_entity_id, coalesce(p_detail, '{}'::jsonb), v_prev, v_hash, v_ts)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION audit_append(actor_type, uuid, uuid, uuid, text, text, uuid, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION audit_append(actor_type, uuid, uuid, uuid, text, text, uuid, jsonb) TO ccn_app;--> statement-breakpoint

-- The verifier has to change with it, and for the same reason: it recomputes
-- every row's hash, so it would fail on a database without pgcrypto in `public`
-- even where the chain is perfectly intact.
CREATE OR REPLACE FUNCTION audit_verify() RETURNS boolean
  LANGUAGE plpgsql STABLE AS $$
DECLARE
  r record;
  v_prev text := NULL;
  v_calc text;
BEGIN
  FOR r IN SELECT * FROM audit_log ORDER BY seq ASC LOOP
    IF r.prev_hash IS DISTINCT FROM v_prev THEN RETURN false; END IF;
    v_calc := encode(sha256(convert_to(
      coalesce(v_prev, '') || '|' || r.actor_type::text || '|' || coalesce(r.actor_id::text, '')
        || '|' || coalesce(r.user_id::text, '') || '|' || coalesce(r.partner_id::text, '')
        || '|' || r.action || '|' || coalesce(r.entity_type, '') || '|' || coalesce(r.entity_id::text, '')
        || '|' || coalesce(r.detail::text, '{}') || '|' || r.created_at::text,
      'UTF8')), 'hex');
    IF v_calc IS DISTINCT FROM r.hash THEN RETURN false; END IF;
    v_prev := r.hash;
  END LOOP;
  RETURN true;
END $$;
