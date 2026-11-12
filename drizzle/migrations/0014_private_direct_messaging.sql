-- Migration: 0014_private_direct_messaging.sql
-- Private Direct Messaging: Conversations, Membership, Messages, Blocks & Realtime Delivery

-- 1. CONVERSATIONS TABLE
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL DEFAULT 'direct' CHECK (type IN ('direct', 'group')),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_message_preview text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversations_last_msg_idx ON public.conversations (last_message_at DESC);
CREATE INDEX IF NOT EXISTS conversations_type_idx ON public.conversations (type);

-- 2. CONVERSATION MEMBERS TABLE
CREATE TABLE IF NOT EXISTS public.conversation_members (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz NOT NULL DEFAULT now(),
  is_muted boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  hidden_at timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS conversation_members_user_idx ON public.conversation_members (user_id, last_read_at DESC);
CREATE INDEX IF NOT EXISTS conversation_members_conv_idx ON public.conversation_members (conversation_id);

-- 3. PRIVATE MESSAGES TABLE
CREATE TABLE IF NOT EXISTS public.private_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content text NOT NULL,
  media_url text,
  media_type text CHECK (media_type IS NULL OR media_type IN ('image', 'video', 'audio', 'document')),
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sending', 'sent', 'delivered', 'read', 'failed')),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT private_messages_content_check CHECK (
    deleted_at IS NOT NULL OR char_length(btrim(content)) BETWEEN 1 AND 5000 OR media_url IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS private_messages_conv_created_idx ON public.private_messages (conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS private_messages_sender_idx ON public.private_messages (sender_id);

-- 4. USER BLOCKS TABLE
CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_not_self CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS user_blocks_blocker_idx ON public.user_blocks (blocker_id);
CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx ON public.user_blocks (blocked_id);

-- 5. ROW LEVEL SECURITY (Strict: Zero leaks to third parties)
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

-- Conversations RLS
CREATE POLICY "Members read own conversations" ON public.conversations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = id AND cm.user_id = auth.uid()
    )
  );

-- Conversation Members RLS
CREATE POLICY "Members read conversation members" ON public.conversation_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.conversation_members cm2
      WHERE cm2.conversation_id = conversation_members.conversation_id
        AND cm2.user_id = auth.uid()
    )
  );

CREATE POLICY "Users update own conversation membership" ON public.conversation_members
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Private Messages RLS
CREATE POLICY "Members read conversation messages" ON public.private_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = conversation_id
        AND cm.user_id = auth.uid()
        AND (cm.hidden_at IS NULL OR private_messages.created_at > cm.hidden_at)
    )
  );

CREATE POLICY "Members insert conversation messages" ON public.private_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = conversation_id
        AND cm.user_id = auth.uid()
    )
    AND NOT EXISTS (
      -- Target cannot be someone who has blocked the sender or whom the sender blocked
      SELECT 1 FROM public.conversation_members other_member
      JOIN public.user_blocks b ON (
        (b.blocker_id = other_member.user_id AND b.blocked_id = auth.uid())
        OR (b.blocker_id = auth.uid() AND b.blocked_id = other_member.user_id)
      )
      WHERE other_member.conversation_id = conversation_id
        AND other_member.user_id <> auth.uid()
    )
  );

CREATE POLICY "Senders soft delete own messages" ON public.private_messages
  FOR UPDATE TO authenticated
  USING (sender_id = auth.uid())
  WITH CHECK (sender_id = auth.uid());

-- User Blocks RLS
CREATE POLICY "Users view own block list" ON public.user_blocks
  FOR SELECT TO authenticated
  USING (blocker_id = auth.uid());

CREATE POLICY "Users manage own blocks" ON public.user_blocks
  FOR INSERT TO authenticated
  WITH CHECK (blocker_id = auth.uid());

CREATE POLICY "Users delete own blocks" ON public.user_blocks
  FOR DELETE TO authenticated
  USING (blocker_id = auth.uid());

-- 6. SECURE RPC FUNCTIONS

-- RPC: Get or Create Direct (1-to-1) Conversation
CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(
  p_target_user_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_conv_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF v_caller = p_target_user_id THEN
    RAISE EXCEPTION 'Cannot start a direct conversation with yourself';
  END IF;

  -- Ensure target profile exists
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION 'Target user not found';
  END IF;

  -- Check if blocked
  IF EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = v_caller AND blocked_id = p_target_user_id)
       OR (blocker_id = p_target_user_id AND blocked_id = v_caller)
  ) THEN
    RAISE EXCEPTION 'Unable to initiate conversation with this user';
  END IF;

  -- Find existing 1-to-1 conversation between these two users
  SELECT cm1.conversation_id INTO v_conv_id
  FROM public.conversation_members cm1
  JOIN public.conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
  JOIN public.conversations c ON c.id = cm1.conversation_id
  WHERE c.type = 'direct'
    AND cm1.user_id = v_caller
    AND cm2.user_id = p_target_user_id
  LIMIT 1;

  -- If exists, unhide if it was hidden
  IF v_conv_id IS NOT NULL THEN
    UPDATE public.conversation_members
    SET hidden_at = NULL
    WHERE conversation_id = v_conv_id AND user_id = v_caller AND hidden_at IS NOT NULL;

    RETURN v_conv_id;
  END IF;

  -- Otherwise, create new conversation atomically
  INSERT INTO public.conversations (type, created_by, last_message_at, updated_at)
  VALUES ('direct', v_caller, now(), now())
  RETURNING id INTO v_conv_id;

  INSERT INTO public.conversation_members (conversation_id, user_id, role, last_read_at)
  VALUES
    (v_conv_id, v_caller, 'admin', now()),
    (v_conv_id, p_target_user_id, 'member', now());

  RETURN v_conv_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_or_create_direct_conversation(uuid) TO authenticated, service_role;

