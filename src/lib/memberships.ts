/**
 * PING Configurable DOT Membership & Subscription Engine (Section 3)
 *
 * Architecture & Security Guarantees:
 * - Reads configurable membership plans dynamically from `public.membership_plans`
 *   (no hardcoded limits when DB catalog is migrated).
 * - Stores entitlements in `public.subscription_entitlements`, strictly separated
 *   from the user's DOT wallet balance.
 * - Executes debits & activations atomically server-side via idempotent
 *   `subscribe_with_dots(p_plan_slug, p_idempotency_key)` RPC (never deducts DOT twice).
 * - Strictly separate from Identity & Professional Verification (spending DOT NEVER
 *   auto-grants identity verification!).
 */

import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type MembershipSlug = "free" | "plus" | "pro" | "business";

export interface MembershipBenefitLimits {
  max_profile_links?: number;
  analytics_days?: number;
  scheduling?: boolean;
  premium_stickers?: boolean;
  profile_customisation?: boolean;
  community_tools?: boolean;
  enhanced_business?: boolean;
}

export interface MembershipPlan {
  slug: MembershipSlug;
  name: string;
  badge: string;
  tagline: string;
  dot_price: number;
  duration_days: number;
  benefits: MembershipBenefitLimits;
  perks: string[];
  highlighted: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface SubscriptionEntitlement {
  user_id: string;
  plan_slug: MembershipSlug;
  status: "active" | "cancelled" | "expired";
  auto_renew: boolean;
  started_at: string;
  expires_at: string | null;
  cancelled_at: string | null;
  entitlements: MembershipBenefitLimits;
  updated_at: string;
}

export interface SubscriptionReceipt {
  id: string;
  user_id: string;
  plan_slug: MembershipSlug;
  action: "activate" | "renew" | "cancel" | "expire";
  dot_charged: number;
  idempotency_key: string | null;
  receipt_number: string;
  period_start: string;
  period_end: string | null;
  note: string;
  created_at: string;
}

export const FALLBACK_MEMBERSHIP_PLANS: readonly MembershipPlan[] = [
  {
    slug: "free",
    name: "Free",
    badge: "Free",
    tagline:
      "Open access to Pings, Moments, Community Hubs, Signals, and private Direct Messaging.",
    dot_price: 0,
    duration_days: 0,
    benefits: {
      max_profile_links: 3,
      analytics_days: 7,
      scheduling: false,
      premium_stickers: false,
      profile_customisation: false,
      community_tools: false,
      enhanced_business: false,
    },
    perks: [
      "Unlimited public Pings, DOT Tags & branded share cards",
      "24-hour Moments & Profile Highlights",
      "Join public & private Community Hubs",
      "1-to-1 Direct Messaging & Group Conversations",
    ],
    highlighted: false,
    is_active: true,
    sort_order: 0,
  },
  {
    slug: "plus",
    name: "Plus",
    badge: "Plus",
    tagline:
      "Profile customisation, additional links, scheduled publishing, and extended creator analytics.",
    dot_price: 150,
    duration_days: 30,
    benefits: {
      max_profile_links: 8,
      analytics_days: 30,
      scheduling: true,
      premium_stickers: true,
      profile_customisation: true,
      community_tools: false,
      enhanced_business: false,
    },
    perks: [
      "Custom accent themes & enhanced profile customisation",
      "Up to 8 external profile connections & links",
      "Ping scheduling & 30-day creator analytics history",
      "Premium sticker packs & extended Highlight covers",
    ],
    highlighted: false,
    is_active: true,
    sort_order: 1,
  },
  {
    slug: "pro",
    name: "Pro",
    badge: "Pro",
    tagline:
      "Complete creator & community toolkit with 90-day insights, priority workflows, and advanced tools.",
    dot_price: 350,
    duration_days: 30,
    benefits: {
      max_profile_links: 15,
      analytics_days: 90,
      scheduling: true,
      premium_stickers: true,
      profile_customisation: true,
      community_tools: true,
      enhanced_business: false,
    },
    perks: [
      "Everything in Plus (strictly separate from identity verification)",
      "Up to 15 profile links & 90-day economic + engagement analytics",
      "Advanced creator tools, scheduling & campaign tracking",
      "Expanded Community Hub governance & event management tools",
    ],
    highlighted: true,
    is_active: true,
    sort_order: 2,
  },
  {
    slug: "business",
    name: "Business",
    badge: "Business",
    tagline:
      "Enhanced multi-agent Business Inbox tools, team workflows, storefronts, and institutional scale.",
    dot_price: 600,
    duration_days: 30,
    benefits: {
      max_profile_links: 25,
      analytics_days: 90,
      scheduling: true,
      premium_stickers: true,
      profile_customisation: true,
      community_tools: true,
      enhanced_business: true,
    },
    perks: [
      "Everything in Pro plus enhanced multi-agent Business Inbox tools",
      "Expanded storefront catalogue, CRM saved replies & lead exports",
      "Multi-publisher Signal channels & institutional Hub governance",
      "Organizational plan badge (never auto-grants identity verification)",
    ],
    highlighted: false,
    is_active: true,
    sort_order: 3,
  },
] as const;

function isMissingMembershipSchema(err: unknown): boolean {
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

export function isEntitlementActive(ent: SubscriptionEntitlement | null | undefined): boolean {
  if (!ent || ent.plan_slug === "free") return false;
  if (ent.status === "expired") return false;
  if (ent.expires_at && new Date(ent.expires_at).getTime() <= Date.now()) return false;
  return ent.status === "active" || ent.status === "cancelled";
}

export function hasMembershipBenefit(
  ent: SubscriptionEntitlement | null | undefined,
  benefit: keyof MembershipBenefitLimits,
): boolean {
  if (!isEntitlementActive(ent)) return false;
  const val = ent?.entitlements?.[benefit];
  return typeof val === "boolean" ? val : typeof val === "number" ? val > 0 : false;
}

export function generateSubscriptionIdempotencyKey(
  userId: string,
  planSlug: MembershipSlug,
): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `sub_${planSlug}_${userId.slice(0, 8)}_${rand}`;
}

export function membershipPlansQuery() {
  return queryOptions({
    queryKey: ["membership-plans"],
    staleTime: 60_000,
    queryFn: async (): Promise<{ migrated: boolean; plans: MembershipPlan[] }> => {
      const { data, error } = await (supabase as any)
        .from("membership_plans")
        .select("*")
        .order("sort_order", { ascending: true });

      if (error) {
        if (!isMissingMembershipSchema(error)) throw error;
        return { migrated: false, plans: [...FALLBACK_MEMBERSHIP_PLANS] };
      }
      const rows = (data ?? []) as MembershipPlan[];
      return {
        migrated: true,
        plans: rows.length > 0 ? rows : [...FALLBACK_MEMBERSHIP_PLANS],
      };
    },
  });
}

export function mySubscriptionEntitlementQuery(userId?: string) {
  return queryOptions({
    queryKey: ["subscription-entitlement", userId],
    enabled: Boolean(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<SubscriptionEntitlement | null> => {
      if (!userId) return null;
      const { data, error } = await (supabase as any)
        .from("subscription_entitlements")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        if (!isMissingMembershipSchema(error)) throw error;
        return null;
      }
      return (data as SubscriptionEntitlement | null) ?? null;
    },
  });
}

export function mySubscriptionReceiptsQuery(userId?: string) {
  return queryOptions({
    queryKey: ["subscription-receipts", userId],
    enabled: Boolean(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<SubscriptionReceipt[]> => {
      if (!userId) return [];
      const { data, error } = await (supabase as any)
        .from("subscription_receipts")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(25);

      if (error) {
        if (!isMissingMembershipSchema(error)) throw error;
        return [];
      }
      return (data ?? []) as SubscriptionReceipt[];
    },
  });
}

export function useSubscribeWithDots() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      planSlug,
      idempotencyKey,
    }: {
      planSlug: Exclude<MembershipSlug, "free">;
      idempotencyKey: string;
    }) => {
      const { data, error } = await (supabase as any).rpc("subscribe_with_dots", {
        p_plan_slug: planSlug,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw error;
      return data as {
        idempotent_replay: boolean;
        entitlement: SubscriptionEntitlement;
        receipt: SubscriptionReceipt;
      };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dot-summary"] });
      void qc.invalidateQueries({ queryKey: ["subscription-entitlement"] });
      void qc.invalidateQueries({ queryKey: ["subscription-receipts"] });
      void qc.invalidateQueries({ queryKey: ["public-tier"] });
      void qc.invalidateQueries({ queryKey: ["header-notifications"] });
    },
  });
}

