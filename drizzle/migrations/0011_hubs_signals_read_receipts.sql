-- ==============================================================================
-- Migration 0011: Hubs, Signals, Real-time Pings, Read Receipts & Privacy
-- ==============================================================================

-- 1. Fix Hub Creation & Hub Members Permissions & Policies
GRANT INSERT, UPDATE, DELETE ON public.hub_members TO authenticated;
GRANT INSERT ON public.hubs TO authenticated;

DROP POLICY IF EXISTS "Users can join or be added to hubs" ON public.hub_members;
CREATE POLICY "Users can join or be added to hubs" ON public.hub_members FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()) OR public.hub_role(hub_id, (select auth.uid())) IN ('owner','admin','moderator'));

DROP POLICY IF EXISTS "Staff can update hub members" ON public.hub_members;
CREATE POLICY "Staff can update hub members" ON public.hub_members FOR UPDATE TO authenticated
  USING (public.hub_role(hub_id, (select auth.uid())) IN ('owner','admin'))
  WITH CHECK (public.hub_role(hub_id, (select auth.uid())) IN ('owner','admin'));

DROP POLICY IF EXISTS "Members or staff can remove membership" ON public.hub_members;
CREATE POLICY "Members or staff can remove membership" ON public.hub_members FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()) OR public.hub_role(hub_id, (select auth.uid())) IN ('owner','admin'));

-- Update guard_hub trigger so counters from triggers are preserved
CREATE OR REPLACE FUNCTION public.guard_hub() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user NOT IN ('service_role','postgres','supabase_admin') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.verified := false; NEW.hidden_at := NULL; NEW.member_limit := coalesce(NEW.member_limit, 10000);
      NEW.member_count := 0; NEW.ping_count := 0;
    ELSE
      NEW.verified := OLD.verified;
      NEW.hidden_at := OLD.hidden_at; NEW.owner_id := OLD.owner_id; NEW.slug := OLD.slug;
      NEW.member_limit := coalesce(NEW.member_limit, OLD.member_limit);
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Secure Hub Creation RPC function
CREATE OR REPLACE FUNCTION public.create_hub(
  _name text,
  _slug text,
  _tagline text DEFAULT '',
  _description text DEFAULT '',
  _rules text DEFAULT '',
  _category text DEFAULT 'community',
  _access text DEFAULT 'public',
  _resources jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _user_id uuid := auth.uid();
  new_hub public.hubs;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Sign in to create hubs'; END IF;

  -- Ensure profile exists
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id) THEN
    INSERT INTO public.profiles (id, username, display_name)
    VALUES (_user_id, 'builder_' || substr(replace(_user_id::text, '-', ''), 1, 8), 'Builder')
    ON CONFLICT (id) DO NOTHING;
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

  -- Insert owner membership
  INSERT INTO public.hub_members (hub_id, user_id, role, status)
  VALUES (new_hub.id, _user_id, 'owner', 'active')
  ON CONFLICT (hub_id, user_id) DO UPDATE SET role = 'owner', status = 'active';

  -- Increment initial member counter safely
  UPDATE public.hubs SET member_count = 1 WHERE id = new_hub.id;
  new_hub.member_count := 1;

  RETURN to_jsonb(new_hub);
END $$;
GRANT EXECUTE ON FUNCTION public.create_hub(text, text, text, text, text, text, text, jsonb) TO authenticated, service_role;

-- 2. User Privacy Preferences (Read Receipts, Presence, Activity)
CREATE TABLE IF NOT EXISTS public.user_privacy_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  read_receipts_enabled boolean NOT NULL DEFAULT true,
  active_presence_enabled boolean NOT NULL DEFAULT true,
  last_active_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.user_privacy_preferences TO authenticated;
GRANT ALL ON public.user_privacy_preferences TO service_role;
ALTER TABLE public.user_privacy_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own privacy preferences" ON public.user_privacy_preferences;
CREATE POLICY "Users read own privacy preferences" ON public.user_privacy_preferences FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users insert own privacy preferences" ON public.user_privacy_preferences;
CREATE POLICY "Users insert own privacy preferences" ON public.user_privacy_preferences FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users update own privacy preferences" ON public.user_privacy_preferences;
CREATE POLICY "Users update own privacy preferences" ON public.user_privacy_preferences FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));

CREATE OR REPLACE FUNCTION public.get_user_privacy(_user uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'read_receipts_enabled', coalesce(p.read_receipts_enabled, true),
    'active_presence_enabled', coalesce(p.active_presence_enabled, true),
    'last_active_enabled', coalesce(p.last_active_enabled, true)
  )
  FROM (SELECT 1) _
  LEFT JOIN public.user_privacy_preferences p ON p.user_id = _user;
