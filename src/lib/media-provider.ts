/**
 * Ping by DOT — Provider-Independent Media Storage Abstraction (Track C)
 *
 * Allows seamless operation on Lovable Cloud Storage today and feature-flagged
 * cutover to Cloudflare R2 (S3-compatible, $0 egress, direct multipart uploads,
 * signed private reads) without rewriting product features.
 */
import { uploadPartsDirectly, type MultipartPartUrl } from "@/lib/resumable-upload";

export type StorageBucketId = "media" | "dm-attachments" | "hub-attachments" | "private-moments";

export type MediaProviderId = "lovable_cloud" | "cloudflare_r2";

export type MediaVisibility = "public" | "private";

export interface ParsedMediaRef {
  provider: MediaProviderId | "external";
  bucket: StorageBucketId | string | null;
  objectKey: string | null;
  isPrivate: boolean;
  raw: string;
}

export interface MediaUploadRequest {
  bucket: StorageBucketId;
  objectKey: string;
  file: File | Blob;
  fileName: string;
  contentType: string;
  visibility: MediaVisibility;
  cacheControl?: string;
  upsert?: boolean;
  conversationId?: string;
  hubId?: string;
  momentAudience?: "public" | "followers" | "close_circle" | "hub";
  onProgress?: (percent: number) => void;
}

export interface MediaUploadResult {
  provider: MediaProviderId;
  bucket: StorageBucketId;
  objectKey: string;
  /** Canonical persisted reference (`https://...` for public, `storage://...` / bare DM path / `r2://...` for private). */
  storedRef: string;
  /** Immediately renderable URL (public CDN URL or short-lived signed URL). */
  readUrl: string;
  expiresAtMs?: number;
  sizeBytes: number;
  contentType: string;
  usedResumable: boolean;
}

export interface MediaReadOptions {
  forceRefresh?: boolean;
  expiresInSec?: number;
  accessToken?: string;
}

export interface MediaStorageProvider {
  readonly id: MediaProviderId;
  readonly supportsResumable: boolean;
  readonly supportsMultipart: boolean;
  upload(request: MediaUploadRequest): Promise<MediaUploadResult>;
  getReadUrl(ref: string, options?: MediaReadOptions): Promise<string | null>;
  deleteObjects(
    bucket: StorageBucketId,
    objectKeys: string[],
  ): Promise<{ deleted: string[]; failed: string[] }>;
}

const KNOWN_PRIVATE_BUCKETS = new Set<string>([
  "dm-attachments",
  "hub-attachments",
  "private-moments",
]);

/**
 * Parses any persisted media string (`r2://bucket/key`, `storage://bucket/key`,
 * canonical bare DM `{conv}/{uid}/{file}`, or legacy `https://...` URL).
 */
export function parseMediaReference(urlOrRef: string | null | undefined): ParsedMediaRef {
  const raw = (urlOrRef ?? "").trim();
  if (!raw) {
    return { provider: "external", bucket: null, objectKey: null, isPrivate: false, raw: "" };
  }

  if (raw.startsWith("r2://")) {
    const rest = raw.slice(5);
    const slash = rest.indexOf("/");
    if (slash > 0 && !rest.includes("..")) {
      const bucket = rest.slice(0, slash);
      const objectKey = rest.slice(slash + 1);
      return {
        provider: "cloudflare_r2",
        bucket,
        objectKey,
        isPrivate: bucket !== "media" && !bucket.endsWith("-public"),
        raw,
      };
    }
    return { provider: "external", bucket: null, objectKey: null, isPrivate: false, raw };
  }

  if (raw.startsWith("storage://")) {
    const rest = raw.slice(10);
    const slash = rest.indexOf("/");
    if (slash > 0 && !rest.includes("..")) {
      const bucket = rest.slice(0, slash);
      const objectKey = rest.slice(slash + 1);
      return {
        provider: "lovable_cloud",
        bucket,
        objectKey,
        isPrivate: KNOWN_PRIVATE_BUCKETS.has(bucket),
        raw,
      };
    }
    return { provider: "external", bucket: null, objectKey: null, isPrivate: false, raw };
  }

  if (/^(https?:|blob:|data:|\/)/i.test(raw)) {
    return { provider: "external", bucket: null, objectKey: null, isPrivate: false, raw };
  }

  // Canonical bare DM path `{conversation_id}/{sender_user_id}/{unique_filename}`
  if (raw.includes("/") && !raw.includes("..")) {
    return {
      provider: "lovable_cloud",
      bucket: "dm-attachments",
      objectKey: raw,
      isPrivate: true,
      raw,
    };
  }

  return { provider: "external", bucket: null, objectKey: null, isPrivate: false, raw };
}

export function isR2ClientFlagEnabled(envOverride?: Record<string, string | undefined>): boolean {
  const env =
    envOverride ??
    (typeof import.meta !== "undefined"
      ? (import.meta.env as Record<string, string | undefined> | undefined)
      : undefined) ??
    (typeof process !== "undefined" ? process.env : {});
  const raw = (env["VITE_MEDIA_PROVIDER"] ?? env["PING_MEDIA_PROVIDER"] ?? "").trim().toLowerCase();
  return raw === "cloudflare_r2";
}

export interface R2PresignClientOptions {
  apiBaseUrl?: string;
  getAccessToken: () => Promise<string | null>;
  fallbackProvider: MediaStorageProvider;
  fetchImpl?: typeof fetch;
}

