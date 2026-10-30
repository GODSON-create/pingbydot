import { z } from "zod";

export const ADMIN_PAGE_SIZE = 25;
export const adminListSchema = z.object({
  view: z.enum(["pings", "users", "reports", "audit"]),
  page: z.number().int().min(0).max(100000),
  search: z.string().trim().max(100),
});
export const moderationSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["hide", "restore", "resolve_report"]),
  reason: z.string().trim().min(3).max(500),
});
export function assertAdminRole(verified: boolean) {
  if (!verified) throw new Error("Access denied");
}