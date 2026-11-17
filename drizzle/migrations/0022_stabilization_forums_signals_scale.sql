-- ==============================================================================
-- Migration 0022: Product Stabilization, Native Hub Forums & Signal Chat,
--                 OAuth Profile Recovery, Single-Query DM Inbox & 1M Scale Indexes
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Idempotent Profile Guarantee for Signed-In Users (prevents 23503 FK failures)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_my_profile()
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_profile public.profiles;
  v_user record;
  v_base text;
  v_candidate text;
  v_n integer := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_caller;
  IF FOUND THEN
    RETURN v_profile;
  END IF;

  SELECT id, email, raw_user_meta_data INTO v_user FROM auth.users WHERE id = v_caller;

  v_base := lower(regexp_replace(
    coalesce(
      v_user.raw_user_meta_data->>'username',
      split_part(coalesce(v_user.email, ''), '@', 1),
      'builder'
    ),
    '[^a-zA-Z0-9_]',
    '',
    'g'
  ));
  IF char_length(v_base) < 3 THEN
    v_base := 'builder_' || substr(replace(v_caller::text, '-', ''), 1, 8);
  END IF;
  v_base := left(v_base, 20);
  v_candidate := v_base;

  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = v_candidate) LOOP
    v_n := v_n + 1;
    v_candidate := left(v_base, 19) || v_n::text;
  END LOOP;

  INSERT INTO public.profiles (id, username, display_name, avatar_url)
  VALUES (
    v_caller,
    v_candidate,
    left(coalesce(
      nullif(btrim(v_user.raw_user_meta_data->>'display_name'), ''),
      nullif(btrim(v_user.raw_user_meta_data->>'full_name'), ''),
      nullif(btrim(v_user.raw_user_meta_data->>'name'), ''),
      v_candidate
    ), 60),
    nullif(btrim(v_user.raw_user_meta_data->>'avatar_url'), '')
  )
  ON CONFLICT (id) DO UPDATE SET updated_at = coalesce(now(), now())
  RETURNING * INTO v_profile;

  RETURN v_profile;
EXCEPTION
  WHEN undefined_column THEN
    -- profiles has no updated_at column in 0000 baseline
    INSERT INTO public.profiles (id, username, display_name, avatar_url)
    VALUES (
      v_caller,
      v_candidate,
      left(coalesce(
        nullif(btrim(v_user.raw_user_meta_data->>'display_name'), ''),
        nullif(btrim(v_user.raw_user_meta_data->>'full_name'), ''),
        nullif(btrim(v_user.raw_user_meta_data->>'name'), ''),
        v_candidate
      ), 60),
      nullif(btrim(v_user.raw_user_meta_data->>'avatar_url'), '')
    )
    ON CONFLICT (id) DO NOTHING;

    SELECT * INTO v_profile FROM public.profiles WHERE id = v_caller;
    RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_profile() TO authenticated;

-- ------------------------------------------------------------------------------
-- 2. Fix update_hub Category Validation & Seed Real Forums in create_hub
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_hub(
  _hub uuid,
  _name text,
  _tagline text DEFAULT '',
  _description text DEFAULT '',
  _rules text DEFAULT '',
  _category text DEFAULT 'community',
  _access text DEFAULT 'public',
  _resources jsonb DEFAULT '[]'::jsonb
) RETURNS public.hubs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _me text;
  _updated public.hubs;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Sign in to update hub details' USING ERRCODE = '42501';
  END IF;

  _me := public.hub_role(_hub, _caller);
  IF _me NOT IN ('owner', 'admin') OR _me IS NULL THEN
    RAISE EXCEPTION 'Only hub owners and administrators can edit hub details' USING ERRCODE = '42501';
  END IF;

  IF _access NOT IN ('public', 'private') THEN
    RAISE EXCEPTION 'Access must be either public or private';
  END IF;

  IF _category NOT IN (
    'organization', 'school', 'incubator', 'ecosystem', 'community',
    'university', 'company', 'government', 'ngo', 'association', 'other'
  ) THEN
    RAISE EXCEPTION 'Invalid hub category';
  END IF;

  IF char_length(btrim(_name)) < 2 OR char_length(btrim(_name)) > 60 THEN
    RAISE EXCEPTION 'Hub name must be between 2 and 60 characters';
  END IF;

  UPDATE public.hubs
  SET
    name = btrim(_name),
    tagline = coalesce(btrim(_tagline), ''),
    description = coalesce(btrim(_description), ''),
    rules = coalesce(btrim(_rules), ''),
    category = _category,
    access = _access,
    resources = coalesce(_resources, '[]'::jsonb),
    updated_at = now()
  WHERE id = _hub
  RETURNING * INTO _updated;

  RETURN _updated;
