-- ============================================================================
-- MIGRATION 0043: CLIPS INTERACTION COUNTERS, SHARE RPC & PROFILE INDEX
-- ============================================================================
-- Additive, forward-only enhancement layered safely on top of
-- 0034_ping_learn_spotlight_and_clips.sql and 0041_stage2_phase2_security_reliability_and_retention.sql.
--
-- Adds:
-- 1. Composite creator timeline index for fast Profile Clips tab queries.
-- 2. SECURITY DEFINER counter triggers keeping ping_clips.likes_count,
--    saves_count, and replies_count synchronized with clip_likes, clip_saves,
--    and clip_replies without weakening RLS.
-- 3. Authenticated record_clip_share(uuid) RPC matching record_clip_view().
-- ============================================================================

CREATE INDEX IF NOT EXISTS ping_clips_creator_created_idx
  ON public.ping_clips (creator_id, created_at DESC)
  WHERE hidden_at IS NULL;

CREATE OR REPLACE FUNCTION public.sync_clip_likes_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.ping_clips
      SET likes_count = GREATEST(0, likes_count + 1)
      WHERE id = NEW.clip_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.ping_clips
      SET likes_count = GREATEST(0, likes_count - 1)
      WHERE id = OLD.clip_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_clip_likes_count ON public.clip_likes;
CREATE TRIGGER trg_sync_clip_likes_count
  AFTER INSERT OR DELETE ON public.clip_likes
  FOR EACH ROW EXECUTE FUNCTION public.sync_clip_likes_count();

CREATE OR REPLACE FUNCTION public.sync_clip_saves_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.ping_clips
      SET saves_count = GREATEST(0, saves_count + 1)
      WHERE id = NEW.clip_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.ping_clips
      SET saves_count = GREATEST(0, saves_count - 1)
      WHERE id = OLD.clip_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_clip_saves_count ON public.clip_saves;
CREATE TRIGGER trg_sync_clip_saves_count
  AFTER INSERT OR DELETE ON public.clip_saves
  FOR EACH ROW EXECUTE FUNCTION public.sync_clip_saves_count();

CREATE OR REPLACE FUNCTION public.sync_clip_replies_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.ping_clips
      SET replies_count = GREATEST(0, replies_count + 1)
      WHERE id = NEW.clip_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.ping_clips
      SET replies_count = GREATEST(0, replies_count - 1)
      WHERE id = OLD.clip_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_clip_replies_count ON public.clip_replies;
CREATE TRIGGER trg_sync_clip_replies_count
  AFTER INSERT OR DELETE ON public.clip_replies
  FOR EACH ROW EXECUTE FUNCTION public.sync_clip_replies_count();

CREATE OR REPLACE FUNCTION public.record_clip_share(p_clip_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.ping_clips
    SET shares_count = shares_count + 1
    WHERE id = p_clip_id AND hidden_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.record_clip_share(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_clip_share(uuid) TO anon, authenticated;
