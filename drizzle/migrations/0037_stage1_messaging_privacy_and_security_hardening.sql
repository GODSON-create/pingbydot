-- ==============================================================================
-- Migration 0037: Stage 1 Database Repair & Messaging/Privacy Security Hardening
--
-- Forward-only, idempotent SQL migration. Not executed against production
-- without explicit operator approval.
--
-- Covers:
--   1. Idempotent forward-repair guarantees for migrations 0029, 0031, 0033, 0035
--      (conversation_members.role CHECK, notifications schema reconciliation,
--       admin_moderate comment moderation actions).
--   2. Approved Message-Request model (mutual follows -> accepted; non-mutual ->
--      one-time text-only pending request subject to recipient dm_permission;
--      accept / decline / block lifecycle; private profile unsolicited contact lock).
--   3. Server-side protection against group admin self-promotion, unauthorized
--      membership changes, private_messages tampering, sending after block,
--      violating only_admins_can_post, bypassing profile_visibility, and
--      ignoring read_receipts_enabled privacy preferences.
--   4. Hardened private DM attachment Storage RLS & conversation-bound paths.
-- ==============================================================================

-- ==============================================================================
-- 1. IDEMPOTENT FORWARD-REPAIR SAFETY NET (0029 / 0033 / 0035)
-- ==============================================================================

-- 1a. Ensure conversation_members.role permits 'owner', 'admin', 'member'
DO $$
DECLARE
  v_conname text;
BEGIN
  FOR v_conname IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.conversation_members'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.conversation_members DROP CONSTRAINT IF EXISTS %I', v_conname);
  END LOOP;
END $$;

ALTER TABLE public.conversation_members
  ADD CONSTRAINT conversation_members_role_check
  CHECK (role IN ('owner', 'admin', 'member'));

