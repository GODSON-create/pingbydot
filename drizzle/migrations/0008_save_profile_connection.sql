CREATE OR REPLACE FUNCTION public.save_profile_connection(_platform text, _handle text, _is_public boolean, _is_primary boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE _owner uuid := auth.uid();
BEGIN
  IF _owner IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE = '42501'; END IF;
  IF _platform NOT IN ('whatsapp','snapchat','instagram','x') OR _platform IS NULL OR _handle IS NULL OR _is_public IS NULL OR _is_primary IS NULL THEN RAISE EXCEPTION 'Invalid connection'; END IF;
  IF (_platform = 'x' AND lower(_handle) IN ('home','intent','i','share','settings','messages','explore','search')) OR (_platform = 'instagram' AND _handle IN ('p','reel','reels','explore','accounts','stories','direct')) THEN RAISE EXCEPTION 'Use a profile identifier'; END IF;
  PERFORM 1 FROM public.profiles WHERE id = _owner FOR UPDATE;
  IF _is_primary THEN UPDATE public.profile_connections SET is_primary = false, updated_at = now() WHERE user_id = _owner AND is_primary; END IF;
  INSERT INTO public.profile_connections(user_id,platform,handle,is_public,is_primary)
  VALUES (_owner,_platform,_handle,_is_public,_is_primary)
  ON CONFLICT (user_id,platform) DO UPDATE SET handle = EXCLUDED.handle, is_public = EXCLUDED.is_public, is_primary = EXCLUDED.is_primary, updated_at = now();
END; $$;
REVOKE ALL ON FUNCTION public.save_profile_connection(text,text,boolean,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_profile_connection(text,text,boolean,boolean) TO authenticated;
COMMENT ON FUNCTION public.save_profile_connection(text,text,boolean,boolean) IS 'Owner-scoped atomic connection save and primary switch; SECURITY INVOKER preserves RLS.';