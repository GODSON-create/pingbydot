-- ==============================================================================
-- Migration 0015: Product Completion Sprint
-- Hub Deletion, Signal Editing, Message Reactions, Highlight Management & Re-Ping Hardening
-- ==============================================================================

-- 0. Admin role helper overload accepting user_id (compatible with is_ping_admin)
CREATE OR REPLACE FUNCTION public.is_admin(_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = coalesce(_user, auth.uid()) AND role = 'admin'
  );
$$;
REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;

-- 1. DELETE HUB RPC
-- Allows the owner of a Hub to permanently delete the Hub and its cascading associations
CREATE OR REPLACE FUNCTION public.delete_hub(_hub uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_owner uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _hub IS NULL THEN
    RAISE EXCEPTION 'Hub id required';
  END IF;

  SELECT owner_id INTO v_owner FROM public.hubs WHERE id = _hub;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hub not found';
  END IF;

  IF v_owner <> v_caller AND NOT public.is_admin(v_caller) THEN
    RAISE EXCEPTION 'Only the hub owner can delete this hub';
  END IF;

  DELETE FROM public.hubs WHERE id = _hub;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_hub(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_hub(uuid) TO authenticated, service_role;

-- Allow hub owners to delete via direct delete policy
DROP POLICY IF EXISTS "Owners delete own hubs" ON public.hubs;
CREATE POLICY "Owners delete own hubs" ON public.hubs
  FOR DELETE TO authenticated
  USING (owner_id = (select auth.uid()) OR public.is_admin((select auth.uid())));
GRANT DELETE ON public.hubs TO authenticated;


-- 2. UPDATE SIGNAL RPC
-- Allows Signal administrators to edit channel information with validation
CREATE OR REPLACE FUNCTION public.update_signal(
  _signal uuid,
  _name text,
  _tagline text DEFAULT '',
  _description text DEFAULT '',
  _website_url text DEFAULT NULL,
  _avatar_url text DEFAULT NULL,
  _institution_type text DEFAULT 'community'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_sig public.signals;
  v_clean_name text;
  v_clean_type text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _signal IS NULL THEN
    RAISE EXCEPTION 'Signal id required';
  END IF;

  v_clean_name := btrim(_name);
  IF v_clean_name IS NULL OR char_length(v_clean_name) < 2 OR char_length(v_clean_name) > 100 THEN
    RAISE EXCEPTION 'Signal name must be between 2 and 100 characters';
  END IF;

  v_clean_type := coalesce(_institution_type, 'community');
  IF v_clean_type NOT IN ('university','company','incubator','government','association','organization','community','public_institution','other') THEN
    RAISE EXCEPTION 'Invalid institution type';
  END IF;

  SELECT * INTO v_sig FROM public.signals WHERE id = _signal;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Signal not found';
  END IF;

  -- Authorization check: Creator, Signal Admin, or Platform Admin
  IF v_sig.created_by <> v_caller AND public.signal_role(_signal, v_caller) <> 'admin' AND NOT public.is_admin(v_caller) THEN
    RAISE EXCEPTION 'Only signal administrators can edit this signal';
  END IF;

  UPDATE public.signals
  SET
    name = v_clean_name,
    tagline = coalesce(btrim(_tagline), ''),
    description = coalesce(btrim(_description), ''),
    website_url = nullif(btrim(_website_url), ''),
    avatar_url = nullif(btrim(_avatar_url), ''),
    institution_type = v_clean_type,
    updated_at = now()
  WHERE id = _signal
  RETURNING * INTO v_sig;

  RETURN to_jsonb(v_sig);
END;
$$;
REVOKE ALL ON FUNCTION public.update_signal(uuid, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_signal(uuid, text, text, text, text, text, text) TO authenticated, service_role;


-- 3. HUB MESSAGE REACTIONS TABLE & PER-USER TOGGLE RPC
-- Dedicated table for per-user reaction tracking, duplicate prevention, and reaction removal
CREATE TABLE IF NOT EXISTS public.hub_message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.hub_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reaction text NOT NULL CHECK (char_length(reaction) BETWEEN 1 AND 16),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, reaction)
);

CREATE INDEX IF NOT EXISTS hub_message_reactions_msg_idx ON public.hub_message_reactions (message_id);
CREATE INDEX IF NOT EXISTS hub_message_reactions_user_idx ON public.hub_message_reactions (user_id);

ALTER TABLE public.hub_message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members view message reactions" ON public.hub_message_reactions;
CREATE POLICY "Members view message reactions" ON public.hub_message_reactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hub_messages m
      WHERE m.id = hub_message_reactions.message_id
        AND public.can_view_hub_content(m.hub_id)
    )
  );

