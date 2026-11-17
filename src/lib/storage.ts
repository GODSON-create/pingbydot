import { supabase } from "@/integrations/supabase/client";

export const MEDIA_BUCKET = "media";

export function formatStorageUploadError(
  error: unknown,
  fallback = "Media upload failed.",
): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof (error as { message?: unknown } | null)?.message === "string"
        ? String((error as { message: string }).message)
        : "";

  if (/bucket not found|nosuchbucket/i.test(message)) {
    return "Storage bucket 'media' is missing on this Supabase project. Run database migration 0021 (or create the public 'media' bucket in Supabase Storage) and try again.";
  }

  if (/row-level security|permission|not authorized|unauthorized/i.test(message)) {
    return "Media upload was blocked by storage permissions. Sign in again and retry.";
  }

  return message || fallback;
}

export async function uploadUserMedia(
  path: string,
  file: File,
  options: { cacheControl?: string; upsert?: boolean } = {},
): Promise<string> {
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, file, {
    cacheControl: options.cacheControl ?? "3600",
    upsert: options.upsert ?? false,
  });

  if (error || !data) {
    throw new Error(formatStorageUploadError(error));
  }

  const { data: pub } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(data.path);
  if (!pub?.publicUrl) {
    throw new Error("Media upload did not return a persistent URL.");
  }

  return pub.publicUrl;
}
