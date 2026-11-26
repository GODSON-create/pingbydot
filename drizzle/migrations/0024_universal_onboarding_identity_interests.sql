-- ==============================================================================
-- Migration 0024: Phase 1 Workstream 2 Universal Onboarding (Identity & Interests)
-- ==============================================================================
-- Extends existing `public.profiles` cleanly without creating a second profile table.
-- Preserves all existing profiles, Pings, Hubs, Moments, Signals, DMs, and RLS policies.

-- 1. Add optional Country and Interest topic categories on public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS interests text[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_country_length_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_country_length_check;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_interests_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_interests_check;
  END IF;
END $$;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_country_length_check
  CHECK (char_length(country) <= 80);

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_interests_check
  CHECK (
    interests <@ ARRAY[
      'technology',
      'business',
      'education',
      'entertainment',
      'lifestyle',
      'communities',
      'creativity',
      'opportunities',
      'culture',
      'other'
    ]::text[]
    AND cardinality(interests) <= 10
  );

-- 2. Replace 6-argument overload so PostgREST resolves a single RPC unambiguously
DROP FUNCTION IF EXISTS public.complete_my_onboarding(text, text, text, text, text[], boolean);

CREATE OR REPLACE FUNCTION public.complete_my_onboarding(
  _display_name text DEFAULT NULL,
  _username text DEFAULT NULL,
  _bio text DEFAULT NULL,
  _avatar_url text DEFAULT NULL,
  _participation_pathways text[] DEFAULT NULL,
  _skip boolean DEFAULT false,
  _country text DEFAULT NULL,
  _interests text[] DEFAULT NULL,
  _mark_complete boolean DEFAULT true
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
  v_country text;
  v_pathways text[];
  v_interests text[];
  v_completed_at timestamptz;
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

  IF _country IS NOT NULL THEN
    v_country := btrim(_country);
  ELSE
    v_country := coalesce(v_profile.country, '');
  END IF;
  IF char_length(v_country) > 80 THEN
    RAISE EXCEPTION 'Country must be 80 characters or fewer';
  END IF;

  IF _participation_pathways IS NULL THEN
    v_pathways := coalesce(v_profile.participation_pathways, '{}');
  ELSE
    SELECT coalesce(array_agg(DISTINCT p), '{}')
    INTO v_pathways
    FROM unnest(_participation_pathways) AS p
    WHERE p = ANY (ARRAY['general', 'creator', 'business', 'community', 'builder', 'investor']::text[]);
  END IF;

  IF _interests IS NULL THEN
    v_interests := coalesce(v_profile.interests, '{}');
  ELSE
    SELECT coalesce(array_agg(DISTINCT i), '{}')
    INTO v_interests
    FROM unnest(_interests) AS i
    WHERE i = ANY (
      ARRAY[
        'technology',
        'business',
        'education',
        'entertainment',
        'lifestyle',
        'communities',
        'creativity',
        'opportunities',
        'culture',
        'other'
      ]::text[]
    );
  END IF;

  IF coalesce(_mark_complete, true) THEN
    v_completed_at := coalesce(v_profile.onboarding_completed_at, now());
  ELSE
    v_completed_at := v_profile.onboarding_completed_at;
  END IF;

  UPDATE public.profiles
  SET
    display_name = v_display,
    username = v_username,
    bio = v_bio,
    avatar_url = v_avatar,
    country = v_country,
    participation_pathways = v_pathways,
    interests = v_interests,
    onboarding_completed_at = v_completed_at
  WHERE id = v_caller
  RETURNING * INTO v_profile;

  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_my_onboarding(text, text, text, text, text[], boolean, text, text[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_my_onboarding(text, text, text, text, text[], boolean, text, text[], boolean) TO authenticated;
