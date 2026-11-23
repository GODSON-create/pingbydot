import { supabase } from "@/integrations/supabase/client";
import { resolveNormalizedMime } from "@/lib/shield";

export const MEDIA_BUCKET = "media";
export const DM_MEDIA_BUCKET = "dm-attachments";
const LEGACY_PRIVATE_DM_PREFIX = `storage://${DM_MEDIA_BUCKET}/`;

/** Short-lived TTL for private DM attachment signed URLs (15 minutes). */
export const DEFAULT_DM_SIGNED_URL_TTL_SEC = 900;
const SIGNED_URL_REFRESH_BUFFER_MS = 60_000;

interface CachedSignedUrl {
  signedUrl: string;
  expiresAtMs: number;
}

const signedUrlCache = new Map<string, CachedSignedUrl>();

export function clearPrivateDmSignedUrlCache(): void {
  signedUrlCache.clear();
}

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
      return "Private messaging storage bucket 'dm-attachments' is missing on this Supabase project. Apply migration 0027 / 0036 and try again.";
    }
    return "Storage bucket 'media' is missing on this Supabase project. Run database migration 0021 / 0036 (or provision the public 'media' bucket in Supabase Storage) and try again.";
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

/**
 * Constructs the canonical conversation-scoped private storage object path:
 *   `{conversation_id}/{sender_user_id}/{unique_filename}`
 *
 * Enforced by Migration `0036` Storage RLS policies on private bucket `dm-attachments`.
 */
export function buildDmAttachmentPath(
  conversationId: string,
  senderUserId: string,
  fileName: string,
  fallbackExt = "bin",
): string {
  const safeConv = conversationId.trim().replace(/[^a-zA-Z0-9_-]/g, "");
  const safeSender = senderUserId.trim().replace(/[^a-zA-Z0-9_-]/g, "");
  const rawExt =
    fileName
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "") || fallbackExt;
  const ext = rawExt.slice(0, 8) || fallbackExt;
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${safeConv}/${safeSender}/${Date.now()}-${rand}.${ext}`;
}

/**
 * Returns true if `urlOrPath` represents a private `dm-attachments` object path
 * (either canonical `{conversation_id}/{sender_user_id}/{file}` OR legacy
 * `storage://dm-attachments/...`), and false for older absolute `https://` URLs.
 */
export function isPrivateDmMediaRef(urlOrPath: string | null | undefined): boolean {
  if (!urlOrPath) return false;
  const trimmed = urlOrPath.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith(LEGACY_PRIVATE_DM_PREFIX)) return true;
  if (/^(https?:|blob:|data:|\/)/i.test(trimmed)) return false;
  return trimmed.includes("/") && !trimmed.includes("..");
}

/**
 * Extracts the bucket-relative object path for private DM attachments, or `null`
 * for legacy public/absolute URLs.
 */
export function extractPrivateDmMediaPath(urlOrPath: string): string | null {
  const trimmed = urlOrPath.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith(LEGACY_PRIVATE_DM_PREFIX)) {
    return trimmed.slice(LEGACY_PRIVATE_DM_PREFIX.length) || null;
  }
  if (/^(https?:|blob:|data:|\/)/i.test(trimmed)) return null;
  if (!trimmed.includes("/") || trimmed.includes("..")) return null;
  return trimmed;
}

/**
 * Uploads sensitive direct-message attachments (voice notes, private images, videos,
 * and documents) strictly into the non-public `dm-attachments` bucket and returns
 * the raw private object path (`storagePath`) to store in `private_messages.media_url`
 * plus an immediate short-lived signed URL for rendering. Never stores a public URL.
 */
