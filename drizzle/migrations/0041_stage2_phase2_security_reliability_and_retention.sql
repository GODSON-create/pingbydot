-- ==============================================================================
-- Migration 0041: Stage 2 Objective A — Phase 2 Security, Reliability, R2,
-- Retention Correctness & Public-Hub Access Remediation
--
-- Forward-only, fully idempotent SQL migration. Does NOT rewrite 0000..0040.
--
-- Remediates all remaining database-side audit findings:
--   - C4:  `can_read_dm_media_object()` SECURITY DEFINER RPC for fail-closed
--          `/api/media/sign-read` authorization (eliminates RLS empty-row bypass).
--   - H2:  `can_access_private_moment_object()` supports both `storage://` and
--          `r2://private-moments/` refs and blocks queued-for-deletion objects.
--   - H3:  Adds `claimed_at` lease tracking + 10-minute stale `processing` job
--          reclamation in `claim_media_deletion_jobs()`.
--   - M3:  Separates `retryable_failed_jobs`, `permanently_failed_jobs`, and
--          `stale_processing_jobs` in `get_chat_retention_metrics()`.
--   - H4:  `AFTER DELETE` trigger on `saved_messages` + `remove_group_member`
--          cleanup + `private_messages` soft-delete purge + always-allowed
--          unsaving so quota never leaks and messages never pin forever.
--   - H5:  Applies `default_chat_retention_policy` (clamped to effective
--          participant ceiling) in `get_or_create_direct_conversation()` and
--          `create_group_conversation()`.
--   - H6:  Allows `anon` SELECT on `hub-attachments` strictly for unhidden
--          `access = 'public'` Hubs (private Hubs remain strictly denied).
--   - H8:  Fixes `mark_conversation_read()` `24h_after_view` behavior: gates on
--          `request_status = 'accepted'`, requires all active group recipients
--          to have viewed before starting countdown, records `first_viewed_at`
--          even on saved messages, and adds supporting partial indexes.
--   - H9:  Maps legacy `account_subscriptions.tier = 'institution'` cleanly to
--          `business` / `premium_eligible`.
--   - M7:  Returns `effective_max_retention_policy` from
--          `get_my_conversations_summary()` and adds `get_conversation_retention_info()`.
--   - M8:  Hardens `publish_moment_as_clip()` against private-bucket refs and
--          guards `moments` against cross-bucket `audience` flipping.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 0. SUPPORTING INDEXES FOR SIGNED-URL LOOKUPS, 24H_AFTER_VIEW & WORKER LEASES
-- ------------------------------------------------------------------------------

ALTER TABLE public.media_deletion_queue
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS media_deletion_queue_processing_lease_idx
  ON public.media_deletion_queue (claimed_at ASC)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS private_messages_conv_media_url_idx
  ON public.private_messages (conversation_id, media_url)
  WHERE media_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS private_messages_24h_unviewed_idx
  ON public.private_messages (conversation_id, created_at ASC)
  WHERE retention_policy = '24h_after_view'
    AND first_viewed_at IS NULL
    AND deleted_at IS NULL
    AND expired_at IS NULL;

