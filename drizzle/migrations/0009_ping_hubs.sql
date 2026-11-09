CREATE TABLE public.hubs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  tagline text NOT NULL DEFAULT '' CHECK (char_length(tagline) <= 120),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  rules text NOT NULL DEFAULT '' CHECK (char_length(rules) <= 2000),
  category text NOT NULL DEFAULT 'community' CHECK (category IN ('organization','school','incubator','ecosystem','community')),
  access text NOT NULL DEFAULT 'public' CHECK (access IN ('public','private')),
  resources jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(resources) = 'array' AND jsonb_array_length(resources) <= 10),
  owner_id uuid NOT NULL REFERENCES public.profiles(id),
  verified boolean NOT NULL DEFAULT false,
  member_count integer NOT NULL DEFAULT 0,
  ping_count integer NOT NULL DEFAULT 0,
  member_limit integer NOT NULL DEFAULT 10000 CHECK (member_limit BETWEEN 1 AND 10000),
  hidden_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hubs_listing_idx ON public.hubs (hidden_at, member_count DESC, created_at DESC);
CREATE INDEX hubs_category_idx ON public.hubs (category, member_count DESC);

CREATE TABLE public.hub_members (
  hub_id uuid NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','moderator','member')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','invited')),
  invited_by uuid REFERENCES public.profiles(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hub_id, user_id)
);
CREATE INDEX hub_members_list_idx ON public.hub_members (hub_id, status, joined_at DESC);
CREATE INDEX hub_members_user_idx ON public.hub_members (user_id, status);

CREATE TABLE public.hub_pings (
  hub_id uuid NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  ping_id uuid NOT NULL REFERENCES public.pings(id) ON DELETE CASCADE,
  added_by uuid NOT NULL REFERENCES public.profiles(id),
  intent text CHECK (intent IN ('ask','offer','launch','collaborate','intro')),
  is_pinned boolean NOT NULL DEFAULT false,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hub_id, ping_id)
);
CREATE INDEX hub_pings_feed_idx ON public.hub_pings (hub_id, removed_at, is_pinned DESC, created_at DESC);
CREATE INDEX hub_pings_ping_idx ON public.hub_pings (ping_id);

CREATE TABLE public.hub_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(12), 'hex'),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  max_uses integer CHECK (max_uses IS NULL OR max_uses BETWEEN 1 AND 10000),
  uses integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hub_invites_hub_idx ON public.hub_invites (hub_id, created_at DESC);

CREATE TABLE public.follows (
  follower_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);
CREATE INDEX follows_following_idx ON public.follows (following_id);

