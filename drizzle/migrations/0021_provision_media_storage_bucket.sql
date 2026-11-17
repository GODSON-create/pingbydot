-- ==============================================================================
-- Migration 0021: Provision 'media' Storage Bucket for Moments, DMs & Hub Media
-- Migration 0000 created RLS policies on storage.objects for bucket_id = 'media',
-- and 0010 tightened listing/select on storage.objects, but the bucket row itself
-- was never provisioned in storage.buckets, causing "Bucket not found" errors.
-- ==============================================================================

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
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'audio/webm',
    'audio/mp4',
    'audio/mpeg',
    'application/pdf'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
