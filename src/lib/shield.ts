/**
 * PING SHIELD — Application-level security, rate-limiting, and abuse prevention baseline.
 */

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface ShieldValidationResult {
  allowed: boolean;
  reason?: string;
  remaining?: number;
  resetInMs?: number;
}

// In-memory rate limiting cache for client-side action gating
const actionCache = new Map<string, number[]>();

export const SHIELD_LIMITS: Record<string, RateLimitConfig> = {
  create_ping: { maxRequests: 5, windowMs: 60_000 }, // 5 pings / min
  send_message: { maxRequests: 30, windowMs: 60_000 }, // 30 DMs / min
  send_comment: { maxRequests: 15, windowMs: 60_000 }, // 15 comments / min
  create_moment: { maxRequests: 5, windowMs: 60_000 }, // 5 moments / min
  like_action: { maxRequests: 60, windowMs: 60_000 }, // 60 likes / min
};

/**
 * Checks whether an action by an identifier (user ID or IP token) passes rate-limit thresholds.
 */
export function checkShieldRateLimit(
  action: keyof typeof SHIELD_LIMITS | string,
  identifier: string,
): ShieldValidationResult {
  const config = SHIELD_LIMITS[action] ?? { maxRequests: 20, windowMs: 60_000 };
  const key = `${action}:${identifier}`;
  const now = Date.now();

  const timestamps = (actionCache.get(key) ?? []).filter((ts) => now - ts < config.windowMs);

  if (timestamps.length >= config.maxRequests) {
    const oldest = timestamps[0];
    const resetInMs = oldest ? config.windowMs - (now - oldest) : config.windowMs;
    return {
      allowed: false,
      reason: `Rate limit exceeded for ${action}. Please wait a moment.`,
      remaining: 0,
      resetInMs,
    };
  }

  timestamps.push(now);
  actionCache.set(key, timestamps);

  return {
    allowed: true,
    remaining: config.maxRequests - timestamps.length,
    resetInMs: config.windowMs,
  };
}

/**
 * Resets the shield rate limit for testing purposes.
 */
export function resetShieldCache(): void {
  actionCache.clear();
}

/**
 * Hardens media upload validation: validates MIME type and file size.
 */
export interface MediaValidationRules {
  allowedMimeTypes: string[];
  maxSizeBytes: number;
}

export type MediaKind = "image" | "video" | "audio" | "document";

export const MEDIA_RULES: Record<MediaKind, MediaValidationRules> = {
  image: {
    allowedMimeTypes: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/heic",
      "image/heif",
    ],
    maxSizeBytes: 10 * 1024 * 1024, // 10MB
  },
  video: {
    allowedMimeTypes: ["video/mp4", "video/webm", "video/quicktime"],
    maxSizeBytes: 50 * 1024 * 1024, // 50MB
  },
  audio: {
    allowedMimeTypes: [
      "audio/webm",
      "audio/mp4",
      "audio/mpeg",
      "audio/ogg",
      "audio/wav",
      "audio/aac",
    ],
    maxSizeBytes: 25 * 1024 * 1024, // 25MB
  },
  document: {
    allowedMimeTypes: [
      "application/pdf",
      "text/plain",
      "text/csv",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/zip",
    ],
    maxSizeBytes: 25 * 1024 * 1024, // 25MB
  },
};

const EXTENSION_MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip",
};

const DANGEROUS_EXTENSIONS = [
  ".exe",
  ".sh",
  ".bat",
  ".cmd",
  ".msi",
  ".ps1",
  ".vbs",
  ".js",
  ".mjs",
  ".html",
  ".htm",
  ".dll",
  ".apk",
];

export function resolveNormalizedMime(file: { type: string; name: string }): string {
  const rawType = (file.type || "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (rawType === "image/jpg") return "image/jpeg";
  if (rawType === "video/x-m4v") return "video/mp4";
  if (rawType === "audio/x-m4a" || rawType === "audio/m4a") return "audio/mp4";
  if (rawType) return rawType;

  const lowerName = (file.name || "").toLowerCase();
  const dotIdx = lowerName.lastIndexOf(".");
  if (dotIdx >= 0) {
    const ext = lowerName.slice(dotIdx);
    if (EXTENSION_MIME_MAP[ext]) return EXTENSION_MIME_MAP[ext];
  }
  return "";
}

export function detectMediaKind(file: { type: string; name: string }): MediaKind {
  const mime = resolveNormalizedMime(file);
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  return "document";
}

export function validateMediaUpload(
  file: { type: string; size: number; name: string },
  kind: MediaKind = "image",
): { valid: boolean; error?: string } {
  if (file.size <= 0) {
    return {
      valid: false,
      error: "Selected file is empty (0 bytes). Please choose another file.",
    };
  }

  const rules = MEDIA_RULES[kind];
  const resolvedMime = resolveNormalizedMime(file);

  if (!resolvedMime || !rules.allowedMimeTypes.includes(resolvedMime)) {
    return {
      valid: false,
      error: `Unsupported file format (${resolvedMime || "unknown"}). Allowed: ${rules.allowedMimeTypes.join(", ")}`,
    };
  }

  if (file.size > rules.maxSizeBytes) {
    const maxMb = Math.round(rules.maxSizeBytes / (1024 * 1024));
    return {
      valid: false,
      error: `File is too large (${Math.max(1, Math.round(file.size / 1024 / 1024))}MB). Maximum allowed is ${maxMb}MB.`,
    };
  }

  const name = (file.name || "").toLowerCase();
  if (name.includes("..") || DANGEROUS_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return {
      valid: false,
      error: "Invalid or unsafe file name.",
    };
  }

  return { valid: true };
}

/**
 * Text content sanitization: strips control characters, normalizes whitespace.
 */
export function sanitizeUserText(input: string): string {
  if (!input) return "";
  // Strip null bytes and non-printable control characters (except newline, tab)
  // eslint-disable-next-line no-control-regex
  const stripped = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  return stripped.trim();
}
