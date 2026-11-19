-- 0029_phase2_social_messaging_hubs_signals_notifications.sql
-- Phase 2: Social Network, Communication, Hubs Events, Signals Opportunities & Notification Centre.
-- Forward-only, idempotent, strict RLS (zero open USING (true) policies).

-- ============================================================================
-- 1. SOCIAL GRAPH: SAVED ACCOUNTS & TOPIC FOLLOWS (Phase 2.1)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_saved_accounts (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, target_user_id),
  CONSTRAINT user_saved_accounts_no_self CHECK (user_id <> target_user_id)
);

ALTER TABLE public.user_saved_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own saved accounts" ON public.user_saved_accounts;
CREATE POLICY "Users read own saved accounts" ON public.user_saved_accounts
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users save accounts" ON public.user_saved_accounts;
CREATE POLICY "Users save accounts" ON public.user_saved_accounts
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND user_id <> target_user_id);

DROP POLICY IF EXISTS "Users unsave accounts" ON public.user_saved_accounts;
CREATE POLICY "Users unsave accounts" ON public.user_saved_accounts
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.user_topic_follows (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  topic_slug text NOT NULL CHECK (char_length(trim(topic_slug)) BETWEEN 2 AND 48),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, topic_slug)
);

ALTER TABLE public.user_topic_follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own topic follows" ON public.user_topic_follows;
CREATE POLICY "Users read own topic follows" ON public.user_topic_follows
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users follow topics" ON public.user_topic_follows;
CREATE POLICY "Users follow topics" ON public.user_topic_follows
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users unfollow topics" ON public.user_topic_follows;
CREATE POLICY "Users unfollow topics" ON public.user_topic_follows
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================================
-- 2. PING INTERACTIONS: SCHEDULING, TAGS, MULTI-REACTIONS & POLLS (Phase 2.2)
-- ============================================================================

ALTER TABLE public.pings
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS hashtags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS mentions text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS pings_hashtags_gin_idx ON public.pings USING gin (hashtags);
CREATE INDEX IF NOT EXISTS pings_scheduled_for_idx ON public.pings (scheduled_for) WHERE scheduled_for IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ping_reactions (
  ping_id uuid NOT NULL REFERENCES public.pings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reaction text NOT NULL CHECK (reaction IN ('like', 'fire', 'insightful', 'celebrate', 'support')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ping_id, user_id, reaction)
);

CREATE INDEX IF NOT EXISTS ping_reactions_ping_idx ON public.ping_reactions (ping_id);
ALTER TABLE public.ping_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Reactions on visible pings readable" ON public.ping_reactions;
CREATE POLICY "Reactions on visible pings readable" ON public.ping_reactions
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pings p
      WHERE p.id = ping_reactions.ping_id AND p.hidden_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Authenticated users manage own ping reactions" ON public.ping_reactions;
