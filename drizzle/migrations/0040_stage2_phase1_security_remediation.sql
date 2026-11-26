-- ==============================================================================
-- Migration 0040: Stage 2 Objective A — Phase 1 P0 Security Remediation
--
-- Remediates all P0 findings from the independent Stage 2 security audit:
--   1. Cross-user arbitrary storage deletion (all 3 exploit paths):
--      - Revokes direct client INSERT/UPDATE/DELETE on public.media_assets and
--        adds server-authorized register_my_media_asset() + service-only
--        register_server_media_asset() RPCs with strict ownership & bucket checks.
--      - Adds guard_hub_message_write() BEFORE INSERT/UPDATE trigger on
--        public.hub_messages binding media_url strictly to hub-attachments
--        under {hub_id}/{sender_id}/{safe_file} and locking immutable columns.
--      - Tightens assert_can_send_to_conversation() and DM/Hub deletion triggers
--        to reject external/public https:// URLs and cross-bucket refs.
--      - Hardens enqueue_media_object_deletion() with strict bucket allowlist,
--        bucket-match enforcement, traversal/encoding rejection, owner-prefix
--        checks, derivative-key validation, and accurate ROW_COUNT return.
--   2. Media metadata & quota integrity:
--      - Derives authoritative file size from storage.objects.metadata (or
--        service_role-verified R2 media_assets), blocking 0-byte spoofing.
--      - Enforces saved-message quotas under a per-user transaction advisory
--        lock with authoritative byte-size cross-check.
--   3. Orphan deletion protection (race-safe live media exclusion):
--      - send_private_message(), hub_messages AFTER INSERT, and moments AFTER
--        INSERT atomically register/flip media_assets to status='ready'.
--      - enqueue_orphaned_staging_media() excludes and heals any actively
--        referenced object across private_messages, hub_messages, moments,
--        pings, profiles, and ping_clips.
--      - claim_media_deletion_jobs() re-verifies active-reference safety and
--        path validity before handing any job to deletion workers.
--
-- Forward-only, idempotent SQL migration. Does not rewrite 0000..0039.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. CANONICAL BUCKET ALLOWLIST, PATH VALIDATION & AUTHORITATIVE STORAGE LOOKUP
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_allowed_storage_bucket(p_bucket text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_bucket IN ('media', 'dm-attachments', 'hub-attachments', 'private-moments');
$$;

REVOKE ALL ON FUNCTION public.is_allowed_storage_bucket(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_allowed_storage_bucket(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_storage_object_scope(
  p_bucket text,
  p_object_key text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_parts text[];
  v_len integer;
BEGIN
  IF NOT public.is_allowed_storage_bucket(p_bucket) THEN
    RETURN false;
  END IF;

  IF p_object_key IS NULL OR p_object_key = '' OR btrim(p_object_key) <> p_object_key THEN
    RETURN false;
  END IF;

  IF char_length(p_object_key) < 3 OR char_length(p_object_key) > 360 THEN
    RETURN false;
  END IF;

  -- Reject schemes, leading/trailing/double slashes, backslashes, query/hash, whitespace, control chars
  IF p_object_key ~* '^[a-z][a-z0-9+.-]*:'
     OR left(p_object_key, 1) = '/'
     OR right(p_object_key, 1) = '/'
     OR position('//' in p_object_key) > 0
     OR position('\' in p_object_key) > 0
     OR position('..' in p_object_key) > 0
     OR position('?' in p_object_key) > 0
     OR position('#' in p_object_key) > 0
     OR p_object_key ~* '%2e|%2f|%5c|%00'
     OR p_object_key ~ '[[:space:]\x00-\x1f\x7f]' THEN
    RETURN false;
  END IF;

  v_parts := string_to_array(p_object_key, '/');
  v_len := coalesce(array_length(v_parts, 1), 0);

  IF p_bucket IN ('dm-attachments', 'hub-attachments') THEN
    IF v_len < 3 THEN RETURN false; END IF;
  ELSIF p_bucket = 'private-moments' THEN
    IF v_len < 4 THEN RETURN false; END IF;
  ELSE
    IF v_len < 2 THEN RETURN false; END IF;
  END IF;

  -- Every path segment must be non-empty and free of dot-segments
  IF EXISTS (
    SELECT 1
    FROM unnest(v_parts) AS seg
    WHERE seg = '' OR seg = '.' OR seg = '..'
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_storage_object_scope(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_storage_object_scope(text, text) TO anon, authenticated, service_role;

-- Authoritative server-side lookup into storage.objects (never trusts client size_bytes)
CREATE OR REPLACE FUNCTION public.lookup_authoritative_storage_object(
  p_bucket text,
  p_object_key text
)
RETURNS TABLE(
  object_exists boolean,
  owner_id uuid,
  size_bytes bigint,
  mime_type text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_row record;
  v_raw_size text;
  v_size bigint := 0;
BEGIN
  IF NOT public.validate_storage_object_scope(p_bucket, p_object_key) THEN
    RETURN QUERY SELECT false, NULL::uuid, 0::bigint, NULL::text;
    RETURN;
  END IF;

  SELECT o.owner, o.metadata
  INTO v_row
  FROM storage.objects o
  WHERE o.bucket_id = p_bucket
    AND o.name = p_object_key
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, 0::bigint, NULL::text;
    RETURN;
  END IF;

  v_raw_size := coalesce(
    nullif(btrim(v_row.metadata->>'size'), ''),
    nullif(btrim(v_row.metadata->>'contentLength'), '')
  );
  IF v_raw_size IS NOT NULL AND v_raw_size ~ '^[0-9]{1,12}$' THEN
    v_size := v_raw_size::bigint;
  ELSE
    v_size := 0;
  END IF;

  RETURN QUERY SELECT
    true,
    v_row.owner,
    v_size,
    nullif(btrim(coalesce(v_row.metadata->>'mimetype', v_row.metadata->>'contentType', '')), '');
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_authoritative_storage_object(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_authoritative_storage_object(text, text) TO service_role;

-- Internal helper for SECURITY INVOKER triggers to verify caller owns a storage object
CREATE OR REPLACE FUNCTION public.assert_user_owns_storage_object(
  p_bucket text,
  p_object_key text,
  p_user_id uuid
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_obj record;
BEGIN
  IF p_user_id IS NULL OR NOT public.validate_storage_object_scope(p_bucket, p_object_key) THEN
    RAISE EXCEPTION 'Invalid storage object bucket or key' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_obj
  FROM public.lookup_authoritative_storage_object(p_bucket, p_object_key);

  IF NOT coalesce(v_obj.object_exists, false) THEN
    RAISE EXCEPTION 'Uploaded storage object not found in bucket %', p_bucket USING ERRCODE = '42501';
  END IF;

  IF v_obj.owner_id IS NOT NULL AND v_obj.owner_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Storage object is owned by another user' USING ERRCODE = '42501';
  END IF;

  IF coalesce(v_obj.size_bytes, 0) <= 0 THEN
    RAISE EXCEPTION 'Storage object has missing or zero authoritative byte size' USING ERRCODE = '22023';
  END IF;

  RETURN v_obj.size_bytes;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_user_owns_storage_object(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_user_owns_storage_object(text, text, uuid) TO service_role;

-- ------------------------------------------------------------------------------
-- 2. LOCK DOWN public.media_assets & ADD SERVER-AUTHORIZED REGISTRATION RPCS
-- ------------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS media_assets_provider_bucket_key_uidx
  ON public.media_assets (provider, bucket, object_key)
  WHERE bucket IS NOT NULL AND object_key IS NOT NULL;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.media_assets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.media_assets TO anon, authenticated;
GRANT ALL ON public.media_assets TO service_role;

DROP POLICY IF EXISTS "Users create own media assets" ON public.media_assets;
DROP POLICY IF EXISTS "Users update own media assets" ON public.media_assets;

-- Defense-in-depth trigger blocking direct client writes even if grants are ever misconfigured
CREATE OR REPLACE FUNCTION public.guard_media_assets_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Direct client writes to media_assets are forbidden; use register_my_media_asset RPC'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_media_assets_write() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_media_assets_write ON public.media_assets;
CREATE TRIGGER guard_media_assets_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.media_assets
  FOR EACH ROW EXECUTE FUNCTION public.guard_media_assets_write();

-- Authoritative active-reference checker across all live Ping content tables
CREATE OR REPLACE FUNCTION public.is_storage_object_actively_referenced(
  p_bucket text,
  p_object_key text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_storage_ref text;
  v_r2_ref text;
  v_pub_suffix text;
BEGIN
  IF NOT public.validate_storage_object_scope(p_bucket, p_object_key) THEN
    RETURN false;
  END IF;

  v_storage_ref := 'storage://' || p_bucket || '/' || p_object_key;
  v_r2_ref := 'r2://' || p_bucket || '/' || p_object_key;
  v_pub_suffix := '%/storage/v1/object/public/' || p_bucket || '/' || p_object_key;

  IF p_bucket = 'dm-attachments' THEN
    IF EXISTS (
      SELECT 1
      FROM public.private_messages pm
      WHERE pm.deleted_at IS NULL
        AND pm.expired_at IS NULL
        AND pm.media_url IN (p_object_key, v_storage_ref, v_r2_ref)
    ) THEN
      RETURN true;
    END IF;
  END IF;

  IF p_bucket = 'hub-attachments' THEN
    IF EXISTS (
      SELECT 1
      FROM public.hub_messages hm
      WHERE hm.deleted_at IS NULL
        AND hm.media_url IN (p_object_key, v_storage_ref, v_r2_ref)
    ) THEN
      RETURN true;
    END IF;
  END IF;

  IF p_bucket = 'private-moments' THEN
    IF EXISTS (
      SELECT 1
      FROM public.moments m
      WHERE m.deleted_at IS NULL
        AND m.media_url IN (p_object_key, v_storage_ref, v_r2_ref)
    ) THEN
      RETURN true;
    END IF;
  END IF;

  IF p_bucket = 'media' THEN
    IF EXISTS (
      SELECT 1
      FROM public.pings p
      WHERE p.hidden_at IS NULL
        AND (
          p.image_url LIKE v_pub_suffix
          OR EXISTS (
            SELECT 1 FROM unnest(coalesce(p.media_urls, '{}'::text[])) AS u
            WHERE u LIKE v_pub_suffix
          )
        )
    ) THEN
      RETURN true;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.profiles pr
      WHERE pr.avatar_url LIKE v_pub_suffix
    ) THEN
      RETURN true;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.moments m
      WHERE m.deleted_at IS NULL
        AND m.media_url LIKE v_pub_suffix
    ) THEN
      RETURN true;
    END IF;

    IF to_regclass('public.ping_clips') IS NOT NULL THEN
      IF EXISTS (
        SELECT 1
        FROM public.ping_clips pc
        WHERE pc.hidden_at IS NULL
          AND (pc.video_url LIKE v_pub_suffix OR pc.poster_url LIKE v_pub_suffix)
      ) THEN
        RETURN true;
      END IF;
    END IF;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.is_storage_object_actively_referenced(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_storage_object_actively_referenced(text, text) TO service_role;

-- Secure client-callable registration RPC (never accepts client size_bytes, derivative_keys, status, or created_at)
CREATE OR REPLACE FUNCTION public.register_my_media_asset(
  p_bucket text,
  p_object_key text,
  p_media_kind text,
  p_mime_type text DEFAULT NULL,
  p_content_sha256 text DEFAULT NULL,
  p_conversation_id uuid DEFAULT NULL,
  p_hub_id uuid DEFAULT NULL,
  p_moment_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_parts text[];
  v_visibility text := 'private';
  v_obj record;
  v_max_bytes bigint;
  v_mime text;
  v_sha text := nullif(lower(btrim(coalesce(p_content_sha256, ''))), '');
  v_source_url text;
  v_status text := 'staging';
  v_conv_id uuid := NULL;
  v_hub_id uuid := NULL;
  v_existing public.media_assets%ROWTYPE;
  v_result public.media_assets%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT public.validate_storage_object_scope(p_bucket, p_object_key) THEN
    RAISE EXCEPTION 'Invalid storage bucket or object key' USING ERRCODE = '22023';
  END IF;

  IF p_media_kind NOT IN ('image', 'video', 'audio', 'document') THEN
    RAISE EXCEPTION 'Unsupported media_kind: %', coalesce(p_media_kind, '') USING ERRCODE = '22023';
  END IF;

  IF v_sha IS NOT NULL AND v_sha !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid content_sha256 format' USING ERRCODE = '22023';
  END IF;

  v_parts := string_to_array(p_object_key, '/');

  -- Enforce strict bucket & folder ownership + live membership authorization
  IF p_bucket = 'media' THEN
    IF v_parts[1] <> v_caller::text THEN
      RAISE EXCEPTION 'Public media object must be scoped under caller UID folder' USING ERRCODE = '42501';
    END IF;
    v_visibility := 'public';
    v_source_url := 'storage://media/' || p_object_key;
    v_status := 'ready';
  ELSIF p_bucket = 'dm-attachments' THEN
    IF v_parts[2] <> v_caller::text THEN
      RAISE EXCEPTION 'DM attachment object must be scoped under caller sender folder' USING ERRCODE = '42501';
    END IF;
    IF v_parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Invalid conversation scope in DM object key' USING ERRCODE = '22023';
    END IF;
    v_conv_id := v_parts[1]::uuid;
    IF p_conversation_id IS NOT NULL AND p_conversation_id <> v_conv_id THEN
      RAISE EXCEPTION 'Conversation ID mismatch with object key scope' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = v_conv_id
        AND cm.user_id = v_caller
        AND cm.hidden_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Active conversation membership required to register DM media' USING ERRCODE = '42501';
    END IF;
    v_visibility := 'private';
    v_source_url := p_object_key;
    v_status := CASE
      WHEN public.is_storage_object_actively_referenced('dm-attachments', p_object_key) THEN 'ready'
      ELSE 'staging'
    END;
  ELSIF p_bucket = 'hub-attachments' THEN
    IF v_parts[2] <> v_caller::text THEN
      RAISE EXCEPTION 'Hub attachment object must be scoped under caller sender folder' USING ERRCODE = '42501';
    END IF;
    IF v_parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Invalid Hub scope in object key' USING ERRCODE = '22023';
    END IF;
    v_hub_id := v_parts[1]::uuid;
    IF p_hub_id IS NOT NULL AND p_hub_id <> v_hub_id THEN
      RAISE EXCEPTION 'Hub ID mismatch with object key scope' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.hub_members hm
      JOIN public.hubs h ON h.id = hm.hub_id
      WHERE hm.hub_id = v_hub_id
        AND hm.user_id = v_caller
        AND hm.status = 'active'
        AND h.hidden_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Active Hub membership required to register Hub media' USING ERRCODE = '42501';
    END IF;
    v_visibility := 'private';
    v_source_url := 'storage://hub-attachments/' || p_object_key;
    v_status := CASE
      WHEN public.is_storage_object_actively_referenced('hub-attachments', p_object_key) THEN 'ready'
      ELSE 'staging'
    END;
  ELSIF p_bucket = 'private-moments' THEN
    IF v_parts[1] <> v_caller::text OR v_parts[2] NOT IN ('followers', 'close_circle', 'hub') THEN
      RAISE EXCEPTION 'Restricted Moment object must match {author_id}/{audience}/{scope}/{file}' USING ERRCODE = '42501';
    END IF;
    IF v_parts[2] = 'hub' THEN
      IF v_parts[3] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'Invalid Hub scope in restricted Moment object key' USING ERRCODE = '22023';
      END IF;
      v_hub_id := v_parts[3]::uuid;
      IF NOT EXISTS (
        SELECT 1
        FROM public.hub_members hm
        JOIN public.hubs h ON h.id = hm.hub_id
        WHERE hm.hub_id = v_hub_id
          AND hm.user_id = v_caller
          AND hm.status = 'active'
          AND h.hidden_at IS NULL
      ) THEN
        RAISE EXCEPTION 'Active Hub membership required for Hub Moment media' USING ERRCODE = '42501';
      END IF;
    END IF;
    v_visibility := 'private';
    v_source_url := 'storage://private-moments/' || p_object_key;
    v_status := CASE
      WHEN public.is_storage_object_actively_referenced('private-moments', p_object_key) THEN 'ready'
      ELSE 'staging'
    END;
  END IF;

  -- Authoritatively verify uploaded object existence, ownership, and non-zero byte size in storage.objects
  SELECT * INTO v_obj
  FROM public.lookup_authoritative_storage_object(p_bucket, p_object_key);

  IF NOT coalesce(v_obj.object_exists, false) THEN
    RAISE EXCEPTION 'Uploaded storage object not found in bucket %', p_bucket USING ERRCODE = '42501';
  END IF;

  IF v_obj.owner_id IS NOT NULL AND v_obj.owner_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'Storage object is owned by another account' USING ERRCODE = '42501';
  END IF;

  IF coalesce(v_obj.size_bytes, 0) <= 0 THEN
    RAISE EXCEPTION 'Storage object has missing or zero authoritative size' USING ERRCODE = '22023';
  END IF;

  v_max_bytes := CASE p_media_kind
    WHEN 'image' THEN 10485760
    WHEN 'audio' THEN 26214400
    WHEN 'document' THEN 26214400
    ELSE 52428800
  END;

  IF v_obj.size_bytes > v_max_bytes THEN
    RAISE EXCEPTION 'Uploaded object size (% bytes) exceeds limit (% bytes) for %',
      v_obj.size_bytes, v_max_bytes, p_media_kind
      USING ERRCODE = '22023';
  END IF;

  v_mime := coalesce(
    v_obj.mime_type,
    nullif(btrim(coalesce(p_mime_type, '')), ''),
    'application/octet-stream'
  );

  -- Prevent hijacking an existing registration owned by another user
  SELECT * INTO v_existing
  FROM public.media_assets
  WHERE provider = 'supabase_storage'
    AND bucket = p_bucket
    AND object_key = p_object_key
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.owner_id <> v_caller THEN
      RAISE EXCEPTION 'Media asset already registered by another user' USING ERRCODE = '42501';
    END IF;

    UPDATE public.media_assets
    SET
      size_bytes = v_obj.size_bytes,
      mime_type = v_mime,
      content_sha256 = coalesce(v_sha, content_sha256),
      status = CASE WHEN status = 'ready' OR v_status = 'ready' THEN 'ready' ELSE status END,
      conversation_id = coalesce(conversation_id, v_conv_id),
      hub_id = coalesce(hub_id, v_hub_id),
      moment_id = coalesce(moment_id, p_moment_id),
      updated_at = now()
    WHERE id = v_existing.id
    RETURNING * INTO v_result;
  ELSE
    INSERT INTO public.media_assets (
      owner_id,
      media_kind,
      provider,
      bucket,
      object_key,
      visibility,
      source_url,
      mime_type,
      content_sha256,
      size_bytes,
      derivative_keys,
      status,
      conversation_id,
      hub_id,
      moment_id,
      created_at,
      updated_at
    ) VALUES (
      v_caller,
      p_media_kind,
      'supabase_storage',
      p_bucket,
      p_object_key,
      v_visibility,
      v_source_url,
      v_mime,
      v_sha,
      v_obj.size_bytes,
      '{}'::text[],
      v_status,
      v_conv_id,
      v_hub_id,
      p_moment_id,
      now(),
      now()
    )
    RETURNING * INTO v_result;
  END IF;

  -- Race-safe backfill if DM message was already inserted with 0 bytes before registration completed
  IF p_bucket = 'dm-attachments' AND v_status = 'ready' THEN
    UPDATE public.private_messages
    SET media_size_bytes = greatest(coalesce(media_size_bytes, 0), v_obj.size_bytes),
        updated_at = now()
    WHERE conversation_id = v_conv_id
      AND sender_id = v_caller
      AND media_url IN (p_object_key, 'storage://dm-attachments/' || p_object_key)
      AND coalesce(media_size_bytes, 0) < v_obj.size_bytes;
  END IF;

  RETURN to_jsonb(v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.register_my_media_asset(text, text, text, text, text, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_my_media_asset(text, text, text, text, text, uuid, uuid, uuid) TO authenticated, service_role;

-- Service-role-only registration for verified external/R2 server uploads (Phase 2 ready)
CREATE OR REPLACE FUNCTION public.register_server_media_asset(
  p_owner_id uuid,
  p_provider text,
  p_bucket text,
  p_object_key text,
  p_media_kind text,
  p_size_bytes bigint,
  p_mime_type text DEFAULT 'application/octet-stream',
  p_conversation_id uuid DEFAULT NULL,
  p_hub_id uuid DEFAULT NULL,
  p_moment_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visibility text := CASE WHEN p_bucket = 'media' THEN 'public' ELSE 'private' END;
  v_source_url text;
  v_result public.media_assets%ROWTYPE;
BEGIN
  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'owner_id required' USING ERRCODE = '22023';
  END IF;
  IF p_provider NOT IN ('supabase_storage', 'cloudflare_r2') THEN
    RAISE EXCEPTION 'Unsupported provider' USING ERRCODE = '22023';
  END IF;
  IF NOT public.validate_storage_object_scope(p_bucket, p_object_key) THEN
    RAISE EXCEPTION 'Invalid storage bucket or object key' USING ERRCODE = '22023';
  END IF;
  IF p_media_kind NOT IN ('image', 'video', 'audio', 'document') THEN
    RAISE EXCEPTION 'Unsupported media_kind' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_size_bytes, 0) <= 0 OR p_size_bytes > 52428800 THEN
    RAISE EXCEPTION 'Authoritative size_bytes must be between 1 and 52428800' USING ERRCODE = '22023';
  END IF;

  v_source_url := CASE
    WHEN p_provider = 'cloudflare_r2' THEN 'r2://' || p_bucket || '/' || p_object_key
    WHEN p_bucket = 'dm-attachments' THEN p_object_key
    ELSE 'storage://' || p_bucket || '/' || p_object_key
  END;

  INSERT INTO public.media_assets (
    owner_id, media_kind, provider, bucket, object_key, visibility, source_url,
    mime_type, size_bytes, derivative_keys, status, conversation_id, hub_id, moment_id
  ) VALUES (
    p_owner_id, p_media_kind, p_provider, p_bucket, p_object_key, v_visibility, v_source_url,
    coalesce(nullif(btrim(p_mime_type), ''), 'application/octet-stream'),
    p_size_bytes, '{}'::text[],
    CASE WHEN p_bucket = 'media' THEN 'ready' ELSE 'staging' END,
    p_conversation_id, p_hub_id, p_moment_id
  )
  ON CONFLICT (provider, bucket, object_key) WHERE bucket IS NOT NULL AND object_key IS NOT NULL
  DO UPDATE SET
    size_bytes = EXCLUDED.size_bytes,
    mime_type = EXCLUDED.mime_type,
    updated_at = now()
  WHERE public.media_assets.owner_id = EXCLUDED.owner_id
  RETURNING * INTO v_result;

  IF v_result.id IS NULL THEN
    RAISE EXCEPTION 'Media asset already registered by another owner' USING ERRCODE = '42501';
  END IF;

  RETURN to_jsonb(v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.register_server_media_asset(uuid, text, text, text, text, bigint, text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_server_media_asset(uuid, text, text, text, text, bigint, text, uuid, uuid, uuid) TO service_role;

-- ------------------------------------------------------------------------------
-- 3. HARDEN public.enqueue_media_object_deletion() AT THE QUEUE BOUNDARY
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enqueue_media_object_deletion(
  p_media_ref text,
  p_default_bucket text,
  p_source_type text,
  p_source_id uuid DEFAULT NULL,
  p_owner_id uuid DEFAULT NULL,
  p_size_bytes bigint DEFAULT 0,
  p_derivative_keys text[] DEFAULT '{}'::text[]
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean text := nullif(btrim(coalesce(p_media_ref, '')), '');
  v_provider text := 'supabase_storage';
  v_bucket text := p_default_bucket;
  v_key text;
  v_rest text;
  v_slash integer;
  v_parts text[];
  v_required_prefix text := '';
  v_safe_derivs text[] := '{}'::text[];
  v_dk text;
  v_inserted integer := 0;
BEGIN
  IF v_clean IS NULL OR NOT public.is_allowed_storage_bucket(p_default_bucket) THEN
    RETURN false;
  END IF;

  -- Never parse or enqueue arbitrary http(s) / external / public URLs for deletion
  IF v_clean ~* '^(https?|javascript|data|blob):' THEN
    RETURN false;
  END IF;

  IF v_clean LIKE 'r2://%' THEN
    v_provider := 'cloudflare_r2';
    v_rest := substr(v_clean, 6);
    v_slash := strpos(v_rest, '/');
    IF v_slash <= 1 THEN RETURN false; END IF;
    v_bucket := substr(v_rest, 1, v_slash - 1);
    v_key := substr(v_rest, v_slash + 1);
  ELSIF v_clean LIKE 'storage://%' THEN
    v_rest := substr(v_clean, 11);
    v_slash := strpos(v_rest, '/');
    IF v_slash <= 1 THEN RETURN false; END IF;
    v_bucket := substr(v_rest, 1, v_slash - 1);
    v_key := substr(v_rest, v_slash + 1);
  ELSE
    v_key := v_clean;
  END IF;

  -- Strictly block cross-bucket deletion (caller bucket MUST match parsed bucket)
  IF v_bucket IS DISTINCT FROM p_default_bucket THEN
    RETURN false;
  END IF;

  IF NOT public.validate_storage_object_scope(v_bucket, v_key) THEN
    RETURN false;
  END IF;

  v_parts := string_to_array(v_key, '/');

  -- Enforce owner-folder binding whenever owner_id is supplied
  IF p_owner_id IS NOT NULL THEN
    IF v_bucket IN ('media', 'private-moments') THEN
      IF v_parts[1] <> p_owner_id::text THEN
        RETURN false;
      END IF;
      v_required_prefix := v_parts[1] || '/';
    ELSIF v_bucket IN ('dm-attachments', 'hub-attachments') THEN
      IF v_parts[2] <> p_owner_id::text THEN
        RETURN false;
      END IF;
      v_required_prefix := v_parts[1] || '/' || v_parts[2] || '/';
    END IF;
  ELSIF v_bucket IN ('dm-attachments', 'hub-attachments') THEN
    v_required_prefix := v_parts[1] || '/' || v_parts[2] || '/';
  ELSE
    v_required_prefix := v_parts[1] || '/';
  END IF;

  -- Validate every derivative key against the same bucket and exact owner/scope prefix
  FOREACH v_dk IN ARRAY coalesce(p_derivative_keys, '{}'::text[]) LOOP
    IF public.validate_storage_object_scope(v_bucket, v_dk)
       AND left(v_dk, char_length(v_required_prefix)) = v_required_prefix THEN
      v_safe_derivs := array_append(v_safe_derivs, v_dk);
    END IF;
  END LOOP;

  INSERT INTO public.media_deletion_queue (
    provider,
    bucket,
    object_key,
    derivative_keys,
    source_type,
    source_id,
    owner_id,
    size_bytes,
    status,
    next_retry_at
  )
  VALUES (
    v_provider,
    v_bucket,
    v_key,
    v_safe_derivs,
    p_source_type,
    p_source_id,
    p_owner_id,
    greatest(0, coalesce(p_size_bytes, 0)),
    'pending',
    now()
  )
  ON CONFLICT (provider, bucket, object_key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_media_object_deletion(text, text, text, uuid, uuid, bigint, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_media_object_deletion(text, text, text, uuid, uuid, bigint, text[]) TO service_role;

-- ------------------------------------------------------------------------------
-- 4. HARDEN public.hub_messages MEDIA SCOPING, IMMUTABILITY & SAFE DELETION
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_hub_message_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_clean text;
  v_key text;
  v_expected_prefix text;
  v_is_r2 boolean := false;
  v_is_client boolean := (auth.role() IN ('anon', 'authenticated'));
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.media_url IS NOT NULL AND btrim(NEW.media_url) <> '' THEN
      v_clean := btrim(NEW.media_url);
      NEW.media_url := v_clean;

      IF v_clean LIKE 'storage://hub-attachments/%' THEN
        v_key := substr(v_clean, char_length('storage://hub-attachments/') + 1);
      ELSIF v_clean LIKE 'r2://hub-attachments/%' THEN
        v_is_r2 := true;
        v_key := substr(v_clean, char_length('r2://hub-attachments/') + 1);
      ELSE
        RAISE EXCEPTION 'Hub attachment media_url must use storage://hub-attachments/{hub_id}/{sender_id}/{file}'
          USING ERRCODE = '42501';
      END IF;

      v_expected_prefix := NEW.hub_id::text || '/' || NEW.sender_id::text || '/';

      IF NOT public.validate_storage_object_scope('hub-attachments', v_key)
         OR left(v_key, char_length(v_expected_prefix)) <> v_expected_prefix
         OR char_length(v_key) <= char_length(v_expected_prefix) THEN
        RAISE EXCEPTION 'Hub attachment path must be scoped to {hub_id}/{sender_id}/{file}'
          USING ERRCODE = '42501';
      END IF;

      -- For client inserts, verify caller owns the uploaded storage object (or server-verified R2 record)
      IF v_is_client THEN
        IF v_is_r2 THEN
          IF NOT EXISTS (
            SELECT 1
            FROM public.media_assets ma
            WHERE ma.provider = 'cloudflare_r2'
              AND ma.bucket = 'hub-attachments'
              AND ma.object_key = v_key
              AND ma.owner_id = NEW.sender_id
              AND ma.size_bytes > 0
              AND ma.deleted_at IS NULL
          ) THEN
            RAISE EXCEPTION 'R2 Hub attachment must be server-verified with non-zero size before sending'
              USING ERRCODE = '42501';
          END IF;
        ELSE
          PERFORM public.assert_user_owns_storage_object('hub-attachments', v_key, NEW.sender_id);
        END IF;
      END IF;
    ELSE
      NEW.media_url := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF v_is_client THEN
      IF NEW.id <> OLD.id
         OR NEW.hub_id <> OLD.hub_id
         OR NEW.sender_id <> OLD.sender_id
         OR NEW.media_url IS DISTINCT FROM OLD.media_url
         OR NEW.is_system IS DISTINCT FROM OLD.is_system
         OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'Hub message identity, sender, and media attachment are immutable'
          USING ERRCODE = '42501';
      END IF;

      IF OLD.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Deleted Hub messages cannot be edited or restored' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_hub_message_write() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_hub_message_write ON public.hub_messages;
CREATE TRIGGER guard_hub_message_write
  BEFORE INSERT OR UPDATE ON public.hub_messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_hub_message_write();

-- Race-safe Hub media_assets transition to 'ready' on message commit
CREATE OR REPLACE FUNCTION public.mark_hub_message_media_ready()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_key text;
  v_provider text := 'supabase_storage';
  v_obj record;
BEGIN
  IF NEW.media_url IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.media_url LIKE 'storage://hub-attachments/%' THEN
    v_key := substr(NEW.media_url, char_length('storage://hub-attachments/') + 1);
  ELSIF NEW.media_url LIKE 'r2://hub-attachments/%' THEN
    v_provider := 'cloudflare_r2';
    v_key := substr(NEW.media_url, char_length('r2://hub-attachments/') + 1);
  ELSE
    RETURN NEW;
  END IF;

  UPDATE public.media_assets
  SET status = 'ready', hub_id = NEW.hub_id, updated_at = now()
  WHERE provider = v_provider
    AND bucket = 'hub-attachments'
    AND object_key = v_key
    AND owner_id = NEW.sender_id;

  IF NOT FOUND AND v_provider = 'supabase_storage' THEN
    SELECT * INTO v_obj
    FROM public.lookup_authoritative_storage_object('hub-attachments', v_key);

    IF coalesce(v_obj.object_exists, false) AND coalesce(v_obj.size_bytes, 0) > 0 THEN
      INSERT INTO public.media_assets (
        owner_id, media_kind, provider, bucket, object_key, visibility, source_url,
        mime_type, size_bytes, derivative_keys, status, hub_id
      ) VALUES (
        NEW.sender_id, 'document', 'supabase_storage', 'hub-attachments', v_key, 'private',
        NEW.media_url, coalesce(v_obj.mime_type, 'application/octet-stream'),
        v_obj.size_bytes, '{}'::text[], 'ready', NEW.hub_id
      )
      ON CONFLICT (provider, bucket, object_key) WHERE bucket IS NOT NULL AND object_key IS NOT NULL
      DO UPDATE SET status = 'ready', hub_id = NEW.hub_id, updated_at = now()
      WHERE public.media_assets.owner_id = EXCLUDED.owner_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_hub_message_media_ready() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS mark_hub_message_media_ready ON public.hub_messages;
CREATE TRIGGER mark_hub_message_media_ready
  AFTER INSERT ON public.hub_messages
  FOR EACH ROW EXECUTE FUNCTION public.mark_hub_message_media_ready();

-- Strictly scoped Hub message soft-delete cleanup (never touches other buckets/hubs/users)
CREATE OR REPLACE FUNCTION public.enqueue_deleted_hub_message_media()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_expected_prefix text;
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND NEW.media_url IS NOT NULL THEN
    v_expected_prefix := NEW.hub_id::text || '/' || NEW.sender_id::text || '/';
    IF NEW.media_url LIKE 'storage://hub-attachments/%' THEN
      v_key := substr(NEW.media_url, char_length('storage://hub-attachments/') + 1);
    ELSIF NEW.media_url LIKE 'r2://hub-attachments/%' THEN
      v_key := substr(NEW.media_url, char_length('r2://hub-attachments/') + 1);
    ELSE
      RETURN NEW;
    END IF;

    IF public.validate_storage_object_scope('hub-attachments', v_key)
       AND left(v_key, char_length(v_expected_prefix)) = v_expected_prefix
       AND NOT public.is_storage_object_actively_referenced('hub-attachments', v_key) THEN
      PERFORM public.enqueue_media_object_deletion(
        NEW.media_url,
        'hub-attachments',
        'hub_message_deleted',
        NEW.id,
        NEW.sender_id,
        0,
        '{}'::text[]
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_deleted_hub_message_media() FROM PUBLIC, anon, authenticated;

-- Race-safe Moments media_assets transition to 'ready' on Moment commit
CREATE OR REPLACE FUNCTION public.mark_moment_media_ready()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_provider text := 'supabase_storage';
BEGIN
  IF NEW.media_url IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.media_url LIKE 'storage://private-moments/%' THEN
    v_key := substr(NEW.media_url, char_length('storage://private-moments/') + 1);
  ELSIF NEW.media_url LIKE 'r2://private-moments/%' THEN
    v_provider := 'cloudflare_r2';
    v_key := substr(NEW.media_url, char_length('r2://private-moments/') + 1);
  ELSE
    RETURN NEW;
  END IF;

  UPDATE public.media_assets
  SET status = 'ready', moment_id = NEW.id, updated_at = now()
  WHERE provider = v_provider
    AND bucket = 'private-moments'
    AND object_key = v_key
    AND owner_id = NEW.author_id;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_moment_media_ready() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS mark_moment_media_ready ON public.moments;
CREATE TRIGGER mark_moment_media_ready
  AFTER INSERT ON public.moments
  FOR EACH ROW EXECUTE FUNCTION public.mark_moment_media_ready();

-- ------------------------------------------------------------------------------
-- 5. HARDEN DM SEND GUARD, AUTHORITATIVE QUOTA ACCOUNTING & SAFE DM DELETION
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_can_send_to_conversation(
  p_conversation_id uuid,
  p_sender_id uuid,
  p_media_url text DEFAULT NULL,
  p_media_type text DEFAULT NULL
)
RETURNS public.conversations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv public.conversations%ROWTYPE;
  v_member public.conversation_members%ROWTYPE;
  v_sent_count integer;
  v_clean_path text;
  v_expected_prefix text;
BEGIN
  IF p_sender_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ping_send_conv:' || p_conversation_id::text, 0));

  SELECT * INTO v_conv
  FROM public.conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  SELECT * INTO v_member
  FROM public.conversation_members
  WHERE conversation_id = p_conversation_id
    AND user_id = p_sender_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not a participant in this conversation' USING ERRCODE = '42501';
  END IF;

  IF v_conv.type = 'direct' AND EXISTS (
    SELECT 1
    FROM public.conversation_members other_cm
    JOIN public.user_blocks b ON (
      (b.blocker_id = other_cm.user_id AND b.blocked_id = p_sender_id)
      OR (b.blocker_id = p_sender_id AND b.blocked_id = other_cm.user_id)
    )
    WHERE other_cm.conversation_id = p_conversation_id
      AND other_cm.user_id <> p_sender_id
  ) THEN
    RAISE EXCEPTION 'Cannot send message: communication is blocked' USING ERRCODE = '42501';
  END IF;

  IF v_conv.type = 'group' AND coalesce(v_conv.only_admins_can_post, false) THEN
    IF v_member.role NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'Only group admins can post in this conversation' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_conv.type = 'direct' THEN
    IF v_conv.request_status = 'declined' THEN
      RAISE EXCEPTION 'This message request has been declined' USING ERRCODE = '42501';
    END IF;

    IF v_conv.request_status = 'pending' THEN
      IF v_conv.requested_by IS DISTINCT FROM p_sender_id THEN
        RAISE EXCEPTION 'Accept this message request before replying' USING ERRCODE = '42501';
      END IF;

      IF p_media_url IS NOT NULL OR p_media_type IS NOT NULL THEN
        RAISE EXCEPTION 'Pending message requests are text-only until accepted' USING ERRCODE = '42501';
      END IF;

      SELECT count(*)::integer INTO v_sent_count
      FROM public.private_messages
      WHERE conversation_id = p_conversation_id
        AND sender_id = p_sender_id;

      IF v_sent_count >= 1 THEN
        RAISE EXCEPTION 'You can only send one message request until the recipient accepts'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  -- Strictly bind ALL new DM media_url values to {conversation_id}/{sender_id}/{safe_file}
  -- inside dm-attachments (rejects ALL http/https/external/public URLs & cross-bucket refs)
  IF p_media_url IS NOT NULL AND btrim(p_media_url) <> '' THEN
    v_clean_path := btrim(p_media_url);

    IF v_clean_path ~* '^(https?|javascript|data|blob):' THEN
      RAISE EXCEPTION 'External, public, or signed HTTP URLs are forbidden in DM attachments; upload into dm-attachments'
        USING ERRCODE = '42501';
    END IF;

    IF v_clean_path LIKE 'storage://dm-attachments/%' THEN
      v_clean_path := substr(v_clean_path, char_length('storage://dm-attachments/') + 1);
    ELSIF v_clean_path LIKE 'r2://dm-attachments/%' THEN
      v_clean_path := substr(v_clean_path, char_length('r2://dm-attachments/') + 1);
    ELSIF v_clean_path LIKE 'storage://%' OR v_clean_path LIKE 'r2://%' THEN
      RAISE EXCEPTION 'Private DM attachments must target dm-attachments only'
        USING ERRCODE = '42501';
    END IF;

    v_expected_prefix := p_conversation_id::text || '/' || p_sender_id::text || '/';

    IF NOT public.validate_storage_object_scope('dm-attachments', v_clean_path)
       OR left(v_clean_path, char_length(v_expected_prefix)) <> v_expected_prefix
       OR char_length(v_clean_path) <= char_length(v_expected_prefix) THEN
      RAISE EXCEPTION 'Private attachment path must be scoped to {conversation_id}/{sender_id}/{file}'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN v_conv;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_can_send_to_conversation(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_can_send_to_conversation(uuid, uuid, text, text) TO service_role;

-- Race-safe send_private_message deriving authoritative storage size & marking media_assets ready atomically
CREATE OR REPLACE FUNCTION public.send_private_message(
  p_conversation_id uuid,
  p_content text,
  p_media_url text DEFAULT NULL,
  p_media_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_conv public.conversations%ROWTYPE;
  v_message public.private_messages;
  v_trimmed_content text := btrim(coalesce(p_content, ''));
  v_clean_media text := nullif(btrim(coalesce(p_media_url, '')), '');
  v_dm_key text := NULL;
  v_media_provider text := 'supabase_storage';
  v_obj record;
  v_media_bytes bigint := 0;
  v_media_mime text := 'application/octet-stream';
  v_media_kind text := 'document';
  v_preview text;
  v_retention_enabled boolean := false;
  v_effective_policy text := NULL;
  v_effective_max text;
  v_expires_at timestamptz := NULL;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF char_length(v_trimmed_content) = 0 AND v_clean_media IS NULL THEN
    RAISE EXCEPTION 'Message cannot be empty';
  END IF;

  IF char_length(v_trimmed_content) > 5000 THEN
    RAISE EXCEPTION 'Message cannot exceed 5000 characters';
  END IF;

  IF p_media_type IS NOT NULL AND p_media_type NOT IN ('image', 'video', 'audio', 'document', 'sticker') THEN
    RAISE EXCEPTION 'Unsupported media_type: %', p_media_type;
  END IF;

  v_conv := public.assert_can_send_to_conversation(
    p_conversation_id,
    v_caller,
    v_clean_media,
    p_media_type
  );

  -- Derive authoritative attachment size & verify object ownership (zero-byte spoofing blocked)
  IF v_clean_media IS NOT NULL THEN
    IF v_clean_media LIKE 'r2://dm-attachments/%' THEN
      v_media_provider := 'cloudflare_r2';
      v_dm_key := substr(v_clean_media, char_length('r2://dm-attachments/') + 1);

      SELECT ma.size_bytes, coalesce(ma.mime_type, 'application/octet-stream')
      INTO v_media_bytes, v_media_mime
      FROM public.media_assets ma
      WHERE ma.provider = 'cloudflare_r2'
        AND ma.bucket = 'dm-attachments'
        AND ma.object_key = v_dm_key
        AND ma.owner_id = v_caller
        AND ma.deleted_at IS NULL
      LIMIT 1;

      IF coalesce(v_media_bytes, 0) <= 0 THEN
        RAISE EXCEPTION 'R2 attachment must be server-verified with non-zero size before sending'
          USING ERRCODE = '42501';
      END IF;
    ELSE
      v_media_provider := 'supabase_storage';
      v_dm_key := CASE
        WHEN v_clean_media LIKE 'storage://dm-attachments/%'
          THEN substr(v_clean_media, char_length('storage://dm-attachments/') + 1)
        ELSE v_clean_media
      END;

      SELECT * INTO v_obj
      FROM public.lookup_authoritative_storage_object('dm-attachments', v_dm_key);

      IF NOT coalesce(v_obj.object_exists, false) THEN
        RAISE EXCEPTION 'Uploaded DM attachment not found in dm-attachments storage'
          USING ERRCODE = '42501';
      END IF;

      IF v_obj.owner_id IS NOT NULL AND v_obj.owner_id IS DISTINCT FROM v_caller THEN
        RAISE EXCEPTION 'DM attachment object is owned by another user'
          USING ERRCODE = '42501';
      END IF;

      IF coalesce(v_obj.size_bytes, 0) <= 0 THEN
        RAISE EXCEPTION 'DM attachment has missing or zero authoritative storage size'
          USING ERRCODE = '22023';
      END IF;

      v_media_bytes := v_obj.size_bytes;
      v_media_mime := coalesce(v_obj.mime_type, 'application/octet-stream');
    END IF;

    v_media_kind := CASE
      WHEN p_media_type IN ('image', 'video', 'audio', 'document') THEN p_media_type
      ELSE 'document'
    END;
  END IF;

  -- Apply authoritative retention timestamp when feature flag is enabled
  SELECT coalesce(enabled, false) INTO v_retention_enabled
  FROM public.app_feature_flags
  WHERE key = 'chat_retention';

  IF coalesce(v_retention_enabled, false) THEN
    v_effective_max := public.resolve_conversation_max_retention_policy(p_conversation_id);
    IF public.chat_retention_policy_rank(coalesce(v_conv.retention_policy, '7d'))
       > public.chat_retention_policy_rank(v_effective_max) THEN
      v_effective_policy := v_effective_max;
    ELSE
      v_effective_policy := coalesce(v_conv.retention_policy, '7d');
    END IF;
    v_expires_at := public.compute_retention_expires_at(v_effective_policy, now());
  END IF;

  INSERT INTO public.private_messages (
    conversation_id,
    sender_id,
    content,
    media_url,
    media_type,
    status,
    is_pending_request_msg,
    retention_policy,
    expires_at,
    media_size_bytes
  ) VALUES (
    p_conversation_id,
    v_caller,
    v_trimmed_content,
    v_clean_media,
    p_media_type,
    'sent',
    (v_conv.type = 'direct' AND v_conv.request_status = 'pending'),
    v_effective_policy,
    v_expires_at,
    v_media_bytes
  )
  RETURNING * INTO v_message;

  -- Race-safe atomic registration/transition of media_assets -> 'ready' inside the same transaction
  IF v_clean_media IS NOT NULL AND v_dm_key IS NOT NULL THEN
    INSERT INTO public.media_assets (
      owner_id,
      media_kind,
      provider,
      bucket,
      object_key,
      visibility,
      source_url,
      mime_type,
      size_bytes,
      derivative_keys,
      status,
      conversation_id,
      expires_at,
      created_at,
      updated_at
    ) VALUES (
      v_caller,
      v_media_kind,
      v_media_provider,
      'dm-attachments',
      v_dm_key,
      'private',
      v_clean_media,
      v_media_mime,
      v_media_bytes,
      '{}'::text[],
      'ready',
      p_conversation_id,
      v_expires_at,
      now(),
      now()
    )
    ON CONFLICT (provider, bucket, object_key) WHERE bucket IS NOT NULL AND object_key IS NOT NULL
    DO UPDATE SET
      status = 'ready',
      size_bytes = EXCLUDED.size_bytes,
      conversation_id = EXCLUDED.conversation_id,
      expires_at = EXCLUDED.expires_at,
      updated_at = now()
    WHERE public.media_assets.owner_id = EXCLUDED.owner_id;
  END IF;

  IF char_length(v_trimmed_content) > 0 THEN
    v_preview := substr(v_trimmed_content, 1, 80);
  ELSIF p_media_type = 'image' THEN
    v_preview := '📷 Photo';
  ELSIF p_media_type = 'video' THEN
    v_preview := '🎥 Video';
  ELSIF p_media_type = 'audio' THEN
    v_preview := 'Voice message';
  ELSE
    v_preview := '📎 Attachment';
  END IF;

  UPDATE public.conversations
  SET
    last_message_at = now(),
    last_message_preview = v_preview,
    updated_at = now()
  WHERE id = p_conversation_id;

  UPDATE public.conversation_members
  SET
    last_read_at = CASE WHEN user_id = v_caller THEN now() ELSE last_read_at END,
    hidden_at = NULL
  WHERE conversation_id = p_conversation_id;

  IF v_conv.type = 'direct' AND v_conv.request_status = 'pending' AND v_conv.request_recipient_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, actor_id, kind, title, body, href, group_key)
    VALUES (
      v_conv.request_recipient_id,
      v_caller,
      'message_request',
      'New message request',
      left(v_preview, 140),
      '/messages?conversationId=' || p_conversation_id::text,
      'message_request:' || p_conversation_id::text
    );
  END IF;

  RETURN to_jsonb(v_message);
END;
$$;

REVOKE ALL ON FUNCTION public.send_private_message(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_private_message(uuid, text, text, text) TO authenticated, service_role;

-- Harden toggle_save_private_message with per-user quota lock & authoritative storage size cross-check
CREATE OR REPLACE FUNCTION public.toggle_save_private_message(
  p_message_id uuid,
  p_save boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_msg public.private_messages%ROWTYPE;
  v_ent jsonb;
  v_quota bigint;
  v_used bigint;
  v_msg_bytes bigint := 0;
  v_dm_key text := NULL;
  v_obj record;
  v_still_saved boolean;
  v_restored_expires timestamptz;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- Serialize concurrent save/unsave quota checks per user
  PERFORM pg_advisory_xact_lock(hashtextextended('ping_save_quota:' || v_caller::text, 0));

  SELECT * INTO v_msg
  FROM public.private_messages
  WHERE id = p_message_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_members cm
    WHERE cm.conversation_id = v_msg.conversation_id
      AND cm.user_id = v_caller
      AND cm.hidden_at IS NULL
  ) THEN
    RAISE EXCEPTION 'You no longer have access to this conversation' USING ERRCODE = '42501';
  END IF;

  IF v_msg.deleted_at IS NOT NULL OR v_msg.expired_at IS NOT NULL THEN
    RAISE EXCEPTION 'Expired or deleted messages cannot be saved' USING ERRCODE = '42501';
  END IF;

  IF p_save THEN
    IF v_msg.expires_at IS NOT NULL AND v_msg.expires_at <= now() AND v_msg.is_saved_in_chat = false THEN
      RAISE EXCEPTION 'Message has already expired' USING ERRCODE = '42501';
    END IF;

    v_msg_bytes := greatest(0, coalesce(v_msg.media_size_bytes, 0));

    -- Cross-check authoritative storage.objects size for DM attachments to prevent 0-byte spoofing
    IF v_msg.media_url IS NOT NULL AND v_msg.media_url !~* '^https?://' THEN
      v_dm_key := CASE
        WHEN v_msg.media_url LIKE 'storage://dm-attachments/%'
          THEN substr(v_msg.media_url, char_length('storage://dm-attachments/') + 1)
        WHEN v_msg.media_url LIKE 'r2://dm-attachments/%'
          THEN substr(v_msg.media_url, char_length('r2://dm-attachments/') + 1)
        ELSE v_msg.media_url
      END;

      IF v_msg.media_url NOT LIKE 'r2://%' THEN
        SELECT * INTO v_obj
        FROM public.lookup_authoritative_storage_object('dm-attachments', v_dm_key);
        v_msg_bytes := greatest(v_msg_bytes, coalesce(v_obj.size_bytes, 0));
      END IF;

      IF v_msg_bytes <= 0 THEN
        RAISE EXCEPTION 'Cannot save attachment with unverified zero-byte storage metadata'
          USING ERRCODE = '42501';
      END IF;
    END IF;

    v_ent := public.resolve_user_chat_retention_entitlement(v_caller);
    v_quota := coalesce((v_ent->>'saved_storage_quota_bytes')::bigint, 104857600);
    v_used := coalesce((v_ent->>'saved_storage_used_bytes')::bigint, 0);

    IF NOT EXISTS (
      SELECT 1 FROM public.saved_messages WHERE user_id = v_caller AND message_id = p_message_id
    ) THEN
      IF v_used + v_msg_bytes > v_quota THEN
        RAISE EXCEPTION 'Saved chat storage quota exceeded (% / % bytes). Unsave older items or upgrade plan.',
          v_used + v_msg_bytes, v_quota
          USING ERRCODE = '54000';
      END IF;

      INSERT INTO public.saved_messages (user_id, message_id, saved_bytes)
      VALUES (v_caller, p_message_id, v_msg_bytes)
      ON CONFLICT (user_id, message_id) DO NOTHING;
    END IF;

    UPDATE public.private_messages
    SET
      is_saved_in_chat = true,
      media_size_bytes = greatest(coalesce(media_size_bytes, 0), v_msg_bytes),
      updated_at = now()
    WHERE id = p_message_id;

    RETURN jsonb_build_object(
      'message_id', p_message_id,
      'saved', true,
      'is_saved_in_chat', true,
      'saved_bytes', v_msg_bytes,
      'expires_at', v_msg.expires_at
    );
  ELSE
    DELETE FROM public.saved_messages
    WHERE user_id = v_caller AND message_id = p_message_id;

    SELECT EXISTS (
      SELECT 1 FROM public.saved_messages WHERE message_id = p_message_id
    ) INTO v_still_saved;

    IF v_still_saved THEN
      RETURN jsonb_build_object(
        'message_id', p_message_id,
        'saved', false,
        'is_saved_in_chat', true,
        'expires_at', v_msg.expires_at
      );
    END IF;

    IF v_msg.retention_policy IS NULL OR v_msg.retention_policy = 'until_deleted' THEN
      v_restored_expires := NULL;
    ELSIF v_msg.retention_policy = '24h_after_view' THEN
      IF v_msg.first_viewed_at IS NOT NULL THEN
        v_restored_expires := v_msg.first_viewed_at + interval '24 hours';
      ELSE
        v_restored_expires := v_msg.created_at + interval '7 days';
      END IF;
    ELSE
      v_restored_expires := public.compute_retention_expires_at(v_msg.retention_policy, v_msg.created_at);
    END IF;

    UPDATE public.private_messages
    SET
      is_saved_in_chat = false,
      expires_at = v_restored_expires,
      updated_at = now()
    WHERE id = p_message_id;

    RETURN jsonb_build_object(
      'message_id', p_message_id,
      'saved', false,
      'is_saved_in_chat', false,
      'expires_at', v_restored_expires
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_save_private_message(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_save_private_message(uuid, boolean) TO authenticated, service_role;

-- Strictly scoped DM soft-delete trigger (never enqueues public/external URLs or other users' keys)
CREATE OR REPLACE FUNCTION public.enqueue_deleted_private_message_media()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dm_key text;
  v_expected_prefix text;
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND OLD.expired_at IS NULL AND NEW.media_url IS NOT NULL THEN
    IF NEW.media_url ~* '^https?://' THEN
      RETURN NEW;
    END IF;

    v_dm_key := CASE
      WHEN NEW.media_url LIKE 'storage://dm-attachments/%'
        THEN substr(NEW.media_url, char_length('storage://dm-attachments/') + 1)
      WHEN NEW.media_url LIKE 'r2://dm-attachments/%'
        THEN substr(NEW.media_url, char_length('r2://dm-attachments/') + 1)
      ELSE NEW.media_url
    END;

    v_expected_prefix := NEW.conversation_id::text || '/' || NEW.sender_id::text || '/';

    IF public.validate_storage_object_scope('dm-attachments', v_dm_key)
       AND left(v_dm_key, char_length(v_expected_prefix)) = v_expected_prefix
       AND NOT public.is_storage_object_actively_referenced('dm-attachments', v_dm_key) THEN
      PERFORM public.enqueue_media_object_deletion(
        NEW.media_url,
        'dm-attachments',
        'private_message_deleted',
        NEW.id,
        NEW.sender_id,
        coalesce(NEW.media_size_bytes, 0),
        '{}'::text[]
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_deleted_private_message_media() FROM PUBLIC, anon, authenticated;

-- Strictly scoped batch expiration (never enqueues non-DM/public URLs or other owners' keys)
CREATE OR REPLACE FUNCTION public.process_expired_private_messages_batch(
  p_batch_size integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_id uuid := gen_random_uuid();
  v_limit integer := least(greatest(coalesce(p_batch_size, 500), 1), 2000);
  v_msg record;
  v_expired_count integer := 0;
  v_enqueued_media integer := 0;
  v_reclaimed_bytes bigint := 0;
  v_derivatives text[];
  v_dm_key text;
  v_expected_prefix text;
BEGIN
  FOR v_msg IN
    SELECT pm.id, pm.conversation_id, pm.sender_id, pm.media_url, pm.retention_policy,
           pm.expires_at, pm.media_size_bytes
    FROM public.private_messages pm
    WHERE pm.expires_at IS NOT NULL
      AND pm.expires_at <= now()
      AND pm.expired_at IS NULL
      AND pm.deleted_at IS NULL
      AND pm.is_saved_in_chat = false
      AND NOT EXISTS (
        SELECT 1 FROM public.saved_messages sm WHERE sm.message_id = pm.id
      )
    ORDER BY pm.expires_at ASC, pm.id ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    v_derivatives := '{}'::text[];

    -- Scrub content & media pointer first so active-reference check reflects this row's expiry
    UPDATE public.private_messages
    SET
      content = '',
      media_url = NULL,
      media_type = NULL,
      expired_at = now(),
      deleted_at = now(),
      updated_at = now()
    WHERE id = v_msg.id;

    IF v_msg.media_url IS NOT NULL AND v_msg.media_url !~* '^https?://' THEN
      v_dm_key := CASE
        WHEN v_msg.media_url LIKE 'storage://dm-attachments/%'
          THEN substr(v_msg.media_url, char_length('storage://dm-attachments/') + 1)
        WHEN v_msg.media_url LIKE 'r2://dm-attachments/%'
          THEN substr(v_msg.media_url, char_length('r2://dm-attachments/') + 1)
        ELSE v_msg.media_url
      END;
      v_expected_prefix := v_msg.conversation_id::text || '/' || v_msg.sender_id::text || '/';

      IF public.validate_storage_object_scope('dm-attachments', v_dm_key)
         AND left(v_dm_key, char_length(v_expected_prefix)) = v_expected_prefix
         AND NOT public.is_storage_object_actively_referenced('dm-attachments', v_dm_key) THEN
        SELECT coalesce(ma.derivative_keys, '{}'::text[])
        INTO v_derivatives
        FROM public.media_assets ma
        WHERE ma.bucket = 'dm-attachments'
          AND ma.object_key = v_dm_key
          AND ma.owner_id = v_msg.sender_id
        ORDER BY ma.created_at DESC
        LIMIT 1;

        IF public.enqueue_media_object_deletion(
          v_msg.media_url,
          'dm-attachments',
          'private_message_expired',
          v_msg.id,
          v_msg.sender_id,
          coalesce(v_msg.media_size_bytes, 0),
          coalesce(v_derivatives, '{}'::text[])
        ) THEN
          v_enqueued_media := v_enqueued_media + 1;
          v_reclaimed_bytes := v_reclaimed_bytes + greatest(0, coalesce(v_msg.media_size_bytes, 0));
        END IF;

        UPDATE public.media_assets
        SET status = 'deleting', updated_at = now()
        WHERE bucket = 'dm-attachments'
          AND object_key = v_dm_key
          AND owner_id = v_msg.sender_id;
      END IF;
    END IF;

    INSERT INTO public.chat_retention_deletion_audit (
      batch_id, conversation_id, message_id, retention_policy, had_media, media_bytes, expired_at
    )
    VALUES (
      v_batch_id,
      v_msg.conversation_id,
      v_msg.id,
      v_msg.retention_policy,
      v_msg.media_url IS NOT NULL,
      greatest(0, coalesce(v_msg.media_size_bytes, 0)),
      v_msg.expires_at
    );

    v_expired_count := v_expired_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'expired_messages', v_expired_count,
    'enqueued_media_deletions', v_enqueued_media,
    'queued_media_bytes', v_reclaimed_bytes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_expired_private_messages_batch(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_expired_private_messages_batch(integer) TO service_role;

-- ------------------------------------------------------------------------------
-- 6. RACE-SAFE ORPHAN CLEANUP & WORKER ACTIVE-REFERENCE GUARD
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enqueue_orphaned_staging_media(
  p_older_than_hours integer DEFAULT 24,
  p_batch_size integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_row record;
  v_obj record;
  v_count integer := 0;
  v_limit integer := least(greatest(coalesce(p_batch_size, 500), 1), 2000);
  v_hours integer := greatest(coalesce(p_older_than_hours, 24), 1);
  v_ref text;
BEGIN
  FOR v_row IN
    SELECT id, provider, bucket, object_key, source_url, owner_id, size_bytes, derivative_keys
    FROM public.media_assets
    WHERE status = 'staging'
      AND deleted_at IS NULL
      AND created_at < now() - make_interval(hours => v_hours)
    ORDER BY created_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Validate bucket allowlist & object key scope
    IF NOT public.validate_storage_object_scope(v_row.bucket, v_row.object_key) THEN
      UPDATE public.media_assets
      SET status = 'failed', error_message = 'Rejected invalid bucket/object_key during orphan sweep', updated_at = now()
      WHERE id = v_row.id;
      CONTINUE;
    END IF;

    -- CRITICAL SAFETY GUARD: Never delete any object actively referenced by live content — heal to 'ready'
    IF public.is_storage_object_actively_referenced(v_row.bucket, v_row.object_key) THEN
      UPDATE public.media_assets
      SET status = 'ready', updated_at = now()
      WHERE id = v_row.id;
      CONTINUE;
    END IF;

    -- Verify storage.objects ownership matches media_assets.owner_id before enqueuing
    IF v_row.provider = 'supabase_storage' THEN
      SELECT * INTO v_obj
      FROM public.lookup_authoritative_storage_object(v_row.bucket, v_row.object_key);

      IF coalesce(v_obj.object_exists, false)
         AND v_obj.owner_id IS NOT NULL
         AND v_obj.owner_id IS DISTINCT FROM v_row.owner_id THEN
        UPDATE public.media_assets
        SET status = 'failed', error_message = 'Ownership mismatch aborted orphan deletion', updated_at = now()
        WHERE id = v_row.id;
        CONTINUE;
      END IF;
    END IF;

    v_ref := CASE
      WHEN v_row.provider = 'cloudflare_r2'
        THEN 'r2://' || v_row.bucket || '/' || v_row.object_key
      ELSE 'storage://' || v_row.bucket || '/' || v_row.object_key
    END;

    IF public.enqueue_media_object_deletion(
      v_ref,
      v_row.bucket,
      'staging_orphan',
      v_row.id,
      v_row.owner_id,
      coalesce(v_row.size_bytes, 0),
      coalesce(v_row.derivative_keys, '{}'::text[])
    ) THEN
      UPDATE public.media_assets
      SET status = 'deleting', updated_at = now()
      WHERE id = v_row.id;

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_orphaned_staging_media(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_orphaned_staging_media(integer, integer) TO service_role;

-- Claim pending/retryable deletion jobs ONLY after verifying scope & zero live references
CREATE OR REPLACE FUNCTION public.claim_media_deletion_jobs(
  p_batch_size integer DEFAULT 100
)
RETURNS SETOF public.media_deletion_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := least(greatest(coalesce(p_batch_size, 100), 1), 500);
  v_job public.media_deletion_queue%ROWTYPE;
BEGIN
  FOR v_job IN
    SELECT *
    FROM public.media_deletion_queue q
    WHERE q.status IN ('pending', 'failed')
      AND q.attempt_count < q.max_attempts
      AND q.next_retry_at <= now()
    ORDER BY q.next_retry_at ASC, q.created_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Defense-in-depth: abort jobs with invalid bucket/path OR active live references
    IF NOT public.validate_storage_object_scope(v_job.bucket, v_job.object_key) THEN
      UPDATE public.media_deletion_queue
      SET
        status = 'failed',
        attempt_count = max_attempts,
        last_error = 'Aborted: invalid storage bucket or path traversal detected'
      WHERE id = v_job.id;
      CONTINUE;
    END IF;

    IF public.is_storage_object_actively_referenced(v_job.bucket, v_job.object_key) THEN
      UPDATE public.media_deletion_queue
      SET
        status = 'failed',
        attempt_count = max_attempts,
        last_error = 'Aborted: storage object is actively referenced by live content'
      WHERE id = v_job.id;
      CONTINUE;
    END IF;

    UPDATE public.media_deletion_queue
    SET
      status = 'processing',
      attempt_count = attempt_count + 1
    WHERE id = v_job.id
    RETURNING * INTO v_job;

    RETURN NEXT v_job;
  END LOOP;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_media_deletion_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_media_deletion_jobs(integer) TO service_role;

-- Mark media_assets.deleted_at ONLY after storage deletion is actually confirmed
CREATE OR REPLACE FUNCTION public.complete_media_deletion_job(
  p_job_id uuid,
  p_success boolean,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.media_deletion_queue%ROWTYPE;
  v_backoff_minutes integer;
BEGIN
  SELECT * INTO v_job FROM public.media_deletion_queue WHERE id = p_job_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF p_success THEN
    UPDATE public.media_deletion_queue
    SET
      status = 'deleted',
      last_error = NULL,
      processed_at = now()
    WHERE id = p_job_id;

    UPDATE public.media_assets
    SET deleted_at = now(), updated_at = now()
    WHERE provider = v_job.provider
      AND bucket = v_job.bucket
      AND object_key = v_job.object_key
      AND deleted_at IS NULL;
  ELSE
    v_backoff_minutes := least(720, (power(2, least(coalesce(v_job.attempt_count, 1), 8))::integer) * 5);
    UPDATE public.media_deletion_queue
    SET
      status = 'failed',
      last_error = left(coalesce(p_error, 'Storage deletion error'), 500),
      next_retry_at = now() + make_interval(mins => v_backoff_minutes)
    WHERE id = p_job_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_media_deletion_job(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_media_deletion_job(uuid, boolean, text) TO service_role;

-- ------------------------------------------------------------------------------
-- 7. FIX STORAGE.OBJECTS RLS BUGS IN 0038 & 0039
--    (a) In migration 0038, subqueries joining `public.hubs h` used unqualified
--        `storage.foldername(name)`, which PostgreSQL bound to `h.name` (the Hub
--        display name) instead of `storage.objects.name`. Qualify `storage.objects.name`
--        explicitly across all four affected Hub & restricted-Moment policies.
--    (b) In migration 0039, the `dm-attachments` SELECT policy queried
--        `public.media_deletion_queue` directly, which failed with
--        `permission denied for table media_deletion_queue` because `authenticated`
--        has no direct SELECT grant on `media_deletion_queue`. Replace direct
--        table reads with a narrow SECURITY DEFINER boolean helper.
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_storage_object_pending_deletion(
  p_bucket text,
  p_object_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.media_deletion_queue mdq
    WHERE mdq.bucket = p_bucket
      AND mdq.object_key = p_object_key
  );
$$;

REVOKE ALL ON FUNCTION public.is_storage_object_pending_deletion(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_storage_object_pending_deletion(text, text) TO authenticated, service_role;

DROP POLICY IF EXISTS "DM conversation participants read signed files" ON storage.objects;
CREATE POLICY "DM conversation participants read signed files" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'dm-attachments'
    AND (
      EXISTS (
        SELECT 1
        FROM public.conversation_members cm
        WHERE cm.conversation_id::text = (storage.foldername(storage.objects.name))[1]
          AND cm.user_id = (select auth.uid())
          AND cm.hidden_at IS NULL
      )
      OR (
        (storage.foldername(storage.objects.name))[2] = 'dm'
        AND EXISTS (
          SELECT 1
          FROM public.conversation_members cm
          WHERE cm.conversation_id::text = (storage.foldername(storage.objects.name))[3]
            AND cm.user_id = (select auth.uid())
            AND cm.hidden_at IS NULL
        )
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.private_messages pm
      WHERE (
        pm.media_url = storage.objects.name
        OR pm.media_url = 'storage://dm-attachments/' || storage.objects.name
      )
        AND (
          pm.deleted_at IS NOT NULL
          OR pm.expired_at IS NOT NULL
          OR (pm.expires_at IS NOT NULL AND pm.expires_at <= now() AND pm.is_saved_in_chat = false)
        )
    )
    AND NOT public.is_storage_object_pending_deletion('dm-attachments', storage.objects.name)
  );

DROP POLICY IF EXISTS "Hub attachments readable by authorized viewers" ON storage.objects;
CREATE POLICY "Hub attachments readable by authorized viewers" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'hub-attachments'
    AND EXISTS (
      SELECT 1
      FROM public.hubs h
      WHERE h.id::text = (storage.foldername(storage.objects.name))[1]
        AND h.hidden_at IS NULL
        AND (
          h.access = 'public'
          OR EXISTS (
            SELECT 1
            FROM public.hub_members hm
            WHERE hm.hub_id = h.id
              AND hm.user_id = (select auth.uid())
              AND hm.status = 'active'
          )
        )
    )
    AND NOT public.is_storage_object_pending_deletion('hub-attachments', storage.objects.name)
  );

DROP POLICY IF EXISTS "Active hub members upload own hub attachments" ON storage.objects;
CREATE POLICY "Active hub members upload own hub attachments" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'hub-attachments'
    AND (storage.foldername(storage.objects.name))[2] = (select auth.uid())::text
    AND EXISTS (
      SELECT 1
      FROM public.hub_members hm
      JOIN public.hubs h ON h.id = hm.hub_id
      WHERE hm.hub_id::text = (storage.foldername(storage.objects.name))[1]
        AND hm.user_id = (select auth.uid())
        AND hm.status = 'active'
        AND h.hidden_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Active hub members update own hub attachments" ON storage.objects;
CREATE POLICY "Active hub members update own hub attachments" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'hub-attachments'
    AND (storage.foldername(storage.objects.name))[2] = (select auth.uid())::text
    AND EXISTS (
      SELECT 1
      FROM public.hub_members hm
      JOIN public.hubs h ON h.id = hm.hub_id
      WHERE hm.hub_id::text = (storage.foldername(storage.objects.name))[1]
        AND hm.user_id = (select auth.uid())
        AND hm.status = 'active'
        AND h.hidden_at IS NULL
    )
  )
  WITH CHECK (
    bucket_id = 'hub-attachments'
    AND (storage.foldername(storage.objects.name))[2] = (select auth.uid())::text
    AND EXISTS (
      SELECT 1
      FROM public.hub_members hm
      JOIN public.hubs h ON h.id = hm.hub_id
      WHERE hm.hub_id::text = (storage.foldername(storage.objects.name))[1]
        AND hm.user_id = (select auth.uid())
        AND hm.status = 'active'
        AND h.hidden_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Authors upload own restricted moments" ON storage.objects;
CREATE POLICY "Authors upload own restricted moments" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'private-moments'
    AND (storage.foldername(storage.objects.name))[1] = (select auth.uid())::text
    AND (
      (storage.foldername(storage.objects.name))[2] IN ('followers', 'close_circle')
      OR (
        (storage.foldername(storage.objects.name))[2] = 'hub'
        AND EXISTS (
          SELECT 1
          FROM public.hub_members hm
          JOIN public.hubs h ON h.id = hm.hub_id
          WHERE hm.hub_id::text = (storage.foldername(storage.objects.name))[3]
            AND hm.user_id = (select auth.uid())
            AND hm.status = 'active'
            AND h.hidden_at IS NULL
        )
      )
    )
  );