END;
$$;

REVOKE ALL ON FUNCTION public.update_hub(uuid, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_hub(uuid, text, text, text, text, text, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_hub(
  _name text,
  _slug text,
  _tagline text DEFAULT '',
  _description text DEFAULT '',
  _rules text DEFAULT '',
  _category text DEFAULT 'community',
  _access text DEFAULT 'public',
  _resources jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  new_hub public.hubs;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to create hubs' USING ERRCODE = '42501';
  END IF;

  PERFORM public.ensure_my_profile();

  IF _category NOT IN (
    'organization', 'school', 'incubator', 'ecosystem', 'community',
    'university', 'company', 'government', 'ngo', 'association', 'other'
  ) THEN
    RAISE EXCEPTION 'Invalid hub category';
  END IF;

  IF _access NOT IN ('public', 'private') THEN
    RAISE EXCEPTION 'Access must be either public or private';
  END IF;

  INSERT INTO public.hubs (name, slug, tagline, description, rules, category, access, resources, owner_id)
  VALUES (
    btrim(_name),
    lower(btrim(_slug)),
    coalesce(btrim(_tagline), ''),
    coalesce(btrim(_description), ''),
    coalesce(btrim(_rules), ''),
    _category,
    _access,
    coalesce(_resources, '[]'::jsonb),
    _user_id
  )
  RETURNING * INTO new_hub;

  INSERT INTO public.hub_members (hub_id, user_id, role, status)
  VALUES (new_hub.id, _user_id, 'owner', 'active')
  ON CONFLICT (hub_id, user_id) DO UPDATE SET role = 'owner', status = 'active';

  UPDATE public.hubs SET member_count = 1 WHERE id = new_hub.id;
  new_hub.member_count := 1;

  -- Seed real default Forums inside PostgreSQL instead of relying on synthetic UI placeholders
  INSERT INTO public.hub_forums (hub_id, slug, name, description, forum_type, access_level, allow_member_posts, created_by)
  VALUES
    (new_hub.id, 'announcements', 'Official Announcements', 'Institutional broadcasts, notices, and scheduled updates from administrators.', 'announcement', 'public', false, _user_id),
    (new_hub.id, 'general', 'General Discussion', 'Open member coordination, introductions, and community updates.', 'general', 'members', true, _user_id),
    (new_hub.id, 'opportunities', 'Opportunities & Needs', 'Subject-specific forum for roles, grants, collaborations, and resource requests.', 'topic', 'members', true, _user_id)
  ON CONFLICT (hub_id, slug) DO NOTHING;

  RETURN to_jsonb(new_hub);
END;
$$;

REVOKE ALL ON FUNCTION public.create_hub(text, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_hub(text, text, text, text, text, text, text, jsonb) TO authenticated, service_role;

-- Backfill default real Forums for any existing Hubs that currently have zero forums
INSERT INTO public.hub_forums (hub_id, slug, name, description, forum_type, access_level, allow_member_posts, created_by)
SELECT
  h.id,
  f.slug,
  f.name,
  f.description,
  f.forum_type,
  f.access_level,
  f.allow_member_posts,
  h.owner_id
FROM public.hubs h
CROSS JOIN (
  VALUES
    ('announcements', 'Official Announcements', 'Institutional broadcasts, notices, and scheduled updates from administrators.', 'announcement', 'public', false),
    ('general', 'General Discussion', 'Open member coordination, introductions, and community updates.', 'general', 'members', true),
    ('opportunities', 'Opportunities & Needs', 'Subject-specific forum for roles, grants, collaborations, and resource requests.', 'topic', 'members', true)
) AS f(slug, name, description, forum_type, access_level, allow_member_posts)
WHERE NOT EXISTS (
  SELECT 1 FROM public.hub_forums existing WHERE existing.hub_id = h.id
)
ON CONFLICT (hub_id, slug) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 3. Hub Forum Threads & Replies (public.hub_forum_posts)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hub_forum_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  forum_id uuid NOT NULL REFERENCES public.hub_forums(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.hub_forum_posts(id) ON DELETE CASCADE,
  title text CHECK (title IS NULL OR char_length(btrim(title)) BETWEEN 2 AND 160),
  content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 5000),
  is_pinned boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hub_forum_posts_forum_idx
  ON public.hub_forum_posts (forum_id, is_pinned DESC, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS hub_forum_posts_parent_idx
  ON public.hub_forum_posts (parent_id, created_at ASC)
  WHERE deleted_at IS NULL AND parent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS hub_forum_posts_hub_idx
  ON public.hub_forum_posts (hub_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.guard_hub_forum_post()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_forum public.hub_forums;
  v_parent public.hub_forum_posts;
  v_role text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_forum FROM public.hub_forums WHERE id = NEW.forum_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Forum not found';
    END IF;

    NEW.hub_id := v_forum.hub_id;
    NEW.content := btrim(NEW.content);
    IF NEW.title IS NOT NULL THEN
      NEW.title := nullif(btrim(NEW.title), '');
    END IF;

    v_role := public.hub_role(NEW.hub_id, NEW.author_id);
    IF current_user IN ('anon', 'authenticated') AND (v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'moderator')) THEN
      NEW.is_pinned := false;
    END IF;

    IF NEW.parent_id IS NOT NULL THEN
      SELECT * INTO v_parent FROM public.hub_forum_posts WHERE id = NEW.parent_id;
      IF NOT FOUND OR v_parent.forum_id <> NEW.forum_id OR v_parent.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Parent discussion post unavailable';
      END IF;
    END IF;

    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id
     OR NEW.hub_id <> OLD.hub_id
     OR NEW.forum_id <> OLD.forum_id
     OR NEW.author_id <> OLD.author_id
     OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Forum post identity fields are immutable';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_hub_forum_post() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_hub_forum_post ON public.hub_forum_posts;
CREATE TRIGGER guard_hub_forum_post
  BEFORE INSERT OR UPDATE ON public.hub_forum_posts
  FOR EACH ROW EXECUTE FUNCTION public.guard_hub_forum_post();

ALTER TABLE public.hub_forum_posts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.hub_forum_posts FROM PUBLIC;
GRANT SELECT ON public.hub_forum_posts TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.hub_forum_posts TO authenticated;
GRANT ALL ON public.hub_forum_posts TO service_role;

DROP POLICY IF EXISTS "Readable hub forum posts" ON public.hub_forum_posts;
CREATE POLICY "Readable hub forum posts" ON public.hub_forum_posts
  FOR SELECT TO anon, authenticated
  USING (
    deleted_at IS NULL
    AND public.can_view_hub_content(hub_id)
    AND EXISTS (
      SELECT 1 FROM public.hub_forums f
      WHERE f.id = hub_forum_posts.forum_id
        AND (
          f.access_level IN ('public', 'members')
          OR public.hub_role(hub_id, (select auth.uid())) IN ('owner', 'admin', 'moderator')
        )
    )
  );

DROP POLICY IF EXISTS "Hub participants post to allowed forums" ON public.hub_forum_posts;
CREATE POLICY "Hub participants post to allowed forums" ON public.hub_forum_posts
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = (select auth.uid())
    AND public.hub_role(hub_id, (select auth.uid())) IS NOT NULL
    AND (
      public.hub_role(hub_id, (select auth.uid())) IN ('owner', 'admin', 'moderator')
      OR EXISTS (
        SELECT 1 FROM public.hub_forums f
        WHERE f.id = hub_forum_posts.forum_id
          AND f.hub_id = hub_forum_posts.hub_id
          AND f.allow_member_posts = true
          AND f.forum_type <> 'announcement'
          AND f.access_level <> 'staff_only'
      )
    )
  );

DROP POLICY IF EXISTS "Authors or hub staff update forum posts" ON public.hub_forum_posts;
CREATE POLICY "Authors or hub staff update forum posts" ON public.hub_forum_posts
  FOR UPDATE TO authenticated
  USING (
    author_id = (select auth.uid())
    OR public.hub_role(hub_id, (select auth.uid())) IN ('owner', 'admin', 'moderator')
  )
  WITH CHECK (
    author_id = (select auth.uid())
    OR public.hub_role(hub_id, (select auth.uid())) IN ('owner', 'admin', 'moderator')
  );

DROP POLICY IF EXISTS "Authors or hub staff delete forum posts" ON public.hub_forum_posts;
CREATE POLICY "Authors or hub staff delete forum posts" ON public.hub_forum_posts
  FOR DELETE TO authenticated
  USING (
    author_id = (select auth.uid())
    OR public.hub_role(hub_id, (select auth.uid())) IN ('owner', 'admin', 'moderator')
  );

-- ------------------------------------------------------------------------------
-- 4. Signals Profile Guard & Native Signal Channel Chat (public.signal_messages)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_signal(
  _name text,
  _slug text,
  _tagline text DEFAULT '',
  _description text DEFAULT '',
  _institution_type text DEFAULT 'organization',
  _website_url text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  new_sig public.signals;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to create an institutional Signal' USING ERRCODE = '42501';
  END IF;

  PERFORM public.ensure_my_profile();

  INSERT INTO public.signals (name, slug, tagline, description, institution_type, website_url, created_by)
  VALUES (
    btrim(_name),
    lower(btrim(_slug)),
    coalesce(btrim(_tagline), ''),
    coalesce(btrim(_description), ''),
    _institution_type,
    nullif(btrim(_website_url), ''),
    _user_id
  )
  RETURNING * INTO new_sig;

  INSERT INTO public.signal_publishers (signal_id, user_id, role, assigned_by)
  VALUES (new_sig.id, _user_id, 'admin', _user_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.signal_followers (signal_id, user_id)
  VALUES (new_sig.id, _user_id)
  ON CONFLICT DO NOTHING;

  UPDATE public.signals SET follower_count = 1 WHERE id = new_sig.id;
  new_sig.follower_count := 1;

  RETURN to_jsonb(new_sig);
END;
$$;

REVOKE ALL ON FUNCTION public.create_signal(text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_signal(text, text, text, text, text, text) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.signal_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.signal_messages(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 3000),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS signal_messages_signal_idx
  ON public.signal_messages (signal_id, created_at ASC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.signal_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.signal_messages FROM PUBLIC;
GRANT SELECT ON public.signal_messages TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.signal_messages TO authenticated;
GRANT ALL ON public.signal_messages TO service_role;

DROP POLICY IF EXISTS "Signal messages are readable" ON public.signal_messages;
CREATE POLICY "Signal messages are readable" ON public.signal_messages
  FOR SELECT TO anon, authenticated
  USING (deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.signals s WHERE s.id = signal_id));

DROP POLICY IF EXISTS "Signal followers or publishers post chat" ON public.signal_messages;
CREATE POLICY "Signal followers or publishers post chat" ON public.signal_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = (select auth.uid())
    AND (
      public.signal_role(signal_id, (select auth.uid())) IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM public.signal_followers sf
        WHERE sf.signal_id = signal_messages.signal_id
          AND sf.user_id = (select auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "Senders or signal admins update messages" ON public.signal_messages;
CREATE POLICY "Senders or signal admins update messages" ON public.signal_messages
  FOR UPDATE TO authenticated
  USING (
    sender_id = (select auth.uid())
    OR public.signal_role(signal_id, (select auth.uid())) IN ('admin', 'publisher')
  )
  WITH CHECK (
    sender_id = (select auth.uid())
    OR public.signal_role(signal_id, (select auth.uid())) IN ('admin', 'publisher')
  );

DROP POLICY IF EXISTS "Senders or signal admins delete messages" ON public.signal_messages;
CREATE POLICY "Senders or signal admins delete messages" ON public.signal_messages
  FOR DELETE TO authenticated
  USING (
    sender_id = (select auth.uid())
    OR public.signal_role(signal_id, (select auth.uid())) IN ('admin', 'publisher')
  );

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.hub_forum_posts;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.signal_messages;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ------------------------------------------------------------------------------
-- 5. Single-Query DM Inbox Summary RPC (Eliminates N+1 unread HTTP calls)
-- ------------------------------------------------------------------------------
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
    ORDER BY c.last_message_at DESC
    LIMIT v_lim OFFSET v_off
  ) sub;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_conversations_summary(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_conversations_summary(integer, integer) TO authenticated;

-- ------------------------------------------------------------------------------
-- 6. High-Scale Partial & Composite Indexes for 1,000,000-User Workload
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS pings_public_feed_idx
  ON public.pings (created_at DESC, id DESC)
  WHERE hidden_at IS NULL;

CREATE INDEX IF NOT EXISTS pings_public_cat_idx
  ON public.pings (category, created_at DESC, id DESC)
  WHERE hidden_at IS NULL;

CREATE INDEX IF NOT EXISTS pings_user_visible_idx
  ON public.pings (user_id, created_at DESC, id DESC)
  WHERE hidden_at IS NULL;

CREATE INDEX IF NOT EXISTS profiles_created_desc_idx
  ON public.profiles (created_at DESC);

CREATE INDEX IF NOT EXISTS moments_active_exp_idx
  ON public.moments (expires_at DESC, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS private_messages_unread_idx
  ON public.private_messages (conversation_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS hub_members_active_hub_user_idx
  ON public.hub_members (hub_id, user_id)
  WHERE status = 'active';
