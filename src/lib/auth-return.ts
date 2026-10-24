export function authDestination(value: unknown): "/create" | "/settings" | "/explore" {
  return value === "/create" || value === "/settings" ? value : "/explore";
}