-- Helpers (definer to avoid recursive RLS on hub_members)
CREATE FUNCTION public.hub_role(_hub uuid, _user uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.hub_members WHERE hub_id = _hub AND user_id = _user AND status = 'active'
$$;
CREATE FUNCTION public.can_view_hub_content(_hub uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.hubs h WHERE h.id = _hub AND h.hidden_at IS NULL
    AND (h.access = 'public' OR EXISTS (SELECT 1 FROM public.hub_members m WHERE m.hub_id = _hub AND m.user_id = auth.uid() AND m.status = 'active')))
$$;
REVOKE ALL ON FUNCTION public.hub_role(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_hub_content(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_role(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_hub_content(uuid) TO anon, authenticated, service_role;

-- Grants
GRANT SELECT ON public.hubs, public.hub_members, public.hub_pings, public.follows TO anon;
GRANT SELECT, INSERT, UPDATE ON public.hubs TO authenticated;
GRANT SELECT ON public.hub_members, public.hub_pings, public.hub_invites TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.follows TO authenticated;
GRANT ALL ON public.hubs, public.hub_members, public.hub_pings, public.hub_invites, public.follows TO service_role;

ALTER TABLE public.hubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_pings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Visible hubs are listed" ON public.hubs FOR SELECT TO anon, authenticated USING (hidden_at IS NULL);
CREATE POLICY "Owners read own hubs" ON public.hubs FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "Users create hubs they own" ON public.hubs FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid() AND verified = false AND hidden_at IS NULL);
CREATE POLICY "Hub admins edit hubs" ON public.hubs FOR UPDATE TO authenticated USING (public.hub_role(id, auth.uid()) IN ('owner','admin')) WITH CHECK (public.hub_role(id, auth.uid()) IN ('owner','admin'));

CREATE POLICY "Members visible with hub content" ON public.hub_members FOR SELECT TO anon, authenticated USING (status = 'active' AND public.can_view_hub_content(hub_id));
CREATE POLICY "Users see own membership" ON public.hub_members FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Hub staff see requests" ON public.hub_members FOR SELECT TO authenticated USING (public.hub_role(hub_id, auth.uid()) IN ('owner','admin','moderator'));

CREATE POLICY "Hub Pings visible with hub content" ON public.hub_pings FOR SELECT TO anon, authenticated USING (removed_at IS NULL AND public.can_view_hub_content(hub_id));

CREATE POLICY "Hub admins read invites" ON public.hub_invites FOR SELECT TO authenticated USING (public.hub_role(hub_id, auth.uid()) IN ('owner','admin'));

CREATE POLICY "Follows are public" ON public.follows FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Users follow as self" ON public.follows FOR INSERT TO authenticated WITH CHECK (follower_id = auth.uid());
CREATE POLICY "Users unfollow as self" ON public.follows FOR DELETE TO authenticated USING (follower_id = auth.uid());

-- Protect trusted columns and seed owner membership
CREATE FUNCTION public.guard_hub() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user NOT IN ('service_role','postgres','supabase_admin') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.verified := false; NEW.member_count := 0; NEW.ping_count := 0; NEW.hidden_at := NULL; NEW.member_limit := 10000;
    ELSE
      NEW.verified := OLD.verified; NEW.member_count := OLD.member_count; NEW.ping_count := OLD.ping_count;
      NEW.hidden_at := OLD.hidden_at; NEW.owner_id := OLD.owner_id; NEW.slug := OLD.slug; NEW.member_limit := OLD.member_limit;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER hubs_guard BEFORE INSERT OR UPDATE ON public.hubs FOR EACH ROW EXECUTE FUNCTION public.guard_hub();

CREATE FUNCTION public.hub_after_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.hub_members (hub_id, user_id, role, status) VALUES (NEW.id, NEW.owner_id, 'owner', 'active');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.hub_after_insert() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER hubs_seed_owner AFTER INSERT ON public.hubs FOR EACH ROW EXECUTE FUNCTION public.hub_after_insert();

-- Counters
CREATE FUNCTION public.hub_member_counter() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status <> 'active') THEN
    UPDATE public.hubs SET member_count = member_count + 1 WHERE id = NEW.hub_id;
  END IF;
  IF TG_OP IN ('DELETE','UPDATE') AND OLD.status = 'active' AND (TG_OP = 'DELETE' OR NEW.status <> 'active') THEN
    UPDATE public.hubs SET member_count = greatest(member_count - 1, 0) WHERE id = OLD.hub_id;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.hub_member_counter() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER hub_members_count AFTER INSERT OR UPDATE OR DELETE ON public.hub_members FOR EACH ROW EXECUTE FUNCTION public.hub_member_counter();

CREATE FUNCTION public.hub_ping_counter() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.removed_at IS NULL THEN
    UPDATE public.hubs SET ping_count = ping_count + 1 WHERE id = NEW.hub_id;
  ELSIF TG_OP = 'UPDATE' AND (OLD.removed_at IS NULL) <> (NEW.removed_at IS NULL) THEN
    UPDATE public.hubs SET ping_count = greatest(ping_count + CASE WHEN NEW.removed_at IS NULL THEN 1 ELSE -1 END, 0) WHERE id = NEW.hub_id;
  ELSIF TG_OP = 'DELETE' AND OLD.removed_at IS NULL THEN
    UPDATE public.hubs SET ping_count = greatest(ping_count - 1, 0) WHERE id = OLD.hub_id;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.hub_ping_counter() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER hub_pings_count AFTER INSERT OR UPDATE OR DELETE ON public.hub_pings FOR EACH ROW EXECUTE FUNCTION public.hub_ping_counter();

-- Membership actions (all writes go through these checked functions)
CREATE FUNCTION public.join_hub(_hub uuid, _token text DEFAULT NULL) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE h public.hubs; inv public.hub_invites; existing public.hub_members; next_status text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to join hubs'; END IF;
  SELECT * INTO h FROM public.hubs WHERE id = _hub AND hidden_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hub not found'; END IF;
  SELECT * INTO existing FROM public.hub_members WHERE hub_id = _hub AND user_id = auth.uid();
  IF FOUND AND existing.status = 'active' THEN RETURN 'active'; END IF;
  IF _token IS NOT NULL THEN
    SELECT * INTO inv FROM public.hub_invites WHERE hub_id = _hub AND token = _token AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now()) AND (max_uses IS NULL OR uses < max_uses) FOR UPDATE;
  END IF;
  IF h.access = 'public' OR inv.id IS NOT NULL OR (FOUND AND existing.status = 'invited') THEN
    next_status := 'active';
  ELSE
    next_status := 'pending';
  END IF;
  IF next_status = 'active' AND h.member_count >= h.member_limit THEN RAISE EXCEPTION 'This hub is full'; END IF;
  INSERT INTO public.hub_members (hub_id, user_id, status, invited_by) VALUES (_hub, auth.uid(), next_status, inv.created_by)
    ON CONFLICT (hub_id, user_id) DO UPDATE SET status = EXCLUDED.status, joined_at = now();
  IF inv.id IS NOT NULL AND next_status = 'active' THEN UPDATE public.hub_invites SET uses = uses + 1 WHERE id = inv.id; END IF;
  RETURN next_status;
END $$;

CREATE FUNCTION public.leave_hub(_hub uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.hub_role(_hub, auth.uid()) = 'owner' THEN RAISE EXCEPTION 'Owners cannot leave their hub'; END IF;
  DELETE FROM public.hub_members WHERE hub_id = _hub AND user_id = auth.uid();
END $$;

CREATE FUNCTION public.manage_hub_member(_hub uuid, _user uuid, _action text, _role text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me text := public.hub_role(_hub, auth.uid()); target public.hub_members; h public.hubs;
BEGIN
  IF me NOT IN ('owner','admin','moderator') OR me IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO target FROM public.hub_members WHERE hub_id = _hub AND user_id = _user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found'; END IF;
  IF target.role = 'owner' THEN RAISE EXCEPTION 'The owner cannot be changed'; END IF;
  IF _action = 'approve' THEN
    SELECT * INTO h FROM public.hubs WHERE id = _hub FOR UPDATE;
    IF h.member_count >= h.member_limit THEN RAISE EXCEPTION 'This hub is full'; END IF;
    UPDATE public.hub_members SET status = 'active', joined_at = now() WHERE hub_id = _hub AND user_id = _user AND status = 'pending';
  ELSIF _action IN ('decline','remove') THEN
    IF target.role IN ('admin','moderator') AND me <> 'owner' THEN RAISE EXCEPTION 'Only the owner can remove staff'; END IF;
    DELETE FROM public.hub_members WHERE hub_id = _hub AND user_id = _user;
  ELSIF _action = 'role' THEN
    IF me <> 'owner' AND NOT (me = 'admin' AND _role IN ('moderator','member') AND target.role <> 'admin') THEN RAISE EXCEPTION 'Not allowed'; END IF;
    IF _role NOT IN ('admin','moderator','member') THEN RAISE EXCEPTION 'Unknown role'; END IF;
    UPDATE public.hub_members SET role = _role WHERE hub_id = _hub AND user_id = _user AND status = 'active';
  ELSE RAISE EXCEPTION 'Unknown action'; END IF;
END $$;

CREATE FUNCTION public.invite_to_hub(_hub uuid, _username text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target uuid;
BEGIN
  IF public.hub_role(_hub, auth.uid()) IS NULL THEN RAISE EXCEPTION 'Join this hub to invite builders'; END IF;
  SELECT id INTO target FROM public.profiles WHERE username = lower(_username);
  IF target IS NULL THEN RAISE EXCEPTION 'No builder with that username'; END IF;
  INSERT INTO public.hub_members (hub_id, user_id, status, invited_by) VALUES (_hub, target, 'invited', auth.uid())
    ON CONFLICT (hub_id, user_id) DO UPDATE SET status = CASE WHEN hub_members.status = 'pending' AND public.hub_role(_hub, auth.uid()) IN ('owner','admin','moderator') THEN 'active' ELSE hub_members.status END;
END $$;

CREATE FUNCTION public.create_hub_invite(_hub uuid, _max_uses integer DEFAULT NULL, _days integer DEFAULT 14) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t text;
BEGIN
  IF public.hub_role(_hub, auth.uid()) NOT IN ('owner','admin') OR public.hub_role(_hub, auth.uid()) IS NULL THEN RAISE EXCEPTION 'Not allowed'; END IF;
  INSERT INTO public.hub_invites (hub_id, created_by, max_uses, expires_at)
    VALUES (_hub, auth.uid(), _max_uses, CASE WHEN _days IS NULL THEN NULL ELSE now() + make_interval(days => least(greatest(_days,1),365)) END)
    RETURNING token INTO t;
  RETURN t;
END $$;

CREATE FUNCTION public.revoke_hub_invite(_invite uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.hub_invites SET revoked_at = now() WHERE id = _invite AND public.hub_role(hub_id, auth.uid()) IN ('owner','admin');
END $$;

CREATE FUNCTION public.share_ping_to_hub(_hub uuid, _ping uuid, _intent text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.hub_role(_hub, auth.uid()) IS NULL THEN RAISE EXCEPTION 'Join this hub to share Pings'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pings WHERE id = _ping AND hidden_at IS NULL) THEN RAISE EXCEPTION 'Ping not available'; END IF;
  IF _intent IS NOT NULL AND _intent NOT IN ('ask','offer','launch','collaborate','intro') THEN RAISE EXCEPTION 'Unknown tag'; END IF;
  IF (SELECT count(*) FROM public.hub_pings WHERE added_by = auth.uid() AND created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'You are sharing too quickly. Try again later.';
  END IF;
  INSERT INTO public.hub_pings (hub_id, ping_id, added_by, intent) VALUES (_hub, _ping, auth.uid(), _intent)
    ON CONFLICT (hub_id, ping_id) DO NOTHING;
END $$;

CREATE FUNCTION public.moderate_hub_ping(_hub uuid, _ping uuid, _action text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me text := public.hub_role(_hub, auth.uid()); pinned integer;
BEGIN
  IF _action = 'remove' AND EXISTS (SELECT 1 FROM public.hub_pings WHERE hub_id = _hub AND ping_id = _ping AND added_by = auth.uid()) THEN
    UPDATE public.hub_pings SET removed_at = now(), is_pinned = false WHERE hub_id = _hub AND ping_id = _ping; RETURN;
  END IF;
  IF me IS NULL OR me NOT IN ('owner','admin','moderator') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _action = 'pin' THEN
    SELECT count(*) INTO pinned FROM public.hub_pings WHERE hub_id = _hub AND is_pinned AND removed_at IS NULL;
    IF pinned >= 3 THEN RAISE EXCEPTION 'Unpin a Ping first (3 maximum)'; END IF;
    UPDATE public.hub_pings SET is_pinned = true WHERE hub_id = _hub AND ping_id = _ping AND removed_at IS NULL;
  ELSIF _action = 'unpin' THEN UPDATE public.hub_pings SET is_pinned = false WHERE hub_id = _hub AND ping_id = _ping;
  ELSIF _action = 'remove' THEN UPDATE public.hub_pings SET removed_at = now(), is_pinned = false WHERE hub_id = _hub AND ping_id = _ping;
  ELSE RAISE EXCEPTION 'Unknown action'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.join_hub(uuid, text), public.leave_hub(uuid), public.manage_hub_member(uuid, uuid, text, text),
  public.invite_to_hub(uuid, text), public.create_hub_invite(uuid, integer, integer), public.revoke_hub_invite(uuid),
  public.share_ping_to_hub(uuid, uuid, text), public.moderate_hub_ping(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_hub(uuid, text), public.leave_hub(uuid), public.manage_hub_member(uuid, uuid, text, text),
  public.invite_to_hub(uuid, text), public.create_hub_invite(uuid, integer, integer), public.revoke_hub_invite(uuid),
  public.share_ping_to_hub(uuid, uuid, text), public.moderate_hub_ping(uuid, uuid, text) TO authenticated, service_role;