import { createFileRoute } from "@tanstack/react-router";
import { verifyPaystackSignature } from "@/lib/payments/paystack";

/**
 * Signed Paystack Webhook Receiver (Phase 4.9).
 *
 * Security invariants:
 * - Verifies HMAC-SHA512 `x-paystack-signature` using server-only `PAYSTACK_SECRET_KEY`.
 * - Never credits DOT based on client-side payment callbacks.
 * - Uses server-side `SUPABASE_SERVICE_ROLE_KEY` ONLY to execute idempotent
 *   `settle_dot_topup_intent` / `reverse_dot_topup_intent` RPCs.
 * - Returns HTTP 503 if server payment secrets are not configured.
 */
export const Route = createFileRoute("/api/webhooks/paystack")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      POST: async ({ request }) => {
        const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
          .process?.env;
        const paystackSecret = env?.["PAYSTACK_SECRET_KEY"];
        const supabaseUrl = env?.["VITE_SUPABASE_URL"] ?? env?.["SUPABASE_URL"];
        const serviceRoleKey = env?.["SUPABASE_SERVICE_ROLE_KEY"];

        if (!paystackSecret || !supabaseUrl || !serviceRoleKey) {
          return new Response(
            JSON.stringify({
              error: "Payment webhook not activated — server credentials not configured.",
            }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          );
        }

        const rawBody = await request.text();
        const sig = request.headers.get("x-paystack-signature");
        const valid = await verifyPaystackSignature(rawBody, sig, paystackSecret);
        if (!valid) {
          return new Response(JSON.stringify({ error: "Invalid webhook signature" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        let payload: {
          event?: string;
          data?: {
            id?: string | number;
            reference?: string;
            amount?: number;
            currency?: string;
            reason?: string;
          };
        };
        try {
          payload = JSON.parse(rawBody);
        } catch {
          return new Response(JSON.stringify({ error: "Malformed JSON payload" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const eventName = payload.event ?? "";
        const ref = payload.data?.reference;
        if (!ref) {
          return new Response(JSON.stringify({ ok: true, ignored: "missing_reference" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { createClient } = await import("@supabase/supabase-js");
        const adminClient = createClient(supabaseUrl, serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        if (eventName === "charge.success") {
          const { data, error } = await adminClient.rpc("settle_dot_topup_intent", {
            p_provider_reference: ref,
            p_provider_event_id: String(payload.data?.id ?? ref),
            p_verified_amount_minor: Number(payload.data?.amount ?? 0),
            p_currency: String(payload.data?.currency ?? "NGN"),
          });
          if (error) {
            return new Response(JSON.stringify({ error: "Settlement failed" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(JSON.stringify({ ok: true, settlement: data }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (eventName === "refund.processed" || eventName === "charge.dispute.create") {
          const { data, error } = await adminClient.rpc("reverse_dot_topup_intent", {
            p_provider_reference: ref,
            p_reason: payload.data?.reason ?? eventName,
          });
          if (error) {
            return new Response(JSON.stringify({ error: "Reversal failed" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(JSON.stringify({ ok: true, reversal: data }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ ok: true, ignored: eventName }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
