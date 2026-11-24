/**
 * Ping by DOT — Resumable (TUS 1.0.0) & S3/R2 Multipart Direct Upload Utilities
 *
 * - Files > 6 MB automatically use Supabase Storage's native `/storage/v1/upload/resumable`
 *   TUS 1.0.0 protocol (6 MB chunks, `HEAD` offset recovery on mobile disconnects).
 * - Future Cloudflare R2 uploads > 6 MB use direct-to-R2 S3 Multipart Presigned URLs
 *   (zero file bytes proxied through TanStack Start / Cloudflare Workers).
 */

export const RESUMABLE_UPLOAD_THRESHOLD_BYTES = 6 * 1024 * 1024; // 6 MB
export const TUS_CHUNK_SIZE_BYTES = 6 * 1024 * 1024; // Supabase Storage required 6 MB TUS chunk size
export const MULTIPART_CHUNK_SIZE_BYTES = 6 * 1024 * 1024; // >= 5 MB S3/R2 minimum part size

export interface TusUploadOptions {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  bucket: string;
  objectPath: string;
  file: Blob;
  contentType: string;
  cacheControl?: string;
  upsert?: boolean;
  chunkSizeBytes?: number;
  maxChunkRetries?: number;
  onProgress?: (percent: number) => void;
  fetchImpl?: typeof fetch;
}

function toBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function encodeTusMetadata(meta: Record<string, string>): string {
  return Object.entries(meta)
    .map(([k, v]) => `${k} ${toBase64Utf8(v)}`)
    .join(",");
}

function resolveLocationUrl(endpoint: string, locationHeader: string): string {
  if (/^https?:\/\//i.test(locationHeader)) return locationHeader;
  const base = new URL(endpoint);
  return new URL(locationHeader, base.origin).toString();
}

/**
 * Uploads a Blob/File using TUS 1.0.0 resumable protocol against Supabase Storage
 * (`/storage/v1/upload/resumable`) with automatic `HEAD` offset recovery on dropped chunks.
 */
export async function uploadViaTusResumable(options: TusUploadOptions): Promise<string> {
  const fetchFn = options.fetchImpl ?? fetch;
  const endpoint = `${options.supabaseUrl.replace(/\/$/, "")}/storage/v1/upload/resumable`;
  const chunkSize = Math.max(256 * 1024, options.chunkSizeBytes ?? TUS_CHUNK_SIZE_BYTES);
  const maxRetries = Math.max(1, options.maxChunkRetries ?? 3);
  const totalBytes = options.file.size;

  if (totalBytes <= 0) {
    throw new Error("Cannot upload an empty (0-byte) file.");
  }

  const baseHeaders: Record<string, string> = {
    Authorization: `Bearer ${options.accessToken}`,
    apikey: options.anonKey,
    "Tus-Resumable": "1.0.0",
  };

  // Step 1: Create resumable upload session
  const createRes = await fetchFn(endpoint, {
    method: "POST",
    headers: {
      ...baseHeaders,
      "Upload-Length": String(totalBytes),
      "Upload-Metadata": encodeTusMetadata({
        bucketName: options.bucket,
        objectName: options.objectPath,
        contentType: options.contentType || "application/octet-stream",
        cacheControl: options.cacheControl ?? "3600",
      }),
      "x-upsert": options.upsert ? "true" : "false",
    },
  });

  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => "");
    throw new Error(
      `Resumable upload initialization failed (HTTP ${createRes.status}): ${errText || createRes.statusText}`,
    );
  }

  const rawLocation = createRes.headers.get("Location") || createRes.headers.get("location");
  if (!rawLocation) {
    throw new Error("Resumable upload server did not return an upload Location URL.");
  }
  const uploadUrl = resolveLocationUrl(endpoint, rawLocation);

  // Step 2: Stream chunks via PATCH with HEAD offset recovery on transient interruptions
  let offset = 0;
  options.onProgress?.(0);

  while (offset < totalBytes) {
    let succeeded = false;
    let lastErr: unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const end = Math.min(totalBytes, offset + chunkSize);
      const chunk = options.file.slice(offset, end);
      try {
        const patchRes = await fetchFn(uploadUrl, {
          method: "PATCH",
          headers: {
            ...baseHeaders,
            "Upload-Offset": String(offset),
            "Content-Type": "application/offset+octet-stream",
          },
          body: chunk,
        });

        if (patchRes.ok) {
          const nextOffsetHeader =
            patchRes.headers.get("Upload-Offset") || patchRes.headers.get("upload-offset");
          const parsedNext = nextOffsetHeader ? Number(nextOffsetHeader) : end;
          offset = Number.isFinite(parsedNext) && parsedNext > offset ? parsedNext : end;
          options.onProgress?.(Math.min(100, Math.round((offset / totalBytes) * 100)));
          succeeded = true;
          break;
        }

        // Non-retryable 4xx (except 408/409/429) fails fast
        if (
          patchRes.status >= 400 &&
          patchRes.status < 500 &&
          patchRes.status !== 408 &&
          patchRes.status !== 409 &&
          patchRes.status !== 429
        ) {
          const errText = await patchRes.text().catch(() => "");
          throw new Error(
            `Resumable upload rejected (HTTP ${patchRes.status}): ${errText || patchRes.statusText}`,
          );
        }

        lastErr = new Error(`Chunk upload interrupted (HTTP ${patchRes.status})`);
      } catch (err) {
        lastErr = err;
        if (err instanceof Error && /rejected \(HTTP 4\d\d\)/i.test(err.message)) {
          throw err;
        }
      }

      // Recover exact server offset via HEAD before retrying the next attempt
      if (attempt < maxRetries) {
        try {
          const headRes = await fetchFn(uploadUrl, {
            method: "HEAD",
            headers: baseHeaders,
          });
          if (headRes.ok) {
            const serverOffset = Number(
              headRes.headers.get("Upload-Offset") || headRes.headers.get("upload-offset") || "",
            );
            if (Number.isFinite(serverOffset) && serverOffset >= 0 && serverOffset <= totalBytes) {
              offset = serverOffset;
              if (offset >= totalBytes) {
                options.onProgress?.(100);
                succeeded = true;
                break;
              }
            }
          }
        } catch {
          // Proceed to retry with backoff
        }
        await new Promise((resolve) => setTimeout(resolve, 250 * Math.pow(2, attempt - 1)));
      }
    }

    if (!succeeded) {
      throw lastErr instanceof Error
        ? lastErr
        : new Error("Resumable upload failed after retries.");
    }
  }

  return options.objectPath;
}

