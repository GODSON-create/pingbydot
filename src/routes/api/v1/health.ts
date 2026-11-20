import { createFileRoute } from "@tanstack/react-router";
import { buildPublicEdgeCacheHeaders } from "@/lib/scale";

/**
 * Public Platform Health & Readiness Endpoint (Phase 5.2 & 5.5).
 * Returns sanitized service metadata with zero credentials or secrets.
 */
export const Route = createFileRoute("/api/v1/health")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      GET: async () => {
        const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
          .process?.env;
        const payload = {
          ok: true,
          service: "ping-by-dot",
          apiVersion: "1.0.0",
          timestamp: new Date().toISOString(),
          capabilities: {
            publicKeysetFeed: true,
            openApiSpec: "/api/v1/openapi.json",
            oauthPkceConsent: "/oauth/authorize",
            griotLiveProviderConfigured: Boolean(
              env?.["GRIOT_AI_API_URL"] && env?.["GRIOT_AI_API_KEY"],
            ),
            businessMessagingApiReady: Boolean(env?.["SUPABASE_SERVICE_ROLE_KEY"]),
            paystackWebhookReady: Boolean(
              env?.["PAYSTACK_SECRET_KEY"] && env?.["SUPABASE_SERVICE_ROLE_KEY"],
            ),
          },
        };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: buildPublicEdgeCacheHeaders(10, 30),
        });
      },
    },
  },
});
