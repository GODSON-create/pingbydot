import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DotTopupRail = "paystack" | "crypto_pending";
export type DotTopupCurrency = "NGN" | "USD";
export type DotTopupStatus =
  "pending" | "awaiting_verification" | "settled" | "failed" | "cancelled";

export interface DotTopupIntent {
  id: string;
  user_id: string;
  rail: DotTopupRail;
  dot_amount: number;
  fiat_currency: string | null;
  fiat_amount_minor: number | null;
  provider_reference: string | null;
  receipt_number?: string | null | undefined;
  status: DotTopupStatus;
  verified_by_webhook?: boolean | undefined;
  refunded_at?: string | null | undefined;
  reversal_reason?: string | null | undefined;
  created_at: string;
  updated_at: string;
}

export interface DotTopupQuote {
  dotAmount: number;
  currency: DotTopupCurrency;
  unitPriceMinor: number;
  totalFiatMinor: number;
  formattedTotal: string;
  sandboxMode: boolean;
}

export interface CryptoPaymentRailAdapter {
  providerId: string | null;
  active: boolean;
  requiresExplicitApproval: true;
  statusLabel: string;
}

export const DOT_TOPUP_LIMITS = {
  minDot: 10,
  maxDotPerTransaction: 100_000,
  maxPendingPer24h: 5,
} as const;

const UNIT_PRICE_MINOR: Record<DotTopupCurrency, number> = {
  NGN: 2500, // ₦25.00 per DOT credit (2500 kobo)
  USD: 2, // $0.02 per DOT credit (2 cents)
};

export function calculateDotTopupQuote(
  dotAmount: number,
  currency: DotTopupCurrency = "NGN",
): DotTopupQuote {
  const cleanDot = Math.max(
    DOT_TOPUP_LIMITS.minDot,
    Math.min(DOT_TOPUP_LIMITS.maxDotPerTransaction, Math.round(dotAmount)),
  );
  const unitPriceMinor = UNIT_PRICE_MINOR[currency];
  const totalFiatMinor = cleanDot * unitPriceMinor;
  const major = totalFiatMinor / 100;
  const formattedTotal =
    currency === "NGN"
      ? `₦${major.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `$${major.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const env = import.meta.env as Record<string, string | undefined> | undefined;
  const liveKeyConfigured = Boolean(env?.["VITE_PAYSTACK_PUBLIC_KEY"]?.startsWith("pk_live_"));

  return {
    dotAmount: cleanDot,
    currency,
    unitPriceMinor,
    totalFiatMinor,
    formattedTotal,
    sandboxMode: !liveKeyConfigured,
  };
}

/**
 * Provider-independent cryptocurrency payment rail placeholder (Phase 4.9).
 * Intentionally unconfigured until a provider is explicitly selected & approved.
 */
export function getCryptoRailStatus(): CryptoPaymentRailAdapter {
  return {
    providerId: null,
    active: false,
    requiresExplicitApproval: true,
    statusLabel: "Inactive — provider-independent interface awaiting explicit approval",
  };
}

export function getPaystackConfigStatus(): {
  mode: "sandbox_unconfigured" | "sandbox_ready" | "live_ready";
  label: string;
} {
  const env = import.meta.env as Record<string, string | undefined> | undefined;
  const pk = env?.["VITE_PAYSTACK_PUBLIC_KEY"] ?? "";
  if (pk.startsWith("pk_live_")) {
    return { mode: "live_ready", label: "Paystack Live Key Detected (Server Webhook Required)" };
  }
  if (pk.startsWith("pk_test_")) {
    return { mode: "sandbox_ready", label: "Paystack Sandbox Test Mode Active" };
  }
  return {
    mode: "sandbox_unconfigured",
    label: "Sandbox Preview (Provide PAYSTACK_SECRET_KEY & VITE_PAYSTACK_PUBLIC_KEY)",
  };
}

/**
 * Constant-time HMAC-SHA512 Paystack webhook signature verification using Web Crypto.
 * Compatible with Node 22+, Cloudflare Workers, and Nitro SSR runtimes.
 */
export async function verifyPaystackSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secretKey: string | undefined,
): Promise<boolean> {
  if (!secretKey || !signatureHeader) return false;
  const expectedHex = signatureHeader.trim().toLowerCase();
  if (!/^[a-f0-9]{128}$/.test(expectedHex)) return false;

  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secretKey),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(rawBody));
  const computedHex = Array.from(new Uint8Array(sigBuffer), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

  if (computedHex.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computedHex.length; i++) {
    diff |= computedHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  }
  return diff === 0;
}

const LOCAL_TOPUP_INTENTS_PREFIX = "ping:dot-topup-intents:";

function isMissingTopupSchema(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string; status?: number };
  const msg = (e.message ?? "").toLowerCase();
  return (
    e.code === "PGRST205" ||
    e.code === "PGRST202" ||
    e.code === "42P01" ||
    e.code === "42883" ||
    e.status === 404 ||
    msg.includes("dot_topup_intents") ||
    msg.includes("create_dot_topup_intent") ||
    msg.includes("does not exist")
  );
}

export function dotTopupIntentsQuery(userId?: string | undefined) {
  return queryOptions({
    queryKey: ["dot-topup-intents", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<DotTopupIntent[]> => {
      if (!userId) return [];
      const { data, error } = await (supabase as any)
        .from("dot_topup_intents")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) {
        if (!isMissingTopupSchema(error)) throw error;
        if (typeof window === "undefined") return [];
        try {
          const raw = window.localStorage.getItem(`${LOCAL_TOPUP_INTENTS_PREFIX}${userId}`);
          return raw ? (JSON.parse(raw) as DotTopupIntent[]) : [];
        } catch {
          return [];
        }
      }

      return (data ?? []) as DotTopupIntent[];
    },
  });
}

