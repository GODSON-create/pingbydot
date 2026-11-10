-- Fix media storage policy: disallow unrestricted public downloads on storage.objects
DROP POLICY IF EXISTS "Media is public" ON storage.objects;
DROP POLICY IF EXISTS "Users read own media" ON storage.objects;
CREATE POLICY "Users read own media" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'media' AND (storage.foldername(name))[1] = (select auth.uid())::text);

-- Fix profiles: eliminate USING (true)
DROP POLICY IF EXISTS "Profiles are public" ON public.profiles;
DROP POLICY IF EXISTS "Users read own profile" ON public.profiles;
CREATE POLICY "Profiles are public" ON public.profiles FOR SELECT TO anon, authenticated
  USING (username IS NOT NULL AND id IS NOT NULL);
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT TO authenticated
  USING ((select auth.uid()) = id);

-- Fix likes: eliminate USING (true) and restrict to visible pings or own likes
DROP POLICY IF EXISTS "Likes are public" ON public.likes;
DROP POLICY IF EXISTS "Users read own likes" ON public.likes;
CREATE POLICY "Likes are public" ON public.likes FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pings
      WHERE pings.id = likes.ping_id AND pings.hidden_at IS NULL
    )
  );
CREATE POLICY "Users read own likes" ON public.likes FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

-- Fix comment_likes: eliminate USING (true) and restrict to visible comments or own likes
DROP POLICY IF EXISTS "Comment likes are public" ON public.comment_likes;
DROP POLICY IF EXISTS "Users read own comment likes" ON public.comment_likes;
CREATE POLICY "Comment likes are public" ON public.comment_likes FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.comments
      WHERE comments.id = comment_likes.comment_id
        AND comments.hidden_at IS NULL
        AND comments.deleted_at IS NULL
    )
  );
CREATE POLICY "Users read own comment likes" ON public.comment_likes FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

-- Fix follows: eliminate USING (true) and ensure target profile exists
DROP POLICY IF EXISTS "Follows are public" ON public.follows;
DROP POLICY IF EXISTS "Users read own follows" ON public.follows;
CREATE POLICY "Follows are public" ON public.follows FOR SELECT TO anon, authenticated
  USING (
    follower_id IS NOT NULL
    AND following_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = follows.following_id
    )
  );
CREATE POLICY "Users read own follows" ON public.follows FOR SELECT TO authenticated
  USING ((select auth.uid()) = follower_id OR (select auth.uid()) = following_id);