CREATE POLICY "Authenticated users manage own ping reactions" ON public.ping_reactions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Authenticated users remove own ping reactions" ON public.ping_reactions;
CREATE POLICY "Authenticated users remove own ping reactions" ON public.ping_reactions
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.toggle_ping_reaction(
  _ping_id uuid,
  _reaction text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_removed boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _reaction NOT IN ('like', 'fire', 'insightful', 'celebrate', 'support') THEN
    RAISE EXCEPTION 'Unsupported reaction type';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.pings WHERE id = _ping_id AND hidden_at IS NULL) THEN
    RAISE EXCEPTION 'Ping not found';
  END IF;

  DELETE FROM public.ping_reactions
  WHERE ping_id = _ping_id AND user_id = v_uid AND reaction = _reaction;

  IF FOUND THEN
    v_removed := true;
  ELSE
    INSERT INTO public.ping_reactions (ping_id, user_id, reaction)
    VALUES (_ping_id, v_uid, _reaction)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'ping_id', _ping_id,
    'reaction', _reaction,
    'active', NOT v_removed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_ping_reaction(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_ping_reaction(uuid, text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.ping_polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ping_id uuid NOT NULL UNIQUE REFERENCES public.pings(id) ON DELETE CASCADE,
  question text NOT NULL CHECK (char_length(trim(question)) BETWEEN 3 AND 240),
  expires_at timestamptz,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ping_poll_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES public.ping_polls(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(trim(label)) BETWEEN 1 AND 120),
  position int NOT NULL DEFAULT 0 CHECK (position >= 0 AND position <= 10)
);

CREATE INDEX IF NOT EXISTS ping_poll_options_poll_idx ON public.ping_poll_options (poll_id, position);

CREATE TABLE IF NOT EXISTS public.ping_poll_votes (
  poll_id uuid NOT NULL REFERENCES public.ping_polls(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES public.ping_poll_options(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, user_id)
);

CREATE INDEX IF NOT EXISTS ping_poll_votes_option_idx ON public.ping_poll_votes (option_id);

ALTER TABLE public.ping_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ping_poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ping_poll_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Polls on visible pings readable" ON public.ping_polls;
CREATE POLICY "Polls on visible pings readable" ON public.ping_polls
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (SELECT 1 FROM public.pings p WHERE p.id = ping_polls.ping_id AND p.hidden_at IS NULL)
  );

DROP POLICY IF EXISTS "Ping authors create polls" ON public.ping_polls;
CREATE POLICY "Ping authors create polls" ON public.ping_polls
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND EXISTS (SELECT 1 FROM public.pings p WHERE p.id = ping_polls.ping_id AND p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Poll options readable for visible polls" ON public.ping_poll_options;
CREATE POLICY "Poll options readable for visible polls" ON public.ping_poll_options
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ping_polls pp
      JOIN public.pings p ON p.id = pp.ping_id
      WHERE pp.id = ping_poll_options.poll_id AND p.hidden_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Poll creators insert options" ON public.ping_poll_options;
CREATE POLICY "Poll creators insert options" ON public.ping_poll_options
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ping_polls pp
      WHERE pp.id = ping_poll_options.poll_id AND pp.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Poll votes readable for visible polls" ON public.ping_poll_votes;
CREATE POLICY "Poll votes readable for visible polls" ON public.ping_poll_votes
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ping_polls pp
      JOIN public.pings p ON p.id = pp.ping_id
      WHERE pp.id = ping_poll_votes.poll_id AND p.hidden_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Authenticated users vote once per poll" ON public.ping_poll_votes;
CREATE POLICY "Authenticated users vote once per poll" ON public.ping_poll_votes
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.vote_ping_poll(
  _poll_id uuid,
  _option_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_expires timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT expires_at INTO v_expires FROM public.ping_polls WHERE id = _poll_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Poll not found';
  END IF;

  IF v_expires IS NOT NULL AND v_expires < now() THEN
    RAISE EXCEPTION 'This poll has closed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.ping_poll_options WHERE id = _option_id AND poll_id = _poll_id
  ) THEN
    RAISE EXCEPTION 'Invalid poll option';
  END IF;

  INSERT INTO public.ping_poll_votes (poll_id, option_id, user_id)
  VALUES (_poll_id, _option_id, v_uid)
  ON CONFLICT (poll_id, user_id)
  DO UPDATE SET option_id = EXCLUDED.option_id, created_at = now();

  RETURN jsonb_build_object('poll_id', _poll_id, 'option_id', _option_id);
END;
$$;

REVOKE ALL ON FUNCTION public.vote_ping_poll(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vote_ping_poll(uuid, uuid) TO authenticated;

-- ============================================================================
-- 3. DIRECT MESSAGING & GROUP COMMUNICATION (Phase 2.5 & 2.6)
-- ============================================================================

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS only_admins_can_post boolean NOT NULL DEFAULT false;

ALTER TABLE public.private_messages
  ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES public.private_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS forwarded_from_id uuid,
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

CREATE INDEX IF NOT EXISTS private_messages_pinned_idx
  ON public.private_messages (conversation_id)
  WHERE is_pinned = true AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.private_message_reactions (
  message_id uuid NOT NULL REFERENCES public.private_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (char_length(trim(emoji)) BETWEEN 1 AND 16),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

ALTER TABLE public.private_message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Conversation members view message reactions" ON public.private_message_reactions;
CREATE POLICY "Conversation members view message reactions" ON public.private_message_reactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.private_messages pm
      WHERE pm.id = private_message_reactions.message_id
        AND public.is_conversation_member(pm.conversation_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Conversation members add own reactions" ON public.private_message_reactions;
CREATE POLICY "Conversation members add own reactions" ON public.private_message_reactions
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.private_messages pm
      WHERE pm.id = private_message_reactions.message_id
        AND public.is_conversation_member(pm.conversation_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Conversation members remove own reactions" ON public.private_message_reactions;
CREATE POLICY "Conversation members remove own reactions" ON public.private_message_reactions
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.saved_messages (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.private_messages(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);

ALTER TABLE public.saved_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own saved messages" ON public.saved_messages;
CREATE POLICY "Users read own saved messages" ON public.saved_messages
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users save accessible messages" ON public.saved_messages;
CREATE POLICY "Users save accessible messages" ON public.saved_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.private_messages pm
      WHERE pm.id = saved_messages.message_id
        AND public.is_conversation_member(pm.conversation_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users unsave own messages" ON public.saved_messages;
CREATE POLICY "Users unsave own messages" ON public.saved_messages
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

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
  v_trimmed text := trim(coalesce(p_content, ''));
  v_row public.private_messages%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF char_length(v_trimmed) < 1 OR char_length(v_trimmed) > 5000 THEN
    RAISE EXCEPTION 'Message content must be between 1 and 5000 characters';
  END IF;

  UPDATE public.private_messages
  SET content = v_trimmed, edited_at = now(), updated_at = now()
  WHERE id = p_message_id AND sender_id = v_uid AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found or you are not the sender';
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.edit_private_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_private_message(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.toggle_pin_private_message(
  p_message_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_conv_id uuid;
  v_pinned boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT conversation_id, is_pinned INTO v_conv_id, v_pinned
  FROM public.private_messages
  WHERE id = p_message_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found';
  END IF;

  IF NOT public.is_conversation_member(v_conv_id, v_uid) THEN
    RAISE EXCEPTION 'Not authorized for this conversation';
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
  v_conv_id uuid;
  v_removed boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT conversation_id INTO v_conv_id
  FROM public.private_messages
  WHERE id = p_message_id AND deleted_at IS NULL;

  IF NOT FOUND OR NOT public.is_conversation_member(v_conv_id, v_uid) THEN
    RAISE EXCEPTION 'Message unavailable';
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

CREATE OR REPLACE FUNCTION public.update_conversation_member_prefs(
  p_conversation_id uuid,
  p_is_muted boolean DEFAULT NULL,
  p_is_archived boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_muted boolean;
  v_archived boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.conversation_members
  SET
    is_muted = coalesce(p_is_muted, is_muted),
    is_archived = coalesce(p_is_archived, is_archived)
  WHERE conversation_id = p_conversation_id AND user_id = v_uid
  RETURNING is_muted, is_archived INTO v_muted, v_archived;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation membership not found';
  END IF;

  RETURN jsonb_build_object(
    'conversation_id', p_conversation_id,
    'is_muted', v_muted,
    'is_archived', v_archived
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_conversation_member_prefs(uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_conversation_member_prefs(uuid, boolean, boolean) TO authenticated;

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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF char_length(v_clean_title) < 2 OR char_length(v_clean_title) > 80 THEN
    RAISE EXCEPTION 'Group title must be between 2 and 80 characters';
  END IF;

  INSERT INTO public.conversations (type, title, description, only_admins_can_post, last_message_at)
  VALUES ('group', v_clean_title, trim(coalesce(p_description, '')), coalesce(p_only_admins_can_post, false), now())
  RETURNING id INTO v_conv_id;

  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES (v_conv_id, v_uid, 'owner')
  ON CONFLICT DO NOTHING;

  FOREACH v_member IN ARRAY coalesce(p_member_ids, '{}'::uuid[]) LOOP
    IF v_member IS NOT NULL AND v_member <> v_uid THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.user_blocks
        WHERE (blocker_id = v_uid AND blocked_id = v_member)
           OR (blocker_id = v_member AND blocked_id = v_uid)
      ) THEN
        INSERT INTO public.conversation_members (conversation_id, user_id, role)
        VALUES (v_conv_id, v_member, 'member')
        ON CONFLICT DO NOTHING;
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversations c
    JOIN public.conversation_members cm ON cm.conversation_id = c.id
    WHERE c.id = p_conversation_id
      AND c.type = 'group'
      AND cm.user_id = v_uid
      AND cm.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Only group admins can add members';
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_target_user_id <> v_uid AND NOT EXISTS (
    SELECT 1 FROM public.conversations c
    JOIN public.conversation_members cm ON cm.conversation_id = c.id
    WHERE c.id = p_conversation_id
      AND c.type = 'group'
      AND cm.user_id = v_uid
      AND cm.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Only group admins can remove other members';
  END IF;

  DELETE FROM public.conversation_members
  WHERE conversation_id = p_conversation_id AND user_id = p_target_user_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_group_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_group_member(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_group_conversation(
  p_conversation_id uuid,
  p_title text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_only_admins_can_post boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.conversations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversations c
    JOIN public.conversation_members cm ON cm.conversation_id = c.id
    WHERE c.id = p_conversation_id
      AND c.type = 'group'
      AND cm.user_id = v_uid
      AND cm.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Only group admins can update group details';
  END IF;

  UPDATE public.conversations
  SET
    title = coalesce(NULLIF(trim(p_title), ''), title),
    description = coalesce(p_description, description),
    only_admins_can_post = coalesce(p_only_admins_can_post, only_admins_can_post),
    updated_at = now()
  WHERE id = p_conversation_id
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.update_group_conversation(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_group_conversation(uuid, text, text, boolean) TO authenticated;

-- ============================================================================
-- 4. HUBS EVENTS & EXTENSIBLE MEMBERSHIP ARCHITECTURE (Phase 2.7)
-- ============================================================================

ALTER TABLE public.hubs
  ADD COLUMN IF NOT EXISTS membership_model text NOT NULL DEFAULT 'free'
    CHECK (membership_model IN ('free', 'paid_planned', 'sponsored', 'institutional', 'learning', 'corporate', 'association', 'local'));

CREATE TABLE IF NOT EXISTS public.hub_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  creator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 3 AND 140),
  description text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  location_label text NOT NULL DEFAULT 'Online on Ping',
  meeting_url text,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hub_events_hub_starts_idx ON public.hub_events (hub_id, starts_at ASC);

CREATE TABLE IF NOT EXISTS public.hub_event_rsvps (
  event_id uuid NOT NULL REFERENCES public.hub_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'going' CHECK (status IN ('going', 'interested', 'not_going')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

ALTER TABLE public.hub_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_event_rsvps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hub events readable by authorized viewers" ON public.hub_events;
CREATE POLICY "Hub events readable by authorized viewers" ON public.hub_events
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hubs h
      WHERE h.id = hub_events.hub_id
        AND (
          h.access = 'public'
          OR (
            auth.uid() IS NOT NULL
            AND (
              h.owner_id = auth.uid()
              OR EXISTS (
                SELECT 1 FROM public.hub_members hm
                WHERE hm.hub_id = h.id AND hm.user_id = auth.uid() AND hm.status = 'active'
              )
            )
          )
        )
    )
  );

DROP POLICY IF EXISTS "Hub staff create events" ON public.hub_events;
CREATE POLICY "Hub staff create events" ON public.hub_events
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = creator_id
    AND EXISTS (
      SELECT 1 FROM public.hubs h
      WHERE h.id = hub_events.hub_id
        AND (
          h.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.hub_members hm
            WHERE hm.hub_id = h.id AND hm.user_id = auth.uid()
              AND hm.status = 'active' AND hm.role IN ('owner', 'admin', 'moderator')
          )
        )
    )
  );

DROP POLICY IF EXISTS "Hub staff update events" ON public.hub_events;
CREATE POLICY "Hub staff update events" ON public.hub_events
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = creator_id
    OR EXISTS (
      SELECT 1 FROM public.hubs h WHERE h.id = hub_events.hub_id AND h.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Event RSVPs readable for accessible events" ON public.hub_event_rsvps;
CREATE POLICY "Event RSVPs readable for accessible events" ON public.hub_event_rsvps
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hub_events e
      JOIN public.hubs h ON h.id = e.hub_id
      WHERE e.id = hub_event_rsvps.event_id
        AND (
          h.access = 'public'
          OR h.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.hub_members hm
            WHERE hm.hub_id = h.id AND hm.user_id = auth.uid() AND hm.status = 'active'
          )
        )
    )
  );

DROP POLICY IF EXISTS "Users manage own event RSVPs" ON public.hub_event_rsvps;
CREATE POLICY "Users manage own event RSVPs" ON public.hub_event_rsvps
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own event RSVPs" ON public.hub_event_rsvps;
CREATE POLICY "Users update own event RSVPs" ON public.hub_event_rsvps
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own event RSVPs" ON public.hub_event_rsvps;
CREATE POLICY "Users delete own event RSVPs" ON public.hub_event_rsvps
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================================
-- 5. SIGNALS OPPORTUNITY INFRASTRUCTURE (Phase 2.8)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.signal_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  signal_id uuid REFERENCES public.signals(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (
    category IN (
      'funding', 'investment', 'jobs', 'recruitment', 'partnerships',
      'procurement', 'grants', 'competitions', 'mentorship', 'services',
      'research', 'events', 'business_proposals', 'product_requests'
    )
  ),
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 4 AND 160),
  description text NOT NULL CHECK (char_length(trim(description)) BETWEEN 10 AND 4000),
  location text NOT NULL DEFAULT 'Remote / Global',
  eligibility text NOT NULL DEFAULT '',
  required_info text NOT NULL DEFAULT '',
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS signal_opportunities_category_status_idx
  ON public.signal_opportunities (category, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.signal_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES public.signal_opportunities(id) ON DELETE CASCADE,
  applicant_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cover_note text NOT NULL CHECK (char_length(trim(cover_note)) BETWEEN 5 AND 3000),
  portfolio_url text,
  status text NOT NULL DEFAULT 'submitted' CHECK (
    status IN ('submitted', 'reviewing', 'shortlisted', 'accepted', 'declined', 'withdrawn')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, applicant_id)
);

CREATE INDEX IF NOT EXISTS signal_applications_opportunity_idx
  ON public.signal_applications (opportunity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS signal_applications_applicant_idx
  ON public.signal_applications (applicant_id, created_at DESC);

ALTER TABLE public.signal_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signal_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Open opportunities readable by anyone" ON public.signal_opportunities;
CREATE POLICY "Open opportunities readable by anyone" ON public.signal_opportunities
  FOR SELECT TO anon, authenticated
  USING (status = 'open' OR (auth.uid() IS NOT NULL AND publisher_id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated users publish opportunities" ON public.signal_opportunities;
CREATE POLICY "Authenticated users publish opportunities" ON public.signal_opportunities
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = publisher_id);

DROP POLICY IF EXISTS "Publishers update own opportunities" ON public.signal_opportunities;
CREATE POLICY "Publishers update own opportunities" ON public.signal_opportunities
  FOR UPDATE TO authenticated
  USING (auth.uid() = publisher_id)
  WITH CHECK (auth.uid() = publisher_id);

DROP POLICY IF EXISTS "Applicants and publishers view applications" ON public.signal_applications;
CREATE POLICY "Applicants and publishers view applications" ON public.signal_applications
  FOR SELECT TO authenticated
  USING (
    auth.uid() = applicant_id
    OR EXISTS (
      SELECT 1 FROM public.signal_opportunities so
      WHERE so.id = signal_applications.opportunity_id AND so.publisher_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Authenticated users submit own applications" ON public.signal_applications;
CREATE POLICY "Authenticated users submit own applications" ON public.signal_applications
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = applicant_id);

DROP POLICY IF EXISTS "Applicants withdraw or publishers review applications" ON public.signal_applications;
CREATE POLICY "Applicants withdraw or publishers review applications" ON public.signal_applications
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = applicant_id
    OR EXISTS (
      SELECT 1 FROM public.signal_opportunities so
      WHERE so.id = signal_applications.opportunity_id AND so.publisher_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.submit_signal_application(
  p_opportunity_id uuid,
  p_cover_note text,
  p_portfolio_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_opp public.signal_opportunities%ROWTYPE;
  v_row public.signal_applications%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_opp FROM public.signal_opportunities WHERE id = p_opportunity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opportunity not found';
  END IF;
  IF v_opp.publisher_id = v_uid THEN
    RAISE EXCEPTION 'You cannot apply to your own opportunity';
  END IF;
  IF v_opp.status <> 'open' OR (v_opp.expires_at IS NOT NULL AND v_opp.expires_at < now()) THEN
    RAISE EXCEPTION 'This opportunity is no longer accepting applications';
  END IF;

  INSERT INTO public.signal_applications (opportunity_id, applicant_id, cover_note, portfolio_url, status)
  VALUES (p_opportunity_id, v_uid, trim(p_cover_note), NULLIF(trim(coalesce(p_portfolio_url, '')), ''), 'submitted')
  ON CONFLICT (opportunity_id, applicant_id)
  DO UPDATE SET
    cover_note = EXCLUDED.cover_note,
    portfolio_url = EXCLUDED.portfolio_url,
    status = 'submitted',
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_signal_application(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_signal_application(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_signal_application_status(
  p_application_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.signal_applications%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_status NOT IN ('submitted', 'reviewing', 'shortlisted', 'accepted', 'declined', 'withdrawn') THEN
    RAISE EXCEPTION 'Invalid application status';
  END IF;

  UPDATE public.signal_applications sa
  SET status = p_status, updated_at = now()
  WHERE sa.id = p_application_id
    AND (
      (p_status = 'withdrawn' AND sa.applicant_id = v_uid)
      OR (
        p_status <> 'withdrawn'
        AND EXISTS (
          SELECT 1 FROM public.signal_opportunities so
          WHERE so.id = sa.opportunity_id AND so.publisher_id = v_uid
        )
      )
    )
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized to update this application';
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.update_signal_application_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_signal_application_status(uuid, text) TO authenticated;

-- ============================================================================
-- 6. CENTRAL NOTIFICATION CENTRE & PREFERENCES (Phase 2.9)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (
    kind IN (
      'reply', 'mention', 'reaction', 'like', 'follow', 'message',
      'hub_activity', 'opportunity', 'application', 'event', 'system'
    )
  ),
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 180),
  body text NOT NULL DEFAULT '',
  href text NOT NULL DEFAULT '/',
  group_key text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_id) WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;
CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own notifications" ON public.notifications;
CREATE POLICY "Users delete own notifications" ON public.notifications
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.mark_notifications_read(
  p_notification_ids uuid[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_notification_ids IS NULL THEN
    UPDATE public.notifications
    SET read_at = now()
    WHERE user_id = v_uid AND read_at IS NULL;
  ELSE
    UPDATE public.notifications
    SET read_at = now()
    WHERE user_id = v_uid AND id = ANY(p_notification_ids) AND read_at IS NULL;
  END IF;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_notifications_read(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid[]) TO authenticated;

ALTER TABLE public.user_privacy_preferences
  ADD COLUMN IF NOT EXISTS notification_preferences jsonb NOT NULL DEFAULT
    '{"replies":true,"mentions":true,"reactions":true,"follows":true,"messages":true,"hubs":true,"opportunities":true,"email_digest":false,"push_enabled":false}'::jsonb;