-- 1b. Reconcile public.notifications schema across 0005 & 0029/0033
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS ping_id uuid REFERENCES public.pings(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS comment_id uuid REFERENCES public.comments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS body text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS href text NOT NULL DEFAULT '/',
  ADD COLUMN IF NOT EXISTS group_key text;

DO $$
DECLARE
  v_conname text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'ping_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.notifications ALTER COLUMN ping_id DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'comment_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.notifications ALTER COLUMN comment_id DROP NOT NULL;
  END IF;

  FOR v_conname IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.notifications'::regclass
      AND contype = 'c'
      AND (pg_get_constraintdef(oid) ILIKE '%kind%' OR pg_get_constraintdef(oid) ILIKE '%title%')
  LOOP
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS %I', v_conname);
  END LOOP;
END $$;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check CHECK (
    kind IN (
      'ping_reply', 'comment_reply',
      'reply', 'mention', 'reaction', 'like', 'follow', 'message', 'message_request',
      'hub_activity', 'opportunity', 'application', 'event', 'system'
    )
  );

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_title_length_check CHECK (char_length(title) <= 180);

-- 1c. Re-assert admin_moderate with all 6 moderation actions + RBAC guard
CREATE OR REPLACE FUNCTION public.admin_moderate(
  _actor uuid,
  _target uuid,
  _action text,
  _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_admin_permission_for_user(_actor, 'content.moderate') THEN
    RAISE EXCEPTION 'Forbidden: content.moderate permission required';
  END IF;
  IF length(trim(_reason)) < 3 OR length(_reason) > 500 THEN
    RAISE EXCEPTION 'Reason required (3-500 characters)';
  END IF;
  IF _action = 'hide' THEN
    UPDATE public.pings SET hidden_at = now() WHERE id = _target;
  ELSIF _action = 'restore' THEN
    UPDATE public.pings SET hidden_at = NULL WHERE id = _target;
  ELSIF _action = 'resolve_report' THEN
    UPDATE public.reports SET resolved_at = now() WHERE id = _target;
  ELSIF _action = 'hide_comment' THEN
    UPDATE public.comments SET hidden_at = now() WHERE id = _target;
  ELSIF _action = 'restore_comment' THEN
    UPDATE public.comments SET hidden_at = NULL WHERE id = _target;
  ELSIF _action = 'resolve_comment_report' THEN
    UPDATE public.comment_reports SET resolved_at = now() WHERE id = _target;
  ELSE
    RAISE EXCEPTION 'Invalid moderation action';
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target record not found';
  END IF;
  INSERT INTO public.moderation_audit (actor_id, action, target_id, reason)
  VALUES (_actor, _action, _target, trim(_reason));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_moderate(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_moderate(uuid, uuid, text, text) TO service_role;

-- ==============================================================================
-- 2. MESSAGE REQUEST & PRIVACY PREFERENCES SCHEMA EXTENSIONS
-- ==============================================================================

ALTER TABLE public.user_privacy_preferences
  ADD COLUMN IF NOT EXISTS dm_permission text NOT NULL DEFAULT 'requests';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_privacy_preferences_dm_permission_check'
      AND conrelid = 'public.user_privacy_preferences'::regclass
  ) THEN
    ALTER TABLE public.user_privacy_preferences
      DROP CONSTRAINT user_privacy_preferences_dm_permission_check;
  END IF;
END $$;

ALTER TABLE public.user_privacy_preferences
  ADD CONSTRAINT user_privacy_preferences_dm_permission_check
  CHECK (dm_permission IN ('everyone', 'requests', 'mutual_follows', 'nobody'));

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS request_status text NOT NULL DEFAULT 'accepted',
  ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS request_recipient_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS request_responded_at timestamptz;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversations_request_status_check'
      AND conrelid = 'public.conversations'::regclass
  ) THEN
    ALTER TABLE public.conversations
      DROP CONSTRAINT conversations_request_status_check;
  END IF;
END $$;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_request_status_check
  CHECK (request_status IN ('accepted', 'pending', 'declined'));

CREATE INDEX IF NOT EXISTS conversations_pending_recipient_idx
  ON public.conversations (request_recipient_id, last_message_at DESC)
  WHERE request_status = 'pending';

-- ==============================================================================
-- 3. INTERNAL SECURITY HELPERS (MUTUAL FOLLOW, BLOCKS, PROFILE VISIBILITY)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.is_mutual_follow(
  _user_a uuid,
  _user_b uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _user_a IS NOT NULL
    AND _user_b IS NOT NULL
    AND _user_a <> _user_b
    AND EXISTS (
      SELECT 1 FROM public.follows
      WHERE follower_id = _user_a AND following_id = _user_b
    )
    AND EXISTS (
      SELECT 1 FROM public.follows
      WHERE follower_id = _user_b AND following_id = _user_a
    );
$$;

REVOKE ALL ON FUNCTION public.is_mutual_follow(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_mutual_follow(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.has_block_between(
  _user_a uuid,
  _user_b uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _user_a IS NOT NULL
    AND _user_b IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_blocks
      WHERE (blocker_id = _user_a AND blocked_id = _user_b)
         OR (blocker_id = _user_b AND blocked_id = _user_a)
    );
$$;

REVOKE ALL ON FUNCTION public.has_block_between(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_block_between(uuid, uuid) TO service_role;

-- Enforces profile_visibility ('public' | 'followers' | 'private') and blocks
-- using auth.uid() directly so callers cannot spoof another viewer's UUID.
CREATE OR REPLACE FUNCTION public.can_view_profile_content(
  _profile_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_viewer uuid := auth.uid();
  v_visibility text;
BEGIN
  IF _profile_id IS NULL THEN
    RETURN false;
  END IF;

  IF v_viewer IS NOT NULL AND v_viewer = _profile_id THEN
    RETURN true;
  END IF;

  IF v_viewer IS NOT NULL AND public.has_block_between(_profile_id, v_viewer) THEN
    RETURN false;
  END IF;

  SELECT coalesce(profile_visibility, 'public')
  INTO v_visibility
  FROM public.profiles
  WHERE id = _profile_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_visibility = 'public' THEN
    RETURN true;
  END IF;

  IF v_viewer IS NULL THEN
    RETURN false;
  END IF;

  IF v_visibility = 'followers' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.follows
      WHERE follower_id = v_viewer AND following_id = _profile_id
    );
  END IF;

  IF v_visibility = 'private' THEN
    RETURN public.is_mutual_follow(v_viewer, _profile_id);
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_view_profile_content(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_profile_content(uuid) TO anon, authenticated, service_role;

-- ==============================================================================
-- 4. PROFILE VISIBILITY RLS ENFORCEMENT (PINGS, CONNECTIONS, COMMENTS, MOMENTS)
-- ==============================================================================

DROP POLICY IF EXISTS "Pings are public" ON public.pings;
CREATE POLICY "Pings are public" ON public.pings
  FOR SELECT TO anon, authenticated
  USING (
    hidden_at IS NULL
    AND (scheduled_for IS NULL OR scheduled_for <= now())
    AND public.can_view_profile_content(pings.user_id)
  );

DROP POLICY IF EXISTS "Public connections are readable" ON public.profile_connections;
CREATE POLICY "Public connections are readable" ON public.profile_connections
  FOR SELECT TO anon, authenticated
  USING (
    is_public
    AND public.can_view_profile_content(profile_connections.user_id)
  );

DROP POLICY IF EXISTS "Comments are public" ON public.comments;
CREATE POLICY "Comments are public" ON public.comments
  FOR SELECT TO anon, authenticated
  USING (
    hidden_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.pings p
      WHERE p.id = comments.ping_id
        AND p.hidden_at IS NULL
        AND (p.scheduled_for IS NULL OR p.scheduled_for <= now())
        AND public.can_view_profile_content(p.user_id)
    )
  );

DROP POLICY IF EXISTS "Users comment as self" ON public.comments;
CREATE POLICY "Users comment as self" ON public.comments
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.pings p
      WHERE p.id = comments.ping_id
        AND p.hidden_at IS NULL
        AND (p.scheduled_for IS NULL OR p.scheduled_for <= now())
        AND public.can_view_profile_content(p.user_id)
    )
  );

DROP POLICY IF EXISTS "Public moments viewable by anyone" ON public.moments;
CREATE POLICY "Public moments viewable by anyone" ON public.moments
  FOR SELECT TO anon, authenticated
  USING (
    deleted_at IS NULL
    AND audience = 'public'
    AND public.can_view_profile_content(moments.author_id)
  );

DROP POLICY IF EXISTS "Restricted moments viewable by authorized users" ON public.moments;
CREATE POLICY "Restricted moments viewable by authorized users" ON public.moments
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL AND (
      author_id = (select auth.uid())
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.user_blocks b
          WHERE (b.blocker_id = moments.author_id AND b.blocked_id = (select auth.uid()))
             OR (b.blocker_id = (select auth.uid()) AND b.blocked_id = moments.author_id)
        )
        AND (
          (
            audience = 'followers' AND EXISTS (
              SELECT 1 FROM public.follows
              WHERE follower_id = (select auth.uid()) AND following_id = moments.author_id
            )
          )
          OR (
            audience = 'hub' AND hub_id IS NOT NULL
            AND public.hub_role(moments.hub_id, (select auth.uid())) IS NOT NULL
          )
          OR (
            audience = 'close_circle'
            AND public.is_close_circle_member(moments.author_id, (select auth.uid()))
          )
        )
      )
    )
  );

