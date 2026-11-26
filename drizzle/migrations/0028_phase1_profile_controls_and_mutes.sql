-- ==============================================================================
-- Migration 0028: Phase 1 Account Controls, Profile Visibility, Muted Accounts,
-- and Owner-Scoped Account Data Export
-- Forward-only, idempotent SQL migration. Not executed against production without
-- explicit operator approval.
-- ==============================================================================

-- 1. Extend public.profiles with optional location, website URL, and account visibility
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS location text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS website_url text,
  ADD COLUMN IF NOT EXISTS profile_visibility text NOT NULL DEFAULT 'public';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_location_length_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_location_length_check;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_website_url_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_website_url_check;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_visibility_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_visibility_check;
  END IF;
END $$;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_location_length_check
  CHECK (char_length(location) <= 100);

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_website_url_check
  CHECK (
    website_url IS NULL
    OR (website_url ~* '^https?://' AND char_length(website_url) <= 300)
  );

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_visibility_check
  CHECK (profile_visibility IN ('public', 'followers', 'private'));

-- 2. Muted accounts table (strict owner-scoped RLS)
CREATE TABLE IF NOT EXISTS public.user_mutes (
  muter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  muted_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (muter_id, muted_id),
  CONSTRAINT user_mutes_no_self_check CHECK (muter_id <> muted_id)
);

CREATE INDEX IF NOT EXISTS user_mutes_muter_created_idx
  ON public.user_mutes (muter_id, created_at DESC);

ALTER TABLE public.user_mutes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_mutes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.user_mutes TO authenticated;
GRANT ALL ON public.user_mutes TO service_role;

DROP POLICY IF EXISTS "Users read own muted accounts" ON public.user_mutes;
CREATE POLICY "Users read own muted accounts" ON public.user_mutes
  FOR SELECT TO authenticated
  USING (muter_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users mute other accounts" ON public.user_mutes;
CREATE POLICY "Users mute other accounts" ON public.user_mutes
  FOR INSERT TO authenticated
  WITH CHECK (muter_id = (select auth.uid()) AND muted_id <> (select auth.uid()));

DROP POLICY IF EXISTS "Users unmute own muted accounts" ON public.user_mutes;
CREATE POLICY "Users unmute own muted accounts" ON public.user_mutes
  FOR DELETE TO authenticated
  USING (muter_id = (select auth.uid()));

-- 3. Self-service owner-scoped Account Data Export RPC (GDPR / App Store compliance)
CREATE OR REPLACE FUNCTION public.export_my_account_data()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_profile jsonb;
  v_connections jsonb;
  v_pings jsonb;
  v_moments jsonb;
  v_hubs jsonb;
  v_saved jsonb;
  v_blocks jsonb;
  v_mutes jsonb;
  v_privacy jsonb;
  v_wallet jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required to export account data'
      USING ERRCODE = '42501';
  END IF;

  SELECT to_jsonb(p) INTO v_profile
  FROM public.profiles p
  WHERE p.id = v_caller;

  SELECT coalesce(jsonb_agg(to_jsonb(pc) ORDER BY pc.created_at DESC), '[]'::jsonb)
  INTO v_connections
  FROM public.profile_connections pc
  WHERE pc.user_id = v_caller;

  SELECT coalesce(jsonb_agg(to_jsonb(pg) ORDER BY pg.created_at DESC), '[]'::jsonb)
  INTO v_pings
  FROM (
    SELECT id, category, content, image_url, cta_url, cta_label, visibility, created_at, updated_at
    FROM public.pings
    WHERE user_id = v_caller
    ORDER BY created_at DESC
    LIMIT 500
  ) pg;

  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.created_at DESC), '[]'::jsonb)
  INTO v_moments
  FROM (
    SELECT id, media_type, caption, location, audience, created_at, expires_at
    FROM public.moments
    WHERE author_id = v_caller
    ORDER BY created_at DESC
    LIMIT 200
  ) m;

  SELECT coalesce(jsonb_agg(to_jsonb(hm) ORDER BY hm.joined_at DESC), '[]'::jsonb)
  INTO v_hubs
  FROM (
    SELECT hub_id, role, status, joined_at
    FROM public.hub_members
    WHERE user_id = v_caller
    ORDER BY joined_at DESC
    LIMIT 200
  ) hm;

  SELECT coalesce(jsonb_agg(to_jsonb(sp) ORDER BY sp.created_at DESC), '[]'::jsonb)
  INTO v_saved
  FROM (
    SELECT ping_id, created_at
    FROM public.saved_pings
    WHERE user_id = v_caller
    ORDER BY created_at DESC
    LIMIT 200
  ) sp;

  SELECT coalesce(jsonb_agg(to_jsonb(ub) ORDER BY ub.created_at DESC), '[]'::jsonb)
  INTO v_blocks
  FROM (
    SELECT blocked_id, created_at
    FROM public.user_blocks
    WHERE blocker_id = v_caller
  ) ub;

  SELECT coalesce(jsonb_agg(to_jsonb(um) ORDER BY um.created_at DESC), '[]'::jsonb)
  INTO v_mutes
  FROM (
    SELECT muted_id, created_at
    FROM public.user_mutes
    WHERE muter_id = v_caller
  ) um;

  SELECT to_jsonb(upp) INTO v_privacy
  FROM public.user_privacy_preferences upp
  WHERE upp.user_id = v_caller;

  SELECT to_jsonb(dw) INTO v_wallet
  FROM public.dot_wallets dw
  WHERE dw.user_id = v_caller;

  RETURN jsonb_build_object(
    'exported_at', now(),
    'schema_version', 'ping_export_v1',
    'user_id', v_caller,
    'profile', coalesce(v_profile, '{}'::jsonb),
    'connections', v_connections,
    'pings', v_pings,
    'moments', v_moments,
    'hub_memberships', v_hubs,
    'saved_pings', v_saved,
    'blocked_users', v_blocks,
    'muted_users', v_mutes,
    'privacy_preferences', coalesce(v_privacy, '{}'::jsonb),
    'dot_wallet', coalesce(v_wallet, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.export_my_account_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_my_account_data() TO authenticated;
