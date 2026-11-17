const SENSITIVE_KEYS = new Set([
  "password",
  "passwd",
  "secret",
  "token",
  "access_token",
  "refresh_token",
  "apikey",
  "api_key",
  "service_role",
  "service_role_key",
  "supabase_service_role_key",
  "authorization",
  "cookie",
  "set-cookie",
  "email",
  "content",
  "message",
  "private_message",
  "balance",
  "amount",
]);

const MAX_SANITIZED_LENGTH = 400;

export function sanitizeErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message || error.name
      : typeof error === "string"
        ? error
        : "Unexpected application error.";

  const cleaned = raw
    // Redact database/service connection strings containing credentials
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"']+/gi, "[redacted-db-url]")
    // Redact Bearer tokens
    .replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [redacted]")
    // Redact Supabase keys (publishable & secret)
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "[redacted-key]")
    // Redact JWTs
    .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}\b/g, "[redacted-jwt]")
    // Redact key=value / secret: value pairs
    .replace(
      /\b(password|passwd|secret|token|access_token|refresh_token|apikey|api_key|service_role|authorization)\s*([:=])\s*['"]?[^\s'",;]+['"]?/gi,
      "$1$2[redacted]",
    )
    // Redact query-string tokens/keys
    .replace(
      /([?&](?:apikey|token|access_token|refresh_token|code|secret)=)[^&\s]+/gi,
      "$1[redacted]",
    )
    // Redact user emails
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[redacted-email]")
    .trim();

  if (!cleaned) return "Unexpected application error.";
  return cleaned.length > MAX_SANITIZED_LENGTH
    ? `${cleaned.slice(0, MAX_SANITIZED_LENGTH - 1)}…`
    : cleaned;
}

export function sanitizeErrorContext(
  context?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!context) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    const normalizedKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(normalizedKey)) {
      result[key] = "[redacted]";
      continue;
    }
    if (typeof value === "string") {
      result[key] = sanitizeErrorMessage(value);
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      result[key] = value;
    } else if (value instanceof Error) {
      result[key] = sanitizeErrorMessage(value);
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