export interface MultipartPartUrl {
  partNumber: number;
  url: string;
}

export interface MultipartCompletedPart {
  partNumber: number;
  etag: string;
}

export interface MultipartPresignedUploadOptions {
  file: Blob;
  partUrls: MultipartPartUrl[];
  chunkSizeBytes?: number;
  maxPartRetries?: number;
  onProgress?: (percent: number) => void;
  fetchImpl?: typeof fetch;
}

/**
 * Uploads chunks directly to S3/R2 presigned `UploadPart` URLs (zero server proxying)
 * and returns `{ partNumber, etag }[]` for multipart completion.
 */
export async function uploadPartsDirectly(
  options: MultipartPresignedUploadOptions,
): Promise<MultipartCompletedPart[]> {
  const fetchFn = options.fetchImpl ?? fetch;
  const chunkSize = Math.max(5 * 1024 * 1024, options.chunkSizeBytes ?? MULTIPART_CHUNK_SIZE_BYTES);
  const maxRetries = Math.max(1, options.maxPartRetries ?? 3);
  const totalBytes = options.file.size;
  const completed: MultipartCompletedPart[] = [];
  let uploadedBytes = 0;

  for (const part of options.partUrls) {
    const start = (part.partNumber - 1) * chunkSize;
    const end = Math.min(totalBytes, start + chunkSize);
    if (start >= totalBytes) break;

    const slice = options.file.slice(start, end);
    let etag: string | null = null;
    let lastErr: unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetchFn(part.url, {
          method: "PUT",
          body: slice,
        });
        if (res.ok) {
          etag = (
            res.headers.get("ETag") ||
            res.headers.get("etag") ||
            `"part-${part.partNumber}"`
          ).replace(/^"|"$/g, "");
          break;
        }
        lastErr = new Error(`Multipart part ${part.partNumber} failed (HTTP ${res.status})`);
      } catch (err) {
        lastErr = err;
      }
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 250 * Math.pow(2, attempt - 1)));
      }
    }

    if (!etag) {
      throw lastErr instanceof Error
        ? lastErr
        : new Error(`Multipart upload failed at part ${part.partNumber}`);
    }

    completed.push({ partNumber: part.partNumber, etag: `"${etag}"` });
    uploadedBytes += end - start;
    options.onProgress?.(Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)));
  }

  return completed;
}
