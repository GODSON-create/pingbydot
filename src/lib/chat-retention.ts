/**
 * Ping by DOT — Scalable Private Chat Retention System (Feature-Flagged)
 *
 * Central entitlement model & React Query hooks for configurable private-chat
 * retention (`24h_after_view`, `7d`, `30d`, `1y`, `until_deleted`), individual
 * message/attachment saving with storage quotas, and transparent multi-participant
 * policy enforcement.
 *
 * Strictly applies to private conversations ONLY — never affects public Pings,
 * profiles, published Moments, Venture listings, Clips, or Hub content.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ChatRetentionPolicy = "24h_after_view" | "7d" | "30d" | "1y" | "until_deleted";

export type ChatRetentionTierKey =
  "standard_unverified" | "verified" | "paid_eligible" | "premium_eligible";

export interface ChatRetentionPolicyMeta {
  value: ChatRetentionPolicy;
  rank: number;
  label: string;
  shortLabel: string;
  description: string;
  requiredTierLabel: string;
}

export const CHAT_RETENTION_POLICIES: readonly ChatRetentionPolicyMeta[] = [
  {
    value: "24h_after_view",
    rank: 1,
    label: "24 hours after viewing",
    shortLabel: "24h after view",
    description: "New messages expire 24 hours after the recipient views the chat (unless saved).",
    requiredTierLabel: "All accounts",
  },
  {
    value: "7d",
    rank: 2,
    label: "7 days after sending",
    shortLabel: "7 days",
    description: "New messages and attachments expire 7 days after sending (unless saved).",
    requiredTierLabel: "All accounts",
  },
  {
    value: "30d",
    rank: 3,
    label: "30 days after sending",
    shortLabel: "30 days",
    description: "Extended 30-day retention for verified accounts and eligible plans.",
    requiredTierLabel: "Verified account or higher",
  },
  {
    value: "1y",
    rank: 4,
    label: "1 year after sending",
    shortLabel: "1 year",
    description: "Long-term 1-year retention for eligible Plus & Pro members.",
    requiredTierLabel: "Eligible paid plan (Plus / Pro)",
  },
  {
    value: "until_deleted",
    rank: 5,
    label: "Until manually deleted",
    shortLabel: "Until deleted",
    description: "Messages remain until manually deleted, subject to plan storage quotas.",
    requiredTierLabel: "Premium eligible plan (Business)",
  },
] as const;

export interface ChatRetentionEntitlement {
  tier_key: ChatRetentionTierKey;
  plan_slug: string;
  is_verified: boolean;
  max_retention_policy: ChatRetentionPolicy;
  max_retention_rank: number;
  saved_storage_quota_bytes: number;
  saved_storage_used_bytes: number;
  feature_enabled: boolean;
  default_chat_retention_policy: ChatRetentionPolicy;
}

export const DEFAULT_CHAT_RETENTION_ENTITLEMENT: ChatRetentionEntitlement = {
  tier_key: "standard_unverified",
  plan_slug: "free",
  is_verified: false,
  max_retention_policy: "7d",
  max_retention_rank: 2,
  saved_storage_quota_bytes: 104_857_600, // 100 MB
  saved_storage_used_bytes: 0,
  feature_enabled: false,
  default_chat_retention_policy: "7d",
};

const POLICY_BY_VALUE = new Map(CHAT_RETENTION_POLICIES.map((p) => [p.value, p]));

export function getRetentionPolicyMeta(
  policy: ChatRetentionPolicy | string | null | undefined,
): ChatRetentionPolicyMeta {
  return (
    POLICY_BY_VALUE.get((policy as ChatRetentionPolicy) || "7d") ?? CHAT_RETENTION_POLICIES[1]!
  );
}

export function getRetentionPolicyRank(
  policy: ChatRetentionPolicy | string | null | undefined,
): number {
  return POLICY_BY_VALUE.get(policy as ChatRetentionPolicy)?.rank ?? 2;
}

export function isPolicyAllowedByMax(
  policy: ChatRetentionPolicy,
  maxPolicy: ChatRetentionPolicy,
): boolean {
  return getRetentionPolicyRank(policy) <= getRetentionPolicyRank(maxPolicy);
}

/**
 * Computes the effective maximum retention policy allowed in a conversation across all
 * participants (minimum ceiling wins so no user can silently extend another's limit).
 */
export function computeEffectiveConversationMaxPolicy(
  participantMaxPolicies: ChatRetentionPolicy[],
): ChatRetentionPolicy {
  if (participantMaxPolicies.length === 0) return "7d";
  let lowest = CHAT_RETENTION_POLICIES[CHAT_RETENTION_POLICIES.length - 1]!;
  for (const pol of participantMaxPolicies) {
    const meta = getRetentionPolicyMeta(pol);
    if (meta.rank < lowest.rank) {
      lowest = meta;
    }
  }
  return lowest.value;
}

