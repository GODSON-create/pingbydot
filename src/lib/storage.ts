import { supabase } from "@/integrations/supabase/client";
import { resolveNormalizedMime } from "@/lib/shield";

export const MEDIA_BUCKET = "media";
export const DM_MEDIA_BUCKET = "dm-attachments";
const PRIVATE_DM_PREFIX = `storage://${DM_MEDIA_BUCKET}/`;

export function formatStorageUploadError(
  error: unknown,
  fallback = "Media upload failed.",
  bucket = MEDIA_BUCKET,
): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof (error as { message?: unknown } | null)?.message === "string"
        ? String((error as { message: string }).message)
        : "";

  if (/bucket not found|nosuchbucket/i.test(message)) {
    if (bucket === DM_MEDIA_BUCKET) {
      return "Private messaging storage bucket 'dm-attachments' is missing on this Supabase project. Apply migration 0027 and try again.";
    }
    return "Storage bucket 'media' is missing on this Supabase project. Run database migration 0021 (or create the public 'media' bucket in Supabase Storage) and try again.";
  }

  if (/row-level security|permission|not authorized|unauthorized/i.test(message)) {
    return "Media upload was blocked by storage permissions. Sign in again and retry.";
  }

  return message || fallback;
}

export function isTransientStorageError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof (error as { message?: unknown } | null)?.message === "string"
        ? String((error as { message: string }).message)
        : "";
  const status = Number(
    (error as { statusCode?: unknown; status?: unknown } | null)?.statusCode ??
      (error as { status?: unknown } | null)?.status ??
      0,
  );

  // Never retry missing bucket, auth/RLS, or 4xx client validation failures
  if (
    /bucket not found|nosuchbucket|row-level security|permission|unauthorized|forbidden/i.test(
      message,
    )
  ) {
    return false;
  }
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
    return false;
  }
  if (status >= 500 || status === 408 || status === 429) {
    return true;
  }
  return /failed to fetch|network|timeout|timed out|load failed|connection reset|econnreset|temporarily unavailable/i.test(
    message,
  );
}

export async function withTransientRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: { maxAttempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 350);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || !isTransientStorageError(err)) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

export async function uploadUserMedia(
  path: string,
  file: File,
  options: { cacheControl?: string; upsert?: boolean; maxAttempts?: number } = {},
): Promise<string> {
  const contentType = resolveNormalizedMime(file) || undefined;
  const uploadedPath = await withTransientRetry(
    async (attempt) => {
      const { data, error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, file, {
        cacheControl: options.cacheControl ?? "3600",
        upsert: options.upsert ?? attempt > 1,
        ...(contentType ? { contentType } : {}),
      });
      if (error || !data) {
        throw error ?? new Error("Media upload failed.");
      }
      return data.path;
    },
    { maxAttempts: options.maxAttempts ?? 3 },
  ).catch((err) => {
    throw new Error(formatStorageUploadError(err, "Media upload failed.", MEDIA_BUCKET));
  });

  const { data: pub } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(uploadedPath);
  if (!pub?.publicUrl) {
    throw new Error("Media upload did not return a persistent URL.");
  }

  return pub.publicUrl;
}

export function isPrivateDmMediaRef(url: string | null | undefined): boolean {
  return Boolean(url && url.startsWith(PRIVATE_DM_PREFIX));
}

export function extractPrivateDmMediaPath(url: string): string | null {
  if (!url.startsWith(PRIVATE_DM_PREFIX)) return null;
  return url.slice(PRIVATE_DM_PREFIX.length) || null;
}

/**
 * Uploads sensitive direct-message attachments (voice notes, private documents,
 * private media) into a non-public Supabase bucket (`dm-attachments`) and
 * returns a `storage://dm-attachments/<path>` reference resolved via signed URLs.
 */
export async function uploadPrivateDmMedia(
  path: string,
  file: File | Blob,
  fileName?: string,
): Promise<{ storageRef: string; signedUrl: string }> {
  const inferredName = fileName || (file instanceof File ? file.name : `attachment-${Date.now()}`);
  const contentType =
    resolveNormalizedMime({ type: file.type, name: inferredName }) || "application/octet-stream";

  const uploadedPath = await withTransientRetry(
    async (attempt) => {
      const { data, error } = await supabase.storage.from(DM_MEDIA_BUCKET).upload(path, file, {
        cacheControl: "3600",
        upsert: attempt > 1,
        contentType,
      });

      if (error || !data) {
        throw error ?? new Error("Private attachment upload failed.");
      }
      return data.path;
    },
    { maxAttempts: 3 },
  ).catch((err) => {
    throw new Error(
      formatStorageUploadError(err, "Private attachment upload failed.", DM_MEDIA_BUCKET),
    );
  });

  const { data: signed, error: signErr } = await supabase.storage
    .from(DM_MEDIA_BUCKET)
    .createSignedUrl(uploadedPath, 3600);

  if (signErr || !signed?.signedUrl) {
    throw new Error(
      formatStorageUploadError(signErr, "Could not authorize attachment access.", DM_MEDIA_BUCKET),
    );
  }

  return {
    storageRef: `${PRIVATE_DM_PREFIX}${uploadedPath}`,
    signedUrl: signed.signedUrl,
  };
}

export async function createPrivateDmSignedUrl(urlOrRef: string): Promise<string | null> {
  if (!urlOrRef) return null;
  const path = extractPrivateDmMediaPath(urlOrRef);
  if (!path) return urlOrRef;

  const { data, error } = await supabase.storage.from(DM_MEDIA_BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