$$;
GRANT EXECUTE ON FUNCTION public.get_user_privacy(uuid) TO anon, authenticated, service_role;

-- 3. Interactive Hub Messages (Hub Pings)
CREATE TABLE IF NOT EXISTS public.hub_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 3000),
  media_url text,
  reply_to_id uuid REFERENCES public.hub_messages(id) ON DELETE SET NULL,
  is_system boolean NOT NULL DEFAULT false,
  reactions jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hub_messages_feed_idx ON public.hub_messages (hub_id, created_at ASC);
CREATE INDEX IF NOT EXISTS hub_messages_reply_idx ON public.hub_messages (reply_to_id);

GRANT SELECT, INSERT, UPDATE ON public.hub_messages TO authenticated;
GRANT SELECT ON public.hub_messages TO anon;
GRANT ALL ON public.hub_messages TO service_role;
ALTER TABLE public.hub_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hub messages readable with hub content" ON public.hub_messages;
CREATE POLICY "Hub messages readable with hub content" ON public.hub_messages FOR SELECT TO anon, authenticated
  USING (public.can_view_hub_content(hub_id));

DROP POLICY IF EXISTS "Active hub members can post messages" ON public.hub_messages;
CREATE POLICY "Active hub members can post messages" ON public.hub_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = (select auth.uid())
    AND public.hub_role(hub_id, (select auth.uid())) IS NOT NULL
  );

DROP POLICY IF EXISTS "Authors or staff can update messages" ON public.hub_messages;
CREATE POLICY "Authors or staff can update messages" ON public.hub_messages FOR UPDATE TO authenticated
  USING (
    sender_id = (select auth.uid())
    OR public.hub_role(hub_id, (select auth.uid())) IN ('owner','admin','moderator')
  )
  WITH CHECK (
    sender_id = (select auth.uid())
    OR public.hub_role(hub_id, (select auth.uid())) IN ('owner','admin','moderator')
  );

-- 4. Ping Read Receipts (Three-state: unread, read, active presence)
CREATE TABLE IF NOT EXISTS public.ping_read_receipts (
  message_id uuid NOT NULL REFERENCES public.hub_messages(id) ON DELETE CASCADE,
  hub_id uuid NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  last_interacted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, recipient_id)
);

CREATE INDEX IF NOT EXISTS ping_read_receipts_hub_idx ON public.ping_read_receipts (hub_id, message_id);
CREATE INDEX IF NOT EXISTS ping_read_receipts_user_idx ON public.ping_read_receipts (recipient_id);

GRANT SELECT, INSERT, UPDATE ON public.ping_read_receipts TO authenticated;
GRANT ALL ON public.ping_read_receipts TO service_role;
ALTER TABLE public.ping_read_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read receipts visible to hub members" ON public.ping_read_receipts;
CREATE POLICY "Read receipts visible to hub members" ON public.ping_read_receipts FOR SELECT TO authenticated
  USING (public.can_view_hub_content(hub_id));

DROP POLICY IF EXISTS "Users record own read receipts" ON public.ping_read_receipts;
CREATE POLICY "Users record own read receipts" ON public.ping_read_receipts FOR INSERT TO authenticated
  WITH CHECK (recipient_id = (select auth.uid()) AND public.hub_role(hub_id, (select auth.uid())) IS NOT NULL);

DROP POLICY IF EXISTS "Users update own read receipts" ON public.ping_read_receipts;
CREATE POLICY "Users update own read receipts" ON public.ping_read_receipts FOR UPDATE TO authenticated
  USING (recipient_id = (select auth.uid())) WITH CHECK (recipient_id = (select auth.uid()));

