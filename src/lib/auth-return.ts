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
    pathOnly === "/forgot-password" ||
    pathOnly === "/reset-password"
  ) {
    return "/explore";
  }
  return trimmed;
}
