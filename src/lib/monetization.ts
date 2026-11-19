import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type MonetizationCategory =
  | "core_free"
  | "premium_user"
  | "creator_service"
  | "business_subscription"
  | "verification_service";

export type MonetizationBillingMode = "free" | "dot_credits" | "planned_fiat";

export interface MonetizationOffering {
  slug: string;
  category: MonetizationCategory;
  title: string;
  summary: string;
  billing_mode: MonetizationBillingMode;
  dot_credit_cost: number | null;
  is_compulsory: false;
  live_payment_enabled: false;
  linked_tier: "free" | "plus" | "pro" | "institution" | null;
  features: string[];
  display_order: number;
}

export interface MonetizationFoundationState {
  migrated: boolean;
  verification_optional: true;
  dot_credits_are_cash: false;
  live_fiat_payments_enabled: false;
  offerings: MonetizationOffering[];
}

export const DEFAULT_MONETIZATION_OFFERINGS: readonly MonetizationOffering[] = [
  {
    slug: "core_ping_access",
    category: "core_free",
    title: "Core Ping Network Access",
    summary:
      "Free everyday access to publishing Pings, Explore discovery, Communities, DMs, and Moments.",
    billing_mode: "free",
    dot_credit_cost: 0,
    is_compulsory: false,
    live_payment_enabled: false,
    linked_tier: "free",
    features: [
      "Unlimited public Pings",
      "Moments & Close Circle",
      "Community Hubs & DMs",
      "No mandatory verification or fees",
    ],
    display_order: 1,
  },
  {
    slug: "member_plus_credits",
    category: "premium_user",
    title: "Member Plus (DOT Credits)",
    summary: "Optional enhanced profile tools redeemable with earned non-cash DOT builder credits.",
    billing_mode: "dot_credits",
    dot_credit_cost: 150,
    is_compulsory: false,
    live_payment_enabled: false,
    linked_tier: "plus",
    features: [
      "90-day analytics window",
      "Extended highlight collections",
      "Plan badge separate from verification",
    ],
    display_order: 2,
  },
  {
    slug: "creator_services_foundation",
    category: "creator_service",
    title: "Creator Services & Audience Tools",
    summary:
      "Foundation for creator analytics, highlights, and future verified creator monetization.",
    billing_mode: "planned_fiat",
    dot_credit_cost: null,
    is_compulsory: false,
    live_payment_enabled: false,
    linked_tier: "pro",
    features: [
      "Expanded creator insights",
      "Future paid memberships pending payment security audit",
    ],
    display_order: 3,
  },
  {
    slug: "business_organization_suite",
    category: "business_subscription",
    title: "Business & Organization Suite",
    summary:
      "Multi-publisher Signal governance and organization coordination preview; commercial billing planned.",
    billing_mode: "dot_credits",
    dot_credit_cost: 600,
    is_compulsory: false,
    live_payment_enabled: false,
    linked_tier: "institution",
    features: [
      "Multi-publisher Signal workflows",
      "Institutional broadcast telemetry",
      "Distinct from admin verification",
    ],
    display_order: 4,
  },
  {
    slug: "optional_verification_review",
    category: "verification_service",
    title: "Optional Trust & Credential Verification",
    summary:
      "Voluntary identity and professional account verification reviewed by administrators at no required charge.",
    billing_mode: "free",
    dot_credit_cost: 0,
    is_compulsory: false,
    live_payment_enabled: false,
    linked_tier: null,
    features: [
      "Identity verification pathway",
      "Creator, Business, Org, Builder, Investor pathways",
      "Priority enterprise KYB planned for future commercial release",
    ],
    display_order: 5,
  },
] as const;

export function monetizationCatalogQuery() {
  return queryOptions({
    queryKey: ["monetization-foundation"],
    staleTime: 60_000,
    queryFn: async (): Promise<MonetizationFoundationState> => {
      const fallback: MonetizationFoundationState = {
        migrated: false,
        verification_optional: true,
        dot_credits_are_cash: false,
        live_fiat_payments_enabled: false,
        offerings: [...DEFAULT_MONETIZATION_OFFERINGS],
      };

      if (typeof supabase?.rpc !== "function") return fallback;

      const { data, error } = await supabase.rpc("get_monetization_foundation");
      if (error) {
        const msg = (error.message ?? "").toLowerCase();
        const isMissing =
          error.code === "PGRST202" ||
          error.code === "42883" ||
          msg.includes("does not exist") ||
          msg.includes("could not find");
        if (isMissing) return fallback;
        throw error;
      }

      if (!data || typeof data !== "object") return fallback;
      const raw = data as { offerings?: unknown };
      const rawOfferings = Array.isArray(raw.offerings) ? raw.offerings : [];

      return {
        migrated: true,
        verification_optional: true,
        dot_credits_are_cash: false,
        live_fiat_payments_enabled: false,
        offerings:
          rawOfferings.length > 0
            ? (rawOfferings as MonetizationOffering[]).map((o) => ({
                ...o,
                is_compulsory: false,
                live_payment_enabled: false,
              }))
            : [...DEFAULT_MONETIZATION_OFFERINGS],
      };
    },
  });
}
