-- ==============================================================================
-- Migration 0042: Feature Restoration & Security Hardening for Moments,
--                 Hubs, and Signals (Forward-Only, Idempotent)
--
-- Does NOT rewrite 0000..0041. Safe to apply on top of 0041 and safe to re-run.
--
-- Scope:
--   1. Moments:
--      - Tighten `moments` SELECT RLS so `audience = 'hub'` requires active Hub
--        membership (`status = 'active'`) instead of pending/invited rows.
--      - Enforce mutual block protection on `moments` SELECT for non-authors
--        (aligned with `can_access_private_moment_object()` in 0041).
--      - Harden `highlights` & `highlight_items` visibility for private collections.
--   2. Hubs:
--      - Add missing `public.hubs.avatar_url` column used by Hub creation/branding.
--      - Restore counter tamper-protection (`member_count`, `ping_count`) inside
--        `public.guard_hub()` when invoked by non-service/non-trigger callers.
--      - Revoke unsafe direct client INSERT/UPDATE/DELETE on `public.hub_members`
--        (eliminates moderator/admin direct-table role-escalation bypasses from 0011;
--        all legitimate membership mutations run through checked SECURITY DEFINER RPCs).
--      - Harden `public.join_hub()` with `ensure_my_profile()` and fix PL/pgSQL
--        `FOUND` clobber when validating invite tokens alongside `invited` status.
--      - Harden `public.invite_to_hub()` so private Hubs require Hub staff
--        (`owner`/`admin`/`moderator`) to issue direct invites.
--      - Ensure `hub_members` and `hub_pings` are included in `supabase_realtime`.
--      - Reconcile `hubs.member_count` and `hubs.ping_count` from actual rows.
--   3. Signals:
--      - Add `public.guard_signal_write()` BEFORE INSERT/UPDATE trigger locking
--        `verified`, `verification_status`, `follower_count`, `post_count`,
--        `created_by`, and `slug` against direct client tampering (blocks self-verification).
--      - Add `public.signal_after_insert()` trigger so even fallback direct Signal
--        inserts seed creator as `admin` publisher and subscriber.
--      - Revoke direct client INSERT/UPDATE/DELETE on `public.signal_publishers`
--        and harden `public.manage_signal_publisher()` (strictly Signal admin/creator;
--        never auto-grants publisher privileges; protects creator from removal/demotion).
--      - Add authoritative `AFTER INSERT OR DELETE` triggers on `public.signal_followers`
--        and `public.signal_posts` so `signals.follower_count` and `signals.post_count`
--        always match actual database records with zero drift.
--      - Add `AFTER INSERT` broadcast notification trigger on `public.signal_posts`
--        dispatching real notifications to active subscribers (`notifications_enabled = true`).
--      - Harden `public.signal_posts` INSERT/UPDATE/DELETE policies and add
--        immutable `signal_id`/`author_id` guard on update.
--      - Harden `public.mark_signal_read()` and `public.get_signal_post_analytics()`
--        against stale counters, missing posts, and >100% read-rate distortion.
--      - Ensure `signal_posts`, `signal_followers`, and `notifications` are in
--        `supabase_realtime`.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. MOMENTS — ACTIVE HUB MEMBERSHIP, ANON CLOSE-CIRCLE FIX & MUTUAL BLOCKS
-- ------------------------------------------------------------------------------

