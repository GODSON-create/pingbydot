import { createFileRoute } from "@tanstack/react-router";
import { handleDeleteMediaRequest } from "@/lib/media-server";

/**
 * Authorized Direct-to-R2 Delete Endpoint (Feature-Flagged — Track C / M6).
 *
 * Verifies Bearer JWT + per-key ownership/role authorization before executing
 * server-side SigV4 DELETE against Cloudflare R2.
 */
export const Route = createFileRoute("/api/media/delete")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      POST: async ({ request }) => handleDeleteMediaRequest(request),
    },
  },
});
