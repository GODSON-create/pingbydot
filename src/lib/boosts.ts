/**
 * PING DOT-Powered Content Boosting Engine (Section 4)
 *
 * Allows users to promote eligible public Pings and public Moments using DOT credits
 * through server-verified idempotent transactions.
 *
 * Integrity Guarantees:
 * - Never fabricates impressions, reach, clicks, or engagement.
 * - Never guarantees delivery outcomes; only shows estimates when real historical
 *   baseline data exists.
 * - Strictly validates Moment remaining lifetime against requested campaign duration.
 * - Clearly labels promoted content and supports user reporting & audited admin refunds.
 */

import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type BoostContentType = "ping" | "moment";
export type BoostDurationHours = 6 | 12 | 24 | 48 | 72 | 168;
export type BoostAudience = "everyone" | "followers_and_similar" | "interest_matched" | "regional";

export type BoostStatus =
  "pending_review" | "active" | "paused" | "completed" | "rejected" | "refunded" | "cancelled";

export interface BoostCampaign {
  id: string;
  user_id: string;
  content_type: BoostContentType;
  content_id: string;
  status: BoostStatus;
  duration_hours: BoostDurationHours;
  audience: BoostAudience;
  target_interests: string[];
  target_regions: string[];
  dot_cost: number;
  idempotency_key: string | null;
  receipt_number: string;
  starts_at: string;
  ends_at: string;
  impressions_count: number;
  reach_count: number;
  clicks_count: number;
  engagement_count: number;
  moderation_note: string;
  created_at: string;
  updated_at: string;
}

export const BOOST_DURATION_OPTIONS: ReadonlyArray<{
  hours: BoostDurationHours;
  label: string;
  baseDotPrice: number;
}> = [
  { hours: 6, label: "6 hours", baseDotPrice: 20 },
  { hours: 12, label: "12 hours", baseDotPrice: 35 },
  { hours: 24, label: "24 hours", baseDotPrice: 60 },
  { hours: 48, label: "2 days (48h)", baseDotPrice: 110 },
  { hours: 72, label: "3 days (72h)", baseDotPrice: 155 },
  { hours: 168, label: "7 days (168h)", baseDotPrice: 300 },
];

export const BOOST_AUDIENCE_OPTIONS: ReadonlyArray<{
  id: BoostAudience;
  label: string;
  description: string;
  surchargeDots: number;
}> = [
  {
    id: "everyone",
    label: "Broad Network",
    description: "Eligible across Explore and For You discovery streams.",
    surchargeDots: 0,
  },
  {
    id: "followers_and_similar",
    label: "Followers & Similar Builders",
    description: "Prioritises adjacent networks and shared-interest followers.",
    surchargeDots: 0,
  },
  {
    id: "interest_matched",
    label: "DOT Tag & Interest Targeting",
    description: "Targets selected permitted DOT Tags and topic interests.",
    surchargeDots: 15,
  },
  {
    id: "regional",
    label: "Regional Geographic Targeting",
    description: "Targets selected countries or continental regions.",
    surchargeDots: 15,
  },
];

export const PERMITTED_BOOST_REGIONS = [
  "GLOBAL",
  "NG",
  "KE",
  "GH",
  "ZA",
  "RW",
  "EG",
  "SN",
  "GB",
  "US",
  "CA",
  "EU",
] as const;

/**
 * Computes exact DOT price matching server SQL `create_boost_campaign`.
 * The server always recomputes and enforces this price authoritatively.
 */
export function calculateBoostDotPrice(
  durationHours: BoostDurationHours,
  audience: BoostAudience,
): number {
  const base = BOOST_DURATION_OPTIONS.find((d) => d.hours === durationHours)?.baseDotPrice ?? 60;
  const surcharge = audience === "interest_matched" || audience === "regional" ? 15 : 0;
  return base + surcharge;
}

/**
 * Validates that a Moment's remaining lifetime is strictly longer than the requested
 * boost duration and that it is publicly visible (Close Circle Moments are ineligible).
 */
export function validateMomentBoostEligibility(input: {
  audience?: string | null | undefined;
  expiresAt?: string | null | undefined;
  durationHours: BoostDurationHours;
  nowMs?: number | undefined;
}): { eligible: boolean; remainingHours: number; reason?: string } {
  const nowMs = input.nowMs ?? Date.now();
  if (input.audience && input.audience !== "public") {
    return {
      eligible: false,
      remainingHours: 0,
      reason: "Only public Moments can be boosted. Close Circle Moments remain private.",
    };
  }
  if (!input.expiresAt) {
    return {
      eligible: false,
      remainingHours: 0,
      reason: "This Moment has no active expiry timestamp.",
    };
  }
  const expMs = new Date(input.expiresAt).getTime();
  if (!Number.isFinite(expMs) || expMs <= nowMs) {
    return {
      eligible: false,
      remainingHours: 0,
      reason: "This Moment has already expired and cannot be boosted.",
    };
  }
  const remainingHours = Math.floor(((expMs - nowMs) / 3_600_000) * 10) / 10;
  if (remainingHours <= input.durationHours) {
    return {
      eligible: false,
      remainingHours,
      reason: `This Moment expires in ${remainingHours.toFixed(1)}h, which is shorter than the selected ${input.durationHours}h campaign duration. Choose a shorter duration.`,
    };
  }
  return { eligible: true, remainingHours };
}