-- Ensure `is_storage_object_pending_deletion` is executable by anon for public Hub RLS
GRANT EXECUTE ON FUNCTION public.is_storage_object_pending_deletion(text, text)
  TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 1. C4 — FAIL-CLOSED SERVER-SIDE DM MEDIA READ AUTHORIZATION RPC
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_read_dm_media_object(
  p_conversation_id uuid,
  p_object_key text
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
  v_storage_ref text;
  v_r2_ref text;
  v_is_scoped boolean := false;
BEGIN
  IF v_caller IS NULL OR p_conversation_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT public.validate_storage_object_scope('dm-attachments', p_object_key) THEN
    RETURN false;
  END IF;

  -- Verify path belongs strictly to p_conversation_id (canonical or legacy uid/dm/convId/file)
  v_parts := string_to_array(p_object_key, '/');
  IF v_parts[1] = p_conversation_id::text THEN
    v_is_scoped := true;
  ELSIF coalesce(array_length(v_parts, 1), 0) >= 4
        AND v_parts[2] = 'dm'
        AND v_parts[3] = p_conversation_id::text THEN
    v_is_scoped := true;
  END IF;

  IF NOT v_is_scoped THEN
    RETURN false;
  END IF;

  -- Caller must be an active (unhidden) participant of the conversation
  IF NOT EXISTS (
    SELECT 1
    FROM public.conversation_members cm
    WHERE cm.conversation_id = p_conversation_id
      AND cm.user_id = v_caller
      AND cm.hidden_at IS NULL
  ) THEN
    RETURN false;
  END IF;

  -- Never sign any object already queued for deletion
  IF public.is_storage_object_pending_deletion('dm-attachments', p_object_key) THEN
    RETURN false;
  END IF;

  v_storage_ref := 'storage://dm-attachments/' || p_object_key;
  v_r2_ref := 'r2://dm-attachments/' || p_object_key;

  -- Explicitly deny if any matching DM row has been deleted, expired, or passed its expiry without being saved
  IF EXISTS (
    SELECT 1
    FROM public.private_messages pm
    WHERE pm.conversation_id = p_conversation_id
      AND pm.media_url IN (p_object_key, v_storage_ref, v_r2_ref)
      AND (
        pm.deleted_at IS NOT NULL
        OR pm.expired_at IS NOT NULL
        OR (pm.expires_at IS NOT NULL AND pm.expires_at <= now() AND pm.is_saved_in_chat = false)
      )
  ) THEN
    RETURN false;
  END IF;

  -- Require an explicit ACTIVE live message referencing this exact object (fail-closed if scrubbed or missing)
  IF EXISTS (
    SELECT 1
    FROM public.private_messages pm
    WHERE pm.conversation_id = p_conversation_id
      AND pm.media_url IN (p_object_key, v_storage_ref, v_r2_ref)
      AND pm.deleted_at IS NULL
      AND pm.expired_at IS NULL
      AND (
        pm.expires_at IS NULL
        OR pm.expires_at > now()
        OR pm.is_saved_in_chat = true
      )
  ) THEN
    RETURN true;
  END IF;

  -- Allow the original uploader to preview their own fresh staging upload (<= 1 hour) before pressing Send
  IF EXISTS (
    SELECT 1
    FROM public.media_assets ma
    WHERE ma.bucket = 'dm-attachments'
      AND ma.object_key = p_object_key
      AND ma.owner_id = v_caller
      AND ma.conversation_id = p_conversation_id
      AND ma.status = 'staging'
      AND ma.deleted_at IS NULL
      AND ma.created_at > now() - interval '1 hour'
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_read_dm_media_object(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_dm_media_object(uuid, text) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 2. H2 — R2 DUAL-PROTOCOL SUPPORT FOR RESTRICTED MOMENTS
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
  v_storage_ref text;
  v_r2_ref text;
  v_moment record;
BEGIN
  IF v_caller IS NULL OR p_object_name IS NULL OR btrim(p_object_name) = '' THEN
    RETURN false;
  END IF;

  IF NOT public.validate_storage_object_scope('private-moments', p_object_name) THEN
    RETURN false;
  END IF;

  IF public.is_storage_object_pending_deletion('private-moments', p_object_name) THEN
    RETURN false;
  END IF;

  v_parts := storage.foldername(p_object_name);
  v_author_text := v_parts[1];

  -- Author can always sign/read their own non-queued restricted Moment objects
  IF v_author_text = v_caller::text THEN
    RETURN true;
  END IF;

  v_storage_ref := 'storage://private-moments/' || p_object_name;
  v_r2_ref := 'r2://private-moments/' || p_object_name;

  SELECT m.id, m.author_id, m.audience, m.hub_id, m.expires_at, m.deleted_at
  INTO v_moment
  FROM public.moments m
  WHERE m.media_url IN (v_storage_ref, v_r2_ref)
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

-- ------------------------------------------------------------------------------
-- 3. H6 — PUBLIC HUB ATTACHMENTS READABLE BY SIGNED-OUT (ANON) VISITORS
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS "Public hub attachments readable by anon" ON storage.objects;
CREATE POLICY "Public hub attachments readable by anon" ON storage.objects
  FOR SELECT TO anon
  USING (
    bucket_id = 'hub-attachments'
    AND EXISTS (
      SELECT 1
      FROM public.hubs h
      WHERE h.id::text = (storage.foldername(storage.objects.name))[1]
        AND h.hidden_at IS NULL
        AND h.access = 'public'
    )
    AND NOT public.is_storage_object_pending_deletion('hub-attachments', storage.objects.name)
  );

-- ------------------------------------------------------------------------------
-- 4. H3 & M3 — DELETION WORKER LEASE RECOVERY & GRANULAR FAILURE METRICS
-- ------------------------------------------------------------------------------

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
    WHERE (
        (
          q.status IN ('pending', 'failed')
          AND q.attempt_count < q.max_attempts
          AND q.next_retry_at <= now()
        )
        OR (
          -- H3: Reclaim stale leased jobs stranded by crashed/timed-out workers (> 10 minutes)
          q.status = 'processing'
          AND q.attempt_count < q.max_attempts
          AND (q.claimed_at IS NULL OR q.claimed_at < now() - interval '10 minutes')
        )
      )
    ORDER BY
      CASE WHEN q.status = 'processing' THEN 0 ELSE 1 END ASC,
      coalesce(q.claimed_at, q.next_retry_at) ASC,
      q.created_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    IF NOT public.validate_storage_object_scope(v_job.bucket, v_job.object_key) THEN
      UPDATE public.media_deletion_queue
      SET
        status = 'failed',
        attempt_count = max_attempts,
        claimed_at = NULL,
        last_error = 'Aborted: invalid storage bucket or path traversal detected'
      WHERE id = v_job.id;
      CONTINUE;
    END IF;

    IF public.is_storage_object_actively_referenced(v_job.bucket, v_job.object_key) THEN
      UPDATE public.media_deletion_queue
      SET
        status = 'failed',
        attempt_count = max_attempts,
        claimed_at = NULL,
        last_error = 'Aborted: storage object is actively referenced by live content'
      WHERE id = v_job.id;
      CONTINUE;
    END IF;

    UPDATE public.media_deletion_queue
    SET
      status = 'processing',
      attempt_count = attempt_count + 1,
      claimed_at = now()
    WHERE id = v_job.id
    RETURNING * INTO v_job;

    RETURN NEXT v_job;
  END LOOP;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_media_deletion_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_media_deletion_jobs(integer) TO service_role;

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
      claimed_at = NULL,
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
      claimed_at = NULL,
      last_error = left(coalesce(p_error, 'Storage deletion error'), 500),
      next_retry_at = now() + make_interval(mins => v_backoff_minutes)
    WHERE id = p_job_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_media_deletion_job(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_media_deletion_job(uuid, boolean, text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_chat_retention_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_media_bytes bigint := 0;
  v_pending_count bigint := 0;
  v_pending_bytes bigint := 0;
  v_deleted_count bigint := 0;
  v_deleted_bytes bigint := 0;
  v_failed_count bigint := 0;
  v_retryable_failed_count bigint := 0;
  v_permanently_failed_count bigint := 0;
  v_stale_processing_count bigint := 0;
  v_saved_count bigint := 0;
  v_saved_bytes bigint := 0;
  v_by_plan jsonb := '[]'::jsonb;
BEGIN
  IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin') AND NOT public.is_ping_admin() THEN
    RAISE EXCEPTION 'Administrator role required' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(sum(size_bytes), 0)::bigint
  INTO v_total_media_bytes
  FROM public.media_assets
  WHERE deleted_at IS NULL;

  SELECT count(*)::bigint, coalesce(sum(size_bytes), 0)::bigint
  INTO v_pending_count, v_pending_bytes
  FROM public.media_deletion_queue
  WHERE status IN ('pending', 'processing');

  SELECT count(*)::bigint, coalesce(sum(size_bytes), 0)::bigint
  INTO v_deleted_count, v_deleted_bytes
  FROM public.media_deletion_queue
  WHERE status = 'deleted';

  SELECT
    count(*)::bigint,
    count(*) FILTER (WHERE attempt_count < max_attempts)::bigint,
    count(*) FILTER (WHERE attempt_count >= max_attempts)::bigint
  INTO v_failed_count, v_retryable_failed_count, v_permanently_failed_count
  FROM public.media_deletion_queue
  WHERE status = 'failed';

  SELECT count(*)::bigint
  INTO v_stale_processing_count
  FROM public.media_deletion_queue
  WHERE status = 'processing'
    AND (claimed_at IS NULL OR claimed_at < now() - interval '10 minutes');

  SELECT count(*)::bigint, coalesce(sum(saved_bytes), 0)::bigint
  INTO v_saved_count, v_saved_bytes
  FROM public.saved_messages;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_by_plan
  FROM (
    SELECT
      coalesce(se.plan_slug, 'free') AS plan_slug,
      count(ma.id)::bigint AS asset_count,
      coalesce(sum(ma.size_bytes), 0)::bigint AS total_bytes
    FROM public.media_assets ma
    LEFT JOIN public.subscription_entitlements se
      ON se.user_id = ma.owner_id
     AND se.status = 'active'
     AND (se.expires_at IS NULL OR se.expires_at > now())
    WHERE ma.deleted_at IS NULL
    GROUP BY coalesce(se.plan_slug, 'free')
    ORDER BY total_bytes DESC
  ) t;

  RETURN jsonb_build_object(
    'total_media_bytes', v_total_media_bytes,
    'expired_awaiting_deletion_count', v_pending_count,
    'expired_awaiting_deletion_bytes', v_pending_bytes,
    'deleted_media_count', v_deleted_count,
    'deleted_media_bytes', v_deleted_bytes,
    'failed_deletion_jobs', v_failed_count,
    'retryable_failed_jobs', v_retryable_failed_count,
    'permanently_failed_jobs', v_permanently_failed_count,
    'stale_processing_jobs', v_stale_processing_count,
    'saved_media_count', v_saved_count,
    'saved_media_bytes', v_saved_bytes,
    'storage_by_plan', v_by_plan,
    'measured_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_chat_retention_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_chat_retention_metrics() TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 5. H9 — FIX LEGACY account_subscriptions.tier = 'institution' MAPPING
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_user_chat_retention_entitlement(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_slug text := 'free';
  v_plan_tier text := 'standard_unverified';
  v_is_verified boolean := false;
  v_tier_key text := 'standard_unverified';
  v_rule public.chat_retention_entitlement_rules%ROWTYPE;
  v_saved_bytes bigint := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'tier_key', 'standard_unverified',
      'plan_slug', 'free',
      'is_verified', false,
      'max_retention_policy', '7d',
      'max_retention_rank', 2,
      'saved_storage_quota_bytes', 104857600,
      'saved_storage_used_bytes', 0
    );
  END IF;

  -- 1. Check active subscription_entitlements (0033)
  SELECT se.plan_slug, coalesce(mp.benefits->>'chat_retention_tier', 'standard_unverified')
  INTO v_plan_slug, v_plan_tier
  FROM public.subscription_entitlements se
  JOIN public.membership_plans mp ON mp.slug = se.plan_slug
  WHERE se.user_id = p_user_id
    AND se.status = 'active'
    AND (se.expires_at IS NULL OR se.expires_at > now())
  LIMIT 1;

  -- Fallback to legacy account_subscriptions (0016) including 'institution' tier
  IF v_plan_slug IS NULL OR v_plan_slug = 'free' THEN
    SELECT
      CASE s.tier
        WHEN 'institution' THEN 'business'
        WHEN 'enterprise' THEN 'business'
        WHEN 'pro' THEN 'pro'
        WHEN 'plus' THEN 'plus'
        ELSE 'free'
      END,
      CASE s.tier
        WHEN 'institution' THEN 'premium_eligible'
        WHEN 'enterprise' THEN 'premium_eligible'
        WHEN 'pro' THEN 'paid_eligible'
        WHEN 'plus' THEN 'paid_eligible'
        ELSE 'standard_unverified'
      END
    INTO v_plan_slug, v_plan_tier
    FROM public.account_subscriptions s
    WHERE s.user_id = p_user_id
      AND s.status = 'active'
      AND (s.expires_at IS NULL OR s.expires_at > now())
    LIMIT 1;
  END IF;

  v_plan_slug := coalesce(v_plan_slug, 'free');
  v_plan_tier := coalesce(v_plan_tier, 'standard_unverified');

  -- 2. Check active account_verifications (0026 / 0033)
  SELECT EXISTS (
    SELECT 1
    FROM public.account_verifications av
    WHERE av.user_id = p_user_id
      AND av.status = 'verified'
      AND (av.expires_at IS NULL OR av.expires_at > now())
  ) INTO v_is_verified;

  -- 3. Highest earned tier wins
  IF v_plan_tier = 'premium_eligible' THEN
    v_tier_key := 'premium_eligible';
  ELSIF v_plan_tier = 'paid_eligible' THEN
    v_tier_key := 'paid_eligible';
  ELSIF v_is_verified THEN
    v_tier_key := 'verified';
  ELSE
    v_tier_key := 'standard_unverified';
  END IF;

  SELECT * INTO v_rule
  FROM public.chat_retention_entitlement_rules
  WHERE tier_key = v_tier_key;

  SELECT coalesce(sum(sm.saved_bytes), 0)::bigint
  INTO v_saved_bytes
  FROM public.saved_messages sm
  WHERE sm.user_id = p_user_id;

  RETURN jsonb_build_object(
    'tier_key', coalesce(v_rule.tier_key, 'standard_unverified'),
    'plan_slug', v_plan_slug,
    'is_verified', v_is_verified,
    'max_retention_policy', coalesce(v_rule.max_retention_policy, '7d'),
    'max_retention_rank', public.chat_retention_policy_rank(coalesce(v_rule.max_retention_policy, '7d')),
    'saved_storage_quota_bytes', coalesce(v_rule.saved_storage_quota_bytes, 104857600),
    'saved_storage_used_bytes', v_saved_bytes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_user_chat_retention_entitlement(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_user_chat_retention_entitlement(uuid) TO service_role;

-- ------------------------------------------------------------------------------
-- 6. H4 — SAVED-MESSAGE LIFECYCLE CLEANUP (ACCOUNT DELETE, LEAVE, SOFT-DELETE)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.recalculate_private_message_save_state(
  p_message_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msg public.private_messages%ROWTYPE;
  v_still_saved boolean;
  v_restored_expires timestamptz;
BEGIN
  IF p_message_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_msg
  FROM public.private_messages
  WHERE id = p_message_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.saved_messages sm WHERE sm.message_id = p_message_id
  ) INTO v_still_saved;

  IF v_still_saved THEN
    IF NOT coalesce(v_msg.is_saved_in_chat, false) THEN
      UPDATE public.private_messages
      SET is_saved_in_chat = true, updated_at = now()
      WHERE id = p_message_id;
    END IF;
    RETURN;
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
    expires_at = CASE
      WHEN deleted_at IS NOT NULL OR expired_at IS NOT NULL THEN expires_at
      ELSE v_restored_expires
    END,
    updated_at = now()
  WHERE id = p_message_id;
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_private_message_save_state(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_private_message_save_state(uuid) TO service_role;

-- AFTER DELETE trigger on saved_messages handles ON DELETE CASCADE (account delete) & bulk deletes
CREATE OR REPLACE FUNCTION public.sync_private_message_after_saved_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recalculate_private_message_save_state(OLD.message_id);
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_private_message_after_saved_delete() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS sync_private_message_after_saved_delete ON public.saved_messages;
CREATE TRIGGER sync_private_message_after_saved_delete
  AFTER DELETE ON public.saved_messages
  FOR EACH ROW EXECUTE FUNCTION public.sync_private_message_after_saved_delete();

-- Purge saved_messages whenever a private message is soft-deleted so saver quotas are released immediately
CREATE OR REPLACE FUNCTION public.purge_saved_messages_on_soft_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    DELETE FROM public.saved_messages WHERE message_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_saved_messages_on_soft_delete() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS purge_saved_messages_on_soft_delete ON public.private_messages;
CREATE TRIGGER purge_saved_messages_on_soft_delete
  AFTER UPDATE OF deleted_at ON public.private_messages
  FOR EACH ROW EXECUTE FUNCTION public.purge_saved_messages_on_soft_delete();

-- Purge departing member's saved_messages inside remove_group_member (H4)
CREATE OR REPLACE FUNCTION public.remove_group_member(
  p_conversation_id uuid,
  p_target_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_caller_role text;
  v_target_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversations
    WHERE id = p_conversation_id AND type = 'group'
  ) THEN
    RAISE EXCEPTION 'Group conversation not found';
  END IF;

  SELECT role INTO v_caller_role
  FROM public.conversation_members
  WHERE conversation_id = p_conversation_id AND user_id = v_uid;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this group' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_target_role
  FROM public.conversation_members
  WHERE conversation_id = p_conversation_id AND user_id = p_target_user_id;

  IF v_target_role IS NULL THEN
    RETURN true;
  END IF;

  IF p_target_user_id <> v_uid THEN
    IF v_caller_role NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'Only group admins can remove other members' USING ERRCODE = '42501';
    END IF;
    IF v_target_role = 'owner' THEN
      RAISE EXCEPTION 'Group owner cannot be removed by another member' USING ERRCODE = '42501';
    END IF;
    IF v_target_role = 'admin' AND v_caller_role <> 'owner' THEN
      RAISE EXCEPTION 'Only the group owner can remove administrators' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Release any saved_messages held by the departing user in this group (triggers recalculate)
  DELETE FROM public.saved_messages sm
  USING public.private_messages pm
  WHERE sm.message_id = pm.id
    AND pm.conversation_id = p_conversation_id
    AND sm.user_id = p_target_user_id;

  DELETE FROM public.conversation_members
  WHERE conversation_id = p_conversation_id AND user_id = p_target_user_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_group_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_group_member(uuid, uuid) TO authenticated;

-- Update toggle_save_private_message so p_save = false ALWAYS succeeds to release caller's quota
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
  v_updated public.private_messages%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ping_save_quota:' || v_caller::text, 0));

  -- Always allow caller to unsave their own saved_messages row even if message was deleted or user left
  IF NOT coalesce(p_save, false) THEN
    DELETE FROM public.saved_messages
    WHERE user_id = v_caller AND message_id = p_message_id;

    SELECT * INTO v_updated
    FROM public.private_messages
    WHERE id = p_message_id;

    RETURN jsonb_build_object(
      'message_id', p_message_id,
      'saved', false,
      'is_saved_in_chat', coalesce(v_updated.is_saved_in_chat, false),
      'expires_at', v_updated.expires_at
    );
  END IF;

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

  IF v_msg.expires_at IS NOT NULL AND v_msg.expires_at <= now() AND v_msg.is_saved_in_chat = false THEN
    RAISE EXCEPTION 'Message has already expired' USING ERRCODE = '42501';
  END IF;

  v_msg_bytes := greatest(0, coalesce(v_msg.media_size_bytes, 0));

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
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_save_private_message(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_save_private_message(uuid, boolean) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 7. H5 — APPLY default_chat_retention_policy ON NEW DIRECT & GROUP CONVERSATIONS
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(
  p_target_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_pair_key text;
  v_conv public.conversations%ROWTYPE;
  v_conv_id uuid;
  v_is_mutual boolean := false;
  v_target_vis text := 'public';
  v_dm_perm text := 'requests';
  v_initial_status text := 'accepted';
  v_creator_default text := '7d';
  v_effective_max text := '7d';
  v_initial_policy text := '7d';
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_target_user_id IS NULL OR p_target_user_id = v_caller THEN
    RAISE EXCEPTION 'Cannot start a direct conversation with yourself';
  END IF;

  SELECT coalesce(profile_visibility, 'public')
  INTO v_target_vis
  FROM public.profiles
  WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recipient profile not found';
  END IF;

  IF public.has_block_between(v_caller, p_target_user_id) THEN
    RAISE EXCEPTION 'Cannot message this user due to block settings' USING ERRCODE = '42501';
  END IF;

  v_pair_key := least(v_caller::text, p_target_user_id::text) || ':' || greatest(v_caller::text, p_target_user_id::text);
  PERFORM pg_advisory_xact_lock(hashtextextended('ping_dm_pair:' || v_pair_key, 0));

  v_is_mutual := public.is_mutual_follow(v_caller, p_target_user_id);

  SELECT * INTO v_conv
  FROM public.conversations
  WHERE type = 'direct' AND direct_pair_key = v_pair_key
  LIMIT 1;

  IF FOUND THEN
    IF v_conv.request_status = 'accepted' THEN
      UPDATE public.conversation_members
      SET hidden_at = NULL
      WHERE conversation_id = v_conv.id AND user_id = v_caller;
      RETURN v_conv.id;
    END IF;

    IF v_conv.request_status = 'pending' THEN
      IF v_is_mutual THEN
        UPDATE public.conversations
        SET request_status = 'accepted', request_responded_at = now(), updated_at = now()
        WHERE id = v_conv.id;
        UPDATE public.conversation_members
        SET hidden_at = NULL
        WHERE conversation_id = v_conv.id;
      ELSE
        UPDATE public.conversation_members
        SET hidden_at = NULL
        WHERE conversation_id = v_conv.id AND user_id = v_caller;
      END IF;
      RETURN v_conv.id;
    END IF;

    IF v_conv.request_status = 'declined' AND (v_is_mutual OR v_conv.request_recipient_id = v_caller) THEN
      UPDATE public.conversations
      SET
        request_status = 'accepted',
        requested_by = NULL,
        request_recipient_id = NULL,
        request_responded_at = now(),
        updated_at = now()
      WHERE id = v_conv.id;
      UPDATE public.conversation_members
      SET hidden_at = NULL
      WHERE conversation_id = v_conv.id;
      RETURN v_conv.id;
    END IF;

    RAISE EXCEPTION 'This user has declined your message request' USING ERRCODE = '42501';
  END IF;

  IF v_is_mutual THEN
    v_initial_status := 'accepted';
  ELSE
    IF v_target_vis = 'private' THEN
      RAISE EXCEPTION 'This account is private and only accepts messages from mutual connections'
        USING ERRCODE = '42501';
    END IF;

    SELECT coalesce(dm_permission, 'requests')
    INTO v_dm_perm
    FROM public.user_privacy_preferences
    WHERE user_id = p_target_user_id;
    v_dm_perm := coalesce(v_dm_perm, 'requests');

    IF v_dm_perm = 'nobody' THEN
      RAISE EXCEPTION 'This user is not accepting new direct messages' USING ERRCODE = '42501';
    ELSIF v_dm_perm = 'mutual_follows' THEN
      RAISE EXCEPTION 'This user only accepts messages from mutual connections' USING ERRCODE = '42501';
    ELSIF v_dm_perm = 'everyone' THEN
      v_initial_status := 'accepted';
    ELSE
      v_initial_status := 'pending';
    END IF;
  END IF;

  INSERT INTO public.conversations (
    type,
    direct_pair_key,
    created_by,
    request_status,
    requested_by,
    request_recipient_id,
    last_message_at,
    updated_at
  )
  VALUES (
    'direct',
    v_pair_key,
    v_caller,
    v_initial_status,
    CASE WHEN v_initial_status = 'pending' THEN v_caller ELSE NULL END,
    CASE WHEN v_initial_status = 'pending' THEN p_target_user_id ELSE NULL END,
    now(),
    now()
  )
  RETURNING id INTO v_conv_id;

  INSERT INTO public.conversation_members (conversation_id, user_id, role, last_read_at)
  VALUES
    (v_conv_id, v_caller, 'member', now()),
    (v_conv_id, p_target_user_id, 'member', now());

  -- H5: Apply creator's default_chat_retention_policy clamped strictly by participant ceiling
  SELECT coalesce(upp.default_chat_retention_policy, '7d')
  INTO v_creator_default
  FROM public.user_privacy_preferences upp
  WHERE upp.user_id = v_caller;
  v_creator_default := coalesce(v_creator_default, '7d');

  v_effective_max := public.resolve_conversation_max_retention_policy(v_conv_id);
  IF public.chat_retention_policy_rank(v_creator_default) > public.chat_retention_policy_rank(v_effective_max) THEN
    v_initial_policy := v_effective_max;
  ELSE
    v_initial_policy := v_creator_default;
  END IF;

  UPDATE public.conversations
  SET retention_policy = v_initial_policy
  WHERE id = v_conv_id;

  RETURN v_conv_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_direct_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_direct_conversation(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_group_conversation(
  p_title text,
  p_description text DEFAULT '',
  p_member_ids uuid[] DEFAULT '{}'::uuid[],
  p_only_admins_can_post boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_clean_title text := trim(coalesce(p_title, ''));
  v_conv_id uuid;
  v_member uuid;
  v_member_vis text;
  v_member_dm text;
  v_creator_default text := '7d';
  v_effective_max text := '7d';
  v_initial_policy text := '7d';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_clean_title) < 2 OR char_length(v_clean_title) > 80 THEN
    RAISE EXCEPTION 'Group title must be between 2 and 80 characters';
  END IF;

  INSERT INTO public.conversations (type, created_by, title, description, only_admins_can_post, request_status, last_message_at)
  VALUES ('group', v_uid, v_clean_title, trim(coalesce(p_description, '')), coalesce(p_only_admins_can_post, false), 'accepted', now())
  RETURNING id INTO v_conv_id;

  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES (v_conv_id, v_uid, 'owner')
  ON CONFLICT DO NOTHING;

  FOREACH v_member IN ARRAY coalesce(p_member_ids, '{}'::uuid[]) LOOP
    IF v_member IS NOT NULL AND v_member <> v_uid THEN
      SELECT coalesce(profile_visibility, 'public')
      INTO v_member_vis
      FROM public.profiles
      WHERE id = v_member;

      IF FOUND AND NOT public.has_block_between(v_uid, v_member) THEN
        SELECT coalesce(dm_permission, 'requests')
        INTO v_member_dm
        FROM public.user_privacy_preferences
        WHERE user_id = v_member;
        v_member_dm := coalesce(v_member_dm, 'requests');

        IF (v_member_vis <> 'private' AND v_member_dm <> 'nobody')
           OR public.is_mutual_follow(v_uid, v_member) THEN
          INSERT INTO public.conversation_members (conversation_id, user_id, role)
          VALUES (v_conv_id, v_member, 'member')
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- H5: Apply creator's default_chat_retention_policy clamped strictly by group participant ceiling
  SELECT coalesce(upp.default_chat_retention_policy, '7d')
  INTO v_creator_default
  FROM public.user_privacy_preferences upp
  WHERE upp.user_id = v_uid;
  v_creator_default := coalesce(v_creator_default, '7d');

  v_effective_max := public.resolve_conversation_max_retention_policy(v_conv_id);
  IF public.chat_retention_policy_rank(v_creator_default) > public.chat_retention_policy_rank(v_effective_max) THEN
    v_initial_policy := v_effective_max;
  ELSE
    v_initial_policy := v_creator_default;
  END IF;

  UPDATE public.conversations
  SET retention_policy = v_initial_policy
  WHERE id = v_conv_id;

  RETURN v_conv_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_group_conversation(text, text, uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_group_conversation(text, text, uuid[], boolean) TO authenticated;

-- ------------------------------------------------------------------------------
-- 8. H8 — HARDENED mark_conversation_read() FOR 24h_after_view IN DIRECT & GROUPS
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_conversation_read(
  p_conversation_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_send_receipts boolean := true;
  v_conv public.conversations%ROWTYPE;
  v_req_status text := 'accepted';
  v_now timestamptz := now();
BEGIN
  IF v_caller IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_members
    WHERE conversation_id = p_conversation_id AND user_id = v_caller
  ) THEN
    RETURN;
  END IF;

  SELECT * INTO v_conv
  FROM public.conversations
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_req_status := coalesce(v_conv.request_status, 'accepted');

  UPDATE public.conversation_members
  SET last_read_at = v_now
  WHERE conversation_id = p_conversation_id AND user_id = v_caller;

  -- H8: Gate 24h_after_view strictly on accepted conversations; in groups wait until ALL active
  -- non-sender members have viewed; record first_viewed_at even when is_saved_in_chat = true!
  IF v_req_status = 'accepted' THEN
    UPDATE public.private_messages pm
    SET
      first_viewed_at = v_now,
      expires_at = CASE
        WHEN pm.is_saved_in_chat = true THEN pm.expires_at
        ELSE least(coalesce(pm.expires_at, v_now + interval '24 hours'), v_now + interval '24 hours')
      END,
      updated_at = v_now
    WHERE pm.conversation_id = p_conversation_id
      AND pm.sender_id <> v_caller
      AND pm.retention_policy = '24h_after_view'
      AND pm.first_viewed_at IS NULL
      AND pm.expired_at IS NULL
      AND pm.deleted_at IS NULL
      AND (
        v_conv.type <> 'group'
        OR NOT EXISTS (
          SELECT 1
          FROM public.conversation_members other_cm
          WHERE other_cm.conversation_id = p_conversation_id
            AND other_cm.hidden_at IS NULL
            AND other_cm.user_id <> pm.sender_id
            AND (other_cm.last_read_at IS NULL OR other_cm.last_read_at < pm.created_at)
        )
      );
  END IF;

  SELECT coalesce(read_receipts_enabled, true)
  INTO v_send_receipts
  FROM public.user_privacy_preferences
  WHERE user_id = v_caller;
  v_send_receipts := coalesce(v_send_receipts, true);

  IF v_send_receipts AND v_req_status = 'accepted' THEN
    UPDATE public.private_messages pm
    SET status = 'read', updated_at = v_now
    WHERE pm.conversation_id = p_conversation_id
      AND pm.sender_id <> v_caller
      AND pm.status IN ('sent', 'delivered')
      AND coalesce(
        (
          SELECT upp.read_receipts_enabled
          FROM public.user_privacy_preferences upp
          WHERE upp.user_id = pm.sender_id
        ),
        true
      ) = true;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_conversation_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 9. M7 — SURFACE effective_max_retention_policy FOR CONVERSATION RETENTION UI
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_conversation_retention_info(
  p_conversation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_conv public.conversations%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_members cm
    WHERE cm.conversation_id = p_conversation_id AND cm.user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'You are not a participant in this conversation' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_conv FROM public.conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  RETURN jsonb_build_object(
    'conversation_id', v_conv.id,
    'retention_policy', coalesce(v_conv.retention_policy, '7d'),
    'retention_updated_at', v_conv.retention_updated_at,
    'effective_max_retention_policy', public.resolve_conversation_max_retention_policy(v_conv.id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_conversation_retention_info(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conversation_retention_info(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_conversations_summary(
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_lim integer := least(greatest(coalesce(_limit, 50), 1), 100);
  v_off integer := greatest(coalesce(_offset, 0), 0);
  v_result jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(row_json ORDER BY last_message_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      c.last_message_at,
      jsonb_build_object(
        'id', c.id,
        'type', c.type,
        'title', c.title,
        'description', c.description,
        'avatar_url', c.avatar_url,
        'only_admins_can_post', coalesce(c.only_admins_can_post, false),
        'request_status', coalesce(c.request_status, 'accepted'),
        'requested_by', c.requested_by,
        'request_recipient_id', c.request_recipient_id,
        'request_responded_at', c.request_responded_at,
        'retention_policy', coalesce(c.retention_policy, '7d'),
        'retention_updated_at', c.retention_updated_at,
        'effective_max_retention_policy', public.resolve_conversation_max_retention_policy(c.id),
        'created_by', c.created_by,
        'last_message_at', c.last_message_at,
        'last_message_preview', c.last_message_preview,
        'created_at', c.created_at,
        'updated_at', c.updated_at,
        'my_membership', jsonb_build_object(
          'conversation_id', my_cm.conversation_id,
          'user_id', my_cm.user_id,
          'role', my_cm.role,
          'joined_at', my_cm.joined_at,
          'last_read_at', my_cm.last_read_at,
          'is_muted', my_cm.is_muted,
          'is_archived', my_cm.is_archived,
          'hidden_at', my_cm.hidden_at
        ),
        'other_member', CASE
          WHEN peer.id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'id', peer.id,
            'username', peer.username,
            'display_name', peer.display_name,
            'avatar_url', peer.avatar_url,
            'bio', peer.bio,
            'created_at', peer.created_at
          )
        END,
        'unread_count', (
          SELECT count(*)::integer
          FROM public.private_messages pm
          WHERE pm.conversation_id = c.id
            AND pm.sender_id <> v_caller
            AND pm.created_at > my_cm.last_read_at
            AND pm.deleted_at IS NULL
            AND pm.expired_at IS NULL
        )
      ) AS row_json
    FROM public.conversation_members my_cm
    JOIN public.conversations c ON c.id = my_cm.conversation_id
    LEFT JOIN LATERAL (
      SELECT p.id, p.username, p.display_name, p.avatar_url, p.bio, p.created_at
      FROM public.conversation_members other_cm
      JOIN public.profiles p ON p.id = other_cm.user_id
      WHERE other_cm.conversation_id = c.id
        AND other_cm.user_id <> v_caller
      LIMIT 1
    ) peer ON true
    WHERE my_cm.user_id = v_caller
      AND my_cm.hidden_at IS NULL
      AND NOT (c.request_status = 'declined' AND c.request_recipient_id = v_caller)
    ORDER BY c.last_message_at DESC
    LIMIT v_lim OFFSET v_off
  ) sub;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_conversations_summary(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_conversations_summary(integer, integer) TO authenticated;

-- ------------------------------------------------------------------------------
-- 10. M8 — MOMENT AUDIENCE BUCKET BOUNDARY & SAFE MOMENT-TO-CLIP CONVERSION
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_moment_audience_bucket_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_is_private_ref boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.audience IS DISTINCT FROM OLD.audience THEN
    v_is_private_ref := coalesce(NEW.media_url, '') LIKE 'storage://private-moments/%'
                        OR coalesce(NEW.media_url, '') LIKE 'r2://private-moments/%';

    IF NEW.audience = 'public' AND v_is_private_ref THEN
      RAISE EXCEPTION 'Restricted Moment media is stored in a private bucket and cannot be switched to public audience; upload as a new public Moment instead'
        USING ERRCODE = '42501';
    END IF;

    IF OLD.audience = 'public' AND NEW.audience <> 'public' AND NOT v_is_private_ref AND coalesce(NEW.media_url, '') <> '' THEN
      RAISE EXCEPTION 'Public Moment media is stored on the public CDN and cannot be switched to a restricted audience; delete and re-upload as a restricted Moment instead'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_moment_audience_bucket_boundary() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_moment_audience_bucket_boundary ON public.moments;
CREATE TRIGGER guard_moment_audience_bucket_boundary
  BEFORE UPDATE OF audience ON public.moments
  FOR EACH ROW EXECUTE FUNCTION public.guard_moment_audience_bucket_boundary();

CREATE OR REPLACE FUNCTION public.publish_moment_as_clip(
  p_moment_id uuid,
  p_caption text DEFAULT NULL,
  p_visibility text DEFAULT 'public',
  p_dot_tags text[] DEFAULT '{}'::text[]
)
RETURNS public.ping_clips
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_moment public.moments%ROWTYPE;
  v_clip public.ping_clips%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_visibility NOT IN ('public', 'followers', 'hub') THEN
    RAISE EXCEPTION 'Invalid Clip visibility';
  END IF;

  SELECT * INTO v_moment
  FROM public.moments
  WHERE id = p_moment_id AND author_id = v_uid AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Moment not found or you are not the original creator' USING ERRCODE = '42501';
  END IF;

  IF v_moment.media_type <> 'video' THEN
    RAISE EXCEPTION 'Only video Moments can be republished as Ping Clips';
  END IF;

  IF v_moment.audience = 'close_circle' AND p_visibility = 'public' THEN
    RAISE EXCEPTION 'Close Circle Moments cannot be republished publicly without changing Moment privacy first';
  END IF;

  -- M8: Never copy private-bucket storage refs into public/discoverable ping_clips.video_url
  IF v_moment.media_url IS NULL
     OR v_moment.media_url LIKE 'storage://%'
     OR v_moment.media_url LIKE 'r2://%'
     OR v_moment.media_url !~* '^https?://' THEN
    RAISE EXCEPTION 'Restricted private-bucket Moments cannot be directly republished as Clips; upload the video as a Clip directly'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.ping_clips (
    creator_id, video_url, caption, duration_sec, visibility, dot_tags, source_moment_id, processing_status
  )
  VALUES (
    v_moment.author_id,
    v_moment.media_url,
    coalesce(nullif(btrim(p_caption), ''), v_moment.caption, ''),
    null,
    p_visibility,
    coalesce(p_dot_tags, '{}'::text[]),
    v_moment.id,
    'ready'
  )
  RETURNING * INTO v_clip;

  RETURN v_clip;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_moment_as_clip(uuid, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_moment_as_clip(uuid, text, text, text[]) TO authenticated;