-- Mark messages read RPC with privacy enforcement
CREATE OR REPLACE FUNCTION public.mark_hub_messages_read(
  _hub_id uuid,
  _message_ids uuid[]
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _user_id uuid := auth.uid();
  _privacy public.user_privacy_preferences;
  _mid uuid;
BEGIN
  IF _user_id IS NULL THEN RETURN; END IF;
  IF public.hub_role(_hub_id, _user_id) IS NULL THEN RETURN; END IF;

  SELECT * INTO _privacy FROM public.user_privacy_preferences WHERE user_id = _user_id;

  FOREACH _mid IN ARRAY _message_ids LOOP
    IF EXISTS (SELECT 1 FROM public.hub_messages WHERE id = _mid AND hub_id = _hub_id AND sender_id <> _user_id) THEN
      INSERT INTO public.ping_read_receipts (message_id, hub_id, recipient_id, delivered_at, read_at, last_interacted_at)
      VALUES (
        _mid,
        _hub_id,
        _user_id,
        now(),
        CASE WHEN coalesce(_privacy.read_receipts_enabled, true) THEN now() ELSE NULL END,
        now()
      )
      ON CONFLICT (message_id, recipient_id) DO UPDATE SET
        read_at = CASE WHEN coalesce(_privacy.read_receipts_enabled, true) AND ping_read_receipts.read_at IS NULL THEN now() ELSE ping_read_receipts.read_at END,
        last_interacted_at = now();
    END IF;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.mark_hub_messages_read(uuid, uuid[]) TO authenticated, service_role;

-- Get message read summary RPC (reciprocal privacy enforced)
CREATE OR REPLACE FUNCTION public.get_message_read_summary(
  _message_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _caller uuid := auth.uid();
  _msg public.hub_messages;
  _total_recipients integer := 0;
  _read_count integer := 0;
  _caller_can_see_readers boolean := true;
  _readers jsonb := '[]'::jsonb;
BEGIN
  IF _caller IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _msg FROM public.hub_messages WHERE id = _message_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT public.can_view_hub_content(_msg.hub_id) THEN RETURN NULL; END IF;

  SELECT count(*) INTO _total_recipients
  FROM public.hub_members
  WHERE hub_id = _msg.hub_id AND status = 'active' AND user_id <> _msg.sender_id;

  SELECT count(*) INTO _read_count
  FROM public.ping_read_receipts
  WHERE message_id = _message_id AND read_at IS NOT NULL;

  IF EXISTS (SELECT 1 FROM public.user_privacy_preferences WHERE user_id = _caller AND read_receipts_enabled = false) THEN
    _caller_can_see_readers := false;
  END IF;

  IF _caller = _msg.sender_id AND _caller_can_see_readers THEN
    SELECT jsonb_agg(
      jsonb_build_object(
        'user_id', p.id,
        'username', p.username,
        'display_name', p.display_name,
        'avatar_url', p.avatar_url,
        'read_at', r.read_at
      ) ORDER BY r.read_at ASC
    ) INTO _readers
    FROM public.ping_read_receipts r
    JOIN public.profiles p ON p.id = r.recipient_id
    LEFT JOIN public.user_privacy_preferences priv ON priv.user_id = r.recipient_id
    WHERE r.message_id = _message_id AND r.read_at IS NOT NULL
      AND coalesce(priv.read_receipts_enabled, true) = true;
  END IF;

  RETURN jsonb_build_object(
    'message_id', _message_id,
    'total_recipients', _total_recipients,
    'read_count', _read_count,
    'readers', coalesce(_readers, '[]'::jsonb)
  );
END $$;
GRANT EXECUTE ON FUNCTION public.get_message_read_summary(uuid) TO authenticated, service_role;

-- 5. Signals: Institutional Broadcast Spaces
CREATE TABLE IF NOT EXISTS public.signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  tagline text NOT NULL DEFAULT '' CHECK (char_length(tagline) <= 140),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 3000),
  institution_type text NOT NULL DEFAULT 'organization' CHECK (institution_type IN ('university','company','government','association','organization','community','public_institution')),
  avatar_url text,
  cover_url text,
  website_url text CHECK (website_url IS NULL OR website_url ~* '^https?://'),
  verified boolean NOT NULL DEFAULT false,
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','pending','verified','rejected')),
  verification_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  follower_count integer NOT NULL DEFAULT 0,
  post_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS signals_listing_idx ON public.signals (verified DESC, follower_count DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS signals_type_idx ON public.signals (institution_type, verified DESC);

CREATE TABLE IF NOT EXISTS public.signal_publishers (
  signal_id uuid NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'publisher' CHECK (role IN ('admin','publisher')),
  assigned_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (signal_id, user_id)
);

CREATE INDEX IF NOT EXISTS signal_publishers_user_idx ON public.signal_publishers (user_id);

CREATE TABLE IF NOT EXISTS public.signal_followers (
  signal_id uuid NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notifications_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (signal_id, user_id)
);

CREATE INDEX IF NOT EXISTS signal_followers_user_idx ON public.signal_followers (user_id);

CREATE TABLE IF NOT EXISTS public.signal_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 160),
  content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 5000),
  media_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  category text NOT NULL DEFAULT 'announcement' CHECK (category IN ('announcement','alert','update','opportunity','event')),
  is_urgent boolean NOT NULL DEFAULT false,
  read_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS signal_posts_feed_idx ON public.signal_posts (signal_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.signal_reads (
  post_id uuid NOT NULL REFERENCES public.signal_posts(id) ON DELETE CASCADE,
  signal_id uuid NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS signal_reads_post_idx ON public.signal_reads (post_id);

-- Helpers for Signals
CREATE OR REPLACE FUNCTION public.signal_role(_signal uuid, _user uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.signal_publishers WHERE signal_id = _signal AND user_id = _user
$$;
GRANT EXECUTE ON FUNCTION public.signal_role(uuid, uuid) TO anon, authenticated, service_role;

-- Grants & RLS for Signals
GRANT SELECT ON public.signals, public.signal_posts TO anon;
GRANT SELECT, INSERT, UPDATE ON public.signals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signal_publishers, public.signal_followers, public.signal_posts, public.signal_reads TO authenticated;
GRANT ALL ON public.signals, public.signal_publishers, public.signal_followers, public.signal_posts, public.signal_reads TO service_role;

ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signal_publishers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signal_followers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signal_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signal_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Signals are public" ON public.signals;
CREATE POLICY "Signals are public" ON public.signals FOR SELECT TO anon, authenticated
  USING (id IS NOT NULL AND slug IS NOT NULL);

DROP POLICY IF EXISTS "Users create signals they own" ON public.signals;
CREATE POLICY "Users create signals they own" ON public.signals FOR INSERT TO authenticated
  WITH CHECK (created_by = (select auth.uid()) AND verified = false);

DROP POLICY IF EXISTS "Signal admins update signals" ON public.signals;
CREATE POLICY "Signal admins update signals" ON public.signals FOR UPDATE TO authenticated
  USING (public.signal_role(id, (select auth.uid())) = 'admin' OR created_by = (select auth.uid()))
  WITH CHECK (public.signal_role(id, (select auth.uid())) = 'admin' OR created_by = (select auth.uid()));

DROP POLICY IF EXISTS "Signal publishers are readable" ON public.signal_publishers;
CREATE POLICY "Signal publishers are readable" ON public.signal_publishers FOR SELECT TO anon, authenticated
  USING (signal_id IS NOT NULL AND user_id IS NOT NULL);

DROP POLICY IF EXISTS "Signal admins manage publishers" ON public.signal_publishers;
CREATE POLICY "Signal admins manage publishers" ON public.signal_publishers FOR INSERT TO authenticated
  WITH CHECK (public.signal_role(signal_id, (select auth.uid())) = 'admin' OR user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Signal admins delete publishers" ON public.signal_publishers;
CREATE POLICY "Signal admins delete publishers" ON public.signal_publishers FOR DELETE TO authenticated
  USING (public.signal_role(signal_id, (select auth.uid())) = 'admin');

DROP POLICY IF EXISTS "Signal followers readable by self or staff" ON public.signal_followers;
CREATE POLICY "Signal followers readable by self or staff" ON public.signal_followers FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()) OR public.signal_role(signal_id, (select auth.uid())) IS NOT NULL);

DROP POLICY IF EXISTS "Users follow signals as self" ON public.signal_followers;
CREATE POLICY "Users follow signals as self" ON public.signal_followers FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users unfollow signals as self" ON public.signal_followers;
CREATE POLICY "Users unfollow signals as self" ON public.signal_followers FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Signal posts are public" ON public.signal_posts;
CREATE POLICY "Signal posts are public" ON public.signal_posts FOR SELECT TO anon, authenticated
  USING (id IS NOT NULL AND signal_id IS NOT NULL);

DROP POLICY IF EXISTS "Authorized publishers create posts" ON public.signal_posts;
CREATE POLICY "Authorized publishers create posts" ON public.signal_posts FOR INSERT TO authenticated
  WITH CHECK (
    author_id = (select auth.uid())
    AND public.signal_role(signal_id, (select auth.uid())) IN ('admin','publisher')
  );

DROP POLICY IF EXISTS "Publishers update own posts" ON public.signal_posts;
CREATE POLICY "Publishers update own posts" ON public.signal_posts FOR UPDATE TO authenticated
  USING (
    author_id = (select auth.uid())
    OR public.signal_role(signal_id, (select auth.uid())) = 'admin'
  )
  WITH CHECK (
    author_id = (select auth.uid())
    OR public.signal_role(signal_id, (select auth.uid())) = 'admin'
  );

DROP POLICY IF EXISTS "Signal reads readable by self or staff" ON public.signal_reads;
CREATE POLICY "Signal reads readable by self or staff" ON public.signal_reads FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()) OR public.signal_role(signal_id, (select auth.uid())) IS NOT NULL);

