-- 0030_phase3_multimedia_music_and_distribution.sql
-- Phase 3: Unified Multimedia Publishing, Video Pipeline, Reusable Music Attachments,
-- Copyright Reporting & Universal Share Analytics.
-- Forward-only, idempotent, strict RLS (zero open USING (true) policies).

-- ============================================================================
-- 1. UNIFIED MULTIMEDIA COLUMNS ON PINGS (Phase 3.1 & 3.3)
-- ============================================================================

ALTER TABLE public.pings
  ADD COLUMN IF NOT EXISTS content_format text NOT NULL DEFAULT 'text'
    CHECK (content_format IN ('text', 'image', 'video')),
  ADD COLUMN IF NOT EXISTS location_tag text,
  ADD COLUMN IF NOT EXISTS poster_url text,
  ADD COLUMN IF NOT EXISTS captions_text text,
  ADD COLUMN IF NOT EXISTS media_duration_sec integer
    CHECK (media_duration_sec IS NULL OR media_duration_sec >= 0),
  ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'ready'
    CHECK (processing_status IN ('pending', 'processing', 'ready', 'failed')),
  ADD COLUMN IF NOT EXISTS imported_source_url text,
  ADD COLUMN IF NOT EXISTS imported_source_platform text;

CREATE INDEX IF NOT EXISTS pings_content_format_created_idx
  ON public.pings (content_format, created_at DESC)
  WHERE hidden_at IS NULL;

-- ============================================================================
-- 2. PROVIDER-AGNOSTIC MEDIA ASSETS & VIDEO ANALYTICS (Phase 3.2 & 3.3)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ping_id uuid REFERENCES public.pings(id) ON DELETE CASCADE,
  media_kind text NOT NULL CHECK (media_kind IN ('image', 'video', 'audio')),
  provider text NOT NULL DEFAULT 'supabase_storage'
    CHECK (provider IN ('supabase_storage', 'mux', 'cloudflare_stream', 'external_pending')),
  provider_asset_id text,
  source_url text NOT NULL,
  playback_url text,
  poster_url text,
  captions_vtt_url text,
  duration_sec integer CHECK (duration_sec IS NULL OR duration_sec >= 0),
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  status text NOT NULL DEFAULT 'ready'
    CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS media_assets_owner_idx ON public.media_assets (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS media_assets_ping_idx ON public.media_assets (ping_id);

ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ready media assets on visible pings readable" ON public.media_assets;
CREATE POLICY "Ready media assets on visible pings readable" ON public.media_assets
  FOR SELECT TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND owner_id = auth.uid())
    OR (
      status = 'ready'
      AND ping_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.pings p WHERE p.id = media_assets.ping_id AND p.hidden_at IS NULL
      )
    )
  );

DROP POLICY IF EXISTS "Users create own media assets" ON public.media_assets;
CREATE POLICY "Users create own media assets" ON public.media_assets
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users update own media assets" ON public.media_assets;
CREATE POLICY "Users update own media assets" ON public.media_assets
  FOR UPDATE TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE TABLE IF NOT EXISTS public.ping_video_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ping_id uuid NOT NULL REFERENCES public.pings(id) ON DELETE CASCADE,
  viewer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  watch_seconds integer NOT NULL DEFAULT 0 CHECK (watch_seconds >= 0 AND watch_seconds <= 86400),
  completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ping_video_views_ping_idx ON public.ping_video_views (ping_id, created_at DESC);
