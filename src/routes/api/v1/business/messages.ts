import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { sha256Hex } from "@/lib/developer";

const businessMessageSchema = z.object({
  businessId: z.string().uuid(),
  enquiryId: z.string().uuid(),
  replyMessage: z.string().trim().min(1).max(2000),
  leadStatus: z.enum(["new", "qualified", "in_progress", "won", "lost", "closed"]).optional(),
});

/**
 * Ping Business Messaging API v1 (Phase 5.2).
 *
 * Security invariants:
 * - Authenticates scoped Developer API Keys (`Authorization: Bearer ping_...`) by
 *   SHA-256 hash through the server-only `verify_api_key_hash` RPC.
 * - Requires `business:inbox:write` scope and verifies the API key is bound to
 *   `businessId` (or owned by the business owner).
 * - Never touches personal 1-on-1 `private_messages`.
 * - Returns HTTP 503 if server `SUPABASE_SERVICE_ROLE_KEY` is not provisioned.
 */
export const Route = createFileRoute("/api/v1/business/messages")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      POST: async ({ request }) => {
        const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
          .process?.env;
        const supabaseUrl = env?.["VITE_SUPABASE_URL"] ?? env?.["SUPABASE_URL"];
        const serviceRoleKey = env?.["SUPABASE_SERVICE_ROLE_KEY"];

        if (!supabaseUrl || !serviceRoleKey) {
          return new Response(
            JSON.stringify({
              error:
                "Business Messaging API not activated — server service credentials not configured.",
            }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          );
        }

        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
        if (!token || !/^ping_(live|test)_[a-zA-Z0-9]{16,}$/.test(token)) {
          return new Response(JSON.stringify({ error: "Missing or malformed Bearer API key." }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        let body: z.infer<typeof businessMessageSchema>;
        try {
          body = businessMessageSchema.parse(await request.json());
        } catch {
          return new Response(
            JSON.stringify({ error: "Invalid Business Messaging API payload." }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const keyHash = await sha256Hex(token);
        const { createClient } = await import("@supabase/supabase-js");
        const adminClient = createClient(supabaseUrl, serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: keyRecord, error: keyErr } = await adminClient.rpc("verify_api_key_hash", {
          p_key_hash: keyHash,
        });
        if (keyErr || !keyRecord) {
          return new Response(JSON.stringify({ error: "Invalid or revoked API key." }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const keyMeta = keyRecord as {
          owner_id: string;
          business_id: string | null;
          scopes: string[];
          rate_limit_per_min: number;
        };

        if (!Array.isArray(keyMeta.scopes) || !keyMeta.scopes.includes("business:inbox:write")) {
          return new Response(
            JSON.stringify({ error: "API key missing required scope: business:inbox:write." }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          );
        }

        if (keyMeta.business_id && keyMeta.business_id !== body.businessId) {
          return new Response(
            JSON.stringify({ error: "API key is not authorised for this businessId." }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          );
        }

        // Verify ownership if key is user-scoped
        if (!keyMeta.business_id) {
          const { data: biz } = await adminClient
            .from("business_profiles")
            .select("owner_id")
            .eq("id", body.businessId)
            .maybeSingle();
          if (!biz || biz.owner_id !== keyMeta.owner_id) {
            return new Response(
              JSON.stringify({ error: "Key owner is not authorised for this business." }),
              { status: 403, headers: { "Content-Type": "application/json" } },
            );
          }
        }

        const now = new Date().toISOString();
        const { data: updated, error: updateErr } = await adminClient
          .from("business_enquiries")
          .update({
            reply_message: body.replyMessage,
            ...(body.leadStatus ? { lead_status: body.leadStatus } : {}),
            first_response_at: now,
            updated_at: now,
          })
          .eq("id", body.enquiryId)
          .eq("business_id", body.businessId)
          .select("id,business_id,lead_status,updated_at")
          .maybeSingle();

        if (updateErr || !updated) {
          return new Response(
            JSON.stringify({ error: "Business enquiry not found or update failed." }),
            {
              status: 404,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        return new Response(
          JSON.stringify({
            ok: true,
            enquiry: updated,
            channel: "ping_business_messaging_api_v1",
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-RateLimit-Limit": String(keyMeta.rate_limit_per_min),
            },
          },
        );
      },
    },
  },
});