-- ==============================================================================
-- 5. MESSAGING TABLE LOCKDOWN: GRANTS, RLS & BEFORE TRIGGERS
-- ==============================================================================

-- 5a. Lock down public.conversations (mutations via SECURITY DEFINER RPCs only)
REVOKE INSERT, UPDATE, DELETE ON public.conversations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;

-- 5b. Lock down public.conversation_members (prevent self-promotion & rogue membership changes)
REVOKE INSERT, UPDATE, DELETE ON public.conversation_members FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conversation_members TO authenticated;
GRANT UPDATE (is_muted, is_archived, hidden_at, last_read_at) ON public.conversation_members TO authenticated;
GRANT ALL ON public.conversation_members TO service_role;

CREATE OR REPLACE FUNCTION public.guard_conversation_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP IN ('INSERT', 'DELETE') THEN
      RAISE EXCEPTION 'Conversation membership can only be modified through authorized RPCs'
        USING ERRCODE = '42501';
    END IF;

    IF TG_OP = 'UPDATE' THEN
      IF NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
         OR NEW.user_id IS DISTINCT FROM OLD.user_id
         OR NEW.role IS DISTINCT FROM OLD.role
         OR NEW.joined_at IS DISTINCT FROM OLD.joined_at THEN
        RAISE EXCEPTION 'Conversation membership role and identity fields cannot be modified directly'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_conversation_members() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_conversation_members ON public.conversation_members;
CREATE TRIGGER guard_conversation_members
  BEFORE INSERT OR UPDATE OR DELETE ON public.conversation_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_conversation_members();

-- 5c. Lock down legacy public.conversation_messages (prevent backdoor writes)
REVOKE INSERT, UPDATE, DELETE ON public.conversation_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conversation_messages TO authenticated;
GRANT ALL ON public.conversation_messages TO service_role;
DROP POLICY IF EXISTS "Participants insert conversation messages" ON public.conversation_messages;