/**
 * Returns delivery estimate ONLY when reliable historical completed campaign data exists.
 * Never fabricates reach or guarantees outcomes.
 */
export function estimateBoostDelivery(completedCampaigns: BoostCampaign[]): {
  hasReliableData: boolean;
  label: string;
  disclaimer: string;
} {
  const valid = completedCampaigns.filter((c) => c.impressions_count > 0 && c.duration_hours > 0);
  if (valid.length < 3) {
    return {
      hasReliableData: false,
      label: "No reliable historical baseline yet",
      disclaimer:
        "Ping never fabricates delivery numbers or guarantees impressions, reach, or engagement. Actual metrics appear in real time once your campaign is active.",
    };
  }
  const avgPerHour =
    valid.reduce((sum, c) => sum + c.impressions_count / c.duration_hours, 0) / valid.length;
  const low = Math.max(1, Math.round(avgPerHour * 0.7));
  const high = Math.max(low + 1, Math.round(avgPerHour * 1.3));
  return {
    hasReliableData: true,
    label: `Historical range: ~${low}–${high} observed impressions/hr`,
    disclaimer:
      "Based solely on prior completed campaigns on this account. Delivery is not guaranteed.",
  };
}

export function generateBoostIdempotencyKey(
  userId: string,
  contentType: BoostContentType,
  contentId: string,
): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `bst_${contentType}_${contentId.slice(0, 8)}_${userId.slice(0, 6)}_${rand}`;
}

function isMissingBoostSchema(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? "").toLowerCase();
  const code = String((err as { code?: string })?.code ?? "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "42883" ||
    code === "PGRST202" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

export function myBoostCampaignsQuery(userId?: string) {
  return queryOptions({
    queryKey: ["my-boost-campaigns", userId],
    enabled: Boolean(userId),
    staleTime: 20_000,
    queryFn: async (): Promise<{ migrated: boolean; campaigns: BoostCampaign[] }> => {
      if (!userId) return { migrated: true, campaigns: [] };
      const { data, error } = await (supabase as any)
        .from("boost_campaigns")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        if (!isMissingBoostSchema(error)) throw error;
        return { migrated: false, campaigns: [] };
      }
      return { migrated: true, campaigns: (data ?? []) as BoostCampaign[] };
    },
  });
}

/**
 * Returns active promoted content IDs (`content_type:content_id -> BoostCampaign`)
 * so PingCard and MomentViewerModal display honest `Promoted` labels & report controls.
 */
export function activeBoostsMapQuery() {
  return queryOptions({
    queryKey: ["active-boosts-map"],
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, BoostCampaign>> => {
      const nowIso = new Date().toISOString();
      const { data, error } = await (supabase as any)
        .from("boost_campaigns")
        .select("id,user_id,content_type,content_id,status,ends_at,receipt_number")
        .eq("status", "active")
        .gt("ends_at", nowIso)
        .limit(100);

      if (error) {
        if (!isMissingBoostSchema(error)) throw error;
        return {};
      }

      const map: Record<string, BoostCampaign> = {};
      for (const row of (data ?? []) as BoostCampaign[]) {
        map[`${row.content_type}:${row.content_id}`] = row;
      }
      return map;
    },
  });
}

export function useCreateBoostCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      contentType: BoostContentType;
      contentId: string;
      durationHours: BoostDurationHours;
      audience: BoostAudience;
      targetInterests: string[];
      targetRegions: string[];
      idempotencyKey: string;
    }) => {
      const { data, error } = await (supabase as any).rpc("create_boost_campaign", {
        p_content_type: input.contentType,
        p_content_id: input.contentId,
        p_duration_hours: input.durationHours,
        p_audience: input.audience,
        p_target_interests: input.targetInterests,
        p_target_regions: input.targetRegions,
        p_idempotency_key: input.idempotencyKey,
      });
      if (error) throw error;
      return data as { idempotent_replay: boolean; campaign: BoostCampaign };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["my-boost-campaigns"] });
      void qc.invalidateQueries({ queryKey: ["active-boosts-map"] });
      void qc.invalidateQueries({ queryKey: ["dot-summary"] });
    },
  });
}

export function useUpdateMyBoostStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      campaignId,
      status,
    }: {
      campaignId: string;
      status: "active" | "paused" | "cancelled";
    }) => {
      const { data, error } = await (supabase as any).rpc("update_my_boost_status", {
        p_campaign_id: campaignId,
        p_status: status,
      });
      if (error) throw error;
      return data as BoostCampaign;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["my-boost-campaigns"] });
      void qc.invalidateQueries({ queryKey: ["active-boosts-map"] });
    },
  });
}

export function useReportBoostCampaign(userId?: string) {
  return useMutation({
    mutationFn: async (input: { campaignId: string; reason: string; details?: string }) => {
      if (!userId) throw new Error("Sign in to report promoted content.");
      const { error } = await (supabase as any).from("boost_campaign_reports").insert({
        campaign_id: input.campaignId,
        reporter_id: userId,
        reason: input.reason.trim(),
        details: (input.details ?? "").trim(),
      });
      if (error) throw error;
    },
  });
}

export async function recordObservedBoostEvent(
  campaignId: string,
  eventType: "impression" | "click" | "engagement",
): Promise<void> {
  await (supabase as any)
    .rpc("record_boost_event", {
      p_campaign_id: campaignId,
      p_event_type: eventType,
    })
    .then(
      () => {},
      () => {},
    );
}
