-- Migration: 0012_moments_highlights_reping.sql
-- Moments: Stories, Highlights, Discoverable Short-Form Content, Re-Pings & Audience Restrictions

-- 1. MOMENTS TABLE
CREATE TABLE IF NOT EXISTS public.moments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  media_url text NOT NULL,
  media_type text NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'video')),
  caption text,
  overlay_text text,
  stickers jsonb DEFAULT '[]'::jsonb,
  mentions jsonb DEFAULT '[]'::jsonb,
  location text,
  duration integer NOT NULL DEFAULT 5,
  audience text NOT NULL DEFAULT 'public' CHECK (audience IN ('public', 'followers', 'hub', 'close_circle')),
  hub_id uuid REFERENCES public.hubs(id) ON DELETE CASCADE,
  is_discoverable boolean NOT NULL DEFAULT false,
  allow_comments boolean NOT NULL DEFAULT true,
  allow_sharing boolean NOT NULL DEFAULT true,
  allow_repings boolean NOT NULL DEFAULT true,
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '24 hours'),
  is_archived boolean NOT NULL DEFAULT false,
  deleted_at timestamp with time zone,
  view_count integer NOT NULL DEFAULT 0,
  like_count integer NOT NULL DEFAULT 0,
  reping_count integer NOT NULL DEFAULT 0,
  reply_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS moments_author_id_idx ON public.moments(author_id);
CREATE INDEX IF NOT EXISTS moments_expires_at_idx ON public.moments(expires_at);
CREATE INDEX IF NOT EXISTS moments_audience_idx ON public.moments(audience);
CREATE INDEX IF NOT EXISTS moments_hub_id_idx ON public.moments(hub_id);
CREATE INDEX IF NOT EXISTS moments_discoverable_idx ON public.moments(is_discoverable) WHERE is_discoverable = true;

-- 2. MOMENT VIEWS TABLE
CREATE TABLE IF NOT EXISTS public.moment_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  moment_id uuid NOT NULL REFERENCES public.moments(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  viewed_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT moment_views_unique_viewer UNIQUE (moment_id, viewer_id)
);

CREATE INDEX IF NOT EXISTS moment_views_moment_id_idx ON public.moment_views(moment_id);
CREATE INDEX IF NOT EXISTS moment_views_viewer_id_idx ON public.moment_views(viewer_id);

-- 3. MOMENT LIKES & REACTIONS
CREATE TABLE IF NOT EXISTS public.moment_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  moment_id uuid NOT NULL REFERENCES public.moments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reaction text NOT NULL DEFAULT '❤️',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT moment_likes_unique_user UNIQUE (moment_id, user_id)
);

CREATE INDEX IF NOT EXISTS moment_likes_moment_id_idx ON public.moment_likes(moment_id);
CREATE INDEX IF NOT EXISTS moment_likes_user_id_idx ON public.moment_likes(user_id);

-- 4. MOMENT REPLIES (Private interactions between viewer and creator)
CREATE TABLE IF NOT EXISTS public.moment_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  moment_id uuid NOT NULL REFERENCES public.moments(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS moment_replies_moment_id_idx ON public.moment_replies(moment_id);
CREATE INDEX IF NOT EXISTS moment_replies_sender_id_idx ON public.moment_replies(sender_id);
CREATE INDEX IF NOT EXISTS moment_replies_recipient_id_idx ON public.moment_replies(recipient_id);

-- 5. MOMENT RE-PINGS (Native re-ping with attribution & commentary)
CREATE TABLE IF NOT EXISTS public.moment_repings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  moment_id uuid NOT NULL REFERENCES public.moments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  caption text,
  audience text NOT NULL DEFAULT 'public' CHECK (audience IN ('public', 'followers')),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT moment_repings_unique_user UNIQUE (moment_id, user_id)
);

CREATE INDEX IF NOT EXISTS moment_repings_moment_id_idx ON public.moment_repings(moment_id);
CREATE INDEX IF NOT EXISTS moment_repings_user_id_idx ON public.moment_repings(user_id);

-- 6. HIGHLIGHT COLLECTIONS TABLE
CREATE TABLE IF NOT EXISTS public.highlights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  cover_url text,
  display_order integer NOT NULL DEFAULT 0,
  is_private boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS highlights_user_id_idx ON public.highlights(user_id);

-- 7. HIGHLIGHT ITEMS TABLE
CREATE TABLE IF NOT EXISTS public.highlight_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  highlight_id uuid NOT NULL REFERENCES public.highlights(id) ON DELETE CASCADE,
  moment_id uuid NOT NULL REFERENCES public.moments(id) ON DELETE CASCADE,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT highlight_items_unique_moment UNIQUE (highlight_id, moment_id)
);

CREATE INDEX IF NOT EXISTS highlight_items_highlight_id_idx ON public.highlight_items(highlight_id);
CREATE INDEX IF NOT EXISTS highlight_items_moment_id_idx ON public.highlight_items(moment_id);

