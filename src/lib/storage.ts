import { supabase } from "@/integrations/supabase/client";
import { resolvePublicSupabaseConfig } from "@/lib/supabase-public-config";
import { detectMediaKind, resolveNormalizedMime } from "@/lib/shield";
import {
  buildUniqueMediaFilename,
  computeFileSha256,
  optimizeImageForUpload,
  type ImageOptimizeOptions,
} from "@/lib/media-optimizer";
import { RESUMABLE_UPLOAD_THRESHOLD_BYTES, uploadViaTusResumable } from "@/lib/resumable-upload";
import {
  CloudflareR2MediaProvider,
  isR2ClientFlagEnabled,
  parseMediaReference,
  type MediaReadOptions,
  type MediaStorageProvider,
  type MediaUploadRequest,
  type MediaUploadResult,
  type StorageBucketId,
} from "@/lib/media-provider";

export const MEDIA_BUCKET = "media";
export const DM_MEDIA_BUCKET = "dm-attachments";
export const HUB_MEDIA_BUCKET = "hub-attachments";
export const PRIVATE_MOMENTS_BUCKET = "private-moments";

const LEGACY_PRIVATE_DM_PREFIX = `storage://${DM_MEDIA_BUCKET}/`;
const PRIVATE_HUB_PREFIX = `storage://${HUB_MEDIA_BUCKET}/`;
const PRIVATE_MOMENT_PREFIX = `storage://${PRIVATE_MOMENTS_BUCKET}/`;

/** Short-lived TTL for private attachment signed URLs (15 minutes). */
export const DEFAULT_DM_SIGNED_URL_TTL_SEC = 900;
const SIGNED_URL_REFRESH_BUFFER_MS = 60_000;
const IMMUTABLE_PUBLIC_CACHE_CONTROL = "31536000";

interface CachedSignedUrl {
  signedUrl: string;
  expiresAtMs: number;
}

const signedUrlCache = new Map<string, CachedSignedUrl>();

export function clearPrivateDmSignedUrlCache(): void {
  signedUrlCache.clear();
}

export function clearAllPrivateSignedUrlCaches(): void {
  signedUrlCache.clear();
}

