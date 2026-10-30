REVOKE ALL ON public.profiles, public.pings, public.likes FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pings TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.likes TO authenticated;