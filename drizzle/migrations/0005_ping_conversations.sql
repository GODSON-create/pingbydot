CREATE TABLE public.comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 ping_id uuid NOT NULL REFERENCES public.pings(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 parent_id uuid REFERENCES public.comments(id) ON DELETE CASCADE,
 root_id uuid,
 depth smallint NOT NULL DEFAULT 0,
 content text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz,
 hidden_at timestamptz,
 CONSTRAINT comments_content_len CHECK (deleted_at IS NOT NULL OR char_length(btrim(content)) BETWEEN 1 AND 1000),
 CONSTRAINT comments_depth_range CHECK (depth BETWEEN 0 AND 2)
);
CREATE INDEX comments_ping_root_idx ON public.comments (ping_id, depth, created_at, id);
CREATE INDEX comments_root_idx ON public.comments (root_id, created_at, id);
CREATE INDEX comments_moderation_idx ON public.comments (hidden_at, created_at DESC);
GRANT SELECT ON public.comments TO anon;
GRANT SELECT, INSERT, UPDATE ON public.comments TO authenticated;
GRANT ALL ON public.comments TO service_role;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Comments are public" ON public.comments FOR SELECT TO anon, authenticated
 USING (hidden_at IS NULL AND EXISTS (SELECT 1 FROM public.pings p WHERE p.id = ping_id AND p.hidden_at IS NULL));
CREATE POLICY "Owners read own comments" ON public.comments FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users comment as self" ON public.comments FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own comments" ON public.comments FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE FUNCTION public.guard_comment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE par public.comments; is_client boolean := current_user IN ('anon','authenticated');
BEGIN
 IF TG_OP = 'INSERT' THEN
  IF is_client AND NEW.hidden_at IS NOT NULL THEN RAISE EXCEPTION 'Moderation fields are protected'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pings WHERE id = NEW.ping_id AND hidden_at IS NULL) THEN RAISE EXCEPTION 'Ping unavailable'; END IF;
  NEW.content := btrim(NEW.content); NEW.deleted_at := NULL; NEW.created_at := now(); NEW.updated_at := now();
  IF NEW.parent_id IS NULL THEN NEW.depth := 0; NEW.root_id := NEW.id;
  ELSE
   SELECT * INTO par FROM public.comments WHERE id = NEW.parent_id;
   IF par.id IS NULL OR par.ping_id <> NEW.ping_id OR par.hidden_at IS NOT NULL OR par.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Reply target unavailable'; END IF;
   IF par.depth >= 2 THEN NEW.parent_id := par.parent_id; NEW.depth := 2; ELSE NEW.depth := par.depth + 1; END IF;
   NEW.root_id := par.root_id;
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.id <> OLD.id OR NEW.ping_id <> OLD.ping_id OR NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.root_id IS DISTINCT FROM OLD.root_id OR NEW.depth <> OLD.depth OR NEW.user_id <> OLD.user_id OR NEW.created_at <> OLD.created_at THEN RAISE EXCEPTION 'Comment thread fields are immutable'; END IF;
 IF is_client AND NEW.hidden_at IS DISTINCT FROM OLD.hidden_at THEN RAISE EXCEPTION 'Moderation fields are protected'; END IF;
 IF OLD.deleted_at IS NOT NULL AND (NEW.deleted_at IS NULL OR NEW.content <> OLD.content) THEN RAISE EXCEPTION 'Deleted comments cannot be changed'; END IF;
 IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN NEW.deleted_at := now(); NEW.content := ''; END IF;
 IF NEW.content IS DISTINCT FROM OLD.content AND NEW.deleted_at IS NULL THEN NEW.content := btrim(NEW.content); NEW.updated_at := now(); END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.guard_comment() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_comment BEFORE INSERT OR UPDATE ON public.comments FOR EACH ROW EXECUTE FUNCTION public.guard_comment();

CREATE TABLE public.comment_likes (
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 comment_id uuid NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id, comment_id)
);
CREATE INDEX comment_likes_comment_idx ON public.comment_likes (comment_id);
GRANT SELECT ON public.comment_likes TO anon;
GRANT SELECT, INSERT, DELETE ON public.comment_likes TO authenticated;
GRANT ALL ON public.comment_likes TO service_role;
ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Comment likes are public" ON public.comment_likes FOR SELECT TO anon, authenticated
 USING (EXISTS (SELECT 1 FROM public.comments c WHERE c.id = comment_id AND c.hidden_at IS NULL AND c.deleted_at IS NULL));
CREATE POLICY "Users like comments as self" ON public.comment_likes FOR INSERT TO authenticated
 WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.comments c WHERE c.id = comment_id AND c.hidden_at IS NULL AND c.deleted_at IS NULL));
CREATE POLICY "Users unlike own comment likes" ON public.comment_likes FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.comment_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 comment_id uuid NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
 reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 60),
 details text CHECK (details IS NULL OR char_length(details) <= 500),
 created_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz,
 UNIQUE (comment_id, reporter_id)
);
CREATE INDEX comment_reports_open_idx ON public.comment_reports (resolved_at, created_at DESC);
GRANT INSERT ON public.comment_reports TO authenticated;
GRANT ALL ON public.comment_reports TO service_role;
ALTER TABLE public.comment_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users report comments as self" ON public.comment_reports FOR INSERT TO authenticated WITH CHECK (reporter_id = auth.uid() AND resolved_at IS NULL);