DROP POLICY IF EXISTS "Users insert own message reactions" ON public.hub_message_reactions;
CREATE POLICY "Users insert own message reactions" ON public.hub_message_reactions
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.hub_messages m
      WHERE m.id = hub_message_reactions.message_id
        AND public.can_view_hub_content(m.hub_id)
    )
  );

DROP POLICY IF EXISTS "Users delete own message reactions" ON public.hub_message_reactions;
CREATE POLICY "Users delete own message reactions" ON public.hub_message_reactions
  FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()));

GRANT SELECT, INSERT, DELETE ON public.hub_message_reactions TO authenticated;

-- Per-user reaction toggle function
CREATE OR REPLACE FUNCTION public.toggle_hub_message_reaction(
  _message_id uuid,
  _reaction text DEFAULT '❤️'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_hub_id uuid;
  v_clean_reaction text;
  v_exists boolean;
  v_summary jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _message_id IS NULL THEN
    RAISE EXCEPTION 'Message id required';
  END IF;

  SELECT hub_id INTO v_hub_id FROM public.hub_messages WHERE id = _message_id AND deleted_at IS NULL;
  IF v_hub_id IS NULL THEN
    RAISE EXCEPTION 'Hub message not found';
  END IF;

  -- Verify authorization to view this hub's messages
  IF NOT public.can_view_hub_content(v_hub_id) THEN
    RAISE EXCEPTION 'Unauthorized to interact with this hub message';
  END IF;

  v_clean_reaction := coalesce(nullif(btrim(_reaction), ''), '❤️');
  IF char_length(v_clean_reaction) > 16 THEN
    RAISE EXCEPTION 'Reaction must be between 1 and 16 characters';
  END IF;

  -- Check if reaction already exists for this user (reaction tracking)
  SELECT EXISTS (
    SELECT 1 FROM public.hub_message_reactions
    WHERE message_id = _message_id AND user_id = v_caller AND reaction = v_clean_reaction
  ) INTO v_exists;

  IF v_exists THEN
    -- Reaction removal (toggle off)
    DELETE FROM public.hub_message_reactions
    WHERE message_id = _message_id AND user_id = v_caller AND reaction = v_clean_reaction;
  ELSE
    -- Duplicate prevention: unique constraint + ON CONFLICT DO NOTHING (toggle on)
    INSERT INTO public.hub_message_reactions (message_id, user_id, reaction)
    VALUES (_message_id, v_caller, v_clean_reaction)
    ON CONFLICT (message_id, user_id, reaction) DO NOTHING;
  END IF;

  -- Recompute aggregate reaction counts for the message
  SELECT coalesce(
    jsonb_object_agg(reaction, count_val),
    '{}'::jsonb
  )
  INTO v_summary
  FROM (
    SELECT reaction, count(*)::integer AS count_val
    FROM public.hub_message_reactions
    WHERE message_id = _message_id
    GROUP BY reaction
  ) sub;

  -- Synchronize hub_messages.reactions cache for real-time and read queries
  UPDATE public.hub_messages
  SET reactions = v_summary, updated_at = now()
  WHERE id = _message_id;

  RETURN jsonb_build_object(
    'reactions', v_summary,
    'toggled', NOT v_exists,
    'reaction', v_clean_reaction
  );
END;
$$;
REVOKE ALL ON FUNCTION public.toggle_hub_message_reaction(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_hub_message_reaction(uuid, text) TO authenticated, service_role;


-- 4. HARDEN RE-PING RPC (Audience expansion prevention & creator follow check)
CREATE OR REPLACE FUNCTION public.reping_moment(
  _moment_id uuid,
  _caption text DEFAULT NULL,
  _audience text DEFAULT 'public'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_moment record;
  v_reping_id uuid;
  v_target_audience text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _moment_id IS NULL THEN
    RAISE EXCEPTION 'Moment id required';
  END IF;

  IF _caption IS NOT NULL AND char_length(_caption) > 500 THEN
    RAISE EXCEPTION 'Caption cannot exceed 500 characters';
  END IF;

  SELECT * INTO v_moment FROM public.moments WHERE id = _moment_id AND deleted_at IS NULL;
  IF v_moment.id IS NULL THEN
    RAISE EXCEPTION 'Moment not found';
  END IF;

  -- AUTHORIZATION & PRIVACY: If moment is followers-only, caller must be follower or creator
  IF v_moment.audience = 'followers' AND v_moment.author_id <> v_user THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.follows
      WHERE follower_id = v_user AND following_id = v_moment.author_id
    ) THEN
      RAISE EXCEPTION 'You must follow the creator to re-ping this moment';
    END IF;
  END IF;

  -- DISTRIBUTION RULE 1: Never allow private Hub or Close Circle moments to be re-pinged
  IF v_moment.audience IN ('hub', 'close_circle') THEN
    RAISE EXCEPTION 'Private Hub and Close Circle moments cannot be re-pinged.';
  END IF;

  -- DISTRIBUTION RULE 2: Respect creator allow_repings setting
  IF NOT v_moment.allow_repings THEN
    RAISE EXCEPTION 'The creator has disabled re-pings for this moment.';
  END IF;

  -- DISTRIBUTION RULE 3: Never expand followers-only moments to public
  IF v_moment.audience = 'followers' AND _audience = 'public' THEN
    RAISE EXCEPTION 'Re-Ping cannot expand a followers-only moment to public audience.';
  END IF;

  -- Force followers audience if original was followers
  IF v_moment.audience = 'followers' THEN
    v_target_audience := 'followers';
  ELSE
    v_target_audience := COALESCE(NULLIF(btrim(_audience), ''), 'public');
    IF v_target_audience NOT IN ('public', 'followers') THEN
      RAISE EXCEPTION 'Invalid target audience: must be public or followers';
    END IF;
  END IF;

  INSERT INTO public.moment_repings (moment_id, user_id, caption, audience)
  VALUES (_moment_id, v_user, nullif(btrim(_caption), ''), v_target_audience)
  ON CONFLICT (moment_id, user_id) DO UPDATE
    SET caption = EXCLUDED.caption, audience = EXCLUDED.audience, created_at = now()
  RETURNING id INTO v_reping_id;

  UPDATE public.moments
  SET reping_count = (SELECT count(*) FROM public.moment_repings WHERE moment_id = _moment_id)
  WHERE id = _moment_id;

  RETURN v_reping_id;
END;
$$;
REVOKE ALL ON FUNCTION public.reping_moment(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reping_moment(uuid, text, text) TO authenticated, service_role;


-- 5. HIGHLIGHT COLLECTIONS MANAGEMENT RPCS
CREATE OR REPLACE FUNCTION public.update_highlight(
  _highlight_id uuid,
  _title text,
  _cover_url text DEFAULT NULL,
  _is_private boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_clean_title text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _highlight_id IS NULL THEN
    RAISE EXCEPTION 'Highlight id required';
  END IF;

  v_clean_title := btrim(_title);
  IF v_clean_title IS NULL OR char_length(v_clean_title) < 1 OR char_length(v_clean_title) > 100 THEN
    RAISE EXCEPTION 'Highlight title must be between 1 and 100 characters';
  END IF;

  UPDATE public.highlights
  SET
    title = v_clean_title,
    cover_url = nullif(btrim(_cover_url), ''),
    is_private = coalesce(_is_private, false),
    updated_at = now()
  WHERE id = _highlight_id AND user_id = v_caller;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Highlight not found or permission denied';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.update_highlight(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_highlight(uuid, text, text, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.remove_moment_from_highlight(
  _highlight_id uuid,
  _moment_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _highlight_id IS NULL OR _moment_id IS NULL THEN
    RAISE EXCEPTION 'Invalid parameters';
  END IF;

  -- Verify highlight belongs to caller
  IF NOT EXISTS (SELECT 1 FROM public.highlights WHERE id = _highlight_id AND user_id = v_caller) THEN
    RAISE EXCEPTION 'Highlight not found or permission denied';
  END IF;

  DELETE FROM public.highlight_items
  WHERE highlight_id = _highlight_id AND moment_id = _moment_id;
END;
$$;
REVOKE ALL ON FUNCTION public.remove_moment_from_highlight(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_moment_from_highlight(uuid, uuid) TO authenticated, service_role;
