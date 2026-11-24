-- ==============================================================================
-- Migration 0039: Stage 2 Scalable Chat Retention System (Feature-Flagged)
--
-- Reuses existing public.account_verifications, public.membership_plans,
-- public.subscription_entitlements, public.account_subscriptions,
-- public.user_privacy_preferences, public.conversations,
-- public.private_messages, public.saved_messages, and public.media_deletion_queue.
--
-- Strictly scoped to private conversations ONLY. Never expires public Pings,
-- profiles, published Moments, Venture listings, Clips, or Hub content.
--
-- Forward-only, idempotent SQL migration. Not executed against production
-- without explicit operator approval.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. FEATURE FLAG REGISTRY (CONTROLLED ROLLOUT — OFF BY DEFAULT)
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.app_feature_flags (
  key text PRIMARY KEY CHECK (key ~ '^[a-z0-9_]{2,64}$'),
  enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.app_feature_flags (key, enabled, config)
VALUES
  ('chat_retention', false, '{"default_policy":"7d","batch_size":500}'::jsonb),
  ('cloudflare_r2_media', false, '{"multipart_threshold_bytes":6291456}'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.app_feature_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_feature_flags FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.app_feature_flags TO authenticated;
GRANT ALL ON public.app_feature_flags TO service_role;

DROP POLICY IF EXISTS "Authenticated users read app feature flags" ON public.app_feature_flags;
CREATE POLICY "Authenticated users read app feature flags" ON public.app_feature_flags
  FOR SELECT TO authenticated
  USING (key IS NOT NULL);

-- ------------------------------------------------------------------------------
-- 2. CENTRAL CHAT RETENTION ENTITLEMENT CONFIGURATION
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.chat_retention_entitlement_rules (
  tier_key text PRIMARY KEY
    CHECK (tier_key IN ('standard_unverified', 'verified', 'paid_eligible', 'premium_eligible')),
  max_retention_policy text NOT NULL
    CHECK (max_retention_policy IN ('24h_after_view', '7d', '30d', '1y', 'until_deleted')),
  saved_storage_quota_bytes bigint NOT NULL CHECK (saved_storage_quota_bytes > 0),
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.chat_retention_entitlement_rules (
  tier_key, max_retention_policy, saved_storage_quota_bytes, label, description
)
VALUES
  (
    'standard_unverified',
    '7d',
    104857600,
    'Standard Account',
    'Up to 7-day chat retention and 100 MB saved-in-chat media quota.'
  ),
  (
    'verified',
    '30d',
    524288000,
    'Verified Account',
    'Up to 30-day chat retention and 500 MB saved-in-chat media quota.'
  ),
  (
    'paid_eligible',
    '1y',
    2147483648,
    'Paid Plan (Plus / Pro)',
    'Up to 1-year chat retention and 2 GB saved-in-chat media quota.'
  ),
  (
    'premium_eligible',
    'until_deleted',
    10737418240,
    'Premium Plan (Business)',
    'Retention until manually deleted, subject to 10 GB saved-in-chat storage quota.'
  )
ON CONFLICT (tier_key) DO NOTHING;

ALTER TABLE public.chat_retention_entitlement_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_retention_entitlement_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.chat_retention_entitlement_rules TO authenticated;
GRANT ALL ON public.chat_retention_entitlement_rules TO service_role;

DROP POLICY IF EXISTS "Authenticated users read retention entitlement rules" ON public.chat_retention_entitlement_rules;
CREATE POLICY "Authenticated users read retention entitlement rules" ON public.chat_retention_entitlement_rules
  FOR SELECT TO authenticated
  USING (tier_key IS NOT NULL);

-- Attach central retention tier mapping to existing membership_plans.benefits
UPDATE public.membership_plans
SET benefits = benefits || jsonb_build_object(
  'chat_retention_tier',
  CASE slug
    WHEN 'business' THEN 'premium_eligible'
    WHEN 'pro' THEN 'paid_eligible'
    WHEN 'plus' THEN 'paid_eligible'
    ELSE 'standard_unverified'
  END
)
WHERE NOT (benefits ? 'chat_retention_tier');

-- Deterministic policy rank helper
CREATE OR REPLACE FUNCTION public.chat_retention_policy_rank(p_policy text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_policy
    WHEN '24h_after_view' THEN 1
    WHEN '7d' THEN 2
    WHEN '30d' THEN 3
    WHEN '1y' THEN 4
    WHEN 'until_deleted' THEN 5
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.chat_retention_policy_from_rank(p_rank integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_rank <= 1 THEN '24h_after_view'
    WHEN p_rank = 2 THEN '7d'
    WHEN p_rank = 3 THEN '30d'
    WHEN p_rank = 4 THEN '1y'
    ELSE 'until_deleted'
  END;
$$;

-- Central authoritative entitlement resolver (reads existing verification + subscription tables)
CREATE OR REPLACE FUNCTION public.resolve_user_chat_retention_entitlement(p_user_id uuid)
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

  -- Fallback to legacy account_subscriptions (0016) if no active 0033 entitlement row
  IF v_plan_slug IS NULL OR v_plan_slug = 'free' THEN
    SELECT
      CASE s.tier
        WHEN 'enterprise' THEN 'business'
        WHEN 'pro' THEN 'pro'
        WHEN 'plus' THEN 'plus'
        ELSE 'free'
      END,
      CASE s.tier
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

  -- 3. Highest earned tier wins (paid/premium > verified > standard_unverified)
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

CREATE OR REPLACE FUNCTION public.get_my_chat_retention_entitlement()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_ent jsonb;
  v_flag boolean := false;
  v_default_policy text := '7d';
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  v_ent := public.resolve_user_chat_retention_entitlement(v_caller);

  SELECT coalesce(enabled, false) INTO v_flag
  FROM public.app_feature_flags
  WHERE key = 'chat_retention';

  SELECT coalesce(default_chat_retention_policy, '7d') INTO v_default_policy
  FROM public.user_privacy_preferences
  WHERE user_id = v_caller;

  RETURN v_ent || jsonb_build_object(
    'feature_enabled', coalesce(v_flag, false),
    'default_chat_retention_policy', coalesce(v_default_policy, '7d')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_chat_retention_entitlement() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_chat_retention_entitlement() TO authenticated, service_role;

-- Effective maximum policy allowed in a conversation = lowest ceiling among active participants
-- (prevents one participant from silently extending another participant's retention limit)
CREATE OR REPLACE FUNCTION public.resolve_conversation_max_retention_policy(p_conversation_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min_rank integer;
BEGIN
  SELECT min(
    (public.resolve_user_chat_retention_entitlement(cm.user_id)->>'max_retention_rank')::integer
  )
  INTO v_min_rank
  FROM public.conversation_members cm
  WHERE cm.conversation_id = p_conversation_id
    AND cm.hidden_at IS NULL;

  IF v_min_rank IS NULL THEN
    RETURN '7d';
  END IF;

  RETURN public.chat_retention_policy_from_rank(v_min_rank);
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_conversation_max_retention_policy(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_conversation_max_retention_policy(uuid) TO service_role;

-- ------------------------------------------------------------------------------
-- 3. EXTEND PRIVACY PREFERENCES, CONVERSATIONS, PRIVATE MESSAGES & SAVED MESSAGES
-- ------------------------------------------------------------------------------

-- 3a. User-level default retention preference (server-enforced against entitlement)
ALTER TABLE public.user_privacy_preferences
  ADD COLUMN IF NOT EXISTS default_chat_retention_policy text NOT NULL DEFAULT '7d';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_privacy_preferences_retention_check'
      AND conrelid = 'public.user_privacy_preferences'::regclass
  ) THEN
    ALTER TABLE public.user_privacy_preferences DROP CONSTRAINT user_privacy_preferences_retention_check;
  END IF;
END $$;

ALTER TABLE public.user_privacy_preferences
  ADD CONSTRAINT user_privacy_preferences_retention_check
  CHECK (default_chat_retention_policy IN ('24h_after_view', '7d', '30d', '1y', 'until_deleted'));

CREATE OR REPLACE FUNCTION public.guard_user_privacy_retention()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ent jsonb;
  v_max_rank integer;
  v_req_rank integer;
BEGIN
  IF current_user IN ('anon', 'authenticated') AND NEW.default_chat_retention_policy IS NOT NULL THEN
    v_ent := public.resolve_user_chat_retention_entitlement(NEW.user_id);
    v_max_rank := coalesce((v_ent->>'max_retention_rank')::integer, 2);
    v_req_rank := public.chat_retention_policy_rank(NEW.default_chat_retention_policy);
    IF v_req_rank <= 0 OR v_req_rank > v_max_rank THEN
      RAISE EXCEPTION 'Selected chat retention policy (%) exceeds your account entitlement (max: %)',
        NEW.default_chat_retention_policy,
        coalesce(v_ent->>'max_retention_policy', '7d')
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_user_privacy_retention() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_user_privacy_retention ON public.user_privacy_preferences;
CREATE TRIGGER guard_user_privacy_retention
  BEFORE INSERT OR UPDATE OF default_chat_retention_policy ON public.user_privacy_preferences
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_privacy_retention();

-- 3b. Conversation-level retention policy (applies to new messages only)
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS retention_policy text NOT NULL DEFAULT '7d',
  ADD COLUMN IF NOT EXISTS retention_updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS retention_updated_at timestamptz;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversations_retention_policy_check'
      AND conrelid = 'public.conversations'::regclass
  ) THEN
    ALTER TABLE public.conversations DROP CONSTRAINT conversations_retention_policy_check;
  END IF;
END $$;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_retention_policy_check
  CHECK (retention_policy IN ('24h_after_view', '7d', '30d', '1y', 'until_deleted'));

-- 3c. Authoritative server-side expiry & saved metadata on private_messages
ALTER TABLE public.private_messages
  ADD COLUMN IF NOT EXISTS retention_policy text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_viewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS expired_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_saved_in_chat boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS media_size_bytes bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'private_messages_retention_policy_check'
      AND conrelid = 'public.private_messages'::regclass
  ) THEN
    ALTER TABLE public.private_messages DROP CONSTRAINT private_messages_retention_policy_check;
  END IF;
END $$;

ALTER TABLE public.private_messages
  ADD CONSTRAINT private_messages_retention_policy_check
  CHECK (retention_policy IS NULL OR retention_policy IN ('24h_after_view', '7d', '30d', '1y', 'until_deleted'));

-- Partial index for high-scale batched expiration (zero full-table scans)
CREATE INDEX IF NOT EXISTS private_messages_expiry_due_idx
  ON public.private_messages (expires_at ASC, id)
  WHERE expires_at IS NOT NULL
    AND expired_at IS NULL
    AND deleted_at IS NULL
    AND is_saved_in_chat = false;

-- Extend write guard trigger (preserving ALL Stage 1 0037 protections + protecting retention columns)
CREATE OR REPLACE FUNCTION public.guard_private_message_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_conv public.conversations%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_user IN ('anon', 'authenticated') THEN
      RAISE EXCEPTION 'Direct inserts into private_messages are forbidden; use send_private_message RPC'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF current_user IN ('anon', 'authenticated') THEN
      IF OLD.sender_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Only the sender can modify their own message' USING ERRCODE = '42501';
      END IF;

      IF NEW.id <> OLD.id
         OR NEW.conversation_id <> OLD.conversation_id
         OR NEW.sender_id <> OLD.sender_id
         OR NEW.media_url IS DISTINCT FROM OLD.media_url
         OR NEW.media_type IS DISTINCT FROM OLD.media_type
         OR NEW.status IS DISTINCT FROM OLD.status
         OR NEW.is_pinned IS DISTINCT FROM OLD.is_pinned
         OR NEW.reply_to_id IS DISTINCT FROM OLD.reply_to_id
         OR NEW.forwarded_from_id IS DISTINCT FROM OLD.forwarded_from_id
         OR NEW.is_pending_request_msg IS DISTINCT FROM OLD.is_pending_request_msg
         OR NEW.retention_policy IS DISTINCT FROM OLD.retention_policy
         OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
         OR NEW.first_viewed_at IS DISTINCT FROM OLD.first_viewed_at
         OR NEW.expired_at IS DISTINCT FROM OLD.expired_at
         OR NEW.is_saved_in_chat IS DISTINCT FROM OLD.is_saved_in_chat
         OR NEW.media_size_bytes IS DISTINCT FROM OLD.media_size_bytes
         OR NEW.is_system IS DISTINCT FROM OLD.is_system
         OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'Message metadata, retention timestamps, attachments, pin state, and delivery status are protected'
          USING ERRCODE = '42501';
      END IF;

      IF OLD.deleted_at IS NOT NULL OR OLD.expired_at IS NOT NULL THEN
        RAISE EXCEPTION 'Deleted or expired messages cannot be restored or edited' USING ERRCODE = '42501';
      END IF;

      IF NEW.deleted_at IS NOT NULL THEN
        NEW.deleted_at := now();
        NEW.updated_at := now();
      ELSE
        SELECT * INTO v_conv FROM public.conversations WHERE id = OLD.conversation_id;
        IF v_conv.type = 'direct' AND (
          v_conv.request_status = 'declined'
          OR public.is_conversation_blocked_for_me(OLD.conversation_id)
        ) THEN
          RAISE EXCEPTION 'Cannot edit messages in a blocked or declined conversation'
            USING ERRCODE = '42501';
        END IF;

        NEW.content := btrim(coalesce(NEW.content, ''));
        IF char_length(NEW.content) < 1 OR char_length(NEW.content) > 5000 THEN
          RAISE EXCEPTION 'Edited message must be between 1 and 5000 characters';
        END IF;
        NEW.edited_at := now();
        NEW.updated_at := now();
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_private_message_write() FROM PUBLIC, anon, authenticated;

-- Hide expired messages from client SELECT queries cleanly
DROP POLICY IF EXISTS "Participants view conversation messages" ON public.private_messages;
CREATE POLICY "Participants view conversation messages" ON public.private_messages
  FOR SELECT TO authenticated
  USING (
    expired_at IS NULL
    AND (
      expires_at IS NULL
      OR expires_at > now()
      OR is_saved_in_chat = true
    )
    AND public.is_conversation_member(conversation_id, (select auth.uid()))
  );

-- Enqueue manual message deletion media into deletion queue
CREATE OR REPLACE FUNCTION public.enqueue_deleted_private_message_media()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND OLD.expired_at IS NULL AND NEW.media_url IS NOT NULL THEN
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
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_deleted_private_message_media() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enqueue_deleted_private_message_media ON public.private_messages;
CREATE TRIGGER enqueue_deleted_private_message_media
  AFTER UPDATE OF deleted_at ON public.private_messages
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_deleted_private_message_media();

-- 3d. Extend saved_messages so all conversation participants see saved state & enforce RPC writes
ALTER TABLE public.saved_messages
  ADD COLUMN IF NOT EXISTS saved_bytes bigint NOT NULL DEFAULT 0 CHECK (saved_bytes >= 0);

CREATE INDEX IF NOT EXISTS saved_messages_message_idx ON public.saved_messages (message_id);

REVOKE INSERT, UPDATE, DELETE ON public.saved_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.saved_messages TO authenticated;
GRANT ALL ON public.saved_messages TO service_role;

DROP POLICY IF EXISTS "Users read own saved messages" ON public.saved_messages;
DROP POLICY IF EXISTS "Conversation members see saved state" ON public.saved_messages;
CREATE POLICY "Conversation members see saved state" ON public.saved_messages
  FOR SELECT TO authenticated
  USING (
    user_id = (select auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.private_messages pm
      WHERE pm.id = saved_messages.message_id
        AND pm.expired_at IS NULL
        AND public.is_conversation_member(pm.conversation_id, (select auth.uid()))
    )
  );

-- ------------------------------------------------------------------------------
-- 4. HARDEN 'dm-attachments' SELECT RLS TO BLOCK EXPIRED / DELETED RENEWALS
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS "DM conversation participants read signed files" ON storage.objects;
CREATE POLICY "DM conversation participants read signed files" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'dm-attachments'
    AND (
      EXISTS (
        SELECT 1
        FROM public.conversation_members cm
        WHERE cm.conversation_id::text = (storage.foldername(name))[1]
          AND cm.user_id = (select auth.uid())
          AND cm.hidden_at IS NULL
      )
      OR (
        (storage.foldername(name))[2] = 'dm'
        AND EXISTS (
          SELECT 1
          FROM public.conversation_members cm
          WHERE cm.conversation_id::text = (storage.foldername(name))[3]
            AND cm.user_id = (select auth.uid())
            AND cm.hidden_at IS NULL
        )
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.private_messages pm
      WHERE (pm.media_url = name OR pm.media_url = 'storage://dm-attachments/' || name)
        AND (
          pm.deleted_at IS NOT NULL
          OR pm.expired_at IS NOT NULL
          OR (pm.expires_at IS NOT NULL AND pm.expires_at <= now() AND pm.is_saved_in_chat = false)
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.media_deletion_queue mdq
      WHERE mdq.bucket = 'dm-attachments'
        AND mdq.object_key = name
    )
  );

-- ------------------------------------------------------------------------------
-- 5. AUTHORITATIVE RETENTION, SAVE/UNSAVE & MESSAGE RPCS
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.compute_retention_expires_at(
  p_policy text,
  p_base_time timestamptz DEFAULT now()
)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_policy
    -- 24h_after_view uses a 7-day unread safety cap until first viewed, then shortens to 24h after view
    WHEN '24h_after_view' THEN p_base_time + interval '7 days'
    WHEN '7d' THEN p_base_time + interval '7 days'
    WHEN '30d' THEN p_base_time + interval '30 days'
    WHEN '1y' THEN p_base_time + interval '365 days'
    WHEN 'until_deleted' THEN NULL
    ELSE p_base_time + interval '7 days'
  END;
$$;

CREATE OR REPLACE FUNCTION public.set_my_default_chat_retention(p_policy text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_ent jsonb;
  v_max_rank integer;
  v_req_rank integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  v_req_rank := public.chat_retention_policy_rank(p_policy);
  IF v_req_rank <= 0 THEN
    RAISE EXCEPTION 'Unsupported chat retention policy: %', coalesce(p_policy, '');
  END IF;

  v_ent := public.resolve_user_chat_retention_entitlement(v_caller);
  v_max_rank := coalesce((v_ent->>'max_retention_rank')::integer, 2);

  IF v_req_rank > v_max_rank THEN
    RAISE EXCEPTION 'Retention policy (%) exceeds your account entitlement (max: %)',
      p_policy,
      coalesce(v_ent->>'max_retention_policy', '7d')
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.user_privacy_preferences (user_id, default_chat_retention_policy, updated_at)
  VALUES (v_caller, p_policy, now())
  ON CONFLICT (user_id) DO UPDATE SET
    default_chat_retention_policy = EXCLUDED.default_chat_retention_policy,
    updated_at = now();

  RETURN jsonb_build_object(
    'default_chat_retention_policy', p_policy,
    'entitlement', v_ent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_default_chat_retention(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_default_chat_retention(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_conversation_retention_policy(
  p_conversation_id uuid,
  p_policy text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_conv public.conversations%ROWTYPE;
  v_member public.conversation_members%ROWTYPE;
  v_effective_max text;
  v_req_rank integer;
  v_max_rank integer;
  v_label text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  v_req_rank := public.chat_retention_policy_rank(p_policy);
  IF v_req_rank <= 0 THEN
    RAISE EXCEPTION 'Unsupported chat retention policy: %', coalesce(p_policy, '');
  END IF;

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
    AND user_id = v_caller
    AND hidden_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not an active participant in this conversation' USING ERRCODE = '42501';
  END IF;

  IF v_conv.type = 'group' AND v_member.role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only group admins can change group retention settings' USING ERRCODE = '42501';
  END IF;

  IF v_conv.type = 'direct' AND (
    coalesce(v_conv.request_status, 'accepted') <> 'accepted'
    OR public.is_conversation_blocked_for_me(p_conversation_id)
  ) THEN
    RAISE EXCEPTION 'Retention settings cannot be modified on pending, declined, or blocked conversations'
      USING ERRCODE = '42501';
  END IF;

  -- Enforce minimum participant entitlement ceiling (cannot silently extend another participant)
  v_effective_max := public.resolve_conversation_max_retention_policy(p_conversation_id);
  v_max_rank := public.chat_retention_policy_rank(v_effective_max);

  IF v_req_rank > v_max_rank THEN
    RAISE EXCEPTION 'Policy (%) exceeds this conversation''s participant entitlement ceiling (max: %)',
      p_policy, v_effective_max
      USING ERRCODE = '42501';
  END IF;

  -- Applies strictly to NEW messages; existing messages keep their existing expires_at
  UPDATE public.conversations
  SET
    retention_policy = p_policy,
    retention_updated_by = v_caller,
    retention_updated_at = now(),
    updated_at = now()
  WHERE id = p_conversation_id;

  v_label := CASE p_policy
    WHEN '24h_after_view' THEN '24 hours after viewing'
    WHEN '7d' THEN '7 days after sending'
    WHEN '30d' THEN '30 days after sending'
    WHEN '1y' THEN '1 year after sending'
    ELSE 'Until manually deleted'
  END;

  -- Visible system notification inside the conversation
  INSERT INTO public.private_messages (
    conversation_id,
    sender_id,
    content,
    status,
    is_system,
    retention_policy,
    expires_at
  )
  VALUES (
    p_conversation_id,
    v_caller,
    'Chat retention changed to ' || v_label || ' (applies to new messages).',
    'sent',
    true,
    p_policy,
    NULL
  );

  RETURN jsonb_build_object(
    'conversation_id', p_conversation_id,
    'retention_policy', p_policy,
    'effective_max_policy', v_effective_max,
    'updated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_conversation_retention_policy(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_conversation_retention_policy(uuid, text) TO authenticated, service_role;

-- Save / unsave individual messages & attachments with server-side quota + expiry restoration
CREATE OR REPLACE FUNCTION public.toggle_save_private_message(
  p_message_id uuid,
  p_save boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_msg public.private_messages%ROWTYPE;
  v_ent jsonb;
  v_quota bigint;
  v_used bigint;
  v_msg_bytes bigint;
  v_still_saved boolean;
  v_restored_expires timestamptz;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
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

  IF p_save THEN
    IF v_msg.expires_at IS NOT NULL AND v_msg.expires_at <= now() AND v_msg.is_saved_in_chat = false THEN
      RAISE EXCEPTION 'Message has already expired' USING ERRCODE = '42501';
    END IF;

    v_msg_bytes := greatest(0, coalesce(v_msg.media_size_bytes, 0));
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
    SET is_saved_in_chat = true, updated_at = now()
    WHERE id = p_message_id;

    RETURN jsonb_build_object(
      'message_id', p_message_id,
      'saved', true,
      'is_saved_in_chat', true,
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

    -- Restore applicable expiry when last participant unsaves
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

-- Update send_private_message preserving ALL 0037 protections + authoritative retention stamping
CREATE OR REPLACE FUNCTION public.send_private_message(
  p_conversation_id uuid,
  p_content text,
  p_media_url text DEFAULT NULL,
  p_media_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_conv public.conversations%ROWTYPE;
  v_message public.private_messages;
  v_trimmed_content text := btrim(coalesce(p_content, ''));
  v_clean_media text := nullif(btrim(coalesce(p_media_url, '')), '');
  v_preview text;
  v_retention_enabled boolean := false;
  v_effective_policy text := NULL;
  v_effective_max text;
  v_expires_at timestamptz := NULL;
  v_media_bytes bigint := 0;
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

  -- Look up recorded attachment size if available in media_assets
  IF v_clean_media IS NOT NULL THEN
    SELECT coalesce(ma.size_bytes, 0)
    INTO v_media_bytes
    FROM public.media_assets ma
    WHERE ma.owner_id = v_caller
      AND (ma.object_key = v_clean_media OR ma.source_url = v_clean_media)
    ORDER BY ma.created_at DESC
    LIMIT 1;
    v_media_bytes := greatest(0, coalesce(v_media_bytes, 0));
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

  -- Flip linked staging media_assets record to ready
  IF v_clean_media IS NOT NULL THEN
    UPDATE public.media_assets
    SET status = 'ready', conversation_id = p_conversation_id, expires_at = v_expires_at, updated_at = now()
    WHERE owner_id = v_caller
      AND status = 'staging'
      AND (object_key = v_clean_media OR source_url = v_clean_media);
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

-- Update mark_conversation_read preserving 0037 reciprocal read receipts + starting 24h_after_view clock
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
  v_req_status text := 'accepted';
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

  UPDATE public.conversation_members
  SET last_read_at = now()
  WHERE conversation_id = p_conversation_id AND user_id = v_caller;

  -- Start 24-hour post-view expiry timer on 24h_after_view messages regardless of read-receipt preference
  UPDATE public.private_messages pm
  SET
    first_viewed_at = now(),
    expires_at = least(coalesce(pm.expires_at, now() + interval '24 hours'), now() + interval '24 hours'),
    updated_at = now()
  WHERE pm.conversation_id = p_conversation_id
    AND pm.sender_id <> v_caller
    AND pm.retention_policy = '24h_after_view'
    AND pm.first_viewed_at IS NULL
    AND pm.expired_at IS NULL
    AND pm.deleted_at IS NULL
    AND pm.is_saved_in_chat = false;

  SELECT coalesce(read_receipts_enabled, true)
  INTO v_send_receipts
  FROM public.user_privacy_preferences
  WHERE user_id = v_caller;
  v_send_receipts := coalesce(v_send_receipts, true);

  SELECT coalesce(request_status, 'accepted')
  INTO v_req_status
  FROM public.conversations
  WHERE id = p_conversation_id;

  IF v_send_receipts AND v_req_status = 'accepted' THEN
    UPDATE public.private_messages pm
    SET status = 'read', updated_at = now()
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

-- Update get_my_conversations_summary to surface retention_policy & retention_updated_at
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
-- 6. CONTENT-FREE DELETION AUDIT, BATCH EXPIRATION & OBSERVABILITY METRICS
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.chat_retention_deletion_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  conversation_id uuid,
  message_id uuid NOT NULL,
  retention_policy text,
  had_media boolean NOT NULL DEFAULT false,
  media_bytes bigint NOT NULL DEFAULT 0 CHECK (media_bytes >= 0),
  expired_at timestamptz NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_retention_audit_processed_idx
  ON public.chat_retention_deletion_audit (processed_at DESC);

ALTER TABLE public.chat_retention_deletion_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_retention_deletion_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.chat_retention_deletion_audit TO service_role;

DROP POLICY IF EXISTS "Admins read chat retention deletion audit" ON public.chat_retention_deletion_audit;
CREATE POLICY "Admins read chat retention deletion audit" ON public.chat_retention_deletion_audit
  FOR SELECT TO authenticated
  USING (public.is_ping_admin());

-- Idempotent batched private-message expiration (zero full-table scans, SKIP LOCKED)
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

    IF v_msg.media_url IS NOT NULL THEN
      SELECT coalesce(ma.derivative_keys, '{}'::text[])
      INTO v_derivatives
      FROM public.media_assets ma
      WHERE ma.object_key = v_msg.media_url OR ma.source_url = v_msg.media_url
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
      SET status = 'deleting', deleted_at = now(), updated_at = now()
      WHERE object_key = v_msg.media_url OR source_url = v_msg.media_url;
    END IF;

    -- Scrub content & media pointer while preserving structural tombstone for auditability
    UPDATE public.private_messages
    SET
      content = '',
      media_url = NULL,
      media_type = NULL,
      expired_at = now(),
      deleted_at = now(),
      updated_at = now()
    WHERE id = v_msg.id;

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

-- Claim pending or retryable deletion jobs atomically (idempotent, SKIP LOCKED)
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
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT id
    FROM public.media_deletion_queue
    WHERE status IN ('pending', 'failed')
      AND attempt_count < max_attempts
      AND next_retry_at <= now()
    ORDER BY next_retry_at ASC, created_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.media_deletion_queue q
  SET
    status = 'processing',
    attempt_count = q.attempt_count + 1
  FROM due
  WHERE q.id = due.id
  RETURNING q.*;
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
  v_attempts integer;
  v_backoff_minutes integer;
BEGIN
  IF p_success THEN
    UPDATE public.media_deletion_queue
    SET
      status = 'deleted',
      last_error = NULL,
      processed_at = now()
    WHERE id = p_job_id;
  ELSE
    SELECT attempt_count INTO v_attempts FROM public.media_deletion_queue WHERE id = p_job_id;
    v_backoff_minutes := least(720, (power(2, least(coalesce(v_attempts, 1), 8))::integer) * 5);
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

-- Observable storage & retention metrics (admin / service_role only)
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

  SELECT count(*)::bigint
  INTO v_failed_count
  FROM public.media_deletion_queue
  WHERE status = 'failed';

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
    'saved_media_count', v_saved_count,
    'saved_media_bytes', v_saved_bytes,
    'storage_by_plan', v_by_plan,
    'measured_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_chat_retention_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_chat_retention_metrics() TO authenticated, service_role;