CREATE TABLE public.notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('ping_reply','comment_reply')),
 ping_id uuid NOT NULL REFERENCES public.pings(id) ON DELETE CASCADE,
 comment_id uuid NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
 read_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON public.notifications (user_id, created_at DESC);
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own notifications" ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Mark own notifications read" ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE FUNCTION public.notify_comment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ping_author uuid; parent_author uuid;
BEGIN
 SELECT user_id INTO ping_author FROM public.pings WHERE id = NEW.ping_id;
 IF NEW.parent_id IS NOT NULL THEN SELECT user_id INTO parent_author FROM public.comments WHERE id = NEW.parent_id; END IF;
 IF parent_author IS NOT NULL AND parent_author <> NEW.user_id THEN
  INSERT INTO public.notifications(user_id, actor_id, kind, ping_id, comment_id) VALUES (parent_author, NEW.user_id, 'comment_reply', NEW.ping_id, NEW.id);
 END IF;
 IF ping_author IS NOT NULL AND ping_author <> NEW.user_id AND ping_author IS DISTINCT FROM parent_author THEN
  INSERT INTO public.notifications(user_id, actor_id, kind, ping_id, comment_id) VALUES (ping_author, NEW.user_id, 'ping_reply', NEW.ping_id, NEW.id);
 END IF;
 RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.notify_comment() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER notify_comment AFTER INSERT ON public.comments FOR EACH ROW EXECUTE FUNCTION public.notify_comment();

ALTER TABLE public.pings ADD COLUMN source_ping_id uuid REFERENCES public.pings(id) ON DELETE SET NULL;
ALTER TABLE public.pings ADD COLUMN source_comment_id uuid REFERENCES public.comments(id) ON DELETE SET NULL;
CREATE FUNCTION public.guard_reping() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF TG_OP = 'UPDATE' THEN
  IF NEW.source_ping_id IS DISTINCT FROM OLD.source_ping_id OR NEW.source_comment_id IS DISTINCT FROM OLD.source_comment_id THEN
   IF current_user IN ('anon','authenticated') THEN RAISE EXCEPTION 'Reping source is immutable'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.source_comment_id IS NOT NULL THEN
  IF NOT EXISTS (SELECT 1 FROM public.comments c JOIN public.pings p ON p.id = c.ping_id
    WHERE c.id = NEW.source_comment_id AND c.hidden_at IS NULL AND c.deleted_at IS NULL AND p.hidden_at IS NULL) THEN
   RAISE EXCEPTION 'Original reply unavailable'; END IF;
  NEW.source_ping_id := (SELECT ping_id FROM public.comments WHERE id = NEW.source_comment_id);
 ELSIF NEW.source_ping_id IS NOT NULL THEN
  RAISE EXCEPTION 'Reping source must be a reply';
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.guard_reping() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_reping BEFORE INSERT OR UPDATE ON public.pings FOR EACH ROW EXECUTE FUNCTION public.guard_reping();

CREATE OR REPLACE FUNCTION public.admin_moderate(_actor uuid, _target uuid, _action text, _reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _actor AND role = 'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF length(trim(_reason)) < 3 OR length(_reason) > 500 THEN RAISE EXCEPTION 'Reason required'; END IF;
 IF _action = 'hide' THEN UPDATE public.pings SET hidden_at = now() WHERE id = _target;
 ELSIF _action = 'restore' THEN UPDATE public.pings SET hidden_at = NULL WHERE id = _target;
 ELSIF _action = 'resolve_report' THEN UPDATE public.reports SET resolved_at = now() WHERE id = _target;
 ELSIF _action = 'hide_comment' THEN UPDATE public.comments SET hidden_at = now() WHERE id = _target;
 ELSIF _action = 'restore_comment' THEN UPDATE public.comments SET hidden_at = NULL WHERE id = _target;
 ELSIF _action = 'resolve_comment_report' THEN UPDATE public.comment_reports SET resolved_at = now() WHERE id = _target;
 ELSE RAISE EXCEPTION 'Invalid action'; END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Not found'; END IF;
 INSERT INTO public.moderation_audit(actor_id,action,target_id,reason) VALUES (_actor,_action,_target,trim(_reason));
 END; $$;
REVOKE ALL ON FUNCTION public.admin_moderate(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_moderate(uuid,uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_metrics() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT jsonb_build_object(
 'accounts', (SELECT count(*) FROM auth.users),
 'activeCreators30d', (SELECT count(DISTINCT user_id) FROM public.pings WHERE created_at >= now() - interval '30 days'),
 'pings', (SELECT count(*) FROM public.pings),
 'hiddenPings', (SELECT count(*) FROM public.pings WHERE hidden_at IS NOT NULL),
 'likes', (SELECT count(*) FROM public.likes),
 'openReports', (SELECT count(*) FROM public.reports WHERE resolved_at IS NULL),
 'comments', (SELECT count(*) FROM public.comments WHERE deleted_at IS NULL),
 'hiddenComments', (SELECT count(*) FROM public.comments WHERE hidden_at IS NOT NULL),
 'openCommentReports', (SELECT count(*) FROM public.comment_reports WHERE resolved_at IS NULL),
 'checkedAt', now()); $$;
REVOKE ALL ON FUNCTION public.admin_metrics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_metrics() TO service_role;