/**
 * Ping by DOT — Scheduled Batched Chat Retention & Media Deletion Worker
 *
 * - Runs server-side (never relies on client timers or opening a chat).
 * - Processes expired private messages in bounded indexed batches (no full-table scan).
 * - Deletes primary storage objects AND derivative thumbnails/previews on both
 *   Lovable Cloud / Supabase Storage and Cloudflare R2.
 * - Retries failed deletions safely with exponential backoff via `media_deletion_queue`.
 * - Enqueues and cleans up orphaned staging uploads.
 * - Respects `CRON_SECRET` / service-role authorization.
 */
import { deleteR2ObjectServer, readR2ServerConfig } from "@/lib/r2-sigv4";

export interface MediaDeletionJobRow {
  id: string;
  provider: "supabase_storage" | "cloudflare_r2" | "s3" | "mux" | "cloudflare_stream";
  bucket: string;
  object_key: string;
  derivative_keys: string[];
  source_type: string;
  source_id: string | null;
  size_bytes: number;
  status: "pending" | "processing" | "deleted" | "failed";
  attempt_count: number;
  max_attempts: number;
}

export interface ChatRetentionSweepSummary {
  expiredMessages: number;
  enqueuedMediaDeletions: number;
  orphansEnqueued: number;
  deletedObjects: number;
  failedObjects: number;
  batchesProcessed: number;
  durationMs: number;
  errors: string[];
}

export interface ChatRetentionWorkerDeps {
  processExpiredBatch: (batchSize: number) => Promise<{
    expired_messages: number;
    enqueued_media_deletions: number;
  }>;
  enqueueOrphanedStaging: (olderThanHours: number, batchSize: number) => Promise<number>;
  claimDeletionJobs: (batchSize: number) => Promise<MediaDeletionJobRow[]>;
  completeDeletionJob: (jobId: string, success: boolean, error?: string) => Promise<void>;
  deleteStorageKeys: (
    provider: MediaDeletionJobRow["provider"],
    bucket: string,
    keys: string[],
  ) => Promise<{ ok: boolean; error?: string }>;
}

export interface ChatRetentionSweepOptions {
  messageBatchSize?: number;
  maxMessageBatches?: number;
  deletionBatchSize?: number;
  orphanOlderThanHours?: number;
}

/**
 * Executes one bounded, idempotent scheduled retention + deletion sweep.
 */
