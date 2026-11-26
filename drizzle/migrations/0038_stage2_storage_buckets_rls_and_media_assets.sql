-- ==============================================================================
-- Migration 0038: Stage 2 Storage Hardening — Public 'media', Private
-- 'dm-attachments', Private 'hub-attachments', Private 'private-moments',
-- Provider-Agnostic 'media_assets' Extensions & 'media_deletion_queue'
--
-- Forward-only, idempotent SQL migration. Not executed against production
-- without explicit operator approval.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. PROVISION / REPAIR STORAGE BUCKETS WITH EXPLICIT VISIBILITY, SIZE & MIME CAPS
-- ------------------------------------------------------------------------------

-- 1a. Public 'media' bucket (public profiles, Pings, Clips, Signals, public Moments)
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'media',
  'media',
  true,
  52428800,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'audio/webm',
    'audio/mp4',
    'audio/x-m4a',
    'audio/m4a',
    'audio/mpeg',
    'audio/ogg',
    'audio/wav',
    'audio/aac',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 1b. Private 'dm-attachments' bucket (Direct & Group chat media + voice notes)
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'dm-attachments',
  'dm-attachments',
  false,
  52428800,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'audio/webm',
    'audio/mp4',
    'audio/x-m4a',
    'audio/m4a',
    'audio/mpeg',
    'audio/ogg',
    'audio/wav',
    'audio/aac',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 1c. Private 'hub-attachments' bucket (Hub chat & forum attachments)
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'hub-attachments',
  'hub-attachments',
  false,
  52428800,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'audio/webm',
    'audio/mp4',
    'audio/x-m4a',
    'audio/m4a',
    'audio/mpeg',
    'audio/ogg',
    'audio/wav',
    'audio/aac',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 1d. Private 'private-moments' bucket (followers, close_circle, and hub Moments)
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'private-moments',
  'private-moments',
  false,
  52428800,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ------------------------------------------------------------------------------
-- 2. REMOVE LEGACY UNRESTRICTED 'Media is public' OBJECT POLICY (KEEP CDN PUBLIC)
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS "Media is public" ON storage.objects;
DROP POLICY IF EXISTS "Users read own media" ON storage.objects;
CREATE POLICY "Users read own media" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

DROP POLICY IF EXISTS "Users upload own media" ON storage.objects;
CREATE POLICY "Users upload own media" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

DROP POLICY IF EXISTS "Users update own media" ON storage.objects;
CREATE POLICY "Users update own media" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

DROP POLICY IF EXISTS "Users delete own media" ON storage.objects;
CREATE POLICY "Users delete own media" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ------------------------------------------------------------------------------
-- 3. STRICT HUB MEMBERSHIP & ROLE RLS ON 'hub-attachments'
--    Canonical key: {hub_id}/{sender_user_id}/{unique_filename}
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS "Hub attachments readable by authorized viewers" ON storage.objects;
CREATE POLICY "Hub attachments readable by authorized viewers" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'hub-attachments'
    AND EXISTS (
      SELECT 1
      FROM public.hubs h
      WHERE h.id::text = (storage.foldername(name))[1]
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
  );

