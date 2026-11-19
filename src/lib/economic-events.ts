import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { sanitizeErrorContext, sanitizeErrorMessage } from "@/lib/error-diagnostics";
import { PARTICIPATION_PATHWAY_IDS, type ParticipationPathwayId } from "@/lib/pathways";

export const ECONOMIC_EVENT_TYPES = [
  "account_created",
  "onboarding_completed",
  "profile_completed",
  "first_meaningful_session",
  "connection_created",
  "ping_published",
  "ping_shared",
  "meaningful_conversation_started",
  "community_joined",
  "business_lead_generated",
  "transaction_completed",
  "venture_submitted",
  "investor_introduction_completed",
  "dot_credit_earned",
  "dot_credit_redeemed",
] as const;

export type EconomicEventType = (typeof ECONOMIC_EVENT_TYPES)[number];

export const CLIENT_EMITTABLE_EVENT_TYPES = [
  "first_meaningful_session",
  "ping_shared",
  "business_lead_generated",
] as const;

export type ClientEmittableEventType = (typeof CLIENT_EMITTABLE_EVENT_TYPES)[number];

export const SERVER_ONLY_OUTCOME_EVENT_TYPES = [
  "transaction_completed",
  "venture_submitted",
  "investor_introduction_completed",
] as const;

export type EconomicEventCategory =
  | "acquisition"
  | "activation"
  | "engagement"
  | "referral"
  | "lead"
  | "credit_activity"
  | "verified_outcome";

export type EconomicTargetType =
  | "profile"
  | "ping"
  | "conversation"
  | "hub"
  | "signal"
  | "moment"
  | "connection"
  | "external_url"
  | "dot_transaction"
  | "settlement"
  | "venture"
  | "introduction";

export const EVENT_CATEGORY_BY_TYPE: Record<EconomicEventType, EconomicEventCategory> = {
  account_created: "acquisition",
  onboarding_completed: "activation",
  profile_completed: "activation",
  first_meaningful_session: "activation",
  connection_created: "engagement",
  ping_published: "engagement",
  ping_shared: "referral",
  meaningful_conversation_started: "engagement",
  community_joined: "engagement",
  business_lead_generated: "lead",
  dot_credit_earned: "credit_activity",
  dot_credit_redeemed: "credit_activity",
  transaction_completed: "verified_outcome",
  venture_submitted: "verified_outcome",
  investor_introduction_completed: "verified_outcome",
};

export const USER_SEGMENTS: readonly ParticipationPathwayId[] = PARTICIPATION_PATHWAY_IDS;

export const LEAD_ELIGIBLE_PING_CATEGORIES = new Set([
  "offer",
  "opportunity",
  "need",
  "collaboration",
  "launch",
]);

export const DASHBOARD_FOUNDATION_PILLARS = [
  { id: "acquisition", label: "Acquisition", status: "supported" },
  { id: "activation", label: "Activation", status: "supported" },
  { id: "retention", label: "Retention", status: "supported" },
  { id: "engagement", label: "Engagement", status: "supported" },
  { id: "referrals", label: "Referrals", status: "supported" },
  {
    id: "creator_business_monetization",
    label: "Creator & Business Monetization",
    status: "partial_credits_and_leads_ready_no_checkout_yet",
  },
  {
    id: "verified_economic_outcomes",
    label: "Verified Economic Outcomes",
    status: "schema_ready_awaiting_payment_and_deal_settlements",
  },
] as const;

const FORBIDDEN_METADATA_KEYS = new Set([
  "amount",
  "amount_minor",
  "gross_amount",
  "gross_amount_minor",
  "platform_fee_minor",
  "net_amount",
  "net_amount_minor",
  "revenue",
  "price",
  "currency",
  "verified",
  "verification_tier",
  "settlement_status",
  "settled",
  "content",
  "message",
  "private_message",
  "email",
  "password",
  "passwd",
  "token",
  "access_token",
  "refresh_token",
  "secret",
  "api_key",
  "apikey",
  "handle",
]);

const ATTRIBUTION_STORAGE_KEY = "ping_landing_attribution_v1";
const FIRST_SESSION_STORAGE_PREFIX = "ping_first_meaningful_session_v1:";