DROP POLICY IF EXISTS "Users record signal reads" ON public.signal_reads FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

-- Create Signal RPC function
CREATE OR REPLACE FUNCTION public.create_signal(
  _name text,
  _slug text,
  _tagline text DEFAULT '',
  _description text DEFAULT '',
  _institution_type text DEFAULT 'organization',
  _website_url text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _user_id uuid := auth.uid();
  new_sig public.signals;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Sign in to create an institutional Signal'; END IF;

  INSERT INTO public.signals (name, slug, tagline, description, institution_type, website_url, created_by)
  VALUES (
    btrim(_name),
    lower(btrim(_slug)),
    coalesce(btrim(_tagline), ''),
    coalesce(btrim(_description), ''),
    _institution_type,
    _website_url,
    _user_id
  )
  RETURNING * INTO new_sig;

  -- Add creator as admin publisher
  INSERT INTO public.signal_publishers (signal_id, user_id, role, assigned_by)
  VALUES (new_sig.id, _user_id, 'admin', _user_id)
  ON CONFLICT DO NOTHING;

  -- Creator auto-follows
  INSERT INTO public.signal_followers (signal_id, user_id)
  VALUES (new_sig.id, _user_id)
  ON CONFLICT DO NOTHING;

  UPDATE public.signals SET follower_count = 1 WHERE id = new_sig.id;
  new_sig.follower_count := 1;

  RETURN to_jsonb(new_sig);
END $$;
GRANT EXECUTE ON FUNCTION public.create_signal(text, text, text, text, text, text) TO authenticated, service_role;

-- Follow Signal RPC function
CREATE OR REPLACE FUNCTION public.toggle_follow_signal(_signal uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _user_id uuid := auth.uid();
  _is_following boolean;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'Sign in to follow Signals'; END IF;

  IF EXISTS (SELECT 1 FROM public.signal_followers WHERE signal_id = _signal AND user_id = _user_id) THEN
    DELETE FROM public.signal_followers WHERE signal_id = _signal AND user_id = _user_id;
    UPDATE public.signals SET follower_count = greatest(follower_count - 1, 0) WHERE id = _signal;
    _is_following := false;
  ELSE
    INSERT INTO public.signal_followers (signal_id, user_id) VALUES (_signal, _user_id);
    UPDATE public.signals SET follower_count = follower_count + 1 WHERE id = _signal;
    _is_following := true;
  END IF;

  RETURN _is_following;
END $$;
GRANT EXECUTE ON FUNCTION public.toggle_follow_signal(uuid) TO authenticated, service_role;

-- Mark Signal Post read RPC
CREATE OR REPLACE FUNCTION public.mark_signal_read(_post_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _user_id uuid := auth.uid();
  _post public.signal_posts;
BEGIN
  IF _user_id IS NULL THEN RETURN; END IF;
  SELECT * INTO _post FROM public.signal_posts WHERE id = _post_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.signal_reads WHERE post_id = _post_id AND user_id = _user_id) THEN
    INSERT INTO public.signal_reads (post_id, signal_id, user_id)
    VALUES (_post_id, _post.signal_id, _user_id)
    ON CONFLICT DO NOTHING;

    UPDATE public.signal_posts SET read_count = read_count + 1 WHERE id = _post_id;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.mark_signal_read(uuid) TO authenticated, service_role;

-- Signal Post Analytics RPC (for publishers)
CREATE OR REPLACE FUNCTION public.get_signal_post_analytics(_post_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _caller uuid := auth.uid();
  _post public.signal_posts;
  _total_followers integer := 0;
  _read_count integer := 0;
  _pct numeric := 0;
BEGIN
  IF _caller IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _post FROM public.signal_posts WHERE id = _post_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF public.signal_role(_post.signal_id, _caller) IS NULL THEN
    RAISE EXCEPTION 'Only authorized publishers can inspect Signal analytics';
  END IF;

  SELECT follower_count INTO _total_followers FROM public.signals WHERE id = _post.signal_id;
  SELECT count(*) INTO _read_count FROM public.signal_reads WHERE post_id = _post_id;

  IF _total_followers > 0 THEN
    _pct := round((_read_count::numeric / _total_followers::numeric) * 100, 1);
  END IF;

  RETURN jsonb_build_object(
    'post_id', _post_id,
    'signal_id', _post.signal_id,
    'total_recipients', _total_followers,
    'read_count', _read_count,
    'read_percentage', _pct
  );
END $$;
GRANT EXECUTE ON FUNCTION public.get_signal_post_analytics(uuid) TO authenticated, service_role;

-- 6. Enable Realtime Publications
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.hub_messages;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ping_read_receipts;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.signal_posts;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