DROP POLICY IF EXISTS "Active hub members upload own hub attachments" ON storage.objects;
CREATE POLICY "Active hub members upload own hub attachments" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'hub-attachments'
    AND (storage.foldername(name))[2] = (select auth.uid())::text
    AND EXISTS (
      SELECT 1
      FROM public.hub_members hm
      JOIN public.hubs h ON h.id = hm.hub_id
      WHERE hm.hub_id::text = (storage.foldername(name))[1]
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
    AND (storage.foldername(name))[2] = (select auth.uid())::text
    AND EXISTS (
      SELECT 1
      FROM public.hub_members hm
      JOIN public.hubs h ON h.id = hm.hub_id
      WHERE hm.hub_id::text = (storage.foldername(name))[1]
        AND hm.user_id = (select auth.uid())
        AND hm.status = 'active'
        AND h.hidden_at IS NULL
    )
  )
  WITH CHECK (
    bucket_id = 'hub-attachments'
    AND (storage.foldername(name))[2] = (select auth.uid())::text
    AND EXISTS (
      SELECT 1
      FROM public.hub_members hm
      JOIN public.hubs h ON h.id = hm.hub_id
      WHERE hm.hub_id::text = (storage.foldername(name))[1]
        AND hm.user_id = (select auth.uid())
        AND hm.status = 'active'
        AND h.hidden_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Hub uploaders or staff delete hub attachments" ON storage.objects;
CREATE POLICY "Hub uploaders or staff delete hub attachments" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'hub-attachments'
    AND EXISTS (
      SELECT 1
      FROM public.hub_members hm
      WHERE hm.hub_id::text = (storage.foldername(name))[1]
        AND hm.user_id = (select auth.uid())
        AND hm.status = 'active'
        AND (
          (storage.foldername(name))[2] = (select auth.uid())::text
          OR hm.role IN ('owner', 'admin', 'moderator')
        )
    )
  );

-- ------------------------------------------------------------------------------
-- 4. AUDIENCE-AWARE RLS ON 'private-moments'
--    Canonical key: {author_id}/{audience}/{scope_id}/{unique_filename}
--    where audience IN ('followers', 'close_circle', 'hub')
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_access_private_moment_object(
  p_object_name text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_parts text[];
  v_author_text text;
  v_full_ref text;
  v_moment record;
BEGIN
  IF v_caller IS NULL OR p_object_name IS NULL OR btrim(p_object_name) = '' THEN
    RETURN false;
  END IF;

  v_parts := storage.foldername(p_object_name);
  v_author_text := v_parts[1];

  -- Author can always sign/read their own uploaded restricted Moment objects
  IF v_author_text = v_caller::text THEN
    RETURN true;
  END IF;

  v_full_ref := 'storage://private-moments/' || p_object_name;

  SELECT m.id, m.author_id, m.audience, m.hub_id, m.expires_at, m.deleted_at
  INTO v_moment
  FROM public.moments m
  WHERE m.media_url = v_full_ref
    AND m.deleted_at IS NULL
    AND (
      m.expires_at > now()
      OR EXISTS (
        SELECT 1 FROM public.highlight_items hi
        WHERE hi.moment_id = m.id
      )
    )
  ORDER BY m.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Deny access if either user has blocked the other
  IF EXISTS (
    SELECT 1 FROM public.user_blocks ub
    WHERE (ub.blocker_id = v_moment.author_id AND ub.blocked_id = v_caller)
       OR (ub.blocker_id = v_caller AND ub.blocked_id = v_moment.author_id)
  ) THEN
    RETURN false;
  END IF;

  IF v_moment.audience = 'followers' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.follows f
      WHERE f.follower_id = v_caller
        AND f.following_id = v_moment.author_id
    );
  END IF;

  IF v_moment.audience = 'close_circle' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.user_close_circle cc
      WHERE cc.user_id = v_moment.author_id
        AND cc.member_id = v_caller
    );
  END IF;

  IF v_moment.audience = 'hub' AND v_moment.hub_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM public.hub_members hm
      WHERE hm.hub_id = v_moment.hub_id
        AND hm.user_id = v_caller
        AND hm.status = 'active'
    );
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_private_moment_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_private_moment_object(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Authorized audience reads private moments" ON storage.objects;
CREATE POLICY "Authorized audience reads private moments" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'private-moments'
    AND public.can_access_private_moment_object(name)
  );

DROP POLICY IF EXISTS "Authors upload own restricted moments" ON storage.objects;
CREATE POLICY "Authors upload own restricted moments" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'private-moments'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
    AND (
      (storage.foldername(name))[2] IN ('followers', 'close_circle')
      OR (
        (storage.foldername(name))[2] = 'hub'
        AND EXISTS (
          SELECT 1
          FROM public.hub_members hm
          JOIN public.hubs h ON h.id = hm.hub_id
          WHERE hm.hub_id::text = (storage.foldername(name))[3]
            AND hm.user_id = (select auth.uid())
            AND hm.status = 'active'
            AND h.hidden_at IS NULL
        )
      )
    )
  );

DROP POLICY IF EXISTS "Authors update own restricted moments" ON storage.objects;
CREATE POLICY "Authors update own restricted moments" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'private-moments'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'private-moments'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

DROP POLICY IF EXISTS "Authors delete own restricted moments" ON storage.objects;
CREATE POLICY "Authors delete own restricted moments" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'private-moments'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ------------------------------------------------------------------------------
-- 5. PROVIDER-AGNOSTIC MEDIA ASSETS EXTENSIONS & DELETION / ORPHAN QUEUE
-- ------------------------------------------------------------------------------

DO $$
DECLARE
  v_conname text;
BEGIN
  FOR v_conname IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.media_assets'::regclass
      AND contype = 'c'
      AND (
        pg_get_constraintdef(oid) ILIKE '%provider%'
        OR pg_get_constraintdef(oid) ILIKE '%media_kind%'
        OR pg_get_constraintdef(oid) ILIKE '%status%'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.media_assets DROP CONSTRAINT IF EXISTS %I', v_conname);
  END LOOP;
END $$;

ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS bucket text,
  ADD COLUMN IF NOT EXISTS object_key text,
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS content_sha256 text,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS derivative_keys text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hub_id uuid REFERENCES public.hubs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS moment_id uuid REFERENCES public.moments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.media_assets
  ADD CONSTRAINT media_assets_provider_check
    CHECK (provider IN ('supabase_storage', 'cloudflare_r2', 's3', 'mux', 'cloudflare_stream', 'external_pending')),
  ADD CONSTRAINT media_assets_kind_check
    CHECK (media_kind IN ('image', 'video', 'audio', 'document')),
  ADD CONSTRAINT media_assets_status_check
    CHECK (status IN ('staging', 'pending', 'processing', 'ready', 'deleting', 'failed')),
  ADD CONSTRAINT media_assets_visibility_check
    CHECK (visibility IN ('public', 'private'));

CREATE INDEX IF NOT EXISTS media_assets_bucket_key_idx
  ON public.media_assets (bucket, object_key)
  WHERE object_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS media_assets_staging_cleanup_idx
  ON public.media_assets (created_at ASC)
  WHERE status = 'staging' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS media_assets_conversation_idx
  ON public.media_assets (conversation_id, created_at DESC)
  WHERE conversation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.media_deletion_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'supabase_storage'
    CHECK (provider IN ('supabase_storage', 'cloudflare_r2', 's3', 'mux', 'cloudflare_stream')),
  bucket text NOT NULL,
  object_key text NOT NULL,
  derivative_keys text[] NOT NULL DEFAULT '{}'::text[],
  source_type text NOT NULL
    CHECK (source_type IN ('private_message_expired', 'private_message_deleted', 'hub_message_deleted', 'moment_deleted', 'moment_expired', 'staging_orphan', 'profile_avatar_replaced', 'account_deleted')),
  source_id uuid,
  owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'deleted', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT media_deletion_queue_unique_object UNIQUE (provider, bucket, object_key)
);

