export interface AuthCallbackParams {
  code: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  error: string | null;
}

export function authDestination(value: unknown): string {
  if (typeof value !== "string") return "/explore";
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) {
    return "/explore";
  }
  const pathOnly = trimmed.split(/[?#]/)[0] || "/";
  if (
    pathOnly === "/login" ||
    pathOnly === "/signup" ||
    pathOnly === "/welcome" ||
    pathOnly === "/forgot-password" ||
    pathOnly === "/reset-password"
  ) {
    return "/explore";
  }
  return trimmed;
}

/**
 * Unwraps `/onboarding?next=...` back to the underlying destination so returning users
 * or chained confirmation links never bounce twice through onboarding.
 */
export function unwrapOnboardingDestination(destination: string): string {
  const safe = authDestination(destination || "/");
  const pathOnly = safe.split(/[?#]/)[0] || "/";
  if (pathOnly !== "/onboarding") return safe;
  const queryStart = safe.indexOf("?");
  if (queryStart === -1) return "/";
  const innerNext = new URLSearchParams(safe.slice(queryStart + 1)).get("next");
  return innerNext ? authDestination(innerNext) : "/";
}

function joinRedirectBase(origin: string, path: string): string {
  const cleanOrigin = origin.replace(/\/+$/, "");
  if (cleanOrigin.endsWith(":")) {
    return `${cleanOrigin}//${path.replace(/^\/+/, "")}`;
  }
  return `${cleanOrigin}/${path.replace(/^\/+/, "")}`;
}

export function buildAuthRedirectUri(nextPath: string, origin: string): string {
  const safeNext = nextPath && nextPath.trim() ? authDestination(nextPath) : "/";
  return `${joinRedirectBase(origin, "login")}?next=${encodeURIComponent(safeNext)}`;
}

export function buildSignupConfirmationRedirect(nextPath: string, origin: string): string {
  const safeNext = nextPath && nextPath.trim() ? authDestination(nextPath) : "/";
  const onboardingTarget =
    safeNext && safeNext !== "/"
      ? `/onboarding?next=${encodeURIComponent(safeNext)}`
      : "/onboarding";
  return `${joinRedirectBase(origin, "login")}?next=${encodeURIComponent(onboardingTarget)}`;
}

export function extractAuthCallbackParams(searchStr: string, hashStr: string): AuthCallbackParams {
  const searchParams = new URLSearchParams(searchStr.replace(/^\?/, ""));
  const hashParams = new URLSearchParams(hashStr.replace(/^#/, ""));
  return {
    code: searchParams.get("code"),
    accessToken: hashParams.get("access_token"),
    refreshToken: hashParams.get("refresh_token"),
    error:
      hashParams.get("error_description") ||
      hashParams.get("error") ||
      searchParams.get("error_description") ||
      searchParams.get("error"),
  };
}
