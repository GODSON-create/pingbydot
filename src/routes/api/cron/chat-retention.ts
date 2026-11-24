import { createFileRoute } from "@tanstack/react-router";
import { handleChatRetentionCronRequest } from "@/lib/chat-retention-worker";

/**
 * Scheduled Batched Private Chat Retention & Orphan Media Deletion Endpoint.
 *
 * Protected by `CRON_SECRET` / `PING_RETENTION_CRON_SECRET`. Executes indexed
 * batched expiry (`process_expired_private_messages_batch`), orphaned staging
 * cleanup (`enqueue_orphaned_staging_media`), and retryable storage object
 * deletion across Lovable Cloud Storage and Cloudflare R2.
 */
export const Route = createFileRoute("/api/cron/chat-retention")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      POST: async ({ request }) => handleChatRetentionCronRequest(request),
    },
  },
});