export async function runChatRetentionSweep(
  deps: ChatRetentionWorkerDeps,
  options: ChatRetentionSweepOptions = {},
): Promise<ChatRetentionSweepSummary> {
  const startedAt = Date.now();
  const messageBatchSize = Math.min(2000, Math.max(1, options.messageBatchSize ?? 500));
  const maxMessageBatches = Math.min(20, Math.max(1, options.maxMessageBatches ?? 5));
  const deletionBatchSize = Math.min(500, Math.max(1, options.deletionBatchSize ?? 100));
  const orphanHours = Math.max(1, options.orphanOlderThanHours ?? 24);

  let expiredMessages = 0;
  let enqueuedMediaDeletions = 0;
  let batchesProcessed = 0;
  let deletedObjects = 0;
  let failedObjects = 0;
  const errors: string[] = [];

  // 1. Expire due private messages in bounded indexed batches
  for (let b = 0; b < maxMessageBatches; b++) {
    const res = await deps.processExpiredBatch(messageBatchSize);
    batchesProcessed += 1;
    expiredMessages += res.expired_messages;
    enqueuedMediaDeletions += res.enqueued_media_deletions;
    if (res.expired_messages < messageBatchSize) {
      break;
    }
  }

  // 2. Detect & enqueue orphaned staging uploads (>24h uncommitted)
  const orphansEnqueued = await deps.enqueueOrphanedStaging(orphanHours, messageBatchSize);

  // 3. Claim pending & retryable storage deletion jobs and delete primary + derivative objects
  const jobs = await deps.claimDeletionJobs(deletionBatchSize);
  for (const job of jobs) {
    const allKeys = Array.from(
      new Set([job.object_key, ...(job.derivative_keys ?? [])].filter(Boolean)),
    );
    try {
      const del = await deps.deleteStorageKeys(job.provider, job.bucket, allKeys);
      if (del.ok) {
        await deps.completeDeletionJob(job.id, true);
        deletedObjects += allKeys.length;
      } else {
        const errMsg = del.error || `Failed deleting ${job.bucket}/${job.object_key}`;
        await deps.completeDeletionJob(job.id, false, errMsg);
        failedObjects += 1;
        errors.push(errMsg);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unexpected storage deletion error";
      await deps.completeDeletionJob(job.id, false, errMsg);
      failedObjects += 1;
      errors.push(errMsg);
    }
  }

  return {
    expiredMessages,
    enqueuedMediaDeletions,
    orphansEnqueued,
    deletedObjects,
    failedObjects,
    batchesProcessed,
    durationMs: Date.now() - startedAt,
    errors,
  };
}

/**
 * HTTP handler for `POST /api/cron/chat-retention` (protected by `CRON_SECRET`).
 */
export async function handleChatRetentionCronRequest(
  request: Request,
  options: {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    depsOverride?: ChatRetentionWorkerDeps;
  } = {},
): Promise<Response> {
  const env = options.env ?? (typeof process !== "undefined" ? process.env : {});
  const expectedSecret = (env["CRON_SECRET"] ?? env["PING_RETENTION_CRON_SECRET"] ?? "").trim();
  const authHeader =
    request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const providedSecret = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!expectedSecret || providedSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized scheduled retention trigger." }), {
      status: 401,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  if (options.depsOverride) {
    const summary = await runChatRetentionSweep(options.depsOverride);
    return new Response(JSON.stringify({ ok: true, summary }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const supabaseUrl = (env["SUPABASE_URL"] ?? env["VITE_SUPABASE_URL"] ?? "")
    .trim()
    .replace(/\/$/, "");
  const serviceRoleKey = (env["SUPABASE_SERVICE_ROLE_KEY"] ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({
        error: "Server-side retention sweep requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      }),
      { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const r2Cfg = readR2ServerConfig(env);
  const rpcHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  const rpc = async <T>(fn: string, body: Record<string, unknown>): Promise<T> => {
    const res = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: rpcHeaders,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`RPC ${fn} failed (HTTP ${res.status}): ${txt}`);
    }
    return (await res.json().catch(() => null)) as T;
  };

  const deps: ChatRetentionWorkerDeps = {
    processExpiredBatch: (batchSize) =>
      rpc("process_expired_private_messages_batch", { p_batch_size: batchSize }),
    enqueueOrphanedStaging: (hours, batchSize) =>
      rpc("enqueue_orphaned_staging_media", {
        p_older_than_hours: hours,
        p_batch_size: batchSize,
      }),
    claimDeletionJobs: (batchSize) => rpc("claim_media_deletion_jobs", { p_batch_size: batchSize }),
    completeDeletionJob: async (jobId, success, error) => {
      await rpc("complete_media_deletion_job", {
        p_job_id: jobId,
        p_success: success,
        p_error: error ?? null,
      });
    },
    deleteStorageKeys: async (provider, bucket, keys) => {
      if (provider === "cloudflare_r2") {
        const targetBucket = bucket === "media" ? r2Cfg.publicBucket : r2Cfg.privateBucket;
        for (const k of keys) {
          const scopedKey = bucket === "media" ? k : `${bucket}/${k}`;
          const res = await deleteR2ObjectServer(r2Cfg, targetBucket, scopedKey, fetchImpl);
          if (!res.ok) return { ok: false, error: res.error || "R2 delete failed" };
        }
        return { ok: true };
      }

      const res = await fetchImpl(
        `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`,
        {
          method: "DELETE",
          headers: rpcHeaders,
          body: JSON.stringify({ prefixes: keys }),
        },
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        return { ok: false, error: `Supabase Storage delete failed (HTTP ${res.status}): ${txt}` };
      }
      return { ok: true };
    },
  };

  const summary = await runChatRetentionSweep(deps);
  return new Response(JSON.stringify({ ok: true, summary }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
