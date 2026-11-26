import { supabase } from "@/integrations/supabase/client";

const SIGNED_URL_TTL_SECONDS = 3600;
const CACHE_SAFETY_MARGIN_MS = 60_000;

interface CachedSignedUrl {
  url: string;
  expiresAt: number;
}

const signedUrlCache = new Map<string, CachedSignedUrl>();

export interface StorageObjectRef {
  bucket: string;
  objectPath: string;
}

/**
 * Extracts bucket and object path from existing Supabase Storage URLs or
 * `storage://<bucket>/<path>` references without mutating external URLs.
 */
export function parseStorageObjectRef(rawUrl: string | null | undefined): StorageObjectRef | null {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith("blob:") || trimmed.startsWith("data:")) {
    return null;
  }

  if (trimmed.startsWith("storage://")) {
    const rest = trimmed.slice("storage://".length);
    const slashIdx = rest.indexOf("/");
    if (slashIdx <= 0 || slashIdx === rest.length - 1) return null;
    return {
      bucket: rest.slice(0, slashIdx),
      objectPath: rest.slice(slashIdx + 1),
    };
  }

  try {
    const parsed = new URL(trimmed);
    // Already a signed URL with token — return null so caller uses it as-is
    if (parsed.pathname.includes("/storage/v1/object/sign/")) {
      return null;
    }
    const match = parsed.pathname.match(
      /\/storage\/v1\/object\/(?:public|authenticated)\/([^/]+)\/(.+)$/,
    );
    if (!match || !match[1] || !match[2]) return null;
    return {
      bucket: decodeURIComponent(match[1]),
      objectPath: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
}

/**
 * Resolves an array of storage URLs into authorized viewer-scoped signed URLs
 * when backed by a private Supabase Storage bucket (e.g. `media`), preserving
 * external/already-signed URLs and gracefully falling back on error.
 */
export async function resolveStorageMediaUrls(
  urls: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const now = Date.now();
  const pendingByBucket = new Map<string, Array<{ raw: string; objectPath: string }>>();

  for (const raw of urls) {
    if (!raw) continue;
    if (resolved.has(raw)) continue;

    const ref = parseStorageObjectRef(raw);
    if (!ref) {
      resolved.set(raw, raw);
      continue;
    }

    const cacheKey = `${ref.bucket}:${ref.objectPath}`;
    const cached = signedUrlCache.get(cacheKey);
    if (cached && cached.expiresAt > now + CACHE_SAFETY_MARGIN_MS) {
      resolved.set(raw, cached.url);
      continue;
    }

    const bucketList = pendingByBucket.get(ref.bucket) ?? [];
    bucketList.push({ raw, objectPath: ref.objectPath });
    pendingByBucket.set(ref.bucket, bucketList);
  }

  for (const [bucket, items] of pendingByBucket.entries()) {
    const storageBucket = supabase.storage?.from?.(bucket);
    if (!storageBucket) {
      for (const item of items) resolved.set(item.raw, item.raw);
      continue;
    }

    const uniquePaths = Array.from(new Set(items.map((i) => i.objectPath)));

    try {
      if (typeof storageBucket.createSignedUrls === "function") {
        const { data, error } = await storageBucket.createSignedUrls(
          uniquePaths,
          SIGNED_URL_TTL_SECONDS,
        );
        if (!error && Array.isArray(data)) {
          const byPath = new Map<string, string>();
          for (const entry of data) {
            if (entry?.path && entry?.signedUrl) {
              byPath.set(entry.path, entry.signedUrl);
              signedUrlCache.set(`${bucket}:${entry.path}`, {
                url: entry.signedUrl,
                expiresAt: now + SIGNED_URL_TTL_SECONDS * 1000,
              });
            }
          }
          for (const item of items) {
            resolved.set(item.raw, byPath.get(item.objectPath) ?? item.raw);
          }
          continue;
        }
      }

      if (typeof storageBucket.createSignedUrl === "function") {
        await Promise.all(
          items.map(async (item) => {
            const { data, error } = await storageBucket.createSignedUrl(
              item.objectPath,
              SIGNED_URL_TTL_SECONDS,
            );
            if (!error && data?.signedUrl) {
              signedUrlCache.set(`${bucket}:${item.objectPath}`, {
                url: data.signedUrl,
                expiresAt: now + SIGNED_URL_TTL_SECONDS * 1000,
              });
              resolved.set(item.raw, data.signedUrl);
            } else {
              resolved.set(item.raw, item.raw);
            }
          }),
        );
        continue;
      }
    } catch {
      // Fall back to original URL below
    }

    for (const item of items) {
      if (!resolved.has(item.raw)) {
        resolved.set(item.raw, item.raw);
      }
    }
  }

  return resolved;
}

export async function resolveStorageMediaUrl(
  rawUrl: string | null | undefined,
): Promise<string | null> {
  if (!rawUrl) return null;
  const map = await resolveStorageMediaUrls([rawUrl]);
  return map.get(rawUrl) ?? rawUrl;
}