export type SafeEventRecord = Record<string, string | number | boolean | null>;

/**
 * Strips monetary fabrication fields, private message content, handles, emails,
 * and credentials before sending event metadata or attribution to the server.
 */
export function sanitizeEventRecord(
  input?: Record<string, string | number | boolean | null | undefined>,
): SafeEventRecord {
  if (!input) return {};
  const filtered: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(input)) {
    if (rawValue === undefined) continue;
    const key = rawKey.trim().toLowerCase();
    if (!key || FORBIDDEN_METADATA_KEYS.has(key)) continue;
    filtered[rawKey.slice(0, 48)] =
      typeof rawValue === "string" ? sanitizeErrorMessage(rawValue).slice(0, 200) : rawValue;
  }
  const safe = sanitizeErrorContext(filtered);
  return (safe as SafeEventRecord | undefined) ?? {};
}

export function captureLandingAttribution(): SafeEventRecord {
  if (typeof window === "undefined") return {};
  try {
    const existingRaw = window.sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    if (existingRaw) {
      const parsed = JSON.parse(existingRaw) as Record<string, string | number | boolean | null>;
      return sanitizeEventRecord(parsed);
    }

    const params = new URLSearchParams(window.location.search);
    const snapshot: SafeEventRecord = {
      entry_path: window.location.pathname.slice(0, 120),
    };

    for (const key of ["utm_source", "utm_medium", "utm_campaign", "ref"] as const) {
      const val = params.get(key)?.trim();
      if (val) snapshot[key] = sanitizeErrorMessage(val).slice(0, 80);
    }

    if (document.referrer) {
      try {
        const refUrl = new URL(document.referrer);
        if (refUrl.origin !== window.location.origin) {
          snapshot["referrer_host"] = refUrl.hostname.slice(0, 120);
        }
      } catch {
        // Ignore malformed document.referrer strings
      }
    }

    const clean = sanitizeEventRecord(snapshot);
    window.sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(clean));
    return clean;
  } catch {
    return {};
  }
}

export interface RecordNetworkEventParams {
  eventType: ClientEmittableEventType | string;
  targetType?: EconomicTargetType | null;
  targetId?: string | null;
  source?: string;
  attribution?: Record<string, string | number | boolean | null | undefined>;
  metadata?: Record<string, string | number | boolean | null | undefined>;
  dedupeKey?: string | null;
}

export function validateClientEventPayload(params: RecordNetworkEventParams): {
  eventType: ClientEmittableEventType;
  targetType: EconomicTargetType | null;
  targetId: string | null;
  source: string;
  attribution: SafeEventRecord;
  metadata: SafeEventRecord;
  dedupeKey: string | null;
} {
  if (!CLIENT_EMITTABLE_EVENT_TYPES.includes(params.eventType as ClientEmittableEventType)) {
    throw new Error(
      `Client cannot emit server-verified or system-only event type: ${String(params.eventType)}`,
    );
  }

  const targetId = params.targetId?.trim() ? params.targetId.trim().slice(0, 160) : null;
  const source = params.source?.trim() ? params.source.trim().slice(0, 64) : "web_app";
  const dedupeKey = params.dedupeKey?.trim() ? params.dedupeKey.trim().slice(0, 120) : null;

  return {
    eventType: params.eventType as ClientEmittableEventType,
    targetType: params.targetType ?? null,
    targetId,
    source,
    attribution: sanitizeEventRecord({
      ...captureLandingAttribution(),
      ...(params.attribution ?? {}),
      ...(typeof window !== "undefined"
        ? { route_path: window.location.pathname.slice(0, 120) }
        : {}),
    }),
    metadata: sanitizeEventRecord(params.metadata),
    dedupeKey,
  };
}

/**
 * Strict version of client event recording that propagates validation or RPC errors.
 * Useful in security/authorization tests and explicit workflows.
 */
