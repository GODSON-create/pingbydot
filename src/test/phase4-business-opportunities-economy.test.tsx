import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildLeadsCsv,
  computeAvgResponseMinutes,
  computeBusinessReputation,
  getBusinessIntegrationReadiness,
  slugifyBusinessName,
  type BusinessEnquiry,
} from "@/lib/business";
import {
  calculateDotTopupQuote,
  getCryptoRailStatus,
  REVENUE_ARCHITECTURE_ENGINES,
  verifyPaystackSignature,
} from "@/lib/payments/paystack";

async function signHmacSha512Hex(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("Phase 4 — Business, Opportunities & Economic Infrastructure", () => {
  describe("Migration 0031 security, RLS & server-only settlement", () => {
    const migrationsDir = path.resolve(__dirname, "../../drizzle/migrations");
    const m31Path = path.join(migrationsDir, "0031_phase4_business_commerce_ads_and_wallet.sql");
    const journalPath = path.join(migrationsDir, "meta/_journal.json");

    it("registers migration 0031 sequentially with zero USING (true) policies and strict RLS", () => {
      const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
      const entry = journal.entries.find((e: { idx: number }) => e.idx === 31);
      expect(entry?.tag).toBe("0031_phase4_business_commerce_ads_and_wallet");

      const sql = fs.readFileSync(m31Path, "utf8");
      const uncommented = sql
        .split("\n")
        .map((l) => l.replace(/--.*$/, ""))
        .join("\n");
      expect(uncommented).not.toMatch(/\bUSING\s*\(\s*true\s*\)/i);
      expect(sql).not.toMatch(/DROP\s+POLICY\s+IF\s+EXISTS\s+"[^"]+"\s+ON\s+\S+\s+FOR\s+/i);

      for (const tbl of [
        "business_profiles",
        "business_team_members",
        "business_offerings",
        "business_reviews",
        "business_enquiries",
        "business_saved_replies",
        "creator_commercial_profiles",
        "ad_campaigns",
        "ad_reports",
        "hub_membership_plans",
      ]) {
        expect(sql).toContain(`ALTER TABLE public.${tbl} ENABLE ROW LEVEL SECURITY;`);
      }

      // Server-only DOT settlement & reversals MUST revoke PUBLIC, anon, and authenticated
      expect(sql).toContain(
        "REVOKE ALL ON FUNCTION public.settle_dot_topup_intent(text, text, integer, text) FROM PUBLIC, anon, authenticated;",
      );
      expect(sql).toContain(
        "REVOKE ALL ON FUNCTION public.reverse_dot_topup_intent(text, text) FROM PUBLIC, anon, authenticated;",
      );
      // Ad campaigns cannot self-approve billing or activate paid ads client-side
      expect(sql).toContain("billing_approved = false");
      // Paid community checkout stays disabled until approval
      expect(sql).toContain("live_checkout_enabled = false");
    });
  });

  describe("Business Profiles, Reputation, Multi-Agent CRM & CSV Export (4.1–4.6)", () => {
    it("slugifies business names cleanly and computes reputation & response times", () => {
      expect(slugifyBusinessName("Kora Solar & Energy Ltd!")).toBe("kora-solar-energy-ltd");

      const rep = computeBusinessReputation([
        {
          id: "1",
          business_id: "b1",
          reviewer_id: "u1",
          rating: 5,
          comment: "Great",
          created_at: "",
        },
        {
          id: "2",
          business_id: "b1",
          reviewer_id: "u2",
          rating: 4,
          comment: "Fast",
          created_at: "",
        },
      ]);
      expect(rep).toEqual({ averageRating: 4.5, reviewCount: 2 });

      const sampleEnquiries: BusinessEnquiry[] = [
        {
          id: "e1",
          business_id: "b1",
          customer_id: "c1",
          offering_id: null,
          enquiry_type: "product_enquiry",
          subject: "=HYPERLINK(evil)",
          message: "Need a quote",
          preferred_date: null,
          lead_status: "qualified",
          assigned_agent_id: null,
          labels: ["priority"],
          internal_notes: "hot lead",
          reply_message: "Sent quote",
          first_response_at: "2026-11-20T10:30:00Z",
          created_at: "2026-11-20T10:00:00Z",
          updated_at: "2026-11-20T10:30:00Z",
        },
      ];
      expect(computeAvgResponseMinutes(sampleEnquiries)).toBe(30);

      // CSV export escapes spreadsheet formula injection characters
      const csv = buildLeadsCsv(sampleEnquiries);
      expect(csv).toContain(`"'=HYPERLINK(evil)"`);
      expect(csv).toContain("qualified");
    });

    it("keeps native Ping Business Inbox independent from optional WhatsApp Business Platform", () => {
      const readiness = getBusinessIntegrationReadiness();
      expect(readiness.nativePingInboxActive).toBe(true);
      expect(readiness.whatsappBusiness.optional).toBe(true);
      expect(readiness.whatsappBusiness.policyNote).toContain("never impersonates WhatsApp");
    });
  });

  describe("Paystack Signed Webhook Verification, Custom DOT Quotes & Revenue Architecture (4.9 & 4.12)", () => {
    it("verifies valid HMAC-SHA512 Paystack signatures and rejects tampered or missing signatures", async () => {
      const secret = "sk_test_ping_webhook_verification_secret";
      const body = JSON.stringify({
        event: "charge.success",
        data: { reference: "PINGDOT_12345", amount: 500000, currency: "NGN" },
      });
      const validSig = await signHmacSha512Hex(body, secret);

      expect(await verifyPaystackSignature(body, validSig, secret)).toBe(true);
      expect(await verifyPaystackSignature(body + "tampered", validSig, secret)).toBe(false);
      expect(await verifyPaystackSignature(body, "invalid-hex", secret)).toBe(false);
      expect(await verifyPaystackSignature(body, validSig, undefined)).toBe(false);
    });

    it("clamps custom DOT top-up quotes, keeps crypto rail inactive, and enumerates all 10 revenue engines", () => {
      const quote = calculateDotTopupQuote(200, "NGN");
      expect(quote.dotAmount).toBe(200);
      expect(quote.totalFiatMinor).toBe(500000);
      expect(quote.sandboxMode).toBe(true);

      const minClamped = calculateDotTopupQuote(1, "USD");
      expect(minClamped.dotAmount).toBe(10);

      const cryptoRail = getCryptoRailStatus();
      expect(cryptoRail.active).toBe(false);
      expect(cryptoRail.requiresExplicitApproval).toBe(true);

      expect(REVENUE_ARCHITECTURE_ENGINES.length).toBe(10);
    });
  });
});