ALTER TABLE public.ping_video_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authors and viewers read video views" ON public.ping_video_views;
CREATE POLICY "Authors and viewers read video views" ON public.ping_video_views
  FOR SELECT TO authenticated
  USING (
    viewer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.pings p WHERE p.id = ping_video_views.ping_id AND p.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.record_ping_video_view(
  p_ping_id uuid,
  p_watch_seconds integer DEFAULT 0,
  p_completed boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sec integer := greatest(0, least(coalesce(p_watch_seconds, 0), 86400));
  v_total bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pings WHERE id = p_ping_id AND hidden_at IS NULL) THEN
    RAISE EXCEPTION 'Ping not found';
  END IF;

  INSERT INTO public.ping_video_views (ping_id, viewer_id, watch_seconds, completed)
  VALUES (p_ping_id, v_uid, v_sec, coalesce(p_completed, false));

  SELECT count(*) INTO v_total FROM public.ping_video_views WHERE ping_id = p_ping_id;
  RETURN jsonb_build_object('ping_id', p_ping_id, 'views', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.record_ping_video_view(uuid, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_ping_video_view(uuid, integer, boolean) TO anon, authenticated;

-- ============================================================================
-- 3. COPYRIGHT & OWNERSHIP REPORTING (Phase 3.3 & 3.4)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.copyright_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('ping', 'moment', 'music_track', 'media_asset')),
  target_id text NOT NULL CHECK (char_length(trim(target_id)) BETWEEN 1 AND 120),
  claim_type text NOT NULL CHECK (claim_type IN ('copyright', 'trademark', 'unauthorized_audio', 'impersonation')),
  rights_owner_name text NOT NULL CHECK (char_length(trim(rights_owner_name)) BETWEEN 2 AND 160),
  evidence_url text,
  details text NOT NULL CHECK (char_length(trim(details)) BETWEEN 10 AND 3000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'actioned', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS copyright_reports_status_idx ON public.copyright_reports (status, created_at DESC);
ALTER TABLE public.copyright_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Reporters and admins view copyright reports" ON public.copyright_reports;
CREATE POLICY "Reporters and admins view copyright reports" ON public.copyright_reports
  FOR SELECT TO authenticated
  USING (auth.uid() = reporter_id OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users file copyright reports" ON public.copyright_reports;
CREATE POLICY "Authenticated users file copyright reports" ON public.copyright_reports
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = reporter_id AND status = 'open');

DROP POLICY IF EXISTS "Admins update copyright reports" ON public.copyright_reports;
CREATE POLICY "Admins update copyright reports" ON public.copyright_reports
  FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- ============================================================================
-- 4. REUSABLE MUSIC & AUDIO ATTACHMENTS (Phase 3.4)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.music_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 140),
  artist text NOT NULL CHECK (char_length(trim(artist)) BETWEEN 1 AND 140),
  duration_sec integer NOT NULL CHECK (duration_sec BETWEEN 1 AND 1800),
  preview_url text,
  license_status text NOT NULL DEFAULT 'original_user'
    CHECK (license_status IN ('original_user', 'licensed_catalog', 'rights_pending', 'taken_down')),
  provider text NOT NULL DEFAULT 'user_original',
  provider_track_id text,
  available_regions text[] NOT NULL DEFAULT ARRAY['GLOBAL']::text[],
  uploader_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ownership_declared boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS music_tracks_license_idx ON public.music_tracks (license_status, created_at DESC);
ALTER TABLE public.music_tracks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cleared music tracks readable" ON public.music_tracks;
CREATE POLICY "Cleared music tracks readable" ON public.music_tracks
  FOR SELECT TO anon, authenticated
  USING (
    license_status IN ('original_user', 'licensed_catalog')
    OR (auth.uid() IS NOT NULL AND uploader_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users upload declared original audio tracks" ON public.music_tracks;
CREATE POLICY "Users upload declared original audio tracks" ON public.music_tracks
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = uploader_id
    AND license_status = 'original_user'
    AND ownership_declared = true
  );

CREATE TABLE IF NOT EXISTS public.content_music_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK (target_type IN ('ping', 'moment')),
  target_id uuid NOT NULL,
  track_id text NOT NULL,
  track_title text NOT NULL CHECK (char_length(trim(track_title)) BETWEEN 1 AND 140),
  track_artist text NOT NULL CHECK (char_length(trim(track_artist)) BETWEEN 1 AND 140),
  preview_url text,
  clip_start_sec integer NOT NULL DEFAULT 0 CHECK (clip_start_sec >= 0),
  clip_duration_sec integer NOT NULL DEFAULT 30 CHECK (clip_duration_sec BETWEEN 5 AND 180),
  attribution_text text NOT NULL DEFAULT '',
  license_status text NOT NULL DEFAULT 'original_user'
    CHECK (license_status IN ('original_user', 'licensed_catalog', 'rights_pending', 'taken_down')),
  available_regions text[] NOT NULL DEFAULT ARRAY['GLOBAL']::text[],
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_type, target_id)
);

CREATE INDEX IF NOT EXISTS content_music_target_idx
  ON public.content_music_attachments (target_type, target_id);
ALTER TABLE public.content_music_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Music attachments on visible content readable" ON public.content_music_attachments;
CREATE POLICY "Music attachments on visible content readable" ON public.content_music_attachments
  FOR SELECT TO anon, authenticated
  USING (
    (auth.uid() IS NOT NULL AND created_by = auth.uid())
    OR (
      target_type = 'ping'
      AND EXISTS (
        SELECT 1 FROM public.pings p WHERE p.id = content_music_attachments.target_id AND p.hidden_at IS NULL
      )
    )
    OR (
      target_type = 'moment'
      AND EXISTS (
        SELECT 1 FROM public.moments m WHERE m.id = content_music_attachments.target_id AND m.audience = 'public'
      )
    )
  );

DROP POLICY IF EXISTS "Creators attach music to own content" ON public.content_music_attachments;
CREATE POLICY "Creators attach music to own content" ON public.content_music_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND license_status IN ('original_user', 'licensed_catalog')
  );