-- 8. CLOSE CIRCLE TABLE
CREATE TABLE IF NOT EXISTS public.user_close_circle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_close_circle_unique_pair UNIQUE (user_id, member_id)
);

CREATE INDEX IF NOT EXISTS user_close_circle_user_id_idx ON public.user_close_circle(user_id);

-- ENABLE RLS
ALTER TABLE public.moments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moment_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moment_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moment_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moment_repings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.highlights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.highlight_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_close_circle ENABLE ROW LEVEL SECURITY;

-- PERMISSIONS
GRANT ALL ON public.moments TO authenticated;
GRANT SELECT ON public.moments TO anon;
GRANT ALL ON public.moment_views TO authenticated;
GRANT SELECT ON public.moment_views TO anon;
GRANT ALL ON public.moment_likes TO authenticated;
GRANT SELECT ON public.moment_likes TO anon;
GRANT ALL ON public.moment_replies TO authenticated;
GRANT ALL ON public.moment_repings TO authenticated;
GRANT SELECT ON public.moment_repings TO anon;
GRANT ALL ON public.highlights TO authenticated;
GRANT SELECT ON public.highlights TO anon;
GRANT ALL ON public.highlight_items TO authenticated;
GRANT SELECT ON public.highlight_items TO anon;
GRANT ALL ON public.user_close_circle TO authenticated;

-- RLS POLICIES FOR MOMENTS
CREATE POLICY "Moments viewable by authorized audience" ON public.moments
  FOR SELECT TO anon, authenticated
  USING (
    deleted_at IS NULL AND (
      author_id = (select auth.uid()) OR
      audience = 'public' OR
      (
        audience = 'followers' AND EXISTS (
          SELECT 1 FROM public.follows
          WHERE follower_id = (select auth.uid()) AND following_id = moments.author_id
        )
      ) OR
      (
        audience = 'hub' AND hub_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.hub_members
          WHERE hub_id = moments.hub_id AND user_id = (select auth.uid())
        )
      ) OR
      (
        audience = 'close_circle' AND EXISTS (
          SELECT 1 FROM public.user_close_circle
          WHERE user_id = moments.author_id AND member_id = (select auth.uid())
        )
      )
    )
  );

CREATE POLICY "Authors create moments" ON public.moments
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = author_id);

CREATE POLICY "Authors update own moments" ON public.moments
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = author_id)
  WITH CHECK ((select auth.uid()) = author_id);

CREATE POLICY "Authors delete own moments" ON public.moments
  FOR DELETE TO authenticated
  USING ((select auth.uid()) = author_id);

-- RLS POLICIES FOR MOMENT VIEWS
CREATE POLICY "Moment views viewable by author" ON public.moment_views
  FOR SELECT TO authenticated
  USING (
    viewer_id = (select auth.uid()) OR
    EXISTS (SELECT 1 FROM public.moments WHERE id = moment_views.moment_id AND author_id = (select auth.uid()))
  );

CREATE POLICY "Viewers record views" ON public.moment_views
  FOR INSERT TO authenticated
  WITH CHECK (viewer_id = (select auth.uid()));

-- RLS POLICIES FOR MOMENT LIKES
CREATE POLICY "Moment likes viewable by eligible viewers" ON public.moment_likes
  FOR SELECT TO anon, authenticated
  USING (
    user_id = (select auth.uid()) OR
    EXISTS (
      SELECT 1 FROM public.moments
      WHERE moments.id = moment_likes.moment_id AND moments.deleted_at IS NULL
    )
  );

CREATE POLICY "Users like moments" ON public.moment_likes
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

CREATE POLICY "Users remove own likes" ON public.moment_likes
  FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()));

-- RLS POLICIES FOR MOMENT REPLIES
CREATE POLICY "Replies viewable by sender or recipient" ON public.moment_replies
  FOR SELECT TO authenticated
  USING (sender_id = (select auth.uid()) OR recipient_id = (select auth.uid()));

CREATE POLICY "Users send moment replies" ON public.moment_replies
  FOR INSERT TO authenticated
  WITH CHECK (sender_id = (select auth.uid()));

-- RLS POLICIES FOR MOMENT RE-PINGS
CREATE POLICY "Repings viewable according to original moment" ON public.moment_repings
  FOR SELECT TO anon, authenticated
  USING (
    user_id = (select auth.uid()) OR
    EXISTS (
      SELECT 1 FROM public.moments
      WHERE moments.id = moment_repings.moment_id
        AND moments.deleted_at IS NULL
        AND moments.allow_repings = true
    )
  );

CREATE POLICY "Users create repings" ON public.moment_repings
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (select auth.uid()) AND
    EXISTS (
      SELECT 1 FROM public.moments
      WHERE moments.id = moment_repings.moment_id
        AND moments.deleted_at IS NULL
        AND moments.allow_repings = true
        AND moments.audience NOT IN ('hub', 'close_circle')
    )
  );

CREATE POLICY "Users delete own repings" ON public.moment_repings
  FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()));