export function formatStorageUploadError(
  error: unknown,
  fallback = "Media upload failed.",
  bucket: StorageBucketId | string = MEDIA_BUCKET,
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
    if (bucket === HUB_MEDIA_BUCKET) {
      return "Private Hub storage bucket 'hub-attachments' is missing or lacks policies on this Supabase project. Apply migration 0038 and try again.";
    }
    if (bucket === PRIVATE_MOMENTS_BUCKET) {
      return "Restricted Moments storage bucket 'private-moments' is missing on this Supabase project. Apply migration 0038 and try again.";
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

/**
 * Constructs a sanitized, collision-resistant public object path under `{userId}/{folder}/{unique}`.
 */
export function buildPublicMediaPath(
  userId: string,
  folder: string,
  fileName: string,
  fallbackExt = "jpg",
): string {
  const safeUser = userId.trim().replace(/[^a-zA-Z0-9_-]/g, "");
  const safeFolder = folder
    .trim()
    .split("/")
    .map((seg) => seg.replace(/[^a-zA-Z0-9_-]/g, ""))
    .filter(Boolean)
    .join("/");
  return `${safeUser}/${safeFolder || "uploads"}/${buildUniqueMediaFilename(fileName, fallbackExt)}`;
}

/**
 * Constructs the canonical conversation-scoped private storage object path:
 *   `{conversation_id}/{sender_user_id}/{unique_filename}`
 *
 * Enforced by Migrations `0036` & `0037` Storage RLS on private bucket `dm-attachments`.
 */
export function buildDmAttachmentPath(
  conversationId: string,
  senderUserId: string,
  fileName: string,
  fallbackExt = "bin",
): string {
  const safeConv = conversationId.trim().replace(/[^a-zA-Z0-9_-]/g, "");
  const safeSender = senderUserId.trim().replace(/[^a-zA-Z0-9_-]/g, "");
  return `${safeConv}/${safeSender}/${buildUniqueMediaFilename(fileName, fallbackExt)}`;
}

/**
 * Constructs the canonical Hub-scoped private storage object path:
 *   `{hub_id}/{sender_user_id}/{unique_filename}`
 *
 * Enforced by Migration `0038` Storage RLS on private bucket `hub-attachments`.
 */
export function buildHubAttachmentPath(
  hubId: string,
  senderUserId: string,
  fileName: string,
  fallbackExt = "bin",
): string {
  const safeHub = hubId.trim().replace(/[^a-zA-Z0-9_-]/g, "");
  const safeSender = senderUserId.trim().replace(/[^a-zA-Z0-9_-]/g, "");
  return `${safeHub}/${safeSender}/${buildUniqueMediaFilename(fileName, fallbackExt)}`;
}

/**
 * Constructs the canonical audience-scoped private Moment storage object path:
 *   `{author_id}/{audience}/{hub_id|self}/{unique_filename}`
 *
 * Enforced by Migration `0038` Storage RLS on private bucket `private-moments`.
 */
export function buildPrivateMomentPath(
  authorId: string,
  audience: "followers" | "close_circle" | "hub",
  hubId: string | null | undefined,
  fileName: string,
  fallbackExt = "jpg",
): string {
  const safeAuthor = authorId.trim().replace(/[^a-zA-Z0-9_-]/g, "");
  const safeScope =
    audience === "hub" && hubId ? hubId.trim().replace(/[^a-zA-Z0-9_-]/g, "") : "self";
  return `${safeAuthor}/${audience}/${safeScope}/${buildUniqueMediaFilename(fileName, fallbackExt)}`;
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
  if (trimmed.startsWith(PRIVATE_HUB_PREFIX) || trimmed.startsWith(PRIVATE_MOMENT_PREFIX)) {
    return false;
  }
  if (/^(https?:|blob:|data:|\/|r2:\/\/|storage:\/\/)/i.test(trimmed)) return false;
  return trimmed.includes("/") && !trimmed.includes("..");
}

/**
 * Returns true if `urlOrPath` represents ANY private Ping storage object
 * (`dm-attachments`, `hub-attachments`, `private-moments`, or private `r2://`).
 */
export function isPrivateMediaRef(urlOrPath: string | null | undefined): boolean {
  return parseMediaReference(urlOrPath).isPrivate;
}

/**
 * Extracts the bucket-relative object path for private DM attachments, or `null`
 * for legacy public/absolute URLs or non-DM buckets.
 */
export function extractPrivateDmMediaPath(urlOrPath: string): string | null {
  const trimmed = urlOrPath.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith(LEGACY_PRIVATE_DM_PREFIX)) {
    return trimmed.slice(LEGACY_PRIVATE_DM_PREFIX.length) || null;
  }
  if (/^(https?:|blob:|data:|\/|r2:\/\/|storage:\/\/)/i.test(trimmed)) return null;
  if (!trimmed.includes("/") || trimmed.includes("..")) return null;
  return trimmed;
}

async function getCurrentSessionAccessToken(): Promise<string | null> {
  try {
    const authApi = (
      supabase as unknown as {
        auth?: {
          getSession?: () => Promise<{ data?: { session?: { access_token?: string } | null } }>;
        };
      }
    ).auth;
    if (!authApi?.getSession) return null;
    const { data } = await authApi.getSession();
    return data?.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function uploadToSupabaseBucket(
  bucket: StorageBucketId,
  objectPath: string,
  file: File | Blob,
  options: {
    contentType?: string;
    cacheControl?: string;
    upsert?: boolean;
    maxAttempts?: number;
    onProgress?: (percent: number) => void;
  } = {},
): Promise<{ path: string; usedResumable: boolean }> {
  const contentType = options.contentType || "application/octet-stream";
  const cacheControl = options.cacheControl ?? "3600";

  // Automatically use TUS 1.0.0 resumable uploads for large files (> 6 MB) when an auth session exists
  if (file.size > RESUMABLE_UPLOAD_THRESHOLD_BYTES) {
    const accessToken = await getCurrentSessionAccessToken();
    let publicCfg: { url: string; publishableKey: string } | null = null;
    try {
      publicCfg = resolvePublicSupabaseConfig();
    } catch {
      publicCfg = null;
    }
    if (accessToken && publicCfg?.url && publicCfg.publishableKey && typeof fetch === "function") {
      try {
        const uploadedPath = await uploadViaTusResumable({
          supabaseUrl: publicCfg.url,
          anonKey: publicCfg.publishableKey,
          accessToken,
          bucket,
          objectPath,
          file,
          contentType,
          cacheControl,
          upsert: Boolean(options.upsert),
          ...(options.onProgress ? { onProgress: options.onProgress } : {}),
        });
        return { path: uploadedPath, usedResumable: true };
      } catch (tusErr) {
        // Never fall back on auth/RLS/4xx errors; rethrow immediately
        if (!isTransientStorageError(tusErr) && /HTTP 4\d\d/i.test(String(tusErr))) {
          throw tusErr;
        }
        // Fallback to standard upload if TUS gateway is unavailable in local/dev mocks
      }
    }
  }

  const uploadedPath = await withTransientRetry(
    async (attempt) => {
      const { data, error } = await supabase.storage.from(bucket).upload(objectPath, file, {
        cacheControl,
        upsert: options.upsert ?? attempt > 1,
        contentType,
      });
      if (error || !data) {
        throw error ?? new Error("Media upload failed.");
      }
      return data.path;
    },
    { maxAttempts: options.maxAttempts ?? 3 },
  );

  options.onProgress?.(100);
  return { path: uploadedPath, usedResumable: false };
}

/**
 * Best-effort registration into `public.media_assets` so retention quotas, orphan
 * cleanup, and storage observability have authoritative byte sizes without blocking
 * uploads on environments where migration 0038 is not yet deployed.
 */
export async function recordMediaAssetMetadata(params: {
  ownerId: string;
  provider: "supabase_storage" | "cloudflare_r2";
  bucket: StorageBucketId;
  objectKey: string;
  sourceUrl: string;
  visibility: "public" | "private";
  file: Blob;
  fileName: string;
  status?: "staging" | "ready";
  conversationId?: string;
  hubId?: string;
  momentId?: string;
}): Promise<void> {
  try {
    const fromFn = (supabase as unknown as { from?: unknown }).from;
    if (typeof fromFn !== "function") return;
    const sha256 = await computeFileSha256(params.file);
    const kind = detectMediaKind({ type: params.file.type, name: params.fileName });
    const mime =
      resolveNormalizedMime({ type: params.file.type, name: params.fileName }) ||
      "application/octet-stream";

    await (supabase as any).from("media_assets").insert({
      owner_id: params.ownerId,
      media_kind: kind,
      provider: params.provider,
      bucket: params.bucket,
      object_key: params.objectKey,
      visibility: params.visibility,
      source_url: params.sourceUrl,
      mime_type: mime,
      content_sha256: sha256,
      size_bytes: params.file.size,
      status: params.status ?? "staging",
      conversation_id: params.conversationId ?? null,
      hub_id: params.hubId ?? null,
      moment_id: params.momentId ?? null,
    });
  } catch {
    // Non-blocking: preserves full functionality before migration 0038 is applied remotely
  }
}

export class LovableCloudMediaProvider implements MediaStorageProvider {
  readonly id = "lovable_cloud" as const;
  readonly supportsResumable = true;
  readonly supportsMultipart = false;

  async upload(request: MediaUploadRequest): Promise<MediaUploadResult> {
    const { path: uploadedPath, usedResumable } = await uploadToSupabaseBucket(
      request.bucket,
      request.objectKey,
      request.file,
      {
        contentType: request.contentType,
        cacheControl:
          request.cacheControl ??
          (request.visibility === "public" ? IMMUTABLE_PUBLIC_CACHE_CONTROL : "3600"),
        ...(request.upsert !== undefined ? { upsert: request.upsert } : {}),
        ...(request.onProgress ? { onProgress: request.onProgress } : {}),
      },
    ).catch((err) => {
      throw new Error(formatStorageUploadError(err, "Media upload failed.", request.bucket));
    });

    if (request.visibility === "public" && request.bucket === MEDIA_BUCKET) {
      const { data: pub } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(uploadedPath);
      if (!pub?.publicUrl) {
        throw new Error("Media upload did not return a persistent URL.");
      }
      return {
        provider: "lovable_cloud",
        bucket: request.bucket,
        objectKey: uploadedPath,
        storedRef: pub.publicUrl,
        readUrl: pub.publicUrl,
        sizeBytes: request.file.size,
        contentType: request.contentType,
        usedResumable,
      };
    }

    const ttlSec = DEFAULT_DM_SIGNED_URL_TTL_SEC;
    const { data: signed, error: signErr } = await supabase.storage
      .from(request.bucket)
      .createSignedUrl(uploadedPath, ttlSec);

    if (signErr || !signed?.signedUrl) {
      throw new Error(
        formatStorageUploadError(signErr, "Could not authorize attachment access.", request.bucket),
      );
    }

    const expiresAtMs = Date.now() + ttlSec * 1000;
    const cacheKey = `${request.bucket}:${uploadedPath}`;
    signedUrlCache.set(cacheKey, { signedUrl: signed.signedUrl, expiresAtMs });

    const storedRef =
      request.bucket === DM_MEDIA_BUCKET
        ? uploadedPath
        : `storage://${request.bucket}/${uploadedPath}`;

    return {
      provider: "lovable_cloud",
      bucket: request.bucket,
      objectKey: uploadedPath,
      storedRef,
      readUrl: signed.signedUrl,
      expiresAtMs,
      sizeBytes: request.file.size,
      contentType: request.contentType,
      usedResumable,
    };
  }

  async getReadUrl(ref: string, options: MediaReadOptions = {}): Promise<string | null> {
    if (!ref) return null;
    const parsed = parseMediaReference(ref);
    if (!parsed.isPrivate || !parsed.bucket || !parsed.objectKey) {
      return ref;
    }

    const cacheKey = `${parsed.bucket}:${parsed.objectKey}`;
    const now = Date.now();
    const cached = signedUrlCache.get(cacheKey);
    if (
      !options.forceRefresh &&
      cached &&
      cached.expiresAtMs - SIGNED_URL_REFRESH_BUFFER_MS > now
    ) {
      return cached.signedUrl;
    }

    const ttlSec = Math.max(60, options.expiresInSec ?? DEFAULT_DM_SIGNED_URL_TTL_SEC);
    const { data, error } = await supabase.storage
      .from(parsed.bucket)
      .createSignedUrl(parsed.objectKey, ttlSec);

    if (error || !data?.signedUrl) {
      signedUrlCache.delete(cacheKey);
      return null;
    }

    signedUrlCache.set(cacheKey, {
      signedUrl: data.signedUrl,
      expiresAtMs: Date.now() + ttlSec * 1000,
    });
    return data.signedUrl;
  }

  async deleteObjects(
    bucket: StorageBucketId,
    objectKeys: string[],
  ): Promise<{ deleted: string[]; failed: string[] }> {
    if (objectKeys.length === 0) return { deleted: [], failed: [] };
    const { error } = await supabase.storage.from(bucket).remove(objectKeys);
    if (error) {
      return { deleted: [], failed: objectKeys };
    }
    for (const key of objectKeys) {
      signedUrlCache.delete(`${bucket}:${key}`);
    }
    return { deleted: objectKeys, failed: [] };
  }
}

const defaultLovableProvider = new LovableCloudMediaProvider();
let activeProviderOverride: MediaStorageProvider | null = null;

export function setMediaStorageProviderForTesting(provider: MediaStorageProvider | null): void {
  activeProviderOverride = provider;
}

export function getActiveMediaStorageProvider(): MediaStorageProvider {
  if (activeProviderOverride) return activeProviderOverride;
  if (isR2ClientFlagEnabled()) {
    return new CloudflareR2MediaProvider({
      getAccessToken: getCurrentSessionAccessToken,
      fallbackProvider: defaultLovableProvider,
    });
  }
  return defaultLovableProvider;
}

export async function uploadUserMedia(
  path: string,
  file: File,
  options: {
    cacheControl?: string;
    upsert?: boolean;
    maxAttempts?: number;
    optimizeImage?: boolean | ImageOptimizeOptions;
    onProgress?: (percent: number) => void;
    ownerId?: string;
  } = {},
): Promise<string> {
  let finalFile = file;
  let finalPath = path;

  if (options.optimizeImage !== false && file.type.startsWith("image/")) {
    const optCfg = typeof options.optimizeImage === "object" ? options.optimizeImage : {};
    const opt = await optimizeImageForUpload(file, optCfg);
    if (opt.file !== file) {
      finalFile = opt.file;
      const newExt = finalFile.name.split(".").pop()?.toLowerCase();
      if (newExt && /\.[a-z0-9]+$/i.test(finalPath)) {
        finalPath = finalPath.replace(/\.[a-z0-9]+$/i, `.${newExt}`);
      }
    }
  }

  const contentType = resolveNormalizedMime(finalFile) || "application/octet-stream";
  const provider = getActiveMediaStorageProvider();
  const result = await provider.upload({
    bucket: MEDIA_BUCKET,
    objectKey: finalPath,
    file: finalFile,
    fileName: finalFile.name,
    contentType,
    visibility: "public",
    cacheControl: options.cacheControl ?? IMMUTABLE_PUBLIC_CACHE_CONTROL,
    ...(options.upsert !== undefined ? { upsert: options.upsert } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });

  if (options.ownerId) {
    void recordMediaAssetMetadata({
      ownerId: options.ownerId,
      provider: result.provider === "cloudflare_r2" ? "cloudflare_r2" : "supabase_storage",
      bucket: MEDIA_BUCKET,
      objectKey: result.objectKey,
      sourceUrl: result.storedRef,
      visibility: "public",
      file: finalFile,
      fileName: finalFile.name,
      status: "ready",
    });
  }

  return result.storedRef;
}

/**
 * Uploads sensitive direct-message attachments strictly into the non-public `dm-attachments`
 * bucket (or R2 private bucket when flagged) and returns the raw private path to store in
 * `private_messages.media_url` plus an immediate short-lived signed URL.
 */
export async function uploadPrivateDmMedia(
  path: string,
  file: File | Blob,
  fileName?: string,
  options: {
    conversationId?: string;
    ownerId?: string;
    optimizeImage?: boolean;
    onProgress?: (percent: number) => void;
  } = {},
): Promise<{
  storagePath: string;
  storageRef: string;
  signedUrl: string;
  expiresAtMs: number;
  sizeBytes: number;
}> {
  let finalFile: File | Blob = file;
  let finalPath = path;
  let inferredName = fileName || (file instanceof File ? file.name : `attachment-${Date.now()}`);

  if (
    options.optimizeImage !== false &&
    finalFile instanceof File &&
    finalFile.type.startsWith("image/")
  ) {
    const opt = await optimizeImageForUpload(finalFile, { maxDimension: 1920, quality: 0.82 });
    if (opt.file !== finalFile) {
      finalFile = opt.file;
      inferredName = opt.file.name;
      const newExt = opt.file.name.split(".").pop()?.toLowerCase();
      if (newExt && /\.[a-z0-9]+$/i.test(finalPath)) {
        finalPath = finalPath.replace(/\.[a-z0-9]+$/i, `.${newExt}`);
      }
    }
  }

  const contentType =
    resolveNormalizedMime({ type: finalFile.type, name: inferredName }) ||
    "application/octet-stream";

  const provider = getActiveMediaStorageProvider();
  const result = await provider.upload({
    bucket: DM_MEDIA_BUCKET,
    objectKey: finalPath,
    file: finalFile,
    fileName: inferredName,
    contentType,
    visibility: "private",
    ...(options.conversationId ? { conversationId: options.conversationId } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });

  if (options.ownerId) {
    void recordMediaAssetMetadata({
      ownerId: options.ownerId,
      provider: result.provider === "cloudflare_r2" ? "cloudflare_r2" : "supabase_storage",
      bucket: DM_MEDIA_BUCKET,
      objectKey: result.objectKey,
      sourceUrl: result.storedRef,
      visibility: "private",
      file: finalFile,
      fileName: inferredName,
      status: "staging",
      ...(options.conversationId ? { conversationId: options.conversationId } : {}),
    });
  }

  return {
    storagePath: result.storedRef,
    storageRef: result.storedRef,
    signedUrl: result.readUrl,
    expiresAtMs: result.expiresAtMs ?? Date.now() + DEFAULT_DM_SIGNED_URL_TTL_SEC * 1000,
    sizeBytes: result.sizeBytes,
  };
}

/**
 * Uploads Hub chat & forum attachments into the private `hub-attachments` bucket
 * scoped under `{hub_id}/{sender_user_id}/{unique_filename}`.
 */
export async function uploadPrivateHubMedia(
  hubId: string,
  senderUserId: string,
  file: File,
  options: { onProgress?: (percent: number) => void } = {},
): Promise<{ storageRef: string; signedUrl: string; expiresAtMs: number; sizeBytes: number }> {
  let finalFile = file;
  if (file.type.startsWith("image/")) {
    const opt = await optimizeImageForUpload(file, { maxDimension: 1920, quality: 0.82 });
    finalFile = opt.file;
  }

  const kind = detectMediaKind(finalFile);
  const fallbackExt =
    kind === "video" ? "mp4" : kind === "audio" ? "webm" : kind === "document" ? "bin" : "jpg";
  const objectKey = buildHubAttachmentPath(hubId, senderUserId, finalFile.name, fallbackExt);
  const contentType = resolveNormalizedMime(finalFile) || "application/octet-stream";

  const provider = getActiveMediaStorageProvider();
  const result = await provider.upload({
    bucket: HUB_MEDIA_BUCKET,
    objectKey,
    file: finalFile,
    fileName: finalFile.name,
    contentType,
    visibility: "private",
    hubId,
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });

  void recordMediaAssetMetadata({
    ownerId: senderUserId,
    provider: result.provider === "cloudflare_r2" ? "cloudflare_r2" : "supabase_storage",
    bucket: HUB_MEDIA_BUCKET,
    objectKey: result.objectKey,
    sourceUrl: result.storedRef,
    visibility: "private",
    file: finalFile,
    fileName: finalFile.name,
    status: "ready",
    hubId,
  });

  return {
    storageRef: result.storedRef,
    signedUrl: result.readUrl,
    expiresAtMs: result.expiresAtMs ?? Date.now() + DEFAULT_DM_SIGNED_URL_TTL_SEC * 1000,
    sizeBytes: result.sizeBytes,
  };
}

/**
 * Uploads restricted Moments (`followers`, `close_circle`, `hub`) into the private
 * `private-moments` bucket with audience-aware Storage RLS.
 */
export async function uploadPrivateMomentMedia(
  authorId: string,
  audience: "followers" | "close_circle" | "hub",
  hubId: string | null | undefined,
  file: File,
  options: { onProgress?: (percent: number) => void } = {},
): Promise<{ storageRef: string; signedUrl: string; expiresAtMs: number; sizeBytes: number }> {
  let finalFile = file;
  if (file.type.startsWith("image/")) {
    const opt = await optimizeImageForUpload(file, { maxDimension: 1920, quality: 0.84 });
    finalFile = opt.file;
  }

  const kind = detectMediaKind(finalFile);
  const fallbackExt = kind === "video" ? "mp4" : "jpg";
  const objectKey = buildPrivateMomentPath(authorId, audience, hubId, finalFile.name, fallbackExt);
  const contentType = resolveNormalizedMime(finalFile) || "application/octet-stream";

  const provider = getActiveMediaStorageProvider();
  const result = await provider.upload({
    bucket: PRIVATE_MOMENTS_BUCKET,
    objectKey,
    file: finalFile,
    fileName: finalFile.name,
    contentType,
    visibility: "private",
    ...(hubId ? { hubId } : {}),
    momentAudience: audience,
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });

  void recordMediaAssetMetadata({
    ownerId: authorId,
    provider: result.provider === "cloudflare_r2" ? "cloudflare_r2" : "supabase_storage",
    bucket: PRIVATE_MOMENTS_BUCKET,
    objectKey: result.objectKey,
    sourceUrl: result.storedRef,
    visibility: "private",
    file: finalFile,
    fileName: finalFile.name,
    status: "ready",
    ...(hubId ? { hubId } : {}),
  });

  return {
    storageRef: result.storedRef,
    signedUrl: result.readUrl,
    expiresAtMs: result.expiresAtMs ?? Date.now() + DEFAULT_DM_SIGNED_URL_TTL_SEC * 1000,
    sizeBytes: result.sizeBytes,
  };
}

/**
 * Resolves any stored Ping media ref (`dm-attachments`, `hub-attachments`, `private-moments`,
 * `r2://`, or legacy `https://` URLs) into a short-lived authorized read URL.
 */
export async function createAuthorizedMediaReadUrl(
  urlOrRef: string,
  options: MediaReadOptions = {},
): Promise<string | null> {
  if (!urlOrRef) return null;
  const parsed = parseMediaReference(urlOrRef);
  if (!parsed.isPrivate) return urlOrRef;

  const provider = getActiveMediaStorageProvider();
  if (parsed.provider === "cloudflare_r2") {
    return provider.getReadUrl(urlOrRef, options);
  }
  return defaultLovableProvider.getReadUrl(urlOrRef, options);
}

/**
 * Backward-compatible alias resolving DM (and any private) storage refs into signed URLs.
 */
export async function createPrivateDmSignedUrl(
  urlOrRef: string,
  options: { forceRefresh?: boolean; expiresInSec?: number } = {},
): Promise<string | null> {
  return createAuthorizedMediaReadUrl(urlOrRef, options);
}

/**
 * Safely forwards a private DM attachment to a different conversation by downloading
 * the authorized source object and uploading a fresh target-scoped copy under
 * `{targetConversationId}/{forwarderUserId}/{unique_filename}`.
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

  const uploaded = await uploadPrivateDmMedia(targetPath, blob, sourceFileName, {
    conversationId: targetConversationId,
    ownerId: forwarderUserId,
    optimizeImage: false,
  });
  return {
    storagePath: uploaded.storagePath,
    signedUrl: uploaded.signedUrl,
    expiresAtMs: uploaded.expiresAtMs,
  };
}
