-- ==============================================================================
-- Migration 0013: Direct Messages (1:1 Conversations), Safety & V2 Features
-- ==============================================================================

-- 1. CONVERSATIONS TABLE
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_message_preview text
);

CREATE INDEX IF NOT EXISTS conversations_last_msg_idx ON public.conversations (last_message_at DESC);

-- 2. CONVERSATION MEMBERS TABLE
CREATE TABLE IF NOT EXISTS public.conversation_members (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  is_muted boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS conv_members_user_idx ON public.conversation_members (user_id, last_read_at);

-- 3. CONVERSATION MESSAGES TABLE
CREATE TABLE IF NOT EXISTS public.conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 5000),
  media_url text,
  reply_to_id uuid REFERENCES public.conversation_messages(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS conv_messages_feed_idx ON public.conversation_messages (conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS conv_messages_sender_idx ON public.conversation_messages (sender_id);

-- 4. USER BLOCKS TABLE
CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx ON public.user_blocks (blocked_id);

-- 5. ENABLE ROW LEVEL SECURITY
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

-- 6. PERMISSIONS & GRANTS (Strict least privilege, no public/anon access)
GRANT SELECT ON public.conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_messages TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.user_blocks TO authenticated;
GRANT ALL ON public.conversations, public.conversation_members, public.conversation_messages, public.user_blocks TO service_role;

-- 7. RLS POLICIES FOR CONVERSATIONS
CREATE POLICY "Conversations visible only to members" ON public.conversations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_members m
      WHERE m.conversation_id = conversations.id
        AND m.user_id = (select auth.uid())
    )
  );

-- 8. RLS POLICIES FOR CONVERSATION MEMBERS
CREATE POLICY "Members visible to conversation participants" ON public.conversation_members
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_members m
      WHERE m.conversation_id = conversation_members.conversation_id
        AND m.user_id = (select auth.uid())
    )
  );

CREATE POLICY "Users update own conversation membership" ON public.conversation_members
  FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- 9. RLS POLICIES FOR CONVERSATION MESSAGES
CREATE POLICY "Messages readable by conversation participants" ON public.conversation_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_members m
      WHERE m.conversation_id = conversation_messages.conversation_id
        AND m.user_id = (select auth.uid())
    )
  );

CREATE POLICY "Participants send messages when not blocked" ON public.conversation_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.conversation_members m
      WHERE m.conversation_id = conversation_messages.conversation_id
        AND m.user_id = (select auth.uid())
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.user_blocks b
      JOIN public.conversation_members other
        ON other.conversation_id = conversation_messages.conversation_id
        AND other.user_id <> (select auth.uid())
      WHERE (b.blocker_id = other.user_id AND b.blocked_id = (select auth.uid()))
         OR (b.blocker_id = (select auth.uid()) AND b.blocked_id = other.user_id)
    )
  );

CREATE POLICY "Senders update own messages" ON public.conversation_messages
  FOR UPDATE TO authenticated
  USING (sender_id = (select auth.uid()))
  WITH CHECK (sender_id = (select auth.uid()));

CREATE POLICY "Senders delete own messages" ON public.conversation_messages
  FOR DELETE TO authenticated
  USING (sender_id = (select auth.uid()));

-- 10. RLS POLICIES FOR USER BLOCKS
CREATE POLICY "Users read own blocks" ON public.user_blocks
  FOR SELECT TO authenticated
  USING (blocker_id = (select auth.uid()));

CREATE POLICY "Users insert own blocks" ON public.user_blocks
  FOR INSERT TO authenticated
  WITH CHECK (blocker_id = (select auth.uid()));

CREATE POLICY "Users remove own blocks" ON public.user_blocks
  FOR DELETE TO authenticated
  USING (blocker_id = (select auth.uid()));

-- 11. RPCS FOR DIRECT MESSAGING
CREATE OR REPLACE FUNCTION public.create_or_get_conversation(_recipient_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _caller uuid := auth.uid();
  _existing_conv uuid;
  _new_conv uuid;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF _caller = _recipient_id THEN RAISE EXCEPTION 'Cannot start conversation with yourself'; END IF;

  -- Ensure profile exists for recipient
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _recipient_id) THEN
    RAISE EXCEPTION 'Recipient does not exist';
  END IF;

  -- Verify not blocked
  IF EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = _recipient_id AND blocked_id = _caller)
       OR (blocker_id = _caller AND blocked_id = _recipient_id)
  ) THEN
    RAISE EXCEPTION 'Unable to connect with this user';
  END IF;

  -- Find existing 1:1 conversation
  SELECT m1.conversation_id INTO _existing_conv
  FROM public.conversation_members m1
  JOIN public.conversation_members m2 ON m1.conversation_id = m2.conversation_id
  WHERE m1.user_id = _caller AND m2.user_id = _recipient_id
    AND (SELECT count(*) FROM public.conversation_members WHERE conversation_id = m1.conversation_id) = 2
  LIMIT 1;

  IF _existing_conv IS NOT NULL THEN
    RETURN _existing_conv;
  END IF;

  -- Create conversation atomically
  INSERT INTO public.conversations (last_message_at)
  VALUES (now())
  RETURNING id INTO _new_conv;

  INSERT INTO public.conversation_members (conversation_id, user_id)
  VALUES (_new_conv, _caller), (_new_conv, _recipient_id);

  RETURN _new_conv;
