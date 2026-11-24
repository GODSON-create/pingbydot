import { createFileRoute } from "@tanstack/react-router";
import { handleSignReadRequest } from "@/lib/media-server";

/**
 * Private R2 Signed-Read Endpoint (Feature-Flagged — Track C).
 *
 * Rechecks Supabase JWT + live Postgres membership/audience/retention expiry on
 * every invocation before minting a short-lived (<= 15 min) presigned R2 GET URL.
 */
export const Route = createFileRoute("/api/media/sign-read")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      POST: async ({ request }) => handleSignReadRequest(request),
    },
  },
});
