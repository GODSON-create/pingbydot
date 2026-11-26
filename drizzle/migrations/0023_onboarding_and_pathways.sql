-- ==============================================================================
-- Migration 0023: Phase 1 Universal Onboarding & Optional Participation Pathways
-- ==============================================================================
-- Preserves all existing accounts, profiles, Pings, Hubs, Moments, Signals,
-- DMs, DOT balances, transactions, subscriptions, and RLS policies.
-- Non-destructively backfills existing profiles so returning users go straight
-- into Ping without being interrupted by new-user onboarding.

-- 1. Optional participation pathways & new-user onboarding marker on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS participation_pathways text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_participation_pathways_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_participation_pathways_check;
  END IF;
END $$;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_participation_pathways_check
  CHECK (
    participation_pathways <@ ARRAY[
      'general',
      'creator',
      'business',
      'community',
      'builder',
      'investor'
    ]::text[]
    AND cardinality(participation_pathways) <= 6
  );

-- 2. Backfill existing accounts so returning users restore directly into Ping
UPDATE public.profiles
SET onboarding_completed_at = created_at
WHERE onboarding_completed_at IS NULL;

-- 3. Broaden new-account fallback handle prefix while keeping existing usernames intact
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base text;
  candidate text;
  n int := 0;
BEGIN
  base := lower(
    regexp_replace(
      coalesce(
        NEW.raw_user_meta_data->>'username',
        split_part(coalesce(NEW.email, ''), '@', 1),
        'member'
      ),
      '[^a-zA-Z0-9_]',
      '',
      'g'
    )
  );
  IF char_length(base) < 3 THEN
    base := 'member_' || substr(replace(NEW.id::text, '-', ''), 1, 8);
  END IF;
  base := left(base, 18);
  candidate := base;

  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = candidate) LOOP
    n := n + 1;
    candidate := left(base, 18) || n::text;
  END LOOP;

  INSERT INTO public.profiles (id, username, display_name, avatar_url)
  VALUES (
    NEW.id,
    candidate,
    left(
      coalesce(
        nullif(btrim(NEW.raw_user_meta_data->>'display_name'), ''),
        nullif(btrim(NEW.raw_user_meta_data->>'full_name'), ''),
        nullif(btrim(NEW.raw_user_meta_data->>'name'), ''),
        candidate
      ),
      60
    ),
    nullif(btrim(NEW.raw_user_meta_data->>'avatar_url'), '')
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

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

  v_base := lower(
    regexp_replace(
      coalesce(
        v_user.raw_user_meta_data->>'username',
        split_part(coalesce(v_user.email, ''), '@', 1),
        'member'
      ),
      '[^a-zA-Z0-9_]',
      '',
      'g'
    )
  );
  IF char_length(v_base) < 3 THEN
    v_base := 'member_' || substr(replace(v_caller::text, '-', ''), 1, 8);
  END IF;
  v_base := left(v_base, 18);
  v_candidate := v_base;

  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = v_candidate) LOOP
    v_n := v_n + 1;
    v_candidate := left(v_base, 18) || v_n::text;
  END LOOP;

  INSERT INTO public.profiles (id, username, display_name, avatar_url)
  VALUES (
    v_caller,
    v_candidate,
    left(
      coalesce(
        nullif(btrim(v_user.raw_user_meta_data->>'display_name'), ''),
        nullif(btrim(v_user.raw_user_meta_data->>'full_name'), ''),
        nullif(btrim(v_user.raw_user_meta_data->>'name'), ''),
        v_candidate
      ),
      60
    ),
    nullif(btrim(v_user.raw_user_meta_data->>'avatar_url'), '')
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_caller;
  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_profile() TO authenticated;

-- 4. Universal simple onboarding completion RPC (supports skipping or saving pathways)
CREATE OR REPLACE FUNCTION public.complete_my_onboarding(
  _display_name text DEFAULT NULL,
  _username text DEFAULT NULL,
  _bio text DEFAULT NULL,
  _avatar_url text DEFAULT NULL,
  _participation_pathways text[] DEFAULT NULL,
  _skip boolean DEFAULT false
) RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_profile public.profiles;
  v_username text;
  v_display text;
  v_bio text;
  v_avatar text;
  v_pathways text[];
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  v_profile := public.ensure_my_profile();

  IF coalesce(_skip, false) THEN
    UPDATE public.profiles
    SET onboarding_completed_at = coalesce(onboarding_completed_at, now())
    WHERE id = v_caller
    RETURNING * INTO v_profile;

    RETURN v_profile;
  END IF;

  v_display := coalesce(nullif(btrim(_display_name), ''), v_profile.display_name);
  IF char_length(v_display) > 60 THEN
    RAISE EXCEPTION 'Display name must be 60 characters or fewer';
  END IF;

  v_username := coalesce(nullif(lower(btrim(_username)), ''), v_profile.username);
  IF v_username !~ '^[a-z0-9_]{3,24}$' THEN
    RAISE EXCEPTION 'Username must be 3-24 lowercase letters, numbers, or underscores';
  END IF;

  v_bio := coalesce(btrim(_bio), v_profile.bio);
  IF char_length(v_bio) > 280 THEN
    RAISE EXCEPTION 'Bio must be 280 characters or fewer';
  END IF;

  IF _avatar_url IS NOT NULL THEN
    v_avatar := nullif(btrim(_avatar_url), '');
  ELSE
    v_avatar := v_profile.avatar_url;
  END IF;

  IF _participation_pathways IS NULL THEN
    v_pathways := coalesce(v_profile.participation_pathways, '{}');
  ELSE
    SELECT coalesce(array_agg(DISTINCT p), '{}')
    INTO v_pathways
    FROM unnest(_participation_pathways) AS p
    WHERE p = ANY (ARRAY['general', 'creator', 'business', 'community', 'builder', 'investor']::text[]);
  END IF;

  UPDATE public.profiles
  SET
    display_name = v_display,
    username = v_username,
    bio = v_bio,
    avatar_url = v_avatar,
    participation_pathways = v_pathways,
    onboarding_completed_at = coalesce(onboarding_completed_at, now())
  WHERE id = v_caller
  RETURNING * INTO v_profile;

  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_my_onboarding(text, text, text, text, text[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_my_onboarding(text, text, text, text, text[], boolean) TO authenticated;
