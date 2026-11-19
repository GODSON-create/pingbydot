import { sanitizeErrorContext, sanitizeErrorMessage } from "@/lib/error-diagnostics";

export type Phase1TelemetryEvent =
  | "welcome_slide_viewed"
  | "welcome_skipped"
  | "auth_started"
  | "auth_completed"
  | "auth_failed"
  | "onboarding_step_saved"
  | "onboarding_completed"
  | "onboarding_skipped"
  | "api_error"
  | "performance_metric"
  | "media_upload_retried"
  | "account_data_exported";

const SESSION_RESTORE_EVENT_KEY = "ping_telemetry_session_restored_v1";

/**
 * Emits sanitized client product telemetry without ever sending PII, tokens, or credentials.
 */
export function trackEvent(
  event: Phase1TelemetryEvent,
  properties?: Record<string, string | number | boolean | null | undefined>,
): void {
  if (typeof window === "undefined") return;
  try {
    const cleanInput: Record<string, unknown> = {};
    if (properties) {
      for (const [key, value] of Object.entries(properties)) {
        if (value !== undefined) cleanInput[key] = value;
      }
    }
    const safeProps = sanitizeErrorContext(cleanInput);
    window.__lovableEvents?.track?.(event, safeProps);
  } catch {
    // Telemetry must never interrupt user workflows.
  }
}

export function trackSessionRestoredOnce(isNewUser: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (window.sessionStorage.getItem(SESSION_RESTORE_EVENT_KEY) === "1") return;
    window.sessionStorage.setItem(SESSION_RESTORE_EVENT_KEY, "1");
    trackEvent("auth_completed", {
      method: "session_restore",
      is_new_user: isNewUser,
    });
  } catch {
    // Ignore sessionStorage restrictions in private contexts.
  }
}

export function clearSessionRestoredFlag(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(SESSION_RESTORE_EVENT_KEY);
    for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith("ping_first_meaningful_session_v1:")) {
        window.sessionStorage.removeItem(k);
      }
    }
  } catch {
    // Ignore sessionStorage restrictions.
  }
}

export function trackApiError(operation: string, error: unknown): void {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  trackEvent("api_error", {
    operation: operation.slice(0, 80),
    code: code.slice(0, 32) || "unknown",
    detail: sanitizeErrorMessage(error).slice(0, 180),
  });
}

export function trackPerformanceMetric(metric: string, durationMs: number, ok = true): void {
  trackEvent("performance_metric", {
    metric: metric.slice(0, 80),
    duration_ms: Math.max(0, Math.round(durationMs)),
    ok,
  });
}
