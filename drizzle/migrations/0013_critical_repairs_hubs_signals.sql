-- 0013_critical_repairs_hubs_signals.sql
-- Fixes critical authorization loophole on signal_publishers, adds publisher management,
-- adds institutional signal verification RPC, and adds hub editing RPC.

-- 1. Security Fix: Remove privilege escalation hole on signal_publishers
DROP POLICY IF EXISTS "Signal admins manage publishers" ON public.signal_publishers;
CREATE POLICY "Signal admins manage publishers" ON public.signal_publishers FOR INSERT TO authenticated
  WITH CHECK (public.signal_role(signal_id, (select auth.uid())) = 'admin');

-- 2. Signal Publisher Management RPC
CREATE OR REPLACE FUNCTION public.manage_signal_publisher(
  _signal uuid,
  _username text,
  _action text,
  _role text DEFAULT 'publisher'
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _caller uuid := auth.uid();
  _target_user uuid;
  _sig public.signals;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Sign in to manage publishers';
  END IF;

  SELECT * INTO _sig FROM public.signals WHERE id = _signal;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Signal channel not found';
  END IF;

  -- Verify caller is admin of this signal
  IF public.signal_role(_signal, _caller) <> 'admin' THEN
    RAISE EXCEPTION 'Only signal administrators can manage publishers';
  END IF;

  -- Resolve target user by username
  SELECT id INTO _target_user FROM public.profiles WHERE username = lower(btrim(_username));
  IF _target_user IS NULL THEN
    RAISE EXCEPTION 'Builder with username "%" not found', _username;
  END IF;

  IF _action IN ('add', 'assign') THEN
    IF _role NOT IN ('admin', 'publisher') THEN
      RAISE EXCEPTION 'Invalid role: must be admin or publisher';
    END IF;

    INSERT INTO public.signal_publishers (signal_id, user_id, role, assigned_by)
    VALUES (_signal, _target_user, _role, _caller)
    ON CONFLICT (signal_id, user_id) DO UPDATE
      SET role = EXCLUDED.role, assigned_by = EXCLUDED.assigned_by;

  ELSIF _action = 'remove' THEN
    -- Prevent removing the original creator of the signal
    IF _sig.created_by = _target_user THEN
      RAISE EXCEPTION 'Cannot remove the primary creator of this Signal';
    END IF;

    DELETE FROM public.signal_publishers
    WHERE signal_id = _signal AND user_id = _target_user;

  ELSIF _action = 'role' THEN
    IF _sig.created_by = _target_user AND _role <> 'admin' THEN
      RAISE EXCEPTION 'The primary creator must remain an administrator';
    END IF;

    IF _role NOT IN ('admin', 'publisher') THEN
      RAISE EXCEPTION 'Invalid role: must be admin or publisher';
    END IF;

    UPDATE public.signal_publishers
    SET role = _role
    WHERE signal_id = _signal AND user_id = _target_user;

  ELSE
    RAISE EXCEPTION 'Unknown action: %', _action;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.manage_signal_publisher(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_signal_publisher(uuid, text, text, text) TO authenticated, service_role;

-- 3. Signal Verification RPCs
CREATE OR REPLACE FUNCTION public.request_signal_verification(
  _signal uuid,
  _details jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _caller uuid := auth.uid();
  _sig public.signals;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Sign in to request verification';
  END IF;

  SELECT * INTO _sig FROM public.signals WHERE id = _signal;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Signal channel not found';
  END IF;

  IF _sig.created_by <> _caller AND public.signal_role(_signal, _caller) <> 'admin' THEN
    RAISE EXCEPTION 'Only signal administrators can request verification';
  END IF;

  UPDATE public.signals
  SET
    verification_status = 'pending',
    verification_details = coalesce(_details, '{}'::jsonb),
    updated_at = now()
  WHERE id = _signal;
END $$;
REVOKE ALL ON FUNCTION public.request_signal_verification(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_signal_verification(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.verify_signal(
  _signal uuid,
  _status text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_ping_admin() THEN
    RAISE EXCEPTION 'Only platform administrators can verify institutional signals';
  END IF;

  IF _status NOT IN ('verified', 'rejected', 'pending', 'unverified') THEN
    RAISE EXCEPTION 'Invalid verification status: %', _status;
  END IF;

  UPDATE public.signals
  SET
    verified = (_status = 'verified'),
    verification_status = _status,
    updated_at = now()
  WHERE id = _signal;
END $$;
REVOKE ALL ON FUNCTION public.verify_signal(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_signal(uuid, text) TO authenticated, service_role;

-- 4. Hub Edit RPC
CREATE OR REPLACE FUNCTION public.update_hub(
  _hub uuid,
  _name text,
  _tagline text DEFAULT '',
  _description text DEFAULT '',
  _rules text DEFAULT '',
  _category text DEFAULT 'community',
  _access text DEFAULT 'public',
  _resources jsonb DEFAULT '[]'::jsonb
) RETURNS public.hubs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _caller uuid := auth.uid();
  _me text;
  _updated public.hubs;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Sign in to update hub details';
  END IF;

  _me := public.hub_role(_hub, _caller);
  IF _me NOT IN ('owner', 'admin') OR _me IS NULL THEN
    RAISE EXCEPTION 'Only hub owners and administrators can edit hub details';
  END IF;

  IF _access NOT IN ('public', 'private') THEN
    RAISE EXCEPTION 'Access must be either public or private';
  END IF;

  IF _category NOT IN ('organization', 'school', 'incubator', 'ecosystem', 'community') THEN
    RAISE EXCEPTION 'Invalid hub category';
  END IF;

  IF char_length(btrim(_name)) < 2 OR char_length(btrim(_name)) > 60 THEN
    RAISE EXCEPTION 'Hub name must be between 2 and 60 characters';
  END IF;

  UPDATE public.hubs
  SET
    name = btrim(_name),
    tagline = coalesce(btrim(_tagline), ''),
    description = coalesce(btrim(_description), ''),
    rules = coalesce(btrim(_rules), ''),
    category = _category,
    access = _access,
    resources = coalesce(_resources, '[]'::jsonb),
    updated_at = now()
  WHERE id = _hub
  RETURNING * INTO _updated;

  RETURN _updated;
END $$;
REVOKE ALL ON FUNCTION public.update_hub(uuid, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_hub(uuid, text, text, text, text, text, text, jsonb) TO authenticated, service_role;
