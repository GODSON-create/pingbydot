import { z } from "zod";

export const ADMIN_PAGE_SIZE = 25;
export const adminListSchema = z.object({
  view: z.enum([
    "pings",
    "users",
    "reports",
    "signals",
    "verifications",
    "plans",
    "boosts",
    "audit",
  ]),
  page: z.number().int().min(0).max(100000),
  search: z.string().trim().max(100),
});
export const moderationSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["hide", "restore", "resolve_report"]),
  reason: z.string().trim().min(3).max(500),
});
export const verifySignalSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["verified", "rejected", "pending", "unverified"]),
});
export const reviewVerificationSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["verified", "rejected", "revoked", "pending"]),
  reviewerNote: z.string().trim().max(500).default(""),
  expiresAt: z.string().datetime().nullable().optional(),
});
export const upsertMembershipPlanSchema = z.object({
  slug: z.enum(["free", "plus", "pro", "business"]),
  name: z.string().trim().min(2).max(60),
  badge: z.string().trim().min(2).max(40),
  tagline: z.string().trim().max(240),
  dotPrice: z.number().int().min(0).max(100000),
  durationDays: z.number().int().min(0).max(365),
  benefits: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .nullable()
    .optional(),
  perks: z.array(z.string().trim().max(180)).max(12).nullable().optional(),
  isActive: z.boolean(),
});
export const moderateBoostSchema = z.object({
  campaignId: z.string().uuid(),
  decision: z.enum(["paused", "rejected", "refunded"]),
  reason: z.string().trim().min(3).max(500),
  refundAmount: z.number().int().min(0).max(100000).default(0),
});
export const economicReadinessSchema = z.object({
  days: z.number().int().min(7).max(90).default(30),
});
export function assertAdminRole(verified: boolean) {
  if (!verified) throw new Error("Access denied");
}
