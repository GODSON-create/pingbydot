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

export const MEDIA_RULES = {
  image: {
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    maxSizeBytes: 10 * 1024 * 1024, // 10MB
  },
  video: {
    allowedMimeTypes: ["video/mp4", "video/webm", "video/quicktime"],
    maxSizeBytes: 50 * 1024 * 1024, // 50MB
  },
};

export function validateMediaUpload(
  file: { type: string; size: number; name: string },
  kind: "image" | "video" = "image",
): { valid: boolean; error?: string } {
  const rules = MEDIA_RULES[kind];

  if (!rules.allowedMimeTypes.includes(file.type.toLowerCase())) {
    return {
      valid: false,
      error: `Unsupported file format (${file.type}). Allowed: ${rules.allowedMimeTypes.join(", ")}`,
    };
  }

  if (file.size > rules.maxSizeBytes) {
    const maxMb = Math.round(rules.maxSizeBytes / (1024 * 1024));
    return {
      valid: false,
      error: `File is too large (${Math.round(file.size / 1024 / 1024)}MB). Maximum allowed is ${maxMb}MB.`,
    };
  }

  // Prevent dangerous double-extensions or directory traversal
  const name = file.name.toLowerCase();
  if (
    name.includes("..") ||
    name.endsWith(".exe") ||
    name.endsWith(".sh") ||
    name.endsWith(".html")
  ) {
    return {
      valid: false,
      error: "Invalid file name.",
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