-- RPC: Send Private Message
CREATE OR REPLACE FUNCTION public.send_private_message(
  p_conversation_id uuid,
  p_content text,
  p_media_url text DEFAULT NULL,
  p_media_type text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_message public.private_messages;
  v_trimmed_content text := btrim(coalesce(p_content, ''));
  v_preview text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Verify membership
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_members
    WHERE conversation_id = p_conversation_id AND user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'You are not a participant in this conversation';
  END IF;

  -- Check block status with any other member
  IF EXISTS (
    SELECT 1 FROM public.conversation_members cm
    JOIN public.user_blocks b ON (
      (b.blocker_id = cm.user_id AND b.blocked_id = v_caller)
      OR (b.blocker_id = v_caller AND b.blocked_id = cm.user_id)
    )
    WHERE cm.conversation_id = p_conversation_id AND cm.user_id <> v_caller
  ) THEN
    RAISE EXCEPTION 'Cannot send message: communication is blocked';
  END IF;

  IF char_length(v_trimmed_content) = 0 AND p_media_url IS NULL THEN
    RAISE EXCEPTION 'Message cannot be empty';
  END IF;

  -- Insert message
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
    p_media_url,
    p_media_type,
    'sent'
  )
  RETURNING * INTO v_message;

  -- Generate preview
  IF char_length(v_trimmed_content) > 0 THEN
    v_preview := substr(v_trimmed_content, 1, 80);
  ELSIF p_media_type = 'image' THEN
    v_preview := '📷 Photo';
  ELSIF p_media_type = 'video' THEN
    v_preview := '🎥 Video';
  ELSIF p_media_type = 'audio' THEN
    v_preview := '🎵 Audio message';
  ELSE
    v_preview := '📎 Attachment';
  END IF;

  -- Update conversation last_message
  UPDATE public.conversations
  SET
    last_message_at = now(),
    last_message_preview = v_preview,
    updated_at = now()
  WHERE id = p_conversation_id;

  -- Update sender's last_read_at & unhide conversation for all members
  UPDATE public.conversation_members
  SET
    last_read_at = CASE WHEN user_id = v_caller THEN now() ELSE last_read_at END,
    hidden_at = NULL
  WHERE conversation_id = p_conversation_id;

  RETURN to_jsonb(v_message);
END;
$$;
GRANT EXECUTE ON FUNCTION public.send_private_message(uuid, text, text, text) TO authenticated, service_role;

-- RPC: Mark Conversation Read
CREATE OR REPLACE FUNCTION public.mark_conversation_read(
  p_conversation_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN RETURN; END IF;

  UPDATE public.conversation_members
  SET last_read_at = now()
  WHERE conversation_id = p_conversation_id AND user_id = v_caller;

  -- Update status of messages in conversation sent by others to 'read'
  UPDATE public.private_messages
  SET status = 'read', updated_at = now()
  WHERE conversation_id = p_conversation_id
    AND sender_id <> v_caller
    AND status IN ('sent', 'delivered');
END;
$$;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated, service_role;

-- RPC: Hide or Delete Conversation (Per-user retention)
CREATE OR REPLACE FUNCTION public.hide_or_delete_conversation(
  p_conversation_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN RETURN; END IF;

  UPDATE public.conversation_members
  SET hidden_at = now()
  WHERE conversation_id = p_conversation_id AND user_id = v_caller;
END;
$$;
GRANT EXECUTE ON FUNCTION public.hide_or_delete_conversation(uuid) TO authenticated, service_role;

-- RPC: Block / Unblock User
CREATE OR REPLACE FUNCTION public.block_user(
  p_target_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF v_caller = p_target_id THEN RAISE EXCEPTION 'Cannot block yourself'; END IF;

  INSERT INTO public.user_blocks (blocker_id, blocked_id)
  VALUES (v_caller, p_target_id)
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING;
END;
$$;
GRANT EXECUTE ON FUNCTION public.block_user(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.unblock_user(
  p_target_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN RETURN; END IF;

  DELETE FROM public.user_blocks
  WHERE blocker_id = v_caller AND blocked_id = p_target_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.unblock_user(uuid) TO authenticated, service_role;

-- RPC: Delete User Account (App Store & Google Play compliance)
CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Delete user profile (cascades to all owned pings, comments, moments, etc.)
  DELETE FROM public.profiles WHERE id = v_caller;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated, service_role;
