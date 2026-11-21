-- ==============================================================================
-- Migration 0036: Provision Public 'media' & Private 'dm-attachments' Buckets,
-- Enforce Conversation-Scoped Storage RLS & Standardize Voice Message Previews
--
-- Forward-only, idempotent SQL migration. Not executed against production
-- without explicit operator approval.
-- ==============================================================================

-- 1. Provision / update public 'media' bucket (Moments, Pings, Avatars, Hubs)
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

-- 2. Provision / update private 'dm-attachments' bucket (Direct Message media & voice notes)
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
    'audio/x-m4a',
    'audio/m4a',
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

-- 3. Strict conversation-scoped Storage RLS policies on 'dm-attachments'
--    Canonical object path: {conversation_id}/{sender_user_id}/{unique_filename}
--    Legacy read/delete compatibility: {sender_user_id}/dm/{conversation_id}/{unique_filename}

DROP POLICY IF EXISTS "DM conversation participants read signed files" ON storage.objects;
CREATE POLICY "DM conversation participants read signed files" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'dm-attachments'
    AND (
      EXISTS (
        SELECT 1
        FROM public.conversation_members cm
        WHERE cm.conversation_id::text = (storage.foldername(name))[1]
          AND cm.user_id = (select auth.uid())
          AND cm.hidden_at IS NULL
      )
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

DROP POLICY IF EXISTS "DM uploaders manage own files" ON storage.objects;
CREATE POLICY "DM uploaders manage own files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'dm-attachments'
    AND (storage.foldername(name))[2] = (select auth.uid())::text
    AND EXISTS (
      SELECT 1
      FROM public.conversation_members cm
      WHERE cm.conversation_id::text = (storage.foldername(name))[1]
        AND cm.user_id = (select auth.uid())
        AND cm.hidden_at IS NULL
    )
  );

DROP POLICY IF EXISTS "DM uploaders update own files" ON storage.objects;
CREATE POLICY "DM uploaders update own files" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'dm-attachments'
    AND (storage.foldername(name))[2] = (select auth.uid())::text
    AND EXISTS (
      SELECT 1
      FROM public.conversation_members cm
      WHERE cm.conversation_id::text = (storage.foldername(name))[1]
        AND cm.user_id = (select auth.uid())
        AND cm.hidden_at IS NULL
    )
  )
  WITH CHECK (
    bucket_id = 'dm-attachments'
    AND (storage.foldername(name))[2] = (select auth.uid())::text
    AND EXISTS (
      SELECT 1
      FROM public.conversation_members cm
      WHERE cm.conversation_id::text = (storage.foldername(name))[1]
        AND cm.user_id = (select auth.uid())
        AND cm.hidden_at IS NULL
    )
  );

DROP POLICY IF EXISTS "DM uploaders delete own files" ON storage.objects;
CREATE POLICY "DM uploaders delete own files" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'dm-attachments'
    AND (
      (
        (storage.foldername(name))[2] = (select auth.uid())::text
        AND EXISTS (
          SELECT 1
          FROM public.conversation_members cm
          WHERE cm.conversation_id::text = (storage.foldername(name))[1]
            AND cm.user_id = (select auth.uid())
            AND cm.hidden_at IS NULL
        )
      )
      OR (
        (storage.foldername(name))[1] = (select auth.uid())::text
        AND (storage.foldername(name))[2] = 'dm'
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

-- 4. Standardize 'Voice message' conversation preview in send_private_message RPC
CREATE OR REPLACE FUNCTION public.send_private_message(
  p_conversation_id uuid,
  p_content text,
  p_media_url text DEFAULT NULL,
  p_media_type text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_message public.private_messages;
  v_trimmed_content text := btrim(coalesce(p_content, ''));
  v_preview text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Verify active conversation membership
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_members
    WHERE conversation_id = p_conversation_id AND user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'You are not a participant in this conversation';
  END IF;

  -- Check block status with any other member
  IF EXISTS (
    SELECT 1 FROM public.conversation_members cm
    JOIN public.user_blocks b ON (
      (b.blocker_id = cm.user_id AND b.blocked_id = v_caller)
      OR (b.blocker_id = v_caller AND b.blocked_id = cm.user_id)
    )
    WHERE cm.conversation_id = p_conversation_id AND cm.user_id <> v_caller
  ) THEN
    RAISE EXCEPTION 'Cannot send message: communication is blocked';
  END IF;

  IF char_length(v_trimmed_content) = 0 AND p_media_url IS NULL THEN
    RAISE EXCEPTION 'Message cannot be empty';
  END IF;

  IF p_media_type IS NOT NULL AND p_media_type NOT IN ('image', 'video', 'audio', 'document', 'sticker') THEN
    RAISE EXCEPTION 'Unsupported media_type: %', p_media_type;
  END IF;

  INSERT INTO public.private_messages (
    conversation_id,
    sender_id,
    content,
    media_url,
    media_type,
    status
  ) VALUES (
    p_conversation_id,
    v_caller,
    v_trimmed_content,
    p_media_url,
    p_media_type,
    'sent'
  )
  RETURNING * INTO v_message;

  IF char_length(v_trimmed_content) > 0 THEN
    v_preview := substr(v_trimmed_content, 1, 80);
  ELSIF p_media_type = 'image' THEN
    v_preview := '📷 Photo';
  ELSIF p_media_type = 'video' THEN
    v_preview := '🎥 Video';
  ELSIF p_media_type = 'audio' THEN
    v_preview := 'Voice message';
  ELSE
    v_preview := '📎 Attachment';
  END IF;

  UPDATE public.conversations
  SET
    last_message_at = now(),
    last_message_preview = v_preview,
    updated_at = now()
  WHERE id = p_conversation_id;

  UPDATE public.conversation_members
  SET
    last_read_at = CASE WHEN user_id = v_caller THEN now() ELSE last_read_at END,
    hidden_at = NULL
  WHERE conversation_id = p_conversation_id;

  RETURN to_jsonb(v_message);
END;
$$;

REVOKE ALL ON FUNCTION public.send_private_message(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_private_message(uuid, text, text, text) TO authenticated, service_role;