CREATE INDEX IF NOT EXISTS media_deletion_queue_due_idx
  ON public.media_deletion_queue (next_retry_at ASC, created_at ASC)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS media_deletion_queue_status_idx
  ON public.media_deletion_queue (status, created_at DESC);

ALTER TABLE public.media_deletion_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.media_deletion_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.media_deletion_queue TO service_role;

DROP POLICY IF EXISTS "Admins inspect media deletion queue" ON public.media_deletion_queue;
CREATE POLICY "Admins inspect media deletion queue" ON public.media_deletion_queue
  FOR SELECT TO authenticated
  USING (public.is_ping_admin());

-- Helper to parse a storage reference into (provider, bucket, object_key) and enqueue idempotently
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
BEGIN
  IF v_clean IS NULL THEN
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
  ELSIF v_clean ~* '^https?://[^/]+/storage/v1/object/public/([^/]+)/(.+)$' THEN
    v_bucket := substring(v_clean FROM '^https?://[^/]+/storage/v1/object/public/([^/]+)/');
    v_key := split_part(substring(v_clean FROM '^https?://[^/]+/storage/v1/object/public/[^/]+/(.+)$'), '?', 1);
  ELSIF v_clean ~* '^https?://' THEN
    -- External third-party URL (not owned by Ping storage)
    RETURN false;
  ELSE
    v_key := v_clean;
  END IF;

  IF v_bucket IS NULL OR v_key IS NULL OR v_key = '' OR position('..' in v_key) > 0 THEN
    RETURN false;
  END IF;

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
    coalesce(p_derivative_keys, '{}'::text[]),
    p_source_type,
    p_source_id,
    p_owner_id,
    greatest(0, coalesce(p_size_bytes, 0)),
    'pending',
    now()
  )
  ON CONFLICT (provider, bucket, object_key) DO NOTHING;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_media_object_deletion(text, text, text, uuid, uuid, bigint, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_media_object_deletion(text, text, text, uuid, uuid, bigint, text[]) TO service_role;

-- Enqueue orphaned staging uploads older than N hours (service_role batch worker)
CREATE OR REPLACE FUNCTION public.enqueue_orphaned_staging_media(
  p_older_than_hours integer DEFAULT 24,
  p_batch_size integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_count integer := 0;
  v_limit integer := least(greatest(coalesce(p_batch_size, 500), 1), 2000);
  v_hours integer := greatest(coalesce(p_older_than_hours, 24), 1);
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
    PERFORM public.enqueue_media_object_deletion(
      coalesce(
        CASE
          WHEN v_row.provider = 'cloudflare_r2' AND v_row.bucket IS NOT NULL AND v_row.object_key IS NOT NULL
            THEN 'r2://' || v_row.bucket || '/' || v_row.object_key
          WHEN v_row.bucket IS NOT NULL AND v_row.object_key IS NOT NULL
            THEN 'storage://' || v_row.bucket || '/' || v_row.object_key
          ELSE v_row.source_url
        END,
        v_row.source_url
      ),
      coalesce(v_row.bucket, 'media'),
      'staging_orphan',
      v_row.id,
      v_row.owner_id,
      coalesce(v_row.size_bytes, 0),
      coalesce(v_row.derivative_keys, '{}'::text[])
    );

    UPDATE public.media_assets
    SET status = 'deleting', deleted_at = now(), updated_at = now()
    WHERE id = v_row.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_orphaned_staging_media(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_orphaned_staging_media(integer, integer) TO service_role;

-- Enqueue deleted Hub message attachment for cleanup (soft delete)
CREATE OR REPLACE FUNCTION public.enqueue_deleted_hub_message_media()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND NEW.media_url IS NOT NULL THEN
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
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_deleted_hub_message_media() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enqueue_deleted_hub_message_media ON public.hub_messages;
CREATE TRIGGER enqueue_deleted_hub_message_media
  AFTER UPDATE OF deleted_at ON public.hub_messages
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_deleted_hub_message_media();