END $$;
GRANT EXECUTE ON FUNCTION public.create_or_get_conversation(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.send_direct_message(
  _conversation_id uuid,
  _content text,
  _media_url text DEFAULT NULL,
  _reply_to_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _caller uuid := auth.uid();
  _clean text;
  _msg public.conversation_messages;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  _clean := btrim(_content);
  IF char_length(_clean) < 1 OR char_length(_clean) > 5000 THEN
    RAISE EXCEPTION 'Message must be between 1 and 5000 characters';
  END IF;

  -- Verify caller is a member
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_members
    WHERE conversation_id = _conversation_id AND user_id = _caller
  ) THEN
    RAISE EXCEPTION 'You are not a participant in this conversation';
  END IF;

  -- Verify neither participant blocked the other
  IF EXISTS (
    SELECT 1 FROM public.user_blocks b
    JOIN public.conversation_members other
      ON other.conversation_id = _conversation_id AND other.user_id <> _caller
    WHERE (b.blocker_id = other.user_id AND b.blocked_id = _caller)
       OR (b.blocker_id = _caller AND b.blocked_id = other.user_id)
  ) THEN
    RAISE EXCEPTION 'Cannot send message to this user';
  END IF;

  INSERT INTO public.conversation_messages (conversation_id, sender_id, content, media_url, reply_to_id)
  VALUES (_conversation_id, _caller, _clean, _media_url, _reply_to_id)
  RETURNING * INTO _msg;

  -- Update conversation metadata
  UPDATE public.conversations
  SET updated_at = now(),
      last_message_at = now(),
      last_message_preview = left(_clean, 100)
  WHERE id = _conversation_id;

  -- Update caller last_read_at
  UPDATE public.conversation_members
  SET last_read_at = now()
  WHERE conversation_id = _conversation_id AND user_id = _caller;

  RETURN to_jsonb(_msg);
END $$;
GRANT EXECUTE ON FUNCTION public.send_direct_message(uuid, text, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(_conversation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _caller uuid := auth.uid();
BEGIN
  IF _caller IS NULL THEN RETURN; END IF;
  UPDATE public.conversation_members
  SET last_read_at = now()
  WHERE conversation_id = _conversation_id AND user_id = _caller;
END $$;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.block_user(_target_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _caller uuid := auth.uid();
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF _caller = _target_id THEN RAISE EXCEPTION 'Cannot block yourself'; END IF;
  INSERT INTO public.user_blocks (blocker_id, blocked_id)
  VALUES (_caller, _target_id)
  ON CONFLICT DO NOTHING;
END $$;
GRANT EXECUTE ON FUNCTION public.block_user(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.unblock_user(_target_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _caller uuid := auth.uid();
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  DELETE FROM public.user_blocks WHERE blocker_id = _caller AND blocked_id = _target_id;
END $$;
GRANT EXECUTE ON FUNCTION public.unblock_user(uuid) TO authenticated, service_role;

-- 12. HUBS V2 RPCs: Delete Hub & Reactions
CREATE OR REPLACE FUNCTION public.delete_hub(_hub uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _caller uuid := auth.uid();
  _role text;
  _creator uuid;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  SELECT owner_id INTO _creator FROM public.hubs WHERE id = _hub;
  IF _creator IS NULL THEN RAISE EXCEPTION 'Hub not found'; END IF;

  SELECT role INTO _role FROM public.hub_members WHERE hub_id = _hub AND user_id = _caller;

  IF _caller <> _creator AND _role <> 'owner' AND NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _caller AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only the hub owner or a site admin can delete this hub';
  END IF;

  DELETE FROM public.hub_messages WHERE hub_id = _hub;
  DELETE FROM public.hub_pings WHERE hub_id = _hub;
  DELETE FROM public.hub_members WHERE hub_id = _hub;
  DELETE FROM public.hub_invites WHERE hub_id = _hub;
  DELETE FROM public.hubs WHERE id = _hub;
END $$;
GRANT EXECUTE ON FUNCTION public.delete_hub(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.toggle_hub_message_reaction(_message_id uuid, _reaction text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _caller uuid := auth.uid();
  _hub_id uuid;
  _reactions jsonb;
  _count int;
  _key text := btrim(_reaction);
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  SELECT hub_id, reactions INTO _hub_id, _reactions FROM public.hub_messages WHERE id = _message_id;
  IF _hub_id IS NULL THEN RAISE EXCEPTION 'Message not found'; END IF;

  IF public.hub_role(_hub_id, _caller) IS NULL THEN
    RAISE EXCEPTION 'Must be a member of the hub to react';
  END IF;

  _count := coalesce((_reactions->>_key)::int, 0);
  IF _count <= 0 THEN
    _reactions := jsonb_set(_reactions, ARRAY[_key], to_jsonb(1));
  ELSE
    _reactions := jsonb_set(_reactions, ARRAY[_key], to_jsonb(_count + 1));
  END IF;

  UPDATE public.hub_messages SET reactions = _reactions, updated_at = now() WHERE id = _message_id;
  RETURN _reactions;
END $$;
GRANT EXECUTE ON FUNCTION public.toggle_hub_message_reaction(uuid, text) TO authenticated, service_role;

-- 13. SIGNALS V2 RPC: Update Signal
CREATE OR REPLACE FUNCTION public.update_signal(
  _signal uuid,
  _name text,
  _tagline text,
  _description text,
  _website_url text,
  _avatar_url text,
  _institution_type text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _caller uuid := auth.uid();
  _role text;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  SELECT role INTO _role FROM public.signal_publishers WHERE signal_id = _signal AND user_id = _caller;

  IF _role <> 'admin' AND NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _caller AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only signal admins can edit this channel';
  END IF;

  UPDATE public.signals SET
    name = btrim(_name),
    tagline = coalesce(btrim(_tagline), ''),
    description = coalesce(btrim(_description), ''),
    website_url = _website_url,
    avatar_url = _avatar_url,
    institution_type = _institution_type,
    updated_at = now()
  WHERE id = _signal;
END $$;
GRANT EXECUTE ON FUNCTION public.update_signal(uuid, text, text, text, text, text, text) TO authenticated, service_role;

-- 14. HIGHLIGHTS V2 RPCs
CREATE OR REPLACE FUNCTION public.update_highlight(
  _highlight_id uuid,
  _title text,
  _cover_url text,
  _is_private boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _caller uuid := auth.uid();
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  UPDATE public.highlights
  SET title = btrim(_title),
      cover_url = _cover_url,
      is_private = coalesce(_is_private, false),
      updated_at = now()
  WHERE id = _highlight_id AND user_id = _caller;
END $$;
GRANT EXECUTE ON FUNCTION public.update_highlight(uuid, text, text, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.remove_moment_from_highlight(
  _highlight_id uuid,
  _moment_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _caller uuid := auth.uid();
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.highlights WHERE id = _highlight_id AND user_id = _caller) THEN
    RAISE EXCEPTION 'Highlight not found or permission denied';
  END IF;
  DELETE FROM public.highlight_items WHERE highlight_id = _highlight_id AND moment_id = _moment_id;
END $$;
GRANT EXECUTE ON FUNCTION public.remove_moment_from_highlight(uuid, uuid) TO authenticated, service_role;

-- 15. ENABLE REALTIME FOR DIRECT MESSAGING
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_messages;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_members;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;


-- 16. COMPATIBILITY ALIASES FOR MESSAGING RPCS & VIEWS
CREATE OR REPLACE VIEW public.private_messages AS
  SELECT id, conversation_id, sender_id, content, media_url, NULL::text AS media_type, 'sent'::text AS status, deleted_at, created_at, updated_at
  FROM public.conversation_messages;

CREATE OR REPLACE FUNCTION public.get_or_create_conversation(p_recipient_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.create_or_get_conversation(p_recipient_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_or_create_conversation(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_conversation(p_recipient_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.create_or_get_conversation(p_recipient_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_conversation(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.send_private_message(
  p_conversation_id uuid,
  p_content text,
  p_media_url text DEFAULT NULL,
  p_media_type text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.send_direct_message(p_conversation_id, p_content, p_media_url, NULL);
END;
$$;
GRANT EXECUTE ON FUNCTION public.send_private_message(uuid, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.send_message(
  p_conversation_id uuid,
  p_content text,
  p_media_url text DEFAULT NULL,
  p_media_type text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.send_direct_message(p_conversation_id, p_content, p_media_url, NULL);
END;
$$;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.hide_or_delete_conversation(p_conversation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN RETURN; END IF;
  UPDATE public.conversation_members
  SET is_archived = true
  WHERE conversation_id = p_conversation_id AND user_id = v_caller;
END;
$$;
GRANT EXECUTE ON FUNCTION public.hide_or_delete_conversation(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  DELETE FROM public.profiles WHERE id = v_caller;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated, service_role;
