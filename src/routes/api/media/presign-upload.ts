import { createFileRoute } from "@tanstack/react-router";
import { handlePresignUploadRequest } from "@/lib/media-server";

/**
 * Direct-to-R2 Presigned Upload Endpoint (Feature-Flagged — Track C).
 *
 * Never proxies file bytes through Cloudflare Workers; validates JWT + Postgres
 * authorization and issues short-lived presigned PUT or S3 Multipart URLs.
 * Returns HTTP 503 when R2 is disabled so clients transparently use Lovable Cloud Storage.
 */
export const Route = createFileRoute("/api/media/presign-upload")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      POST: async ({ request }) => handlePresignUploadRequest(request),
    },
  },
});
