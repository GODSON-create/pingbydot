import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AccountTier = "free" | "plus" | "pro" | "institution";

export interface DotWallet {
  user_id: string;
  balance: number;
  lifetime_earned: number;
  lifetime_spent: number;
  streak_days: number;
  last_checkin_at: string | null;
}

export interface DotTransaction {
  id: string;
  amount: number;
  tx_type: "earn" | "spend" | "bonus" | "upgrade";
  source: string;
  description: string;
  created_at: string;
}

export interface AccountSubscription {
  user_id: string;
  tier: AccountTier;
  status: string;
  billing_cycle: string;
  started_at: string;
  expires_at: string | null;
}

export interface DotSummary {
  migrated: boolean;
  wallet: DotWallet;
  subscription: AccountSubscription;
  transactions: DotTransaction[];
}

export interface UpgradeTierInfo {
  id: AccountTier;
  name: string;
  badge: string;
  dotCost: number;
  tagline: string;
  perks: string[];
  highlighted?: boolean;
}

export const UPGRADE_TIERS: UpgradeTierInfo[] = [
  {
    id: "free",
    name: "Free Builder",
    badge: "Starter",
    dotCost: 0,
    tagline: "Everything you need to build in public and join the network.",
    perks: [
      "Unlimited public Pings & share cards",
      "24-hour Moments & Profile Highlights",
      "Join public & private Community Hubs",
      "1-to-1 encrypted Direct Messaging",
    ],
  },
  {
    id: "plus",
    name: "Builder Plus",
    badge: "Plus",
    dotCost: 150,
    tagline: "Stand out in Explore and unlock extended creator workflows.",
    perks: [
      "Everything in Free Builder",
      "Builder Plus profile badge & priority replies",
      "90-day Creator Analytics history",
      "Extended Highlight collections & custom covers",
    ],
  },
  {
    id: "pro",
    name: "Founder Pro",
    badge: "Pro",
    dotCost: 350,
    tagline:
      "Champagne Gold creator plan with extended network insights (optional, DOT credits only).",
    highlighted: true,
    perks: [
      "Founder Pro plan badge (separate from verification)",
      "Full Ping, Moment, Hub & Signal performance telemetry",
      "Priority placement options in personal feeds",
      "Higher daily Moment & Hub broadcast quotas",
    ],
  },
  {
    id: "institution",
    name: "Institution",
    badge: "Org Plan",
    dotCost: 600,
    tagline: "Designed for accelerators, universities, startups, businesses, and collectives.",
    perks: [
      "Eligible for optional institutional Signal verification review",
      "Multi-publisher Signal & Hub team governance",
      "Official organizational broadcast analytics",
      "Organizational plan badge (distinct from verified credentials)",
    ],
  },
];

export function canClaimDailyCheckin(lastCheckinAt: string | null): boolean {
  if (!lastCheckinAt) return true;
  const lastDate = new Date(lastCheckinAt).toISOString().slice(0, 10);
  const todayDate = new Date().toISOString().slice(0, 10);
  return lastDate < todayDate;
}

export function dotSummaryQuery(userId?: string) {
  return queryOptions({
    queryKey: ["dot-summary", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<DotSummary> => {
      if (!userId) {
        return {
          migrated: false,
          wallet: {
            user_id: "",
            balance: 0,
            lifetime_earned: 0,
            lifetime_spent: 0,
            streak_days: 0,
            last_checkin_at: null,
          },
          subscription: {
            user_id: "",
            tier: "free",
            status: "active",
            billing_cycle: "dot_credits",
            started_at: new Date().toISOString(),
            expires_at: null,
          },
          transactions: [],
        };
      }

      const { data, error } = await supabase.rpc("get_my_dot_summary");
      if (!error && data && typeof data === "object") {
        const raw = data as unknown as {
          wallet: DotWallet;
          subscription: AccountSubscription;
          transactions: DotTransaction[];
        };
        return {
          migrated: true,
          wallet: raw.wallet,
          subscription: raw.subscription,
          transactions: raw.transactions ?? [],
        };
      }

      if (error) {
        const isMissingRpc =
          error.code === "PGRST202" ||
          error.code === "42883" ||
          error.message?.toLowerCase().includes("does not exist");
        if (!isMissingRpc) {
          throw error;
        }
      }

      // Graceful read-only fallback only when migration 0016 RPC is not yet deployed
      const { count: pingCount } = await supabase
        .from("pings")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .is("hidden_at", null);

      const estimatedEarned = 50 + (pingCount ?? 0) * 10;

      return {
        migrated: false,
        wallet: {
          user_id: userId,
          balance: estimatedEarned,
          lifetime_earned: estimatedEarned,
          lifetime_spent: 0,
          streak_days: 0,
          last_checkin_at: null,
        },
        subscription: {
          user_id: userId,
          tier: "free",
          status: "active",
          billing_cycle: "dot_credits",
          started_at: new Date().toISOString(),
          expires_at: null,
        },
        transactions: [
          {
            id: "preview-welcome",
            amount: 50,
            tx_type: "bonus",
            source: "welcome_grant",
            description: "Starter DOT allocation (pending ledger sync)",
            created_at: new Date().toISOString(),
          },
          ...(pingCount && pingCount > 0
            ? [
                {
                  id: "preview-pings",
                  amount: pingCount * 10,
                  tx_type: "earn" as const,
                  source: "published_pings",
                  description: `Activity credit for ${pingCount} published ${pingCount === 1 ? "Ping" : "Pings"}`,
                  created_at: new Date().toISOString(),
                },
              ]
            : []),
        ],
      };
    },
  });
}

export function publicAccountTierQuery(userId?: string) {
  return queryOptions({
    queryKey: ["public-tier", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<AccountTier> => {
      if (!userId) return "free";
      const { data, error } = await supabase.rpc("get_public_account_tier", {
        _user_id: userId,
      });
      if (error || !data) return "free";
      if (data === "plus" || data === "pro" || data === "institution") return data;
      return "free";
    },
  });
}

export function useClaimDailyDot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("claim_daily_dot");
      if (error) throw error;
      return data as unknown as { reward: number; streak_days: number; wallet: DotWallet };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dot-summary"] });
    },
  });
}

export function useUpgradeWithDots() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      tier,
      billingCycle = "dot_credits",
    }: {
      tier: Exclude<AccountTier, "free">;
      billingCycle?: "monthly" | "annual" | "dot_credits";
    }) => {
      const { data, error } = await supabase.rpc("upgrade_account_with_dots", {
        _tier: tier,
        _billing_cycle: billingCycle,
      });
      if (error) throw error;
      return data as unknown as { wallet: DotWallet; subscription: AccountSubscription };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dot-summary"] });
      qc.invalidateQueries({ queryKey: ["public-tier"] });
    },
  });
}