/**
 * Feature-flagged Cloudflare R2 provider.
 *
 * - Never proxies file bytes through server functions: obtains presigned direct `PUT`
 *   (or multipart `UploadPart`) URLs from `/api/media/presign-upload` and uploads directly
 *   browser/app -> R2.
 * - Falls back seamlessly to `fallbackProvider` (Lovable Cloud Storage) whenever R2 is
 *   not configured or returns 503, and delegates all legacy Lovable Cloud objects to
 *   `fallbackProvider` for zero-downtime dual-read compatibility.
 */
export class CloudflareR2MediaProvider implements MediaStorageProvider {
  readonly id: MediaProviderId = "cloudflare_r2";
  readonly supportsResumable = true;
  readonly supportsMultipart = true;

  private readonly apiBaseUrl: string;
  private readonly getAccessToken: () => Promise<string | null>;
  private readonly fallbackProvider: MediaStorageProvider;
  private readonly fetchImpl: typeof fetch;

  constructor(options: R2PresignClientOptions) {
    this.apiBaseUrl = (options.apiBaseUrl ?? "").replace(/\/$/, "");
    this.getAccessToken = options.getAccessToken;
    this.fallbackProvider = options.fallbackProvider;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async upload(request: MediaUploadRequest): Promise<MediaUploadResult> {
    const token = await this.getAccessToken();
    if (!token) {
      return this.fallbackProvider.upload(request);
    }

    const presignRes = await this.fetchImpl(`${this.apiBaseUrl}/api/media/presign-upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        bucket: request.bucket,
        objectKey: request.objectKey,
        fileName: request.fileName,
        contentType: request.contentType,
        sizeBytes: request.file.size,
        visibility: request.visibility,
        conversationId: request.conversationId,
        hubId: request.hubId,
        momentAudience: request.momentAudience,
      }),
    });

    // If R2 is disabled or unconfigured on the server, fall back cleanly to Lovable Cloud
    if (presignRes.status === 503 || presignRes.status === 404) {
      return this.fallbackProvider.upload(request);
    }

    if (!presignRes.ok) {
      const errBody = (await presignRes.json().catch(() => ({}))) as { error?: string };
      throw new Error(
        errBody.error || `R2 upload authorization failed (HTTP ${presignRes.status}).`,
      );
    }

    const plan = (await presignRes.json()) as {
      mode: "single" | "multipart";
      uploadUrl?: string;
      uploadId?: string;
      partUrls?: MultipartPartUrl[];
      completeUrl?: string;
      chunkSizeBytes?: number;
      storedRef: string;
      readUrl: string;
      expiresAtMs?: number;
      r2Bucket: string;
      objectKey: string;
    };

    if (plan.mode === "multipart" && plan.partUrls?.length) {
      const completedParts = await uploadPartsDirectly({
        file: request.file,
        partUrls: plan.partUrls,
        ...(plan.chunkSizeBytes ? { chunkSizeBytes: plan.chunkSizeBytes } : {}),
        ...(request.onProgress ? { onProgress: request.onProgress } : {}),
        fetchImpl: this.fetchImpl,
      });

      if (plan.completeUrl) {
        const xmlBody = [
          "<CompleteMultipartUpload>",
          ...completedParts.map(
            (p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`,
          ),
          "</CompleteMultipartUpload>",
        ].join("");
        const completeRes = await this.fetchImpl(plan.completeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/xml" },
          body: xmlBody,
        });
        if (!completeRes.ok) {
          throw new Error(`R2 multipart completion failed (HTTP ${completeRes.status}).`);
        }
      }
    } else if (plan.uploadUrl) {
      const putRes = await this.fetchImpl(plan.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": request.contentType || "application/octet-stream",
        },
        body: request.file,
      });
      if (!putRes.ok) {
        throw new Error(`Direct R2 upload failed (HTTP ${putRes.status}).`);
      }
      request.onProgress?.(100);
    } else {
      return this.fallbackProvider.upload(request);
    }

    return {
      provider: "cloudflare_r2",
      bucket: request.bucket,
      objectKey: plan.objectKey,
      storedRef: plan.storedRef,
      readUrl: plan.readUrl,
      ...(plan.expiresAtMs ? { expiresAtMs: plan.expiresAtMs } : {}),
      sizeBytes: request.file.size,
      contentType: request.contentType,
      usedResumable: plan.mode === "multipart",
    };
  }

  async getReadUrl(ref: string, options: MediaReadOptions = {}): Promise<string | null> {
    const parsed = parseMediaReference(ref);
    if (parsed.provider !== "cloudflare_r2") {
      // Zero-downtime dual-read: legacy Lovable Cloud & https URLs resolve via fallbackProvider
      return this.fallbackProvider.getReadUrl(ref, options);
    }

    const token = options.accessToken ?? (await this.getAccessToken());
    if (!token) return null;

    const res = await this.fetchImpl(`${this.apiBaseUrl}/api/media/sign-read`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ref,
        expiresInSec: options.expiresInSec ?? 900,
      }),
    });

    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { signedUrl?: string } | null;
    return data?.signedUrl ?? null;
  }

  async deleteObjects(
    bucket: StorageBucketId,
    objectKeys: string[],
  ): Promise<{ deleted: string[]; failed: string[] }> {
    return this.fallbackProvider.deleteObjects(bucket, objectKeys);
  }
}