-- SECURITY DEFINER helper prevents `anon` SELECT on public.moments from failing
-- with `42501: permission denied for table user_close_circle` after 0019 revoked
-- anon privileges on public.user_close_circle.
CREATE OR REPLACE FUNCTION public.is_in_close_circle(_author uuid, _viewer uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN _author IS NULL OR _viewer IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.user_close_circle ucc
      WHERE ucc.user_id = _author
        AND ucc.member_id = _viewer
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.is_in_close_circle(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_in_close_circle(uuid, uuid) TO anon, authenticated, service_role;

-- Ensure anon SELECT planning on public.moments can invoke is_blocked_with (returns false for NULL auth.uid())
GRANT EXECUTE ON FUNCTION public.is_blocked_with(uuid) TO anon;

DROP POLICY IF EXISTS "Moments viewable by authorized audience" ON public.moments;
CREATE POLICY "Moments viewable by authorized audience" ON public.moments
  FOR SELECT TO anon, authenticated
  USING (
    deleted_at IS NULL
    AND (
      author_id = (select auth.uid())
      OR (
        NOT (
          (select auth.uid()) IS NOT NULL
          AND public.is_blocked_with(moments.author_id)
        )
        AND (
          audience = 'public'
          OR (
            audience = 'followers'
            AND (select auth.uid()) IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.follows f
              WHERE f.follower_id = (select auth.uid())
                AND f.following_id = moments.author_id
            )
          )
          OR (
            audience = 'hub'
            AND hub_id IS NOT NULL
            AND (select auth.uid()) IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.hub_members hm
              WHERE hm.hub_id = moments.hub_id
                AND hm.user_id = (select auth.uid())
                AND hm.status = 'active'
            )
          )
          OR (
            audience = 'close_circle'
            AND (select auth.uid()) IS NOT NULL
            AND public.is_in_close_circle(moments.author_id, (select auth.uid()))
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS "Public highlights readable" ON public.highlights;
CREATE POLICY "Public highlights readable" ON public.highlights
  FOR SELECT TO anon, authenticated
  USING (
    is_private = false
    OR user_id = (select auth.uid())
  );

DROP POLICY IF EXISTS "Highlight items readable with highlight" ON public.highlight_items;
CREATE POLICY "Highlight items readable with highlight" ON public.highlight_items
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.highlights h
      WHERE h.id = highlight_items.highlight_id
        AND (h.is_private = false OR h.user_id = (select auth.uid()))
    )
  );

-- ------------------------------------------------------------------------------
-- 2. HUBS — SCHEMA, COUNTER INTEGRITY, MEMBERSHIP LOCKDOWN & REALTIME
-- ------------------------------------------------------------------------------

ALTER TABLE public.hubs
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- Restore tamper protection for member_count & ping_count while keeping
-- SECURITY DEFINER triggers (running as postgres/service_role) authoritative.
CREATE OR REPLACE FUNCTION public.guard_hub()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.verified := false;
      NEW.hidden_at := NULL;
      NEW.member_limit := coalesce(NEW.member_limit, 10000);
      NEW.member_count := 0;
      NEW.ping_count := 0;
    ELSE
      NEW.verified := OLD.verified;
      NEW.hidden_at := OLD.hidden_at;
      NEW.owner_id := OLD.owner_id;
      NEW.slug := OLD.slug;
      NEW.member_count := OLD.member_count;
      NEW.ping_count := OLD.ping_count;
      NEW.member_limit := coalesce(OLD.member_limit, 10000);
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Revoke unsafe direct client writes on hub_members (closes 0011 moderator/admin
-- direct-table role escalation); all legitimate writes use checked SECURITY DEFINER RPCs.
REVOKE INSERT, UPDATE, DELETE ON public.hub_members FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.hub_members TO anon, authenticated;
GRANT ALL ON public.hub_members TO service_role;

DROP POLICY IF EXISTS "Users can join or be added to hubs" ON public.hub_members;
DROP POLICY IF EXISTS "Staff can update hub members" ON public.hub_members;
DROP POLICY IF EXISTS "Members or staff can remove membership" ON public.hub_members;

-- Harden join_hub: ensure profile row exists and avoid FOUND clobber during token lookup.
CREATE OR REPLACE FUNCTION public.join_hub(_hub uuid, _token text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  h public.hubs;
  inv public.hub_invites;
  existing public.hub_members;
  v_has_existing boolean := false;
  v_has_valid_invite boolean := false;
  next_status text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Sign in to join hubs' USING ERRCODE = '42501';
  END IF;

  PERFORM public.ensure_my_profile();

  SELECT * INTO h
  FROM public.hubs
  WHERE id = _hub AND hidden_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hub not found';
  END IF;

  SELECT * INTO existing
  FROM public.hub_members
  WHERE hub_id = _hub AND user_id = v_caller;
  v_has_existing := FOUND;

  IF v_has_existing AND existing.status = 'active' THEN
    RETURN 'active';
  END IF;

  IF _token IS NOT NULL AND btrim(_token) <> '' THEN
    SELECT * INTO inv
    FROM public.hub_invites
    WHERE hub_id = _hub
      AND token = btrim(_token)
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
      AND (max_uses IS NULL OR uses < max_uses)
    FOR UPDATE;
    v_has_valid_invite := FOUND;
  END IF;

  IF h.access = 'public'
     OR v_has_valid_invite
     OR (v_has_existing AND existing.status = 'invited') THEN
    next_status := 'active';
  ELSE
    next_status := 'pending';
  END IF;

  IF next_status = 'active' AND h.member_count >= h.member_limit THEN
    RAISE EXCEPTION 'This hub is full';
  END IF;

  INSERT INTO public.hub_members (hub_id, user_id, role, status, invited_by)
  VALUES (
    _hub,
    v_caller,
    'member',
    next_status,
    CASE WHEN v_has_valid_invite THEN inv.created_by ELSE existing.invited_by END
  )
  ON CONFLICT (hub_id, user_id) DO UPDATE
    SET status = EXCLUDED.status,
        joined_at = now(),
        invited_by = coalesce(EXCLUDED.invited_by, hub_members.invited_by);

  IF v_has_valid_invite AND next_status = 'active' THEN
    UPDATE public.hub_invites
    SET uses = uses + 1
    WHERE id = inv.id;
  END IF;

  RETURN next_status;
END;
$$;
REVOKE ALL ON FUNCTION public.join_hub(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_hub(uuid, text) TO authenticated, service_role;

-- Harden invite_to_hub: private Hubs require owner/admin/moderator to issue direct invites.
CREATE OR REPLACE FUNCTION public.invite_to_hub(_hub uuid, _username text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_role text;
  v_access text;
  v_target uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Sign in to invite builders' USING ERRCODE = '42501';
  END IF;

  v_role := public.hub_role(_hub, v_caller);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Join this hub to invite builders' USING ERRCODE = '42501';
  END IF;

  SELECT access INTO v_access FROM public.hubs WHERE id = _hub AND hidden_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hub not found';
  END IF;

  IF v_access = 'private' AND v_role NOT IN ('owner', 'admin', 'moderator') THEN
    RAISE EXCEPTION 'Only hub staff can invite builders to a private hub' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_target
  FROM public.profiles
  WHERE username = lower(btrim(_username));
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'No builder with that username';
  END IF;

  INSERT INTO public.hub_members (hub_id, user_id, role, status, invited_by)
  VALUES (_hub, v_target, 'member', 'invited', v_caller)
  ON CONFLICT (hub_id, user_id) DO UPDATE
    SET status = CASE
      WHEN hub_members.status = 'pending' AND v_role IN ('owner', 'admin', 'moderator') THEN 'active'
      ELSE hub_members.status
    END,
    invited_by = coalesce(hub_members.invited_by, v_caller);
END;
$$;
REVOKE ALL ON FUNCTION public.invite_to_hub(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_to_hub(uuid, text) TO authenticated, service_role;

-- Reconcile existing Hub member_count and ping_count accurately
UPDATE public.hubs h
SET
  member_count = (
    SELECT count(*)::integer
    FROM public.hub_members hm
    WHERE hm.hub_id = h.id AND hm.status = 'active'
  ),
  ping_count = (
    SELECT count(*)::integer
    FROM public.hub_pings hp
    WHERE hp.hub_id = h.id AND hp.removed_at IS NULL
  );

-- ------------------------------------------------------------------------------
-- 3. SIGNALS — INSTITUTIONAL SECURITY, ACCURATE COUNTERS, NOTIFICATIONS & ANALYTICS
-- ------------------------------------------------------------------------------

-- 3a. Guard trusted Signal columns against direct client tampering (prevents self-verification)
CREATE OR REPLACE FUNCTION public.guard_signal_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.created_by := auth.uid();
      NEW.verified := false;
      NEW.verification_status := 'unverified';
      NEW.verification_details := NULL;
      NEW.follower_count := 0;
      NEW.post_count := 0;
    ELSE
      NEW.created_by := OLD.created_by;
      NEW.slug := OLD.slug;
      NEW.verified := OLD.verified;
      NEW.verification_status := OLD.verification_status;
      NEW.verification_details := OLD.verification_details;
      NEW.follower_count := OLD.follower_count;
      NEW.post_count := OLD.post_count;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS signals_guard ON public.signals;
CREATE TRIGGER signals_guard
  BEFORE INSERT OR UPDATE ON public.signals
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_signal_write();

-- 3b. Automatically seed creator as Signal admin publisher & initial subscriber
--     even if a Signal is created via fallback direct INSERT.
CREATE OR REPLACE FUNCTION public.signal_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.signal_publishers (signal_id, user_id, role, assigned_by)
  VALUES (NEW.id, NEW.created_by, 'admin', NEW.created_by)
  ON CONFLICT (signal_id, user_id) DO NOTHING;

  INSERT INTO public.signal_followers (signal_id, user_id)
  VALUES (NEW.id, NEW.created_by)
  ON CONFLICT (signal_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.signal_after_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS signals_seed_creator ON public.signals;
CREATE TRIGGER signals_seed_creator
  AFTER INSERT ON public.signals
  FOR EACH ROW
  EXECUTE FUNCTION public.signal_after_insert();

-- 3c. Lock down signal_publishers: revoke unsafe direct client INSERT/UPDATE/DELETE
REVOKE INSERT, UPDATE, DELETE ON public.signal_publishers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.signal_publishers TO anon, authenticated;
GRANT ALL ON public.signal_publishers TO service_role;

DROP POLICY IF EXISTS "Signal admins manage publishers" ON public.signal_publishers;
DROP POLICY IF EXISTS "Signal admins remove publishers" ON public.signal_publishers;

-- Harden manage_signal_publisher RPC
CREATE OR REPLACE FUNCTION public.manage_signal_publisher(
  _signal uuid,
  _username text,
  _action text,
  _role text DEFAULT 'publisher'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_sig public.signals;
  v_caller_role text;
  v_target_id uuid;
  v_clean_username text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Sign in to manage Signal publishers' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_sig FROM public.signals WHERE id = _signal;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Signal not found';
  END IF;

  v_caller_role := public.signal_role(_signal, v_caller);
  IF v_sig.created_by <> v_caller AND coalesce(v_caller_role, '') <> 'admin' THEN
    RAISE EXCEPTION 'Only Signal administrators can manage publishers' USING ERRCODE = '42501';
  END IF;

  v_clean_username := lower(ltrim(btrim(coalesce(_username, '')), '@'));
  IF v_clean_username = '' THEN
    RAISE EXCEPTION 'Username is required';
  END IF;

  SELECT id INTO v_target_id FROM public.profiles WHERE username = v_clean_username;
  IF v_target_id IS NULL THEN
    RAISE EXCEPTION 'No user found with username @%', v_clean_username;
  END IF;

  IF _action = 'add' THEN
    IF _role NOT IN ('admin', 'publisher') THEN
      RAISE EXCEPTION 'Role must be admin or publisher';
    END IF;
    INSERT INTO public.signal_publishers (signal_id, user_id, role, assigned_by)
    VALUES (_signal, v_target_id, _role, v_caller)
    ON CONFLICT (signal_id, user_id) DO UPDATE
      SET role = CASE
        WHEN signal_publishers.user_id = v_sig.created_by THEN 'admin'
        ELSE EXCLUDED.role
      END;
  ELSIF _action = 'role' THEN
    IF _role NOT IN ('admin', 'publisher') THEN
      RAISE EXCEPTION 'Role must be admin or publisher';
    END IF;
    IF v_target_id = v_sig.created_by AND _role <> 'admin' THEN
      RAISE EXCEPTION 'Cannot demote the Signal creator';
    END IF;
    UPDATE public.signal_publishers
    SET role = _role
    WHERE signal_id = _signal AND user_id = v_target_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target user is not a publisher on this Signal';
    END IF;
  ELSIF _action = 'remove' THEN
    IF v_target_id = v_sig.created_by THEN
      RAISE EXCEPTION 'Cannot remove the Signal creator';
    END IF;
    DELETE FROM public.signal_publishers
    WHERE signal_id = _signal AND user_id = v_target_id;
  ELSE
    RAISE EXCEPTION 'Unknown action: %', coalesce(_action, '');
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.manage_signal_publisher(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_signal_publisher(uuid, text, text, text) TO authenticated, service_role;

-- 3c-ii. Fix SQL NULL <> 'admin' authorization bypasses in request_signal_verification (0013)
--        and update_signal (0015), where non-publishers received signal_role() = NULL and
--        `NULL <> 'admin'` evaluated to UNKNOWN, skipping the IF RAISE guard!
CREATE OR REPLACE FUNCTION public.request_signal_verification(
  _signal uuid,
  _details jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_sig public.signals;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Sign in to request verification' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_sig FROM public.signals WHERE id = _signal;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Signal channel not found';
  END IF;

  IF v_sig.created_by <> v_caller
     AND coalesce(public.signal_role(_signal, v_caller), '') <> 'admin' THEN
    RAISE EXCEPTION 'Only signal administrators can request verification' USING ERRCODE = '42501';
  END IF;

  UPDATE public.signals
  SET
    verification_status = 'pending',
    verification_details = coalesce(_details, '{}'::jsonb),
    updated_at = now()
  WHERE id = _signal;
END;
$$;
REVOKE ALL ON FUNCTION public.request_signal_verification(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_signal_verification(uuid, jsonb) TO authenticated, service_role;

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
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
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

  IF v_sig.created_by <> v_caller
     AND coalesce(public.signal_role(_signal, v_caller), '') <> 'admin'
     AND NOT public.is_admin(v_caller) THEN
    RAISE EXCEPTION 'Only signal administrators can edit this signal' USING ERRCODE = '42501';
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

-- 3d. Harden signal_posts policies and prevent post ownership/channel reassignment
CREATE OR REPLACE FUNCTION public.guard_signal_post_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.signal_id IS DISTINCT FROM OLD.signal_id OR NEW.author_id IS DISTINCT FROM OLD.author_id THEN
        RAISE EXCEPTION 'Broadcast channel and author cannot be reassigned' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS signal_posts_guard ON public.signal_posts;
CREATE TRIGGER signal_posts_guard
  BEFORE UPDATE ON public.signal_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_signal_post_write();

DROP POLICY IF EXISTS "Signal publishers create posts" ON public.signal_posts;
CREATE POLICY "Signal publishers create posts" ON public.signal_posts
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = (select auth.uid())
    AND (
      public.signal_role(signal_id, (select auth.uid())) IN ('admin', 'publisher')
      OR EXISTS (
        SELECT 1
        FROM public.signals s
        WHERE s.id = signal_posts.signal_id
          AND s.created_by = (select auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "Publishers update own posts" ON public.signal_posts;
CREATE POLICY "Publishers update own posts" ON public.signal_posts
  FOR UPDATE TO authenticated
  USING (
    author_id = (select auth.uid())
    OR public.signal_role(signal_id, (select auth.uid())) = 'admin'
    OR EXISTS (
      SELECT 1
      FROM public.signals s
      WHERE s.id = signal_posts.signal_id
        AND s.created_by = (select auth.uid())
    )
  )
  WITH CHECK (
    author_id = (select auth.uid())
    OR public.signal_role(signal_id, (select auth.uid())) = 'admin'
    OR EXISTS (
      SELECT 1
      FROM public.signals s
      WHERE s.id = signal_posts.signal_id
        AND s.created_by = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Publishers delete own or admin deletes posts" ON public.signal_posts;
CREATE POLICY "Publishers delete own or admin deletes posts" ON public.signal_posts
  FOR DELETE TO authenticated
  USING (
    author_id = (select auth.uid())
    OR public.signal_role(signal_id, (select auth.uid())) = 'admin'
    OR EXISTS (
      SELECT 1
      FROM public.signals s
      WHERE s.id = signal_posts.signal_id
        AND s.created_by = (select auth.uid())
    )
  );

-- 3e. Authoritative counters for signal_followers & signal_posts (zero drift)
CREATE OR REPLACE FUNCTION public.signal_follower_counter()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.signals
    SET follower_count = (
      SELECT count(*)::integer FROM public.signal_followers WHERE signal_id = NEW.signal_id
    )
    WHERE id = NEW.signal_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.signals
    SET follower_count = (
      SELECT count(*)::integer FROM public.signal_followers WHERE signal_id = OLD.signal_id
    )
    WHERE id = OLD.signal_id;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.signal_follower_counter() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS signal_followers_count_trg ON public.signal_followers;
CREATE TRIGGER signal_followers_count_trg
  AFTER INSERT OR DELETE ON public.signal_followers
  FOR EACH ROW
  EXECUTE FUNCTION public.signal_follower_counter();

CREATE OR REPLACE FUNCTION public.signal_post_counter()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.signals
    SET post_count = (
      SELECT count(*)::integer FROM public.signal_posts WHERE signal_id = NEW.signal_id
    )
    WHERE id = NEW.signal_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.signals
    SET post_count = (
      SELECT count(*)::integer FROM public.signal_posts WHERE signal_id = OLD.signal_id
    )
    WHERE id = OLD.signal_id;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.signal_post_counter() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS signal_posts_count_trg ON public.signal_posts;
CREATE TRIGGER signal_posts_count_trg
  AFTER INSERT OR DELETE ON public.signal_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.signal_post_counter();

-- Update create_signal & toggle_follow_signal so counters come solely from triggers
CREATE OR REPLACE FUNCTION public.create_signal(
  _name text,
  _slug text,
  _tagline text DEFAULT '',
  _description text DEFAULT '',
  _institution_type text DEFAULT 'organization',
  _website_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  new_sig public.signals;
BEGIN
  IF v_user_id IS NULL THEN
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
    v_user_id
  )
  RETURNING * INTO new_sig;

  -- signal_after_insert trigger seeds publisher & follower; reload row with updated follower_count
  SELECT * INTO new_sig FROM public.signals WHERE id = new_sig.id;
  RETURN to_jsonb(new_sig);
END;
$$;
REVOKE ALL ON FUNCTION public.create_signal(text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_signal(text, text, text, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.toggle_follow_signal(_signal uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_exists boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to follow Signals' USING ERRCODE = '42501';
  END IF;

  PERFORM public.ensure_my_profile();

  IF NOT EXISTS (SELECT 1 FROM public.signals WHERE id = _signal) THEN
    RAISE EXCEPTION 'Signal not found';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.signal_followers
    WHERE signal_id = _signal AND user_id = v_user_id
  ) INTO v_exists;

  IF v_exists THEN
    DELETE FROM public.signal_followers
    WHERE signal_id = _signal AND user_id = v_user_id;
    RETURN false;
  ELSE
    INSERT INTO public.signal_followers (signal_id, user_id)
    VALUES (_signal, v_user_id)
    ON CONFLICT (signal_id, user_id) DO NOTHING;
    RETURN true;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.toggle_follow_signal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_follow_signal(uuid) TO authenticated, service_role;

-- 3f. Broadcast subscriber notification delivery trigger on new official Signal posts
CREATE OR REPLACE FUNCTION public.notify_signal_broadcast()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sig public.signals;
  v_prefix text;
BEGIN
  SELECT * INTO v_sig FROM public.signals WHERE id = NEW.signal_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_prefix := CASE WHEN NEW.is_urgent THEN '[URGENT] ' ELSE '' END;

  INSERT INTO public.notifications (user_id, actor_id, kind, title, body, href, group_key)
  SELECT
    sf.user_id,
    NEW.author_id,
    'system',
    left(v_prefix || v_sig.name || ': ' || NEW.title, 180),
    left(NEW.content, 240),
    '/signals/' || v_sig.slug,
    'signal_broadcast:' || NEW.id::text
  FROM public.signal_followers sf
  WHERE sf.signal_id = NEW.signal_id
    AND sf.notifications_enabled = true
    AND sf.user_id <> NEW.author_id;

  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_signal_broadcast() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notify_signal_broadcast_trg ON public.signal_posts;
CREATE TRIGGER notify_signal_broadcast_trg
  AFTER INSERT ON public.signal_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_signal_broadcast();

-- 3g. Harden mark_signal_read & get_signal_post_analytics against actual records
CREATE OR REPLACE FUNCTION public.mark_signal_read(_post_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_signal_id uuid;
BEGIN
  IF v_user_id IS NULL OR _post_id IS NULL THEN
    RETURN;
  END IF;

  SELECT signal_id INTO v_signal_id
  FROM public.signal_posts
  WHERE id = _post_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  PERFORM public.ensure_my_profile();

  INSERT INTO public.signal_reads (post_id, signal_id, user_id, read_at)
  VALUES (_post_id, v_signal_id, v_user_id, now())
  ON CONFLICT (post_id, user_id) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_signal_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_signal_read(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_signal_post_analytics(_post_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_post public.signal_posts;
  v_sig public.signals;
  v_total_followers integer := 0;
  v_read_count integer := 0;
  v_subscriber_read_count integer := 0;
  v_pct numeric := 0;
BEGIN
  IF v_caller IS NULL OR _post_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_post FROM public.signal_posts WHERE id = _post_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_sig FROM public.signals WHERE id = v_post.signal_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_sig.created_by <> v_caller
     AND public.signal_role(v_post.signal_id, v_caller) IS NULL
     AND NOT public.is_admin(v_caller) THEN
    RAISE EXCEPTION 'Not authorized to view Signal analytics' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer INTO v_total_followers
  FROM public.signal_followers
  WHERE signal_id = v_post.signal_id;

  SELECT count(*)::integer INTO v_read_count
  FROM public.signal_reads
  WHERE post_id = _post_id;

  SELECT count(*)::integer INTO v_subscriber_read_count
  FROM public.signal_reads sr
  JOIN public.signal_followers sf
    ON sf.signal_id = v_post.signal_id
   AND sf.user_id = sr.user_id
  WHERE sr.post_id = _post_id;

  IF v_total_followers > 0 THEN
    v_pct := least(100, round((v_subscriber_read_count::numeric / v_total_followers::numeric) * 100, 1));
  END IF;

  RETURN jsonb_build_object(
    'post_id', _post_id,
    'signal_id', v_post.signal_id,
    'total_recipients', v_total_followers,
    'read_count', v_read_count,
    'subscriber_read_count', v_subscriber_read_count,
    'read_percentage', v_pct
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_signal_post_analytics(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_signal_post_analytics(uuid) TO authenticated, service_role;

-- Reconcile existing Signal follower_count and post_count from actual records
UPDATE public.signals s
SET
  follower_count = (
    SELECT count(*)::integer FROM public.signal_followers sf WHERE sf.signal_id = s.id
  ),
  post_count = (
    SELECT count(*)::integer FROM public.signal_posts sp WHERE sp.signal_id = s.id
  );

-- ------------------------------------------------------------------------------
-- 4. REALTIME PUBLICATIONS (Idempotent)
-- ------------------------------------------------------------------------------

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.hub_members;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.hub_pings;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.signal_posts;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.signal_followers;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