export async function uploadPrivateDmMedia(
  path: string,
  file: File | Blob,
  fileName?: string,
): Promise<{ storagePath: string; storageRef: string; signedUrl: string; expiresAtMs: number }> {
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

  const ttlSec = DEFAULT_DM_SIGNED_URL_TTL_SEC;
  const { data: signed, error: signErr } = await supabase.storage
    .from(DM_MEDIA_BUCKET)
    .createSignedUrl(uploadedPath, ttlSec);

  if (signErr || !signed?.signedUrl) {
    throw new Error(
      formatStorageUploadError(signErr, "Could not authorize attachment access.", DM_MEDIA_BUCKET),
    );
  }

  const expiresAtMs = Date.now() + ttlSec * 1000;
  signedUrlCache.set(uploadedPath, { signedUrl: signed.signedUrl, expiresAtMs });

  return {
    storagePath: uploadedPath,
    storageRef: uploadedPath,
    signedUrl: signed.signedUrl,
    expiresAtMs,
  };
}

/**
 * Resolves a stored `private_messages.media_url` value into a short-lived signed URL
 * when it is a private attachment path (canonical or legacy `storage://dm-attachments/`),
 * or returns legacy absolute `https://` URLs unchanged. Automatically caches and refreshes
 * near-expiry URLs, and supports forced refresh on media playback errors.
 */
export async function createPrivateDmSignedUrl(
  urlOrRef: string,
  options: { forceRefresh?: boolean; expiresInSec?: number } = {},
): Promise<string | null> {
  if (!urlOrRef) return null;
  const objectPath = extractPrivateDmMediaPath(urlOrRef);
  if (!objectPath) return urlOrRef;

  const now = Date.now();
  const cached = signedUrlCache.get(objectPath);
  if (!options.forceRefresh && cached && cached.expiresAtMs - SIGNED_URL_REFRESH_BUFFER_MS > now) {
    return cached.signedUrl;
  }

  const ttlSec = Math.max(60, options.expiresInSec ?? DEFAULT_DM_SIGNED_URL_TTL_SEC);
  const { data, error } = await supabase.storage
    .from(DM_MEDIA_BUCKET)
    .createSignedUrl(objectPath, ttlSec);

  if (error || !data?.signedUrl) {
    signedUrlCache.delete(objectPath);
    return null;
  }

  signedUrlCache.set(objectPath, {
    signedUrl: data.signedUrl,
    expiresAtMs: Date.now() + ttlSec * 1000,
  });
  return data.signedUrl;
}

/**
 * Safely forwards a private DM attachment to a different conversation by
 * downloading the authorized source object and uploading a fresh target-scoped
 * copy under `{targetConversationId}/{forwarderUserId}/{unique_filename}`.
 *
 * Prevents cross-conversation storage path reuse (enforced by Stage 1 migration
 * 0037 Storage RLS and `assert_can_send_to_conversation`).
 */
export async function forwardPrivateDmAttachment(
  sourceUrlOrRef: string,
  targetConversationId: string,
  forwarderUserId: string,
  mediaType?: string | null,
): Promise<{ storagePath: string; signedUrl: string; expiresAtMs: number }> {
  const sourcePath = extractPrivateDmMediaPath(sourceUrlOrRef);
  if (!sourcePath) {
    throw new Error("Only private DM attachments require conversation-scoped re-upload.");
  }

  const { data: blob, error: downloadError } = await supabase.storage
    .from(DM_MEDIA_BUCKET)
    .download(sourcePath);

  if (downloadError || !blob) {
    throw new Error(
      formatStorageUploadError(
        downloadError,
        "Could not access source attachment for forwarding.",
        DM_MEDIA_BUCKET,
      ),
    );
  }

  const sourceFileName = sourcePath.split("/").pop() || "forwarded-attachment.bin";
  const fallbackExt =
    mediaType === "video"
      ? "mp4"
      : mediaType === "audio"
        ? "webm"
        : mediaType === "image"
          ? "jpg"
          : "bin";
  const targetPath = buildDmAttachmentPath(
    targetConversationId,
    forwarderUserId,
    sourceFileName,
    fallbackExt,
  );

  const uploaded = await uploadPrivateDmMedia(targetPath, blob, sourceFileName);
  return {
    storagePath: uploaded.storagePath,
    signedUrl: uploaded.signedUrl,
    expiresAtMs: uploaded.expiresAtMs,
  };
}
