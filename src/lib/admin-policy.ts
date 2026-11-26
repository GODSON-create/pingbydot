import { z } from "zod";
import { ADMIN_PERMISSIONS, type AdminPermission } from "./admin-rbac";

export const ADMIN_PAGE_SIZE = 25;

export const APPOINTABLE_ADMIN_ROLES = [
  "admin",
  "moderator",
  "support",
  "analyst",
  "finance_admin",
  "community_admin",
  "spotlight_editor",
] as const;

export const adminListSchema = z.object({
  view: z.enum([
    "pings",
    "users",
    "reports",
    "signals",
    "hubs",
    "verifications",
    "plans",
    "boosts",
    "businesses",
    "learn",
    "early_access",
    "system_errors",
    "staff",
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

export const updateCourseScheduleSchema = z.object({
  requireLeapfrogCompletion: z.boolean(),
  releaseIntervalDays: z.number().int().min(7).max(180),
  coursesPerCycle: z.number().int().min(1).max(5),
  minAssessmentScore: z.number().int().min(50).max(100),
  releaseOrder: z.array(z.string().trim().min(2).max(48)).min(1).max(20),
});

export const spotlightDecisionSchema = z.object({
  candidateId: z.string().uuid(),
  status: z.enum(["under_review", "shortlisted", "selected", "declined", "retracted"]),
  selectionReason: z.string().trim().min(8).max(1000),
  scores: z.record(z.string(), z.number().min(0).max(10)).nullable().optional(),
  weightedTotal: z.number().min(0).max(100).nullable().optional(),
  internalNotes: z.string().trim().max(2500).default(""),
});

export const spotlightPublishSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{3,80}$/),
  candidateId: z.string().uuid().nullable().optional(),
  founderId: z.string().uuid(),
  businessId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(3).max(160),
  editorialIntro: z.string().trim().max(1000).default(""),
  founderStory: z.string().trim().min(20).max(12000),
  businessDescription: z.string().trim().max(4000).default(""),
  problemSolved: z.string().trim().max(2000).default(""),
  productSolution: z.string().trim().max(2000).default(""),
  evidenceAchievements: z.array(z.string().trim().max(240)).max(12).default([]),
  mediaUrls: z.array(z.string().trim().url()).max(8).default([]),
  featuredPingIds: z.array(z.string().uuid()).max(8).default([]),
  featuredClipIds: z.array(z.string().uuid()).max(8).default([]),
  featuredMomentIds: z.array(z.string().uuid()).max(8).default([]),
  dotTags: z.array(z.string().trim().max(32)).max(8).default([]),
  templateLayout: z
    .enum(["editorial_feature", "video_interview", "builder_case_study"])
    .default("editorial_feature"),
  distributionConfig: z
    .object({
      home_feed: z.boolean().default(true),
      explore: z.boolean().default(true),
      official_account: z.boolean().default(true),
      notify_eligible: z.boolean().default(false),
      frequency_cap_days: z.number().int().min(1).max(30).default(7),
    })
    .optional(),
  scheduledFor: z.string().datetime().nullable().optional(),
  videoInterviewUrl: z.string().trim().url().nullable().optional(),
  founderPortraitUrl: z.string().trim().url().nullable().optional(),
  status: z
    .enum(["draft", "scheduled", "published", "corrected", "retracted"])
    .default("published"),
  correctionNote: z.string().trim().max(800).default(""),
});

export const spotlightQueueDiscoverySchema = z.object({
  founderId: z.string().uuid(),
  sourceType: z.enum([
    "ping",
    "moment",
    "clip",
    "profile",
    "business",
    "hub",
    "editorial_discovery",
  ]),
  sourceRefId: z.string().uuid().nullable().optional(),
  headline: z.string().trim().min(3).max(160),
  storyPitch: z.string().trim().min(10).max(4000),
  businessId: z.string().uuid().nullable().optional(),
});

export const economicReadinessSchema = z.object({
  days: z.number().int().min(7).max(90).default(30),
});

export const appointAdminSchema = z.object({
  targetUserId: z.string().uuid(),
  role: z.enum(APPOINTABLE_ADMIN_ROLES),
  reason: z.string().trim().min(5).max(500),
});

export const revokeAdminSchema = z.object({
  targetUserId: z.string().uuid(),
  role: z.enum(APPOINTABLE_ADMIN_ROLES).nullable().optional(),
  reason: z.string().trim().min(5).max(500),
});

export const setUserPermissionSchema = z.object({
  targetUserId: z.string().uuid(),
  permission: z.enum(ADMIN_PERMISSIONS),
  effect: z.enum(["grant", "revoke", "clear"]),
  reason: z.string().trim().min(5).max(500),
});

export function assertAdminRole(verified: boolean) {
  if (!verified) throw new Error("Access denied");
}

export function assertAdminPermission(verified: boolean, permission: AdminPermission) {
  if (!verified) throw new Error(`Access denied: missing permission ${permission}`);
}

export function assertPlatformOwner(isOwner: boolean) {
  if (!isOwner) throw new Error("Access denied: Platform Owner authority required");
}

export function assertEditorialRole(verified: boolean) {
  if (!verified) throw new Error("Spotlight editorial role required");
}
