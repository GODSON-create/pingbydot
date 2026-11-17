-- =============================================================================
-- Migration 0017: Human Coordination Network — Structured Intents, Hub Forums,
--                 Institutional Broadcasts, Saved Pings & Moment Associations
-- =============================================================================

-- 1. Extend Pings with structured intent coordination fields (backward compatible)
ALTER TABLE public.pings
  ADD COLUMN IF NOT EXISTS headline text,
  ADD COLUMN IF NOT EXISTS needs text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS offers text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS skills text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS desired_outcome text,
  ADD COLUMN IF NOT EXISTS media_urls text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public';

-- Expand pings.category check constraint to support full intent taxonomy
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pings_category_check'
      AND conrelid = 'public.pings'::regclass
  ) THEN
    ALTER TABLE public.pings DROP CONSTRAINT pings_category_check;
  END IF;
END $$;

ALTER TABLE public.pings
  ADD CONSTRAINT pings_category_check
  CHECK (category IN (
    'progress', 'idea', 'launch', 'milestone', 'question', 'opportunity',
    'building', 'need', 'offer', 'collaboration', 'update'
  ));

-- 2. Saved Pings (Bookmarks)
CREATE TABLE IF NOT EXISTS public.saved_pings (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ping_id uuid NOT NULL REFERENCES public.pings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ping_id)
);

CREATE INDEX IF NOT EXISTS saved_pings_user_idx ON public.saved_pings(user_id, created_at DESC);
GRANT SELECT, INSERT, DELETE ON public.saved_pings TO authenticated;
GRANT ALL ON public.saved_pings TO service_role;

ALTER TABLE public.saved_pings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own saved pings" ON public.saved_pings;
CREATE POLICY "Users read own saved pings" ON public.saved_pings
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users insert own saved pings" ON public.saved_pings;
CREATE POLICY "Users insert own saved pings" ON public.saved_pings
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users delete own saved pings" ON public.saved_pings;
CREATE POLICY "Users delete own saved pings" ON public.saved_pings
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- 3. Expand Hubs organizational categories & notification preferences
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hubs_category_check'
      AND conrelid = 'public.hubs'::regclass
  ) THEN
    ALTER TABLE public.hubs DROP CONSTRAINT hubs_category_check;
  END IF;
END $$;

ALTER TABLE public.hubs
  ADD CONSTRAINT hubs_category_check
  CHECK (category IN (
    'organization', 'school', 'incubator', 'ecosystem', 'community',
    'university', 'company', 'government', 'ngo', 'association', 'other'
  ));

ALTER TABLE public.hubs
  ADD COLUMN IF NOT EXISTS allow_member_broadcasts boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified';

ALTER TABLE public.hub_members
  ADD COLUMN IF NOT EXISTS notifications_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_broadcast boolean NOT NULL DEFAULT false;

-- 4. Hub Forums (Subject-Based Communication Spaces within Hubs)
CREATE TABLE IF NOT EXISTS public.hub_forums (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 80),
  description text NOT NULL DEFAULT '',
  forum_type text NOT NULL DEFAULT 'general'
    CHECK (forum_type IN ('general', 'topic', 'restricted', 'announcement')),
  access_level text NOT NULL DEFAULT 'members'
    CHECK (access_level IN ('public', 'members', 'staff_only')),
  allow_member_posts boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hub_id, slug)
);

CREATE INDEX IF NOT EXISTS hub_forums_hub_idx ON public.hub_forums(hub_id, created_at ASC);

-- 5. Hub Forum Memberships & Publishing Permissions
CREATE TABLE IF NOT EXISTS public.hub_forum_members (
  forum_id uuid NOT NULL REFERENCES public.hub_forums(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member'
    CHECK (role IN ('admin', 'moderator', 'publisher', 'member')),
  can_publish boolean NOT NULL DEFAULT true,
  notifications_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (forum_id, user_id)
);

-- 6. Hub Institutional Broadcasts (Distinct from ordinary discussion posts)
CREATE TABLE IF NOT EXISTS public.hub_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  forum_id uuid REFERENCES public.hub_forums(id) ON DELETE SET NULL,
  author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 2 AND 160),
  content text NOT NULL CHECK (char_length(trim(content)) BETWEEN 1 AND 8000),
  broadcast_type text NOT NULL DEFAULT 'announcement'
    CHECK (broadcast_type IN ('announcement', 'news', 'notice', 'event', 'update', 'alert')),
  target_audience text NOT NULL DEFAULT 'all_members'
    CHECK (target_audience IN ('all_members', 'staff', 'forum_members', 'public')),
  is_pinned boolean NOT NULL DEFAULT false,
  is_urgent boolean NOT NULL DEFAULT false,
  media_urls text[] NOT NULL DEFAULT '{}',
  scheduled_for timestamptz,
  published_at timestamptz DEFAULT now(),
  delivery_count integer NOT NULL DEFAULT 0,
  read_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hub_broadcasts_hub_idx
  ON public.hub_broadcasts(hub_id, is_pinned DESC, created_at DESC);

-- 7. Hub Broadcast Engagement / Readership Tracking
CREATE TABLE IF NOT EXISTS public.hub_broadcast_reads (
  broadcast_id uuid NOT NULL REFERENCES public.hub_broadcasts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (broadcast_id, user_id)
);