/**
 * Evaluates the controlled Chat Retention feature flag (off by default until staged & verified).
 */
export function isChatRetentionFeatureEnabled(options?: {
  dbEnabled?: boolean;
  envOverride?: Record<string, string | undefined>;
}): boolean {
  if (typeof options?.dbEnabled === "boolean" && options.dbEnabled) {
    return true;
  }
  const env =
    options?.envOverride ??
    (typeof import.meta !== "undefined"
      ? (import.meta.env as Record<string, string | undefined> | undefined)
      : undefined) ??
    (typeof process !== "undefined" ? process.env : {});
  const raw = (env["VITE_FEATURE_CHAT_RETENTION"] ?? env["PING_FEATURE_CHAT_RETENTION"] ?? "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "enabled";
}

export function formatStorageBytes(bytes: number): string {
  const safe = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  if (safe >= 1024 * 1024 * 1024) return `${(safe / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (safe >= 1024 * 1024) return `${(safe / (1024 * 1024)).toFixed(1)} MB`;
  if (safe >= 1024) return `${Math.round(safe / 1024)} KB`;
  return `${safe} B`;
}

export function formatMessageExpiryBadge(params: {
  expiresAt?: string | null;
  retentionPolicy?: ChatRetentionPolicy | string | null;
  isSavedInChat?: boolean;
  nowMs?: number;
}): { label: string; urgent: boolean } | null {
  if (params.isSavedInChat) {
    return { label: "Saved in chat", urgent: false };
  }
  if (!params.expiresAt) {
    if (params.retentionPolicy === "until_deleted") {
      return { label: "Kept until deleted", urgent: false };
    }
    return null;
  }

  const now = params.nowMs ?? Date.now();
  const expMs = new Date(params.expiresAt).getTime();
  if (!Number.isFinite(expMs)) return null;

  const diffMs = expMs - now;
  if (diffMs <= 0) {
    return { label: "Expiring now", urgent: true };
  }

  const mins = Math.ceil(diffMs / 60_000);
  if (mins < 60) {
    return { label: `Expires in ${mins}m`, urgent: true };
  }
  const hours = Math.ceil(diffMs / 3_600_000);
  if (hours <= 24) {
    return { label: `Expires in ${hours}h`, urgent: hours <= 6 };
  }
  const days = Math.ceil(diffMs / 86_400_000);
  return { label: `Expires in ${days}d`, urgent: false };
}

function isMissingRetentionSchema(err: unknown): boolean {
  const code = String((err as { code?: unknown } | null)?.code ?? "");
  const msg = String((err as { message?: unknown } | null)?.message ?? "").toLowerCase();
  return (
    code === "PGRST202" ||
    code === "42883" ||
    code === "42P01" ||
    code === "42703" ||
    msg.includes("does not exist") ||
    msg.includes("could not find the function")
  );
}

export function myChatRetentionEntitlementQuery(userId?: string) {
  return {
    queryKey: ["chat-retention-entitlement", userId],
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: async (): Promise<ChatRetentionEntitlement> => {
      if (!userId) return DEFAULT_CHAT_RETENTION_ENTITLEMENT;
      const { data, error } = await (supabase as any).rpc("get_my_chat_retention_entitlement");
      if (error) {
        if (isMissingRetentionSchema(error)) {
          return {
            ...DEFAULT_CHAT_RETENTION_ENTITLEMENT,
            feature_enabled: isChatRetentionFeatureEnabled(),
          };
        }
        throw error;
      }
      const row = (data ?? {}) as Partial<ChatRetentionEntitlement>;
      return {
        ...DEFAULT_CHAT_RETENTION_ENTITLEMENT,
        ...row,
        feature_enabled: isChatRetentionFeatureEnabled({ dbEnabled: Boolean(row.feature_enabled) }),
      };
    },
  };
}

export function useMyChatRetentionEntitlement(userId?: string) {
  return useQuery(myChatRetentionEntitlementQuery(userId));
}

export function useSetDefaultChatRetention(userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (policy: ChatRetentionPolicy) => {
      if (!userId) throw new Error("Sign in to update chat retention settings.");
      const { data, error } = await (supabase as any).rpc("set_my_default_chat_retention", {
        p_policy: policy,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat-retention-entitlement", userId] });
      qc.invalidateQueries({ queryKey: ["privacy-preferences", userId] });
    },
  });
}

export function useSetConversationRetention(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (policy: ChatRetentionPolicy) => {
      const { data, error } = await (supabase as any).rpc("set_conversation_retention_policy", {
        p_conversation_id: conversationId,
        p_policy: policy,
      });
      if (error) throw error;
      return data as {
        conversation_id: string;
        retention_policy: ChatRetentionPolicy;
        effective_max_policy: ChatRetentionPolicy;
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation-messages", conversationId] });
    },
  });
}