export function useCancelDotSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (reason: string = "") => {
      const { data, error } = await (supabase as any).rpc("cancel_my_dot_subscription", {
        p_reason: reason,
      });
      if (error) throw error;
      return data as { entitlement: SubscriptionEntitlement; receipt: SubscriptionReceipt };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dot-summary"] });
      void qc.invalidateQueries({ queryKey: ["subscription-entitlement"] });
      void qc.invalidateQueries({ queryKey: ["subscription-receipts"] });
      void qc.invalidateQueries({ queryKey: ["public-tier"] });
    },
  });
}

export function useAdminUpsertMembershipPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (plan: {
      slug: MembershipSlug;
      name: string;
      badge: string;
      tagline: string;
      dotPrice: number;
      durationDays: number;
      benefits: MembershipBenefitLimits;
      perks: string[];
      isActive: boolean;
    }) => {
      const { data, error } = await (supabase as any).rpc("admin_upsert_membership_plan", {
        p_slug: plan.slug,
        p_name: plan.name,
        p_badge: plan.badge,
        p_tagline: plan.tagline,
        p_dot_price: plan.dotPrice,
        p_duration_days: plan.durationDays,
        p_benefits: plan.benefits,
        p_perks: plan.perks,
        p_is_active: plan.isActive,
      });
      if (error) throw error;
      return data as MembershipPlan;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["membership-plans"] });
    },
  });
}