-- 8. Extend Moments with optional Ping, Forum, and Project associations
ALTER TABLE public.moments
  ADD COLUMN IF NOT EXISTS ping_id uuid REFERENCES public.pings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS forum_id uuid REFERENCES public.hub_forums(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_name text;

-- 9. Grants & Row-Level Security for Hub Forums and Broadcasts
GRANT SELECT ON public.hub_forums, public.hub_broadcasts TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.hub_forums, public.hub_broadcasts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hub_forum_members, public.hub_broadcast_reads TO authenticated;
GRANT ALL ON public.hub_forums, public.hub_forum_members, public.hub_broadcasts, public.hub_broadcast_reads TO service_role;

ALTER TABLE public.hub_forums ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_forum_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_broadcast_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Readable hub forums" ON public.hub_forums;
CREATE POLICY "Readable hub forums" ON public.hub_forums
  FOR SELECT TO anon, authenticated
  USING (
    public.can_view_hub_content(hub_id)
    AND (
      access_level IN ('public', 'members')
      OR public.hub_role(hub_id, auth.uid()) IN ('owner', 'admin', 'moderator')
    )
  );

DROP POLICY IF EXISTS "Hub staff manage forums" ON public.hub_forums;
CREATE POLICY "Hub staff manage forums" ON public.hub_forums
  FOR ALL TO authenticated
  USING (public.hub_role(hub_id, auth.uid()) IN ('owner', 'admin', 'moderator'))
  WITH CHECK (public.hub_role(hub_id, auth.uid()) IN ('owner', 'admin', 'moderator'));

DROP POLICY IF EXISTS "Users view forum memberships" ON public.hub_forum_members;
CREATE POLICY "Users view forum memberships" ON public.hub_forum_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.hub_forums f
      WHERE f.id = hub_forum_members.forum_id
        AND public.can_view_hub_content(f.hub_id)
    )
  );

DROP POLICY IF EXISTS "Users manage own forum membership" ON public.hub_forum_members;
CREATE POLICY "Users manage own forum membership" ON public.hub_forum_members
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users update own forum notifications" ON public.hub_forum_members;
CREATE POLICY "Users update own forum notifications" ON public.hub_forum_members
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Readable hub broadcasts" ON public.hub_broadcasts;
CREATE POLICY "Readable hub broadcasts" ON public.hub_broadcasts
  FOR SELECT TO anon, authenticated
  USING (
    public.can_view_hub_content(hub_id)
    AND (
      scheduled_for IS NULL
      OR scheduled_for <= now()
      OR author_id = auth.uid()
      OR public.hub_role(hub_id, auth.uid()) IN ('owner', 'admin', 'moderator')
    )
  );

DROP POLICY IF EXISTS "Authorized hub staff publish broadcasts" ON public.hub_broadcasts;
CREATE POLICY "Authorized hub staff publish broadcasts" ON public.hub_broadcasts
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND (
      public.hub_role(hub_id, auth.uid()) IN ('owner', 'admin', 'moderator')
      OR EXISTS (
        SELECT 1 FROM public.hub_members hm
        WHERE hm.hub_id = hub_broadcasts.hub_id
          AND hm.user_id = auth.uid()
          AND hm.status = 'active'
          AND hm.can_broadcast = true
      )
    )
  );

DROP POLICY IF EXISTS "Authors or hub staff update broadcasts" ON public.hub_broadcasts;
CREATE POLICY "Authors or hub staff update broadcasts" ON public.hub_broadcasts
  FOR UPDATE TO authenticated
  USING (
    author_id = auth.uid()
    OR public.hub_role(hub_id, auth.uid()) IN ('owner', 'admin', 'moderator')
  )
  WITH CHECK (
    author_id = auth.uid()
    OR public.hub_role(hub_id, auth.uid()) IN ('owner', 'admin', 'moderator')
  );

DROP POLICY IF EXISTS "Authors or hub staff delete broadcasts" ON public.hub_broadcasts;
CREATE POLICY "Authors or hub staff delete broadcasts" ON public.hub_broadcasts
  FOR DELETE TO authenticated
  USING (
    author_id = auth.uid()
    OR public.hub_role(hub_id, auth.uid()) IN ('owner', 'admin', 'moderator')
  );

DROP POLICY IF EXISTS "Users read broadcast receipts" ON public.hub_broadcast_reads;
CREATE POLICY "Users read broadcast receipts" ON public.hub_broadcast_reads
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.hub_broadcasts b
      WHERE b.id = hub_broadcast_reads.broadcast_id
        AND public.hub_role(b.hub_id, auth.uid()) IN ('owner', 'admin', 'moderator')
    )
  );

DROP POLICY IF EXISTS "Users record own broadcast read" ON public.hub_broadcast_reads;
CREATE POLICY "Users record own broadcast read" ON public.hub_broadcast_reads
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 10. Helper RPC to record broadcast read & increment read_count atomically
CREATE OR REPLACE FUNCTION public.mark_hub_broadcast_read(_broadcast_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.hub_broadcast_reads (broadcast_id, user_id)
  VALUES (_broadcast_id, v_uid)
  ON CONFLICT (broadcast_id, user_id) DO NOTHING;

  IF FOUND THEN
    UPDATE public.hub_broadcasts
    SET read_count = read_count + 1
    WHERE id = _broadcast_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_hub_broadcast_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_hub_broadcast_read(uuid) TO authenticated, service_role;