export function useCreateDotTopupIntent(userId?: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      dotAmount: number;
      currency: DotTopupCurrency;
      rail: DotTopupRail;
    }): Promise<DotTopupIntent> => {
      if (!userId) throw new Error("Sign in to create a DOT top-up request.");
      if (input.rail === "crypto_pending") {
        throw new Error(
          "Crypto payment rail is inactive until a provider is explicitly selected and approved.",
        );
      }

      const quote = calculateDotTopupQuote(input.dotAmount, input.currency);
      const { data, error } = await (supabase as any).rpc("create_dot_topup_intent", {
        p_dot_amount: quote.dotAmount,
        p_rail: input.rail,
        p_currency: quote.currency,
        p_fiat_amount_minor: quote.totalFiatMinor,
      });

      if (error) {
        if (!isMissingTopupSchema(error)) throw error;
        // Local sandbox intent preview — NEVER credits DOT client-side!
        const ref = `PINGDOT_SANDBOX_${Date.now()}`;
        const intent: DotTopupIntent = {
          id: `local-intent-${Date.now()}`,
          user_id: userId,
          rail: input.rail,
          dot_amount: quote.dotAmount,
          fiat_currency: quote.currency,
          fiat_amount_minor: quote.totalFiatMinor,
          provider_reference: ref,
          receipt_number: `RCPT-${ref.slice(-10)}`,
          status: "pending",
          verified_by_webhook: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (typeof window !== "undefined") {
          try {
            const key = `${LOCAL_TOPUP_INTENTS_PREFIX}${userId}`;
            const curr = JSON.parse(window.localStorage.getItem(key) || "[]") as DotTopupIntent[];
            window.localStorage.setItem(key, JSON.stringify([intent, ...curr].slice(0, 20)));
          } catch {
            // ignore storage errors
          }
        }
        return intent;
      }

      return data as DotTopupIntent;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dot-topup-intents", userId] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/*                    REVENUE ARCHITECTURE MATRIX (Phase 4.12)                */
/* -------------------------------------------------------------------------- */

export interface RevenueEngineSpec {
  id: string;
  name: string;
  pricingModel: string;
  billingStatus: "dot_credits_active" | "sandbox_ready" | "planned_approval_required";
  complianceGate: string;
}

export const REVENUE_ARCHITECTURE_ENGINES: readonly RevenueEngineSpec[] = [
  {
    id: "business_subscriptions",
    name: "Business Subscriptions",
    pricingModel: "Tiered monthly/annual seats & multi-agent Business Inbox",
    billingStatus: "planned_approval_required",
    complianceGate: "Commercial pricing & VAT/tax rules + Paystack live credentials",
  },
  {
    id: "sponsored_placements",
    name: "Sponsored Placements",
    pricingModel: "Disclosed Sponsored Pings, Signals & Hub placements",
    billingStatus: "planned_approval_required",
    complianceGate: "Approved advertising policy, moderation queue & billing activation",
  },
  {
    id: "advertising",
    name: "Self-Serve Business Advertising",
    pricingModel: "Budget-capped regional & interest campaigns",
    billingStatus: "planned_approval_required",
    complianceGate: "Ad policy sign-off, billing verification & ad transparency controls",
  },
  {
    id: "premium_analytics",
    name: "Premium Analytics",
    pricingModel: "90-day & multi-team commercial conversion dashboards",
    billingStatus: "dot_credits_active",
    complianceGate: "Optional upgrade via non-cash DOT credits (no forced paywall)",
  },
  {
    id: "lead_generation",
    name: "Lead Generation & CRM Workflows",
    pricingModel: "Business enquiries, lead qualification & team assignment",
    billingStatus: "sandbox_ready",
    complianceGate: "Consent-bounded customer contact & authorised export controls",
  },
  {
    id: "opportunity_placement",
    name: "Featured Opportunity Placement",
    pricingModel: "Optional priority placement for verified institutional Signals",
    billingStatus: "planned_approval_required",
    complianceGate: "Institutional verification & anti-scam review policy",
  },
  {
    id: "transaction_fees",
    name: "Commerce & Booking Facilitation Fees",
    pricingModel: "Percentage or flat fee where merchant checkout is enabled",
    billingStatus: "planned_approval_required",
    complianceGate: "Merchant-of-record legal definition, refund & dispute terms",
  },
  {
    id: "premium_communities",
    name: "Paid Community Memberships",
    pricingModel: "Recurring Hub tiers & institutional sponsorships",
    billingStatus: "planned_approval_required",
    complianceGate: "Payment settlement audit; core Ping remains free",
  },
  {
    id: "api_enterprise",
    name: "API & Enterprise Subscriptions",
    pricingModel: "Metered API keys, webhooks & Business Messaging API (Phase 5)",
    billingStatus: "planned_approval_required",
    complianceGate: "Phase 5 OAuth, rate limits & SLA agreements",
  },
  {
    id: "developer_services",
    name: "Developer & Ecosystem Services",
    pricingModel: "Verified app integrations & custom enterprise connectors",
    billingStatus: "planned_approval_required",
    complianceGate: "Phase 5 Developer Portal & security review",
  },
] as const;