DROP POLICY IF EXISTS "Creators remove own music attachments" ON public.content_music_attachments;
CREATE POLICY "Creators remove own music attachments" ON public.content_music_attachments
  FOR DELETE TO authenticated
  USING (auth.uid() = created_by);

-- ============================================================================
-- 5. UNIVERSAL SHARE ANALYTICS & REFERRAL ATTRIBUTION (Phase 3.7 & 3.10)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.share_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sharer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_type text NOT NULL CHECK (
    target_type IN ('ping', 'moment', 'hub', 'signal', 'profile', 'opportunity', 'business')
  ),
  target_id text NOT NULL CHECK (char_length(trim(target_id)) BETWEEN 1 AND 120),
  destination text NOT NULL DEFAULT 'unknown' CHECK (
    destination IN (
      'native_share', 'copy_link', 'download_card', 'whatsapp', 'instagram',
      'snapchat', 'x', 'facebook', 'telegram', 'linkedin', 'email', 'sms', 'hub', 'unknown'
    )
  ),
  event_kind text NOT NULL CHECK (
    event_kind IN (
      'share_initiated', 'link_clicked', 'preview_impression',
      'signup_attributed', 'post_referral_engagement'
    )
  ),
  share_code text,
  referrer_domain text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS share_events_target_idx ON public.share_events (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS share_events_code_idx ON public.share_events (share_code) WHERE share_code IS NOT NULL;
ALTER TABLE public.share_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Sharers and admins read own share analytics" ON public.share_events;
CREATE POLICY "Sharers and admins read own share analytics" ON public.share_events
  FOR SELECT TO authenticated
  USING (sharer_id = auth.uid() OR public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.record_share_event(
  p_target_type text,
  p_target_id text,
  p_event_kind text,
  p_destination text DEFAULT 'unknown',
  p_share_code text DEFAULT NULL,
  p_referrer_domain text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.share_events (
    sharer_id, target_type, target_id, event_kind, destination, share_code, referrer_domain
  )
  VALUES (
    auth.uid(),
    p_target_type,
    trim(p_target_id),
    p_event_kind,
    coalesce(NULLIF(trim(p_destination), ''), 'unknown'),
    NULLIF(trim(coalesce(p_share_code, '')), ''),
    NULLIF(left(trim(coalesce(p_referrer_domain, '')), 120), '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_share_event(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_share_event(text, text, text, text, text, text) TO anon, authenticated;
