-- ==============================================================================
-- Migration 0027: Full-System Audit Repairs, Private DM Storage & Media Support
-- Forward-only, idempotent SQL migration. Not executed against production without
-- explicit operator approval.
-- ==============================================================================

-- 1. Expand public 'media' bucket MIME allowlist for voice notes, HEIC photos & Hub documents
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'media',
  'media',
  true,
  52428800,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'audio/webm',
    'audio/mp4',
    'audio/mpeg',
    'audio/ogg',
    'audio/wav',
    'audio/aac',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Provision private 'dm-attachments' bucket for Direct Message voice/documents/media
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'dm-attachments',
  'dm-attachments',
  false,
  52428800,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'audio/webm',
    'audio/mp4',
    'audio/mpeg',
    'audio/ogg',
    'audio/wav',
    'audio/aac',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "DM uploaders manage own files" ON storage.objects;
CREATE POLICY "DM uploaders manage own files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'dm-attachments'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

DROP POLICY IF EXISTS "DM uploaders update own files" ON storage.objects;
CREATE POLICY "DM uploaders update own files" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'dm-attachments'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'dm-attachments'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

DROP POLICY IF EXISTS "DM uploaders delete own files" ON storage.objects;
CREATE POLICY "DM uploaders delete own files" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'dm-attachments'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

DROP POLICY IF EXISTS "DM conversation participants read signed files" ON storage.objects;
CREATE POLICY "DM conversation participants read signed files" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'dm-attachments'
    AND (
      (storage.foldername(name))[1] = (select auth.uid())::text
      OR (
        (storage.foldername(name))[2] = 'dm'
        AND EXISTS (
          SELECT 1
          FROM public.conversation_members cm
          WHERE cm.conversation_id::text = (storage.foldername(name))[3]
            AND cm.user_id = (select auth.uid())
            AND cm.hidden_at IS NULL
        )
      )
    )
  );

-- 3. Hubs branding column support
ALTER TABLE public.hubs
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- 4. Private messages structured media metadata + sticker type support
ALTER TABLE public.private_messages
  ADD COLUMN IF NOT EXISTS media_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.private_messages
  DROP CONSTRAINT IF EXISTS private_messages_media_type_check;
ALTER TABLE public.private_messages
  ADD CONSTRAINT private_messages_media_type_check
  CHECK (media_type IS NULL OR media_type IN ('image', 'video', 'audio', 'document', 'sticker'));

-- 5. Safe DOT top-up intent log (pending state only; server/webhook settlement required)
CREATE TABLE IF NOT EXISTS public.dot_topup_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rail text NOT NULL CHECK (rail IN ('paystack', 'crypto_pending')),
  dot_amount integer NOT NULL CHECK (dot_amount BETWEEN 10 AND 1000000),
  fiat_currency text,
  fiat_amount_minor integer CHECK (fiat_amount_minor IS NULL OR fiat_amount_minor > 0),
  provider_reference text UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'awaiting_verification', 'settled', 'failed', 'cancelled')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dot_topup_intents_user_idx
  ON public.dot_topup_intents (user_id, created_at DESC);

ALTER TABLE public.dot_topup_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dot_topup_intents FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.dot_topup_intents TO authenticated;
GRANT ALL ON public.dot_topup_intents TO service_role;

DROP POLICY IF EXISTS "Users read own DOT topup intents" ON public.dot_topup_intents;
CREATE POLICY "Users read own DOT topup intents" ON public.dot_topup_intents
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users create pending DOT topup intents" ON public.dot_topup_intents;
CREATE POLICY "Users create pending DOT topup intents" ON public.dot_topup_intents
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (select auth.uid())
    AND status IN ('pending', 'awaiting_verification')
  );