-- 5d. Centralized server-side send guard (blocks, only_admins_can_post, message requests, path scoping)
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
BEGIN
  IF p_sender_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- Lock conversation row to serialize concurrent pending-request message sends
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

  -- Block check: strict two-way enforcement in direct conversations
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

  -- Group admin-only posting guard
  IF v_conv.type = 'group' AND coalesce(v_conv.only_admins_can_post, false) THEN
    IF v_member.role NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'Only group admins can post in this conversation' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Direct message request lifecycle guard
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

      -- Count ALL messages sent by requester (including soft-deleted) to enforce strict 1-message limit
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

  -- Private attachment path binding: prevent cross-conversation path injection or unsafe forwarding
  IF p_media_url IS NOT NULL AND btrim(p_media_url) <> '' THEN
    v_clean_path := btrim(p_media_url);
    IF v_clean_path !~* '^https?://' THEN
      IF v_clean_path LIKE 'storage://dm-attachments/%' THEN
        v_clean_path := substr(v_clean_path, char_length('storage://dm-attachments/') + 1);
      END IF;

      IF position('..' in v_clean_path) > 0
         OR left(v_clean_path, char_length(p_conversation_id::text) + 1) <> p_conversation_id::text || '/' THEN
        RAISE EXCEPTION 'Private attachment path must be scoped to this conversation'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN v_conv;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_can_send_to_conversation(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_can_send_to_conversation(uuid, uuid, text, text) TO service_role;

-- 5e. Lock down public.private_messages privileges, RLS & triggers
REVOKE UPDATE, DELETE ON public.private_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.private_messages TO authenticated;
GRANT UPDATE (content, deleted_at, edited_at, updated_at) ON public.private_messages TO authenticated;
GRANT ALL ON public.private_messages TO service_role;

CREATE OR REPLACE FUNCTION public.guard_private_message_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv public.conversations%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_user IN ('anon', 'authenticated') THEN
      IF NEW.sender_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Cannot spoof message sender' USING ERRCODE = '42501';
      END IF;

      PERFORM public.assert_can_send_to_conversation(
        NEW.conversation_id,
        NEW.sender_id,
        NEW.media_url,
        NEW.media_type
      );

      NEW.status := 'sent';
      NEW.is_pinned := false;
      NEW.deleted_at := NULL;
      NEW.edited_at := NULL;
      NEW.created_at := now();
      NEW.updated_at := now();
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
         OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'Message metadata, attachments, pin state, and delivery status are protected'
          USING ERRCODE = '42501';
      END IF;

      IF OLD.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Deleted messages cannot be restored or edited' USING ERRCODE = '42501';
      END IF;

      IF NEW.deleted_at IS NOT NULL THEN
        NEW.deleted_at := now();
        NEW.updated_at := now();
      ELSE
        SELECT * INTO v_conv FROM public.conversations WHERE id = OLD.conversation_id;
        IF v_conv.type = 'direct' AND (
          v_conv.request_status = 'declined'
          OR EXISTS (
            SELECT 1 FROM public.conversation_members other_cm
            WHERE other_cm.conversation_id = OLD.conversation_id
              AND other_cm.user_id <> OLD.sender_id
              AND public.has_block_between(OLD.sender_id, other_cm.user_id)
          )
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
DROP TRIGGER IF EXISTS guard_private_message_write ON public.private_messages;
CREATE TRIGGER guard_private_message_write
  BEFORE INSERT OR UPDATE ON public.private_messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_private_message_write();

DROP POLICY IF EXISTS "Members insert conversation messages" ON public.private_messages;
CREATE POLICY "Members insert conversation messages" ON public.private_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = (select auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.conversation_members cm
      JOIN public.conversations c ON c.id = cm.conversation_id
      WHERE cm.conversation_id = private_messages.conversation_id
        AND cm.user_id = (select auth.uid())
        AND (
          c.type <> 'group'
          OR NOT coalesce(c.only_admins_can_post, false)
          OR cm.role IN ('owner', 'admin')
        )
        AND (
          c.type <> 'direct'
          OR c.request_status = 'accepted'
          OR (
            c.request_status = 'pending'
            AND c.requested_by = (select auth.uid())
            AND private_messages.media_url IS NULL
            AND private_messages.media_type IS NULL
          )
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.conversations c
      JOIN public.conversation_members other_member ON other_member.conversation_id = c.id
      JOIN public.user_blocks b ON (
        (b.blocker_id = other_member.user_id AND b.blocked_id = (select auth.uid()))
        OR (b.blocker_id = (select auth.uid()) AND b.blocked_id = other_member.user_id)
      )
      WHERE c.id = private_messages.conversation_id
        AND c.type = 'direct'
        AND other_member.user_id <> (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Senders soft delete own messages" ON public.private_messages;
CREATE POLICY "Senders soft delete own messages" ON public.private_messages
  FOR UPDATE TO authenticated
  USING (sender_id = (select auth.uid()) AND deleted_at IS NULL)
  WITH CHECK (sender_id = (select auth.uid()));

-- ==============================================================================
-- 6. HARDENED MESSAGING & MESSAGE-REQUEST RPCs
-- ==============================================================================

-- 6a. Get or Create Direct Conversation (enforces blocks, private profiles, dm_permission, requests)
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
  v_target_vis text;
  v_dm_perm text;
  v_is_mutual boolean;
  v_conv public.conversations%ROWTYPE;
  v_conv_id uuid;
  v_initial_status text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF v_caller = p_target_user_id THEN
    RAISE EXCEPTION 'Cannot start a direct conversation with yourself';
  END IF;

  SELECT coalesce(profile_visibility, 'public')
  INTO v_target_vis
  FROM public.profiles
  WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user not found';
  END IF;

  IF public.has_block_between(v_caller, p_target_user_id) THEN
    RAISE EXCEPTION 'Unable to initiate conversation with this user' USING ERRCODE = '42501';
  END IF;

  v_is_mutual := public.is_mutual_follow(v_caller, p_target_user_id);

  -- Check existing 1-to-1 conversation
  SELECT c.* INTO v_conv
  FROM public.conversation_members cm1
  JOIN public.conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
  JOIN public.conversations c ON c.id = cm1.conversation_id
  WHERE c.type = 'direct'
    AND cm1.user_id = v_caller
    AND cm2.user_id = p_target_user_id
  LIMIT 1
  FOR UPDATE OF c;

  IF FOUND THEN
    IF v_conv.request_status = 'accepted' THEN
      UPDATE public.conversation_members
      SET hidden_at = NULL
      WHERE conversation_id = v_conv.id AND user_id = v_caller AND hidden_at IS NOT NULL;
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
        WHERE conversation_id = v_conv.id AND user_id = v_caller AND hidden_at IS NOT NULL;
      END IF;
      RETURN v_conv.id;
    END IF;

    -- request_status = 'declined'
    IF v_is_mutual OR v_conv.request_recipient_id = v_caller THEN
      UPDATE public.conversations
      SET
        request_status = 'accepted',
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

  -- New conversation: evaluate mutual-follow, private-profile, and recipient dm_permission rules
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
    created_by,
    request_status,
    requested_by,
    request_recipient_id,
    last_message_at,
    updated_at
  )
  VALUES (
    'direct',
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

  RETURN v_conv_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_direct_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_direct_conversation(uuid) TO authenticated, service_role;

-- 6b. Accept Message Request (recipient-only)
CREATE OR REPLACE FUNCTION public.accept_message_request(
  p_conversation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
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

  SELECT * INTO v_conv
  FROM public.conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND OR v_conv.type <> 'direct' THEN
    RAISE EXCEPTION 'Direct conversation not found';
  END IF;

  IF v_conv.request_status = 'accepted' THEN
    IF NOT public.is_conversation_member(p_conversation_id, v_caller) THEN
      RAISE EXCEPTION 'Not authorized for this conversation' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object('conversation_id', p_conversation_id, 'request_status', 'accepted');
  END IF;

  IF v_conv.request_status <> 'pending' OR v_conv.request_recipient_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'Only the recipient can accept a pending message request' USING ERRCODE = '42501';
  END IF;

  IF v_conv.requested_by IS NOT NULL AND public.has_block_between(v_caller, v_conv.requested_by) THEN
    RAISE EXCEPTION 'Cannot accept message request from a blocked user' USING ERRCODE = '42501';
  END IF;

  UPDATE public.conversations
  SET
    request_status = 'accepted',
    request_responded_at = now(),
    updated_at = now()
  WHERE id = p_conversation_id;

  UPDATE public.conversation_members
  SET hidden_at = NULL
  WHERE conversation_id = p_conversation_id;

  RETURN jsonb_build_object('conversation_id', p_conversation_id, 'request_status', 'accepted');
END;
$$;

REVOKE ALL ON FUNCTION public.accept_message_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_message_request(uuid) TO authenticated, service_role;

-- 6c. Decline Message Request (recipient-only)
CREATE OR REPLACE FUNCTION public.decline_message_request(
  p_conversation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
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

  SELECT * INTO v_conv
  FROM public.conversations
  WHERE id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND OR v_conv.type <> 'direct' THEN
    RAISE EXCEPTION 'Direct conversation not found';
  END IF;

  IF v_conv.request_status <> 'pending' OR v_conv.request_recipient_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'Only the recipient can decline a pending message request' USING ERRCODE = '42501';
  END IF;

  UPDATE public.conversations
  SET
    request_status = 'declined',
    request_responded_at = now(),
    updated_at = now()
  WHERE id = p_conversation_id;

  UPDATE public.conversation_members
  SET hidden_at = now()
  WHERE conversation_id = p_conversation_id
    AND user_id = v_caller;

  RETURN jsonb_build_object('conversation_id', p_conversation_id, 'request_status', 'declined');
END;
$$;

REVOKE ALL ON FUNCTION public.decline_message_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_message_request(uuid) TO authenticated, service_role;

-- 6d. Harden block_user to decline pending requests and hide direct chats with blocked user
CREATE OR REPLACE FUNCTION public.block_user(
  p_target_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF v_caller = p_target_id THEN
    RAISE EXCEPTION 'Cannot block yourself';
  END IF;

  INSERT INTO public.user_blocks (blocker_id, blocked_id)
  VALUES (v_caller, p_target_id)
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING;

  -- Decline any pending message request between blocker and target
  UPDATE public.conversations c
  SET
    request_status = 'declined',
    request_responded_at = now(),
    updated_at = now()
  WHERE c.type = 'direct'
    AND c.request_status = 'pending'
    AND EXISTS (
      SELECT 1 FROM public.conversation_members cm1
      JOIN public.conversation_members cm2 ON cm2.conversation_id = cm1.conversation_id
      WHERE cm1.conversation_id = c.id
        AND cm1.user_id = v_caller
        AND cm2.user_id = p_target_id
    );

  -- Hide direct conversations with the blocked user for the blocker
  UPDATE public.conversation_members cm
  SET hidden_at = now()
  FROM public.conversations c
  WHERE cm.conversation_id = c.id
    AND c.type = 'direct'
    AND cm.user_id = v_caller
    AND EXISTS (
      SELECT 1 FROM public.conversation_members cm2
      WHERE cm2.conversation_id = c.id
        AND cm2.user_id = p_target_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.block_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.block_user(uuid) TO authenticated, service_role;

-- 6e. Hardened send_private_message (enforces all guards + standardized Voice message preview)
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

  INSERT INTO public.private_messages (
    conversation_id,
    sender_id,
    content,
    media_url,
    media_type,
    status
  ) VALUES (
    p_conversation_id,
    v_caller,
    v_trimmed_content,
    v_clean_media,
    p_media_type,
    'sent'
  )
  RETURNING * INTO v_message;

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

  -- Notify recipient on initial pending message request
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

-- 6f. Hardened mark_conversation_read (strictly honors read_receipts_enabled & request_status)
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

  -- Always clear the caller's own unread counter
  UPDATE public.conversation_members
  SET last_read_at = now()
  WHERE conversation_id = p_conversation_id AND user_id = v_caller;

  -- Respect caller's read_receipts_enabled privacy preference (default true)
  SELECT coalesce(read_receipts_enabled, true)
  INTO v_send_receipts
  FROM public.user_privacy_preferences
  WHERE user_id = v_caller;
  v_send_receipts := coalesce(v_send_receipts, true);

  SELECT coalesce(request_status, 'accepted')
  INTO v_req_status
  FROM public.conversations
  WHERE id = p_conversation_id;

  -- Never emit read receipts when disabled or before a message request is accepted
  IF v_send_receipts AND v_req_status = 'accepted' THEN
    UPDATE public.private_messages
    SET status = 'read', updated_at = now()
    WHERE conversation_id = p_conversation_id
      AND sender_id <> v_caller
      AND status IN ('sent', 'delivered');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_conversation_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated, service_role;

-- 6g. Harden group creation & membership RPCs (blocks, private profiles, owner protection)
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

  RETURN v_conv_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_group_conversation(text, text, uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_group_conversation(text, text, uuid[], boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_group_member(
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
  v_target_vis text;
  v_target_dm text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversations c
    JOIN public.conversation_members cm ON cm.conversation_id = c.id
    WHERE c.id = p_conversation_id
      AND c.type = 'group'
      AND cm.user_id = v_uid
      AND cm.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Only group admins can add members' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(profile_visibility, 'public')
  INTO v_target_vis
  FROM public.profiles
  WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user not found';
  END IF;

  IF public.has_block_between(v_uid, p_target_user_id) THEN
    RAISE EXCEPTION 'Cannot add a blocked user to this group' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(dm_permission, 'requests')
  INTO v_target_dm
  FROM public.user_privacy_preferences
  WHERE user_id = p_target_user_id;
  v_target_dm := coalesce(v_target_dm, 'requests');

  IF (v_target_vis = 'private' OR v_target_dm = 'nobody')
     AND NOT public.is_mutual_follow(v_uid, p_target_user_id) THEN
    RAISE EXCEPTION 'This user restricts group invitations to mutual connections'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES (p_conversation_id, p_target_user_id, 'member')
  ON CONFLICT (conversation_id, user_id) DO UPDATE SET hidden_at = NULL;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.add_group_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_group_member(uuid, uuid) TO authenticated;

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

  DELETE FROM public.conversation_members
  WHERE conversation_id = p_conversation_id AND user_id = p_target_user_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_group_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_group_member(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_group_member_role(
  p_conversation_id uuid,
  p_target_user_id uuid,
  p_role text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_caller_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('admin', 'member') THEN
    RAISE EXCEPTION 'Role must be admin or member';
  END IF;
  IF p_target_user_id = v_uid THEN
    RAISE EXCEPTION 'Owners cannot change their own role directly' USING ERRCODE = '42501';
  END IF;

  SELECT cm.role INTO v_caller_role
  FROM public.conversations c
  JOIN public.conversation_members cm ON cm.conversation_id = c.id
  WHERE c.id = p_conversation_id
    AND c.type = 'group'
    AND cm.user_id = v_uid;

  IF v_caller_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only the group owner can promote or demote administrators'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.conversation_members
  SET role = p_role
  WHERE conversation_id = p_conversation_id
    AND user_id = p_target_user_id
    AND role <> 'owner';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target group member not found';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.update_group_member_role(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_group_member_role(uuid, uuid, text) TO authenticated;

-- 6h. Harden edit / pin / reaction RPCs against blocked or declined conversations
CREATE OR REPLACE FUNCTION public.edit_private_message(
  p_message_id uuid,
  p_content text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_clean text := trim(coalesce(p_content, ''));
  v_row public.private_messages%ROWTYPE;
  v_conv public.conversations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_clean) < 1 OR char_length(v_clean) > 5000 THEN
    RAISE EXCEPTION 'Message content must be between 1 and 5000 characters';
  END IF;

  SELECT * INTO v_row
  FROM public.private_messages
  WHERE id = p_message_id AND sender_id = v_uid AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found or not authorized to edit' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_conv FROM public.conversations WHERE id = v_row.conversation_id;
  IF v_conv.type = 'direct' AND (
    v_conv.request_status = 'declined'
    OR EXISTS (
      SELECT 1 FROM public.conversation_members other_cm
      WHERE other_cm.conversation_id = v_row.conversation_id
        AND other_cm.user_id <> v_uid
        AND public.has_block_between(v_uid, other_cm.user_id)
    )
  ) THEN
    RAISE EXCEPTION 'Cannot edit messages in a blocked or declined conversation'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.private_messages
  SET content = v_clean, edited_at = now(), updated_at = now()
  WHERE id = p_message_id
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.edit_private_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_private_message(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.toggle_pin_private_message(p_message_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_conv_id uuid;
  v_conv public.conversations%ROWTYPE;
  v_pinned boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT pm.conversation_id, pm.is_pinned
  INTO v_conv_id, v_pinned
  FROM public.private_messages pm
  WHERE pm.id = p_message_id AND pm.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found';
  END IF;

  SELECT * INTO v_conv
  FROM public.conversations
  WHERE id = v_conv_id;

  IF NOT FOUND OR NOT public.is_conversation_member(v_conv.id, v_uid) THEN
    RAISE EXCEPTION 'Not authorized for this conversation' USING ERRCODE = '42501';
  END IF;

  IF v_conv.type = 'direct' AND v_conv.request_status <> 'accepted' THEN
    RAISE EXCEPTION 'Accept the message request before pinning messages' USING ERRCODE = '42501';
  END IF;

  UPDATE public.private_messages
  SET is_pinned = NOT v_pinned, updated_at = now()
  WHERE id = p_message_id;

  RETURN jsonb_build_object('message_id', p_message_id, 'is_pinned', NOT v_pinned);
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_pin_private_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_pin_private_message(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.toggle_private_message_reaction(
  p_message_id uuid,
  p_emoji text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_conv public.conversations%ROWTYPE;
  v_removed boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT c.* INTO v_conv
  FROM public.private_messages pm
  JOIN public.conversations c ON c.id = pm.conversation_id
  WHERE pm.id = p_message_id AND pm.deleted_at IS NULL;

  IF NOT FOUND OR NOT public.is_conversation_member(v_conv.id, v_uid) THEN
    RAISE EXCEPTION 'Message unavailable';
  END IF;

  IF v_conv.type = 'direct' AND v_conv.request_status <> 'accepted' THEN
    RAISE EXCEPTION 'Accept the message request before reacting' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.private_message_reactions
  WHERE message_id = p_message_id AND user_id = v_uid AND emoji = trim(p_emoji);

  IF FOUND THEN
    v_removed := true;
  ELSE
    INSERT INTO public.private_message_reactions (message_id, user_id, emoji)
    VALUES (p_message_id, v_uid, trim(p_emoji))
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object('message_id', p_message_id, 'emoji', trim(p_emoji), 'active', NOT v_removed);
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_private_message_reaction(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_private_message_reaction(uuid, text) TO authenticated;

-- 6i. Enhanced get_my_conversations_summary (includes group metadata & message request state)
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

-- ==============================================================================
-- 7. HARDEN PRIVATE DM ATTACHMENT STORAGE RLS (BLOCK UPLOADS ON PENDING/BLOCKED)
-- ==============================================================================

DROP POLICY IF EXISTS "DM uploaders manage own files" ON storage.objects;
CREATE POLICY "DM uploaders manage own files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'dm-attachments'
    AND (storage.foldername(name))[2] = (select auth.uid())::text
    AND EXISTS (
      SELECT 1
      FROM public.conversation_members cm
      JOIN public.conversations c ON c.id = cm.conversation_id
      WHERE cm.conversation_id::text = (storage.foldername(name))[1]
        AND cm.user_id = (select auth.uid())
        AND cm.hidden_at IS NULL
        AND coalesce(c.request_status, 'accepted') = 'accepted'
        AND (
          c.type <> 'group'
          OR NOT coalesce(c.only_admins_can_post, false)
          OR cm.role IN ('owner', 'admin')
        )
        AND NOT (
          c.type = 'direct'
          AND EXISTS (
            SELECT 1
            FROM public.conversation_members other_cm
            JOIN public.user_blocks b ON (
              (b.blocker_id = other_cm.user_id AND b.blocked_id = (select auth.uid()))
              OR (b.blocker_id = (select auth.uid()) AND b.blocked_id = other_cm.user_id)
            )
            WHERE other_cm.conversation_id = c.id
              AND other_cm.user_id <> (select auth.uid())
          )
        )
    )
  );

DROP POLICY IF EXISTS "DM uploaders update own files" ON storage.objects;
CREATE POLICY "DM uploaders update own files" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'dm-attachments'
    AND (storage.foldername(name))[2] = (select auth.uid())::text
    AND EXISTS (
      SELECT 1
      FROM public.conversation_members cm
      JOIN public.conversations c ON c.id = cm.conversation_id
      WHERE cm.conversation_id::text = (storage.foldername(name))[1]
        AND cm.user_id = (select auth.uid())
        AND cm.hidden_at IS NULL
        AND coalesce(c.request_status, 'accepted') = 'accepted'
    )
  )
  WITH CHECK (
    bucket_id = 'dm-attachments'
    AND (storage.foldername(name))[2] = (select auth.uid())::text
    AND EXISTS (
      SELECT 1
      FROM public.conversation_members cm
      JOIN public.conversations c ON c.id = cm.conversation_id
      WHERE cm.conversation_id::text = (storage.foldername(name))[1]
        AND cm.user_id = (select auth.uid())
        AND cm.hidden_at IS NULL
        AND coalesce(c.request_status, 'accepted') = 'accepted'
    )
  );