-- RLS POLICIES FOR HIGHLIGHTS
CREATE POLICY "Public highlights viewable by anyone" ON public.highlights
  FOR SELECT TO anon, authenticated
  USING (
    user_id = (select auth.uid()) OR
    is_private = false
  );

CREATE POLICY "Users manage own highlights" ON public.highlights
  FOR ALL TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- RLS POLICIES FOR HIGHLIGHT ITEMS
CREATE POLICY "Highlight items viewable by highlight viewers" ON public.highlight_items
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.highlights
      WHERE highlights.id = highlight_items.highlight_id
        AND (highlights.user_id = (select auth.uid()) OR highlights.is_private = false)
    )
  );

CREATE POLICY "Users manage own highlight items" ON public.highlight_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.highlights
      WHERE highlights.id = highlight_items.highlight_id
        AND highlights.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.highlights
      WHERE highlights.id = highlight_items.highlight_id
        AND highlights.user_id = (select auth.uid())
    )
  );

-- RLS POLICIES FOR CLOSE CIRCLE
CREATE POLICY "Users manage own close circle" ON public.user_close_circle
  FOR ALL TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- RPC: RECORD MOMENT VIEW
CREATE OR REPLACE FUNCTION public.view_moment(_moment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_viewer uuid;
  v_author uuid;
BEGIN
  v_viewer := auth.uid();
  IF v_viewer IS NULL THEN
    RETURN;
  END IF;

  SELECT author_id INTO v_author FROM public.moments WHERE id = _moment_id;
  IF v_author IS NULL OR v_author = v_viewer THEN
    RETURN;
  END IF;

  INSERT INTO public.moment_views (moment_id, viewer_id)
  VALUES (_moment_id, v_viewer)
  ON CONFLICT (moment_id, viewer_id) DO UPDATE
    SET viewed_at = now();

  UPDATE public.moments
  SET view_count = (SELECT count(*) FROM public.moment_views WHERE moment_id = _moment_id)
  WHERE id = _moment_id;
END;
$$;

-- RPC: TOGGLE LIKE MOMENT
CREATE OR REPLACE FUNCTION public.toggle_like_moment(_moment_id uuid, _reaction text DEFAULT '❤️')
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user uuid;
  v_liked boolean;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF EXISTS (SELECT 1 FROM public.moment_likes WHERE moment_id = _moment_id AND user_id = v_user) THEN
    DELETE FROM public.moment_likes WHERE moment_id = _moment_id AND user_id = v_user;
    v_liked := false;
  ELSE
    INSERT INTO public.moment_likes (moment_id, user_id, reaction)
    VALUES (_moment_id, v_user, COALESCE(_reaction, '❤️'));
    v_liked := true;
  END IF;

  UPDATE public.moments
  SET like_count = (SELECT count(*) FROM public.moment_likes WHERE moment_id = _moment_id)
  WHERE id = _moment_id;

  RETURN v_liked;
END;
$$;

-- RPC: RE-PING MOMENT
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
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_moment FROM public.moments WHERE id = _moment_id AND deleted_at IS NULL;
  IF v_moment.id IS NULL THEN
    RAISE EXCEPTION 'Moment not found';
  END IF;

  -- DISTRIBUTION RULE: Never allow private Hub or Close Circle moments to become public
  IF v_moment.audience IN ('hub', 'close_circle') THEN
    RAISE EXCEPTION 'Private Hub and Close Circle moments cannot be re-pinged.';
  END IF;

  IF NOT v_moment.allow_repings THEN
    RAISE EXCEPTION 'The creator has disabled re-pings for this moment.';
  END IF;

  INSERT INTO public.moment_repings (moment_id, user_id, caption, audience)
  VALUES (_moment_id, v_user, _caption, COALESCE(_audience, 'public'))
  ON CONFLICT (moment_id, user_id) DO UPDATE
    SET caption = EXCLUDED.caption, audience = EXCLUDED.audience, created_at = now()
  RETURNING id INTO v_reping_id;

  UPDATE public.moments
  SET reping_count = (SELECT count(*) FROM public.moment_repings WHERE moment_id = _moment_id)
  WHERE id = _moment_id;

  RETURN v_reping_id;
END;
$$;

-- RPC: DELETE RE-PING
CREATE OR REPLACE FUNCTION public.delete_reping(_reping_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user uuid;
  v_moment_id uuid;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT moment_id INTO v_moment_id
  FROM public.moment_repings
  WHERE id = _reping_id AND user_id = v_user;

  IF v_moment_id IS NOT NULL THEN
    DELETE FROM public.moment_repings WHERE id = _reping_id AND user_id = v_user;

    UPDATE public.moments
    SET reping_count = (SELECT count(*) FROM public.moment_repings WHERE moment_id = v_moment_id)
    WHERE id = v_moment_id;
  END IF;
END;
$$;

-- ENABLE REALTIME
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.moments;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.moment_likes;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.moment_repings;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
