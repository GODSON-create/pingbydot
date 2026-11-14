-- ==============================================================================
-- Migration 0015: Product Completion Sprint
-- Hub Deletion, Signal Editing, Message Reactions, Highlight Management & Re-Ping Hardening
-- ==============================================================================

-- 1. DELETE HUB RPC
-- Allows the owner of a Hub to permanently delete the Hub and its associations
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
-- Allows Signal administrators to edit channel information without altering verification status
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
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_sig FROM public.signals WHERE id = _signal;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Signal not found';
  END IF;

  IF v_sig.created_by <> v_caller AND public.signal_role(_signal, v_caller) <> 'admin' AND NOT public.is_admin(v_caller) THEN
    RAISE EXCEPTION 'Only signal administrators can edit this signal';
  END IF;

  UPDATE public.signals
  SET
    name = btrim(_name),
    tagline = coalesce(btrim(_tagline), ''),
    description = coalesce(btrim(_description), ''),
    website_url = nullif(btrim(_website_url), ''),
    avatar_url = nullif(btrim(_avatar_url), ''),
    institution_type = coalesce(_institution_type, 'community'),
    updated_at = now()
  WHERE id = _signal
  RETURNING * INTO v_sig;

  RETURN to_jsonb(v_sig);
END;
$$;
REVOKE ALL ON FUNCTION public.update_signal(uuid, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_signal(uuid, text, text, text, text, text, text) TO authenticated, service_role;


-- 3. HUB MESSAGE REACTIONS RPC
-- Safely increments or toggles emoji reactions on hub messages
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
  v_current jsonb;
  v_count integer;
  v_clean_reaction text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT hub_id, reactions INTO v_hub_id, v_current FROM public.hub_messages WHERE id = _message_id;
  IF v_hub_id IS NULL THEN
    RAISE EXCEPTION 'Hub message not found';
  END IF;

  -- Verify membership in hub if private
  IF NOT public.can_view_hub_content(v_hub_id) THEN
    RAISE EXCEPTION 'Unauthorized to interact with this hub message';
  END IF;

  v_clean_reaction := coalesce(btrim(_reaction), '❤️');
  v_current := coalesce(v_current, '{}'::jsonb);
  v_count := coalesce((v_current->>v_clean_reaction)::integer, 0) + 1;

  v_current := jsonb_set(v_current, ARRAY[v_clean_reaction], to_jsonb(v_count));

  UPDATE public.hub_messages
  SET reactions = v_current, updated_at = now()
  WHERE id = _message_id;

  RETURN v_current;
END;
$$;
REVOKE ALL ON FUNCTION public.toggle_hub_message_reaction(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_hub_message_reaction(uuid, text) TO authenticated, service_role;


-- 4. HARDEN RE-PING RPC (Audience expansion prevention)
-- Re-Pings must never expand a followers-only moment to a public audience
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
  v_user uuid;
  v_moment record;
  v_reping_id uuid;
  v_target_audience text;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_moment FROM public.moments WHERE id = _moment_id AND deleted_at IS NULL;
  IF v_moment.id IS NULL THEN
    RAISE EXCEPTION 'Moment not found';
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
    v_target_audience := COALESCE(_audience, 'public');
  END IF;

  INSERT INTO public.moment_repings (moment_id, user_id, caption, audience)
  VALUES (_moment_id, v_user, _caption, v_target_audience)
  ON CONFLICT (moment_id, user_id) DO UPDATE
    SET caption = EXCLUDED.caption, audience = EXCLUDED.audience, created_at = now()
  RETURNING id INTO v_reping_id;

  UPDATE public.moments
  SET reping_count = (SELECT count(*) FROM public.moment_repings WHERE moment_id = _moment_id)
  WHERE id = _moment_id;

  RETURN v_reping_id;
END;
$$;


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
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.highlights
  SET
    title = btrim(_title),
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

  -- Verify highlight belongs to caller
  IF NOT EXISTS (SELECT 1 FROM public.highlights WHERE id = _highlight_id AND user_id = v_caller) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  DELETE FROM public.highlight_items
  WHERE highlight_id = _highlight_id AND moment_id = _moment_id;
END;
$$;
REVOKE ALL ON FUNCTION public.remove_moment_from_highlight(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_moment_from_highlight(uuid, uuid) TO authenticated, service_role;
