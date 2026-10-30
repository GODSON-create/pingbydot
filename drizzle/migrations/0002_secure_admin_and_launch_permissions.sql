CREATE TABLE public.user_roles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 role text NOT NULL DEFAULT 'admin' CHECK (role = 'admin'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own role" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE FUNCTION public.is_ping_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'); $$;
REVOKE ALL ON FUNCTION public.is_ping_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_ping_admin() TO authenticated, service_role;
CREATE TABLE public.moderation_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid, action text NOT NULL,
 target_id uuid NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.moderation_audit TO authenticated;
GRANT ALL ON public.moderation_audit TO service_role;
ALTER TABLE public.moderation_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read audit" ON public.moderation_audit FOR SELECT TO authenticated USING (public.is_ping_admin());
ALTER TABLE public.pings ADD COLUMN hidden_at timestamptz;
ALTER TABLE public.reports ADD COLUMN resolved_at timestamptz;
CREATE INDEX pings_hidden_created_idx ON public.pings (hidden_at, created_at DESC);
CREATE INDEX reports_unresolved_created_idx ON public.reports (resolved_at, created_at DESC);
CREATE INDEX moderation_audit_created_idx ON public.moderation_audit (created_at DESC);
GRANT SELECT ON public.profiles, public.pings, public.likes TO anon;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pings TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.likes TO authenticated;
GRANT INSERT ON public.reports TO authenticated;
GRANT ALL ON public.profiles, public.pings, public.likes, public.reports TO service_role;
ALTER POLICY "Pings are public" ON public.pings USING (hidden_at IS NULL);
CREATE POLICY "Owners read hidden Pings" ON public.pings FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE FUNCTION public.protect_ping_moderation() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$ BEGIN
 IF current_user IN ('anon','authenticated') AND ((TG_OP = 'INSERT' AND NEW.hidden_at IS NOT NULL) OR (TG_OP = 'UPDATE' AND NEW.hidden_at IS DISTINCT FROM OLD.hidden_at)) THEN RAISE EXCEPTION 'Moderation fields are protected'; END IF;
 RETURN NEW; END; $$;
CREATE TRIGGER protect_ping_moderation BEFORE INSERT OR UPDATE ON public.pings FOR EACH ROW EXECUTE FUNCTION public.protect_ping_moderation();
CREATE FUNCTION public.admin_moderate(_actor uuid, _target uuid, _action text, _reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _actor AND role = 'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF length(trim(_reason)) < 3 OR length(_reason) > 500 THEN RAISE EXCEPTION 'Reason required'; END IF;
 IF _action = 'hide' THEN UPDATE public.pings SET hidden_at = now() WHERE id = _target;
 ELSIF _action = 'restore' THEN UPDATE public.pings SET hidden_at = NULL WHERE id = _target;
 ELSIF _action = 'resolve_report' THEN UPDATE public.reports SET resolved_at = now() WHERE id = _target;
 ELSE RAISE EXCEPTION 'Invalid action'; END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Not found'; END IF;
 INSERT INTO public.moderation_audit(actor_id,action,target_id,reason) VALUES (_actor,_action,_target,trim(_reason));
 END; $$;
REVOKE ALL ON FUNCTION public.admin_moderate(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_moderate(uuid,uuid,text,text) TO service_role;
CREATE FUNCTION public.audit_admin_role_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN
 INSERT INTO public.moderation_audit(actor_id,action,target_id,reason) VALUES (auth.uid(), CASE WHEN TG_OP = 'INSERT' THEN 'grant_admin' ELSE 'revoke_admin' END, CASE WHEN TG_OP = 'INSERT' THEN NEW.user_id ELSE OLD.user_id END, 'Trusted manual role change');
 RETURN NULL; END; $$;
CREATE TRIGGER audit_admin_roles AFTER INSERT OR DELETE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.audit_admin_role_change();
CREATE FUNCTION public.admin_metrics() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT jsonb_build_object(
 'accounts', (SELECT count(*) FROM auth.users),
 'activeCreators30d', (SELECT count(DISTINCT user_id) FROM public.pings WHERE created_at >= now() - interval '30 days'),
 'pings', (SELECT count(*) FROM public.pings),
 'hiddenPings', (SELECT count(*) FROM public.pings WHERE hidden_at IS NOT NULL),
 'likes', (SELECT count(*) FROM public.likes),
 'openReports', (SELECT count(*) FROM public.reports WHERE resolved_at IS NULL),
 'checkedAt', now()); $$;
REVOKE ALL ON FUNCTION public.admin_metrics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_metrics() TO service_role;