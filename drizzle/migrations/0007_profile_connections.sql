CREATE TABLE public.profile_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('whatsapp','snapchat','instagram','x')),
  handle text NOT NULL CHECK (
    (platform = 'whatsapp' AND handle ~ '^[1-9][0-9]{7,14}$') OR
    (platform = 'snapchat' AND handle ~ '^[a-z][a-z0-9._-]{1,13}[a-z0-9]$') OR
    (platform = 'instagram' AND handle ~ '^[a-z0-9._]{1,30}$') OR
    (platform = 'x' AND handle ~ '^[A-Za-z0-9_]{1,15}$')
  ),
  is_public boolean NOT NULL DEFAULT false,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform)
);
CREATE UNIQUE INDEX profile_connections_one_primary ON public.profile_connections (user_id) WHERE is_primary;
GRANT SELECT ON public.profile_connections TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_connections TO authenticated;
GRANT ALL ON public.profile_connections TO service_role;
ALTER TABLE public.profile_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public connections are readable" ON public.profile_connections FOR SELECT TO anon, authenticated USING (is_public);
CREATE POLICY "Owners read their connections" ON public.profile_connections FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owners add connections" ON public.profile_connections FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owners update connections" ON public.profile_connections FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owners remove connections" ON public.profile_connections FOR DELETE TO authenticated USING (auth.uid() = user_id);