export async function submitValidatedNetworkEvent(
  params: RecordNetworkEventParams,
): Promise<string | null> {
  const clean = validateClientEventPayload(params);
  if (typeof supabase?.rpc !== "function") return null;

  const { data, error } = await supabase.rpc("record_network_event", {
    _event_type: clean.eventType,
    _target_type: clean.targetType,
    _target_id: clean.targetId,
    _source: clean.source,
    _attribution: clean.attribution as Json,
    _metadata: clean.metadata as Json,
    _dedupe_key: clean.dedupeKey,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

/**
 * Non-blocking product measurement dispatcher for authenticated client UI flows.
 * Silently ignores telemetry failures so core user journeys are never interrupted.
 */
export async function recordNetworkEvent(params: RecordNetworkEventParams): Promise<string | null> {
  try {
    return await submitValidatedNetworkEvent(params);
  } catch {
    return null;
  }
}

export function recordFirstMeaningfulSessionOnce(userId?: string, source = "app_session"): void {
  if (!userId || typeof window === "undefined") return;
  try {
    const key = `${FIRST_SESSION_STORAGE_PREFIX}${userId}`;
    if (window.sessionStorage.getItem(key) === "1") return;
    window.sessionStorage.setItem(key, "1");
    void recordNetworkEvent({
      eventType: "first_meaningful_session",
      targetType: "profile",
      targetId: userId,
      source,
      dedupeKey: "first_meaningful_session",
    });
  } catch {
    // Ignore storage restrictions
  }
}

export interface CreatorEconomicSummary {
  migrated: boolean;
  days: number;
  engagement: {
    pings_published: number;
    connections_created: number;
    meaningful_conversations: number;
    communities_joined: number;
  };
  referrals: {
    shares_received: number;
    shares_initiated: number;
  };
  leads: {
    leads_received: number;
    leads_initiated: number;
  };
  dot_credits: {
    is_cash_revenue: false;
    currency: "DOT_CREDIT";
    earned: number;
    redeemed: number;
    upgrades_count: number;
  };
  verified_outcomes: {
    is_cash_revenue: true;
    settled_transactions_count: number;
    verified_net_amount_minor: number;
  };
}

export function creatorEconomicSummaryQuery(userId?: string, days = 30) {
  return queryOptions({
    queryKey: ["creator-economic-summary", userId, days],
    enabled: Boolean(userId),
    queryFn: async (): Promise<CreatorEconomicSummary> => {
      const empty: CreatorEconomicSummary = {
        migrated: false,
        days,
        engagement: {
          pings_published: 0,
          connections_created: 0,
          meaningful_conversations: 0,
          communities_joined: 0,
        },
        referrals: {
          shares_received: 0,
          shares_initiated: 0,
        },
        leads: {
          leads_received: 0,
          leads_initiated: 0,
        },
        dot_credits: {
          is_cash_revenue: false,
          currency: "DOT_CREDIT",
          earned: 0,
          redeemed: 0,
          upgrades_count: 0,
        },
        verified_outcomes: {
          is_cash_revenue: true,
          settled_transactions_count: 0,
          verified_net_amount_minor: 0,
        },
      };
      if (!userId || typeof supabase?.rpc !== "function") return empty;

      const { data, error } = await supabase.rpc("get_creator_economic_summary", {
        _days: days,
      });

      if (error) {
        const msg = (error.message ?? "").toLowerCase();
        const isMissingRpc =
          error.code === "PGRST202" ||
          error.code === "42883" ||
          msg.includes("does not exist") ||
          msg.includes("could not find the function");
        if (isMissingRpc) return empty;
        throw error;
      }

      if (!data || typeof data !== "object") return empty;
      const raw = data as unknown as Omit<CreatorEconomicSummary, "migrated">;
      return {
        migrated: true,
        days: raw.days ?? days,
        engagement: raw.engagement ?? empty.engagement,
        referrals: raw.referrals ?? empty.referrals,
        leads: raw.leads ?? empty.leads,
        dot_credits: {
          is_cash_revenue: false,
          currency: "DOT_CREDIT",
          earned: raw.dot_credits?.earned ?? 0,
          redeemed: raw.dot_credits?.redeemed ?? 0,
          upgrades_count: raw.dot_credits?.upgrades_count ?? 0,
        },
        verified_outcomes: {
          is_cash_revenue: true,
          settled_transactions_count: raw.verified_outcomes?.settled_transactions_count ?? 0,
          verified_net_amount_minor: raw.verified_outcomes?.verified_net_amount_minor ?? 0,
        },
      };
    },
  });
}
