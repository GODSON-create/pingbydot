-- PING SHIELD: tighten authorization around Signals, Moments, and privacy RPCs.
-- This migration assumes 0011 and 0012 have been reviewed and applied in order.

-- Privacy RPC: callers may only read their own preferences.
CREATE OR REPLACE FUNCTION public.get_user_privacy(_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR _user IS DISTINCT FROM auth.uid() THEN NULL
    ELSE jsonb_build_object(
      'read_receipts_enabled', coalesce(p.read_receipts_enabled, true),
      'active_presence_enabled', coalesce(p.active_presence_enabled, true),
      'last_active_enabled', coalesce(p.last_active_enabled, true)
    )
  END
  FROM (SELECT 1) AS caller
  LEFT JOIN public.user_privacy_preferences p ON p.user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.get_user_privacy(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_privacy(uuid) TO authenticated, service_role;

-- Signal publishers cannot self-appoint as admins on another institution's Signal.
DROP POLICY IF EXISTS "Signal admins manage publishers" ON public.signal_publishers;
CREATE POLICY "Signal admins manage publishers"
  ON public.signal_publishers
  FOR INSERT TO authenticated
  WITH CHECK (
    public.signal_role(signal_id, (select auth.uid())) = 'admin'
    AND assigned_by = (select auth.uid())
  );

-- The create_signal SECURITY DEFINER function remains responsible for creating
-- the initial creator/admin publisher row. All later assignments require an admin.
REVOKE INSERT, UPDATE, DELETE ON public.signal_publishers FROM authenticated;
GRANT SELECT ON public.signal_publishers TO authenticated;

-- Signal reads must be written through the validating RPC, not directly by clients.
REVOKE INSERT, UPDATE, DELETE ON public.signal_reads FROM authenticated;
GRANT SELECT ON public.signal_reads TO authenticated;
DROP POLICY IF EXISTS "Users record signal reads" ON public.signal_reads;

CREATE OR REPLACE FUNCTION public.mark_signal_read(_post_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _post public.signal_posts;
  _inserted integer := 0;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO _post
  FROM public.signal_posts
  WHERE id = _post_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Only a follower of the Signal can contribute a read receipt.
  IF NOT EXISTS (
    SELECT 1 FROM public.signal_followers
    WHERE signal_id = _post.signal_id AND user_id = _user_id
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.signal_reads (post_id, signal_id, user_id)
  VALUES (_post.id, _post.signal_id, _user_id)
  ON CONFLICT (post_id, user_id) DO NOTHING;

  GET DIAGNOSTICS _inserted = ROW_COUNT;
  IF _inserted = 1 THEN
    UPDATE public.signal_posts
    SET read_count = read_count + 1
    WHERE id = _post.id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_signal_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_signal_read(uuid) TO authenticated, service_role;

-- Remove dangerous table-wide grants. RLS remains the row-level boundary.
REVOKE ALL ON public.moments, public.moment_views, public.moment_likes,
  public.moment_replies, public.moment_repings, public.highlights,
  public.highlight_items, public.user_close_circle FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.moments TO authenticated;
GRANT SELECT ON public.moments TO anon;
GRANT SELECT ON public.moment_views TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.moment_likes TO authenticated;
GRANT SELECT, INSERT ON public.moment_replies TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.moment_repings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.highlights TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.highlight_items TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.user_close_circle TO authenticated;

-- Moment replies are private conversations with the moment's creator.
DROP POLICY IF EXISTS "Users send moment replies" ON public.moment_replies;
CREATE POLICY "Users send moment replies"
  ON public.moment_replies
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = (select auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.moments m
      WHERE m.id = moment_replies.moment_id
        AND m.author_id = moment_replies.recipient_id
        AND m.allow_comments = true
        AND m.deleted_at IS NULL
        AND (
          m.author_id = (select auth.uid())
          OR m.audience = 'public'
          OR (m.audience = 'followers' AND EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.follower_id = (select auth.uid()) AND f.following_id = m.author_id
          ))
          OR (m.audience = 'hub' AND EXISTS (
            SELECT 1 FROM public.hub_members hm
            WHERE hm.hub_id = m.hub_id
              AND hm.user_id = (select auth.uid())
              AND hm.status = 'active'
          ))
          OR (m.audience = 'close_circle' AND EXISTS (
            SELECT 1 FROM public.user_close_circle cc
            WHERE cc.user_id = m.author_id AND cc.member_id = (select auth.uid())
          ))
        )
    )
  );

-- A followers-only Moment must never be redistributed to a public audience.
CREATE OR REPLACE FUNCTION public.reping_moment(
  _moment_id uuid,
  _caption text DEFAULT NULL,
  _audience text DEFAULT 'public'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid := auth.uid();
  _moment public.moments;
  _reping_id uuid;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _audience NOT IN ('public', 'followers') THEN
    RAISE EXCEPTION 'Invalid Re-Ping audience';
  END IF;

  SELECT * INTO _moment
  FROM public.moments
  WHERE id = _moment_id
    AND deleted_at IS NULL
    AND expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Moment not found';
  END IF;

  IF _moment.author_id = _user_id THEN
    RAISE EXCEPTION 'You cannot Re-Ping your own Moment';
  END IF;

  IF NOT _moment.allow_repings THEN
    RAISE EXCEPTION 'The creator has disabled Re-Pings for this Moment';
  END IF;

  IF _moment.audience IN ('hub', 'close_circle') THEN
    RAISE EXCEPTION 'Private Hub and Close Circle Moments cannot be Re-Pinged';
  END IF;

  IF _moment.audience = 'followers' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.follows
      WHERE follower_id = _user_id AND following_id = _moment.author_id
    ) THEN
      RAISE EXCEPTION 'You are not allowed to view this Moment';
    END IF;
    IF _audience = 'public' THEN
      RAISE EXCEPTION 'Followers-only Moments cannot be Re-Pinged publicly';
    END IF;
  END IF;

  INSERT INTO public.moment_repings (moment_id, user_id, caption, audience)
  VALUES (_moment_id, _user_id, left(_caption, 500), _audience)
  ON CONFLICT (moment_id, user_id) DO UPDATE
    SET caption = EXCLUDED.caption,
        audience = EXCLUDED.audience,
        created_at = now()
  RETURNING id INTO _reping_id;

  UPDATE public.moments
  SET reping_count = (
    SELECT count(*) FROM public.moment_repings WHERE moment_id = _moment_id
  )
  WHERE id = _moment_id;

  RETURN _reping_id;
END;
$$;
REVOKE ALL ON FUNCTION public.reping_moment(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reping_moment(uuid, text, text) TO authenticated, service_role;

-- Harden other SECURITY DEFINER Moment RPCs against anonymous execution.
REVOKE ALL ON FUNCTION public.view_moment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.view_moment(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.toggle_like_moment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_like_moment(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.delete_reping(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_reping(uuid) TO authenticated, service_role;


-- Central visibility predicate used by both policies and SECURITY DEFINER RPCs.
CREATE OR REPLACE FUNCTION public.can_view_moment(_moment_id uuid, _viewer uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.moments m
    WHERE m.id = _moment_id
      AND m.deleted_at IS NULL
      AND m.expires_at > now()
      AND (
        m.author_id = _viewer
        OR m.audience = 'public'
        OR (
          _viewer IS NOT NULL AND m.audience = 'followers'
          AND EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.follower_id = _viewer AND f.following_id = m.author_id
          )
        )
        OR (
          _viewer IS NOT NULL AND m.audience = 'hub'
          AND EXISTS (
            SELECT 1 FROM public.hub_members hm
            WHERE hm.hub_id = m.hub_id AND hm.user_id = _viewer AND hm.status = 'active'
          )
        )
        OR (
          _viewer IS NOT NULL AND m.audience = 'close_circle'
          AND EXISTS (
            SELECT 1 FROM public.user_close_circle cc
            WHERE cc.user_id = m.author_id AND cc.member_id = _viewer
          )
        )
      )
  );
$$;
REVOKE ALL ON FUNCTION public.can_view_moment(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_moment(uuid, uuid) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Moments viewable by authorized audience" ON public.moments;
CREATE POLICY "Moments viewable by authorized audience"
  ON public.moments FOR SELECT TO anon, authenticated
  USING (public.can_view_moment(id, (select auth.uid())));

DROP POLICY IF EXISTS "Moment likes viewable by eligible viewers" ON public.moment_likes;
CREATE POLICY "Moment likes viewable by eligible viewers"
  ON public.moment_likes FOR SELECT TO anon, authenticated
  USING (public.can_view_moment(moment_id, (select auth.uid())));

DROP POLICY IF EXISTS "Repings viewable according to original moment" ON public.moment_repings;
CREATE POLICY "Repings viewable according to original moment"
  ON public.moment_repings FOR SELECT TO anon, authenticated
  USING (
    user_id = (select auth.uid())
    OR public.can_view_moment(moment_id, (select auth.uid()))
  );

-- SECURITY DEFINER RPCs must enforce the same visibility predicate as table reads.
CREATE OR REPLACE FUNCTION public.view_moment(_moment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _viewer uuid := auth.uid();
BEGIN
  IF _viewer IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.can_view_moment(_moment_id, _viewer) THEN
    RAISE EXCEPTION 'Moment not found';
  END IF;
  IF EXISTS (SELECT 1 FROM public.moments WHERE id = _moment_id AND author_id = _viewer) THEN
    RETURN;
  END IF;

  INSERT INTO public.moment_views (moment_id, viewer_id)
  VALUES (_moment_id, _viewer)
  ON CONFLICT (moment_id, viewer_id) DO UPDATE SET viewed_at = now();

  UPDATE public.moments
  SET view_count = (SELECT count(*) FROM public.moment_views WHERE moment_id = _moment_id)
  WHERE id = _moment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.toggle_like_moment(_moment_id uuid, _reaction text DEFAULT '❤️')
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _viewer uuid := auth.uid();
  _liked boolean;
BEGIN
  IF _viewer IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.can_view_moment(_moment_id, _viewer) THEN
    RAISE EXCEPTION 'Moment not found';
  END IF;

  IF EXISTS (SELECT 1 FROM public.moment_likes WHERE moment_id = _moment_id AND user_id = _viewer) THEN
    DELETE FROM public.moment_likes WHERE moment_id = _moment_id AND user_id = _viewer;
    _liked := false;
  ELSE
    INSERT INTO public.moment_likes (moment_id, user_id, reaction)
    VALUES (_moment_id, _viewer, left(coalesce(_reaction, '❤️'), 16));
    _liked := true;
  END IF;

  UPDATE public.moments
  SET like_count = (SELECT count(*) FROM public.moment_likes WHERE moment_id = _moment_id)
  WHERE id = _moment_id;

  RETURN _liked;
END;
$$;


-- Direct Re-Ping inserts must preserve the original audience too; the RPC alone
-- is not the security boundary because authenticated clients can call PostgREST.
DROP POLICY IF EXISTS "Users create repings" ON public.moment_repings;
CREATE POLICY "Users create repings"
  ON public.moment_repings
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (select auth.uid())
    AND audience IN ('public', 'followers')
    AND EXISTS (
      SELECT 1
      FROM public.moments m
      WHERE m.id = moment_repings.moment_id
        AND m.deleted_at IS NULL
        AND m.expires_at > now()
        AND m.allow_repings = true
        AND m.audience IN ('public', 'followers')
        AND public.can_view_moment(m.id, (select auth.uid()))
        AND (m.audience <> 'followers' OR audience = 'followers')
    )
  );

-- A user may edit only their own post while they remain an authorized publisher.
DROP POLICY IF EXISTS "Publishers update own posts" ON public.signal_posts;
CREATE POLICY "Publishers update own posts"
  ON public.signal_posts
  FOR UPDATE TO authenticated
  USING (
    public.signal_role(signal_id, (select auth.uid())) IN ('admin', 'publisher')
    AND (author_id = (select auth.uid()) OR public.signal_role(signal_id, (select auth.uid())) = 'admin')
  )
  WITH CHECK (
    public.signal_role(signal_id, (select auth.uid())) IN ('admin', 'publisher')
    AND (author_id = (select auth.uid()) OR public.signal_role(signal_id, (select auth.uid())) = 'admin')
  );
