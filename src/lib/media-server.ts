/**
 * Ping by DOT — Edge-Safe Direct-to-R2 Presigned Media Authorization Handlers
 *
 * Runs cleanly inside Cloudflare Workers (`workerd` 50 ms CPU / 128 MB RAM):
 * - NEVER proxies or buffers binary file bytes through server functions.
 * - Strict JSON-only metadata validation (max 16 KB body).
 * - Verifies caller identity via Supabase Bearer JWT and checks live Postgres
 *   authorization using fail-closed SECURITY DEFINER RPCs (`can_read_dm_media_object`,
 *   `can_access_private_moment_object`, `is_storage_object_pending_deletion`).
 * - Cryptographically binds `Content-Type` and `Content-Length` in AWS SigV4 presigned
 *   headers (C5), requires `R2_PUBLIC_CDN_URL` for public uploads (M6), and returns
 *   presigned `abortUrl` for multipart upload failure cleanup (M5).
 * - Feature-flagged behind `PING_MEDIA_PROVIDER=cloudflare_r2` + R2 secrets;
 *   returns HTTP 503 when disabled so clients stay on Lovable Cloud Storage.
 */
import { z } from "zod";
import { resolvePublicSupabaseConfig } from "@/lib/supabase-public-config";
import { detectMediaKind, validateMediaUpload } from "@/lib/shield";
import {
  MULTIPART_CHUNK_SIZE_BYTES,
  RESUMABLE_UPLOAD_THRESHOLD_BYTES,
} from "@/lib/resumable-upload";
import { parseMediaReference } from "@/lib/media-provider";
import { isSafeDeletionTarget } from "@/lib/chat-retention-worker";
import {
  deleteR2ObjectServer,
  getR2EndpointHost,
  presignS3Request,
  readR2ServerConfig,
  resolveRuntimeEnv,
  type R2ServerConfig,
} from "@/lib/r2-sigv4";

const MAX_JSON_BODY_BYTES = 16 * 1024;
const MAX_SIGNED_READ_TTL_SEC = 900;

const presignUploadSchema = z
  .object({
    bucket: z.enum(["media", "dm-attachments", "hub-attachments", "private-moments"]),
    objectKey: z.string().min(3).max(360),
    fileName: z.string().min(1).max(180),
    contentType: z.string().min(1).max(120),
    sizeBytes: z.number().int().positive().max(52_428_800),
    visibility: z.enum(["public", "private"]),
    conversationId: z.string().uuid().optional(),
    hubId: z.string().uuid().optional(),
    momentAudience: z.enum(["public", "followers", "close_circle", "hub"]).optional(),
  })
  .strict();

const signReadSchema = z
  .object({
    ref: z.string().min(5).max(400),
    expiresInSec: z.number().int().min(60).max(MAX_SIGNED_READ_TTL_SEC).optional(),
  })
  .strict();

const deleteMediaSchema = z
  .object({
    bucket: z.enum(["media", "dm-attachments", "hub-attachments", "private-moments"]),
    objectKeys: z.array(z.string().min(3).max(360)).min(1).max(50),
  })
  .strict();

export interface MediaServerDeps {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  verifyAuthUser?: (token: string) => Promise<{ id: string } | null>;
  authorizeAction?: (params: {
    token: string;
    userId: string;
    action: "upload" | "read" | "delete";
    bucket: string;
    objectKey: string;
    conversationId?: string;
    hubId?: string;
    momentAudience?: string;
  }) => Promise<{ allowed: boolean; reason?: string }>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

async function readStrictJson(
  request: Request,
): Promise<{ ok: true; data: unknown } | { ok: false; response: Response }> {
  const ct = (request.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("application/json")) {
    return {
      ok: false,
      response: jsonResponse({ error: "Content-Type must be application/json." }, 415),
    };
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_JSON_BODY_BYTES) {
    return {
      ok: false,
      response: jsonResponse({ error: "Request metadata payload exceeds 16 KB limit." }, 413),
    };
  }
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch {
    return { ok: false, response: jsonResponse({ error: "Malformed JSON payload." }, 400) };
  }
}

async function defaultVerifySupabaseUser(
  token: string,
  fetchImpl: typeof fetch,
): Promise<{ id: string } | null> {
  let cfg: { url: string; publishableKey: string };
  try {
    cfg = resolvePublicSupabaseConfig();
  } catch {
    return null;
  }
  if (!cfg.url || !cfg.publishableKey) return null;
  const res = await fetchImpl(`${cfg.url.replace(/\/$/, "")}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: cfg.publishableKey,
    },
  });
  if (!res.ok) return null;
  const user = (await res.json().catch(() => null)) as { id?: string } | null;
  return user?.id ? { id: user.id } : null;
}

/**
 * Authorizes a media upload, read, or delete request against live Supabase Postgres.
 *
 * Security invariants (C4):
 * - NEVER fails open on PostgREST/RPC errors or empty rows.
 * - Uses SECURITY DEFINER `can_read_dm_media_object()` for `dm-attachments` reads so
 *   expired/deleted/scrubbed rows hidden by SELECT RLS are explicitly denied (403).
 * - Checks `is_storage_object_pending_deletion()` for private buckets on reads.
 */
export async function defaultAuthorizeAgainstSupabase(params: {
  token: string;
  userId: string;
  action: "upload" | "read" | "delete";
  bucket: string;
  objectKey: string;
  conversationId?: string;
  hubId?: string;
  momentAudience?: string;
  fetchImpl: typeof fetch;
  supabaseUrlOverride?: string;
  supabaseAnonKeyOverride?: string;
}): Promise<{ allowed: boolean; reason?: string }> {
  if (!isSafeDeletionTarget(params.bucket, params.objectKey)) {
    return { allowed: false, reason: "Invalid or unsafe storage bucket/objectKey scope." };
  }

  let url = params.supabaseUrlOverride;
  let publishableKey = params.supabaseAnonKeyOverride;
  if (!url || !publishableKey) {
    try {
      const cfg = resolvePublicSupabaseConfig();
      url = url || cfg.url;
      publishableKey = publishableKey || cfg.publishableKey;
    } catch {
      return { allowed: false, reason: "Supabase authorization endpoint unavailable." };
    }
  }
  if (!url || !publishableKey) {
    return { allowed: false, reason: "Supabase authorization endpoint unavailable." };
  }

  const restBase = `${url.replace(/\/$/, "")}/rest/v1`;
  const headers = {
    Authorization: `Bearer ${params.token}`,
    apikey: publishableKey,
    Accept: "application/json",
  };
  const jsonHeaders = {
    ...headers,
    "Content-Type": "application/json",
  };

  if (params.bucket === "media") {
    if (params.action === "read") return { allowed: true };
    const firstSeg = params.objectKey.split("/")[0];
    return firstSeg === params.userId
      ? { allowed: true }
      : { allowed: false, reason: "Public media writes must target caller's own UID folder." };
  }

  if (params.bucket === "dm-attachments") {
    const parts = params.objectKey.split("/");
    const convId =
      params.conversationId || (parts[1] === "dm" && parts.length >= 4 ? parts[2] : parts[0]);
    const senderSeg = parts[1];
    if (!convId) {
      return { allowed: false, reason: "Invalid DM attachment object scope." };
    }
    if ((params.action === "upload" || params.action === "delete") && senderSeg !== params.userId) {
      return {
        allowed: false,
        reason: "DM attachment writes must target caller's own UID folder.",
      };
    }

    if (params.action === "read") {
      // C4 FAIL-CLOSED RPC: bypasses private_messages SELECT RLS safely to require an
      // explicit live non-expired, non-deleted message (or fresh uploader staging asset).
      const rpcRes = await params.fetchImpl(`${restBase}/rpc/can_read_dm_media_object`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          p_conversation_id: convId,
          p_object_key: params.objectKey,
        }),
      });
      if (!rpcRes.ok) {
        return { allowed: false, reason: "DM attachment authorization check failed." };
      }
      const allowed = (await rpcRes.json().catch(() => false)) as unknown;
      return allowed === true
        ? { allowed: true }
        : { allowed: false, reason: "Attachment is unavailable, expired, or unauthorized." };
    }

    const memRes = await params.fetchImpl(
      `${restBase}/conversation_members?conversation_id=eq.${encodeURIComponent(convId)}&user_id=eq.${encodeURIComponent(params.userId)}&hidden_at=is.null&select=conversation_id`,
      { headers },
    );
    if (!memRes.ok) {
      return { allowed: false, reason: "Conversation membership verification failed." };
    }
    const memRows = (await memRes.json().catch(() => [])) as Array<{ conversation_id: string }>;
    if (!Array.isArray(memRows) || memRows.length === 0) {
      return { allowed: false, reason: "Caller is not an active conversation participant." };
    }
    return { allowed: true };
  }

  if (params.bucket === "hub-attachments") {
    const parts = params.objectKey.split("/");
    const hubId = params.hubId || parts[0];
    const senderSeg = parts[1];
    if (!hubId) {
      return { allowed: false, reason: "Invalid Hub attachment object scope." };
    }
    if (params.action === "upload" && senderSeg !== params.userId) {
      return {
        allowed: false,
        reason: "Hub attachment uploads must target caller's own UID folder.",
      };
    }

    if (params.action === "read") {
      const pendRes = await params.fetchImpl(`${restBase}/rpc/is_storage_object_pending_deletion`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          p_bucket: "hub-attachments",
          p_object_key: params.objectKey,
        }),
      });
      if (!pendRes.ok) {
        return { allowed: false, reason: "Hub attachment deletion-state verification failed." };
      }
      const pending = (await pendRes.json().catch(() => true)) as unknown;
      if (pending !== false) {
        return { allowed: false, reason: "Hub attachment has been removed." };
      }
    }

    const memRes = await params.fetchImpl(
      `${restBase}/hub_members?hub_id=eq.${encodeURIComponent(hubId)}&user_id=eq.${encodeURIComponent(params.userId)}&status=eq.active&select=role`,
      { headers },
    );
    if (memRes.ok) {
      const memRows = (await memRes.json().catch(() => [])) as Array<{ role: string }>;
      if (Array.isArray(memRows) && memRows.length > 0) {
        if (params.action === "delete") {
          const role = memRows[0]?.role ?? "";
          if (senderSeg === params.userId || ["owner", "admin", "moderator"].includes(role)) {
            return { allowed: true };
          }
          return { allowed: false, reason: "Only the uploader or Hub staff may delete Hub files." };
        }
        return { allowed: true };
      }
    }

    if (params.action === "read") {
      const hubRes = await params.fetchImpl(
        `${restBase}/hubs?id=eq.${encodeURIComponent(hubId)}&hidden_at=is.null&select=access`,
        { headers },
      );
      if (hubRes.ok) {
        const hubs = (await hubRes.json().catch(() => [])) as Array<{ access: string }>;
        if (Array.isArray(hubs) && hubs[0]?.access === "public") return { allowed: true };
      }
    }
    return { allowed: false, reason: "Active Hub membership required." };
  }

  if (params.bucket === "private-moments") {
    const parts = params.objectKey.split("/");
    const authorSeg = parts[0];
    if (params.action === "upload" || params.action === "delete") {
      return authorSeg === params.userId
        ? { allowed: true }
        : { allowed: false, reason: "Restricted Moments must be managed under author's UID." };
    }
    const rpcRes = await params.fetchImpl(`${restBase}/rpc/can_access_private_moment_object`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ p_object_name: params.objectKey }),
    });
    if (!rpcRes.ok) {
      return { allowed: false, reason: "Moment audience authorization failed." };
    }
    const allowed = (await rpcRes.json().catch(() => false)) as unknown;
    return allowed === true
      ? { allowed: true }
      : { allowed: false, reason: "Caller is not in this Moment's authorized audience." };
  }

  return { allowed: false, reason: "Unknown storage bucket." };
}

function resolveTargetR2Bucket(config: R2ServerConfig, logicalBucket: string): string {
  return logicalBucket === "media" ? config.publicBucket : config.privateBucket;
}

/**
 * `POST /api/media/presign-upload`
 * Issues direct-to-R2 single PUT or Multipart presigned URLs (0 bytes proxied) with
 * cryptographically signed `Content-Type` and `Content-Length` headers (C5).
 */
export async function handlePresignUploadRequest(
  request: Request,
  deps: MediaServerDeps = {},
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const r2Cfg = readR2ServerConfig(deps.env);
  if (!r2Cfg.enabled) {
    return jsonResponse(
      { error: "Cloudflare R2 media provider is not enabled; use Lovable Cloud Storage." },
      503,
    );
  }

  const token = extractBearerToken(request);
  if (!token) {
    return jsonResponse({ error: "Missing Bearer authorization token." }, 401);
  }

  const parsedBody = await readStrictJson(request);
  if (!parsedBody.ok) return parsedBody.response;

  const validated = presignUploadSchema.safeParse(parsedBody.data);
  if (!validated.success) {
    return jsonResponse(
      { error: "Invalid upload metadata.", issues: validated.error.issues.map((i) => i.message) },
      400,
    );
  }

  const input = validated.data;
  if (!isSafeDeletionTarget(input.bucket, input.objectKey)) {
    return jsonResponse({ error: "Invalid or unsafe objectKey path." }, 400);
  }

  // M6: Require R2_PUBLIC_CDN_URL when uploading public objects so unrenderable `r2://media/...` is never emitted
  if (input.visibility === "public" && !r2Cfg.publicCdnUrl) {
    return jsonResponse(
      { error: "R2_PUBLIC_CDN_URL must be configured before serving public R2 media." },
      503,
    );
  }

  const kind = detectMediaKind({ type: input.contentType, name: input.fileName });
  const mediaCheck = validateMediaUpload(
    { type: input.contentType, size: input.sizeBytes, name: input.fileName },
    kind,
  );
  if (!mediaCheck.valid) {
    return jsonResponse({ error: mediaCheck.error || "File rejected by media validation." }, 400);
  }

  const user = await (deps.verifyAuthUser
    ? deps.verifyAuthUser(token)
    : defaultVerifySupabaseUser(token, fetchImpl));
  if (!user) {
    return jsonResponse({ error: "Invalid or expired authentication token." }, 401);
  }

  const authz = await (deps.authorizeAction
    ? deps.authorizeAction({
        token,
        userId: user.id,
        action: "upload",
        bucket: input.bucket,
        objectKey: input.objectKey,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(input.hubId ? { hubId: input.hubId } : {}),
        ...(input.momentAudience ? { momentAudience: input.momentAudience } : {}),
      })
    : defaultAuthorizeAgainstSupabase({
        token,
        userId: user.id,
        action: "upload",
        bucket: input.bucket,
        objectKey: input.objectKey,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(input.hubId ? { hubId: input.hubId } : {}),
        ...(input.momentAudience ? { momentAudience: input.momentAudience } : {}),
        fetchImpl,
      }));

  if (!authz.allowed) {
    return jsonResponse({ error: authz.reason || "Forbidden upload target." }, 403);
  }

  const r2Bucket = resolveTargetR2Bucket(r2Cfg, input.bucket);
  const scopedKey =
    input.bucket === "media" ? input.objectKey : `${input.bucket}/${input.objectKey}`;
  const endpointHost = getR2EndpointHost(r2Cfg.accountId);
  const storedRef =
    input.visibility === "public"
      ? `${r2Cfg.publicCdnUrl}/${scopedKey}`
      : `r2://${input.bucket}/${input.objectKey}`;

  // Large files (> 6 MB): initiate direct-to-R2 S3 Multipart upload with bound Content-Type & per-part Content-Length
  if (input.sizeBytes > RESUMABLE_UPLOAD_THRESHOLD_BYTES) {
    const initiateUrl = await presignS3Request({
      method: "POST",
      endpointHost,
      bucket: r2Bucket,
      objectKey: scopedKey,
      accessKeyId: r2Cfg.accessKeyId,
      secretAccessKey: r2Cfg.secretAccessKey,
      region: r2Cfg.region,
      expiresInSec: 300,
      queryParams: { uploads: "" },
      signedHeaders: {
        "content-type": input.contentType,
      },
    });

    const initRes = await fetchImpl(initiateUrl, {
      method: "POST",
      headers: { "Content-Type": input.contentType },
    });
    if (!initRes.ok) {
      return jsonResponse(
        { error: `Could not initiate R2 multipart upload (HTTP ${initRes.status}).` },
        502,
      );
    }
    const initXml = await initRes.text();
    const uploadIdMatch = initXml.match(/<UploadId>([^<]+)<\/UploadId>/);
    const uploadId = uploadIdMatch?.[1];
    if (!uploadId) {
      return jsonResponse({ error: "R2 multipart init response missing UploadId." }, 502);
    }

    const totalParts = Math.ceil(input.sizeBytes / MULTIPART_CHUNK_SIZE_BYTES);
    const partUrls = await Promise.all(
      Array.from({ length: totalParts }, async (_, idx) => {
        const partNumber = idx + 1;
        const start = idx * MULTIPART_CHUNK_SIZE_BYTES;
        const partBytes = Math.min(MULTIPART_CHUNK_SIZE_BYTES, input.sizeBytes - start);
        const url = await presignS3Request({
          method: "PUT",
          endpointHost,
          bucket: r2Bucket,
          objectKey: scopedKey,
          accessKeyId: r2Cfg.accessKeyId,
          secretAccessKey: r2Cfg.secretAccessKey,
          region: r2Cfg.region,
          expiresInSec: 900,
          queryParams: { partNumber: String(partNumber), uploadId },
          signedHeaders: {
            "content-length": String(partBytes),
          },
        });
        return { partNumber, url, expectedBytes: partBytes };
      }),
    );

    const completeUrl = await presignS3Request({
      method: "POST",
      endpointHost,
      bucket: r2Bucket,
      objectKey: scopedKey,
      accessKeyId: r2Cfg.accessKeyId,
      secretAccessKey: r2Cfg.secretAccessKey,
      region: r2Cfg.region,
      expiresInSec: 900,
      queryParams: { uploadId },
      signedHeaders: {
        "content-type": "application/xml",
      },
    });

    const abortUrl = await presignS3Request({
      method: "DELETE",
      endpointHost,
      bucket: r2Bucket,
      objectKey: scopedKey,
      accessKeyId: r2Cfg.accessKeyId,
      secretAccessKey: r2Cfg.secretAccessKey,
      region: r2Cfg.region,
      expiresInSec: 900,
      queryParams: { uploadId },
    });

    const readUrl =
      input.visibility === "public"
        ? `${r2Cfg.publicCdnUrl}/${scopedKey}`
        : await presignS3Request({
            method: "GET",
            endpointHost,
            bucket: r2Bucket,
            objectKey: scopedKey,
            accessKeyId: r2Cfg.accessKeyId,
            secretAccessKey: r2Cfg.secretAccessKey,
            region: r2Cfg.region,
            expiresInSec: MAX_SIGNED_READ_TTL_SEC,
          });

    return jsonResponse({
      mode: "multipart",
      uploadId,
      partUrls,
      completeUrl,
      abortUrl,
      chunkSizeBytes: MULTIPART_CHUNK_SIZE_BYTES,
      r2Bucket,
      objectKey: input.objectKey,
      storedRef,
      readUrl,
      expiresAtMs: Date.now() + MAX_SIGNED_READ_TTL_SEC * 1000,
    });
  }

  // Standard <= 6 MB: direct-to-R2 single PUT presigned URL with cryptographically bound Content-Type + Content-Length (C5)
  const uploadUrl = await presignS3Request({
    method: "PUT",
    endpointHost,
    bucket: r2Bucket,
    objectKey: scopedKey,
    accessKeyId: r2Cfg.accessKeyId,
    secretAccessKey: r2Cfg.secretAccessKey,
    region: r2Cfg.region,
    expiresInSec: 300,
    signedHeaders: {
      "content-type": input.contentType,
      "content-length": String(input.sizeBytes),
    },
  });

  const readUrl =
    input.visibility === "public"
      ? `${r2Cfg.publicCdnUrl}/${scopedKey}`
      : await presignS3Request({
          method: "GET",
          endpointHost,
          bucket: r2Bucket,
          objectKey: scopedKey,
          accessKeyId: r2Cfg.accessKeyId,
          secretAccessKey: r2Cfg.secretAccessKey,
          region: r2Cfg.region,
          expiresInSec: MAX_SIGNED_READ_TTL_SEC,
        });

  return jsonResponse({
    mode: "single",
    uploadUrl,
    requiredHeaders: {
      "Content-Type": input.contentType,
      "Content-Length": String(input.sizeBytes),
    },
    r2Bucket,
    objectKey: input.objectKey,
    storedRef,
    readUrl,
    expiresAtMs: Date.now() + MAX_SIGNED_READ_TTL_SEC * 1000,
  });
}

/**
 * `POST /api/media/sign-read`
 * Rechecks fail-closed authorization on every call and issues a short-lived presigned R2 GET URL.
 * Works whenever R2 credentials are configured (even if write flag was rolled back to Lovable Cloud — H2).
 */
export async function handleSignReadRequest(
  request: Request,
  deps: MediaServerDeps = {},
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const r2Cfg = readR2ServerConfig(deps.env);
  const env = resolveRuntimeEnv(deps.env);
  const hasR2Creds = Boolean(r2Cfg.accountId && r2Cfg.accessKeyId && r2Cfg.secretAccessKey);
  const allowDualRead = hasR2Creds && (r2Cfg.enabled || env["R2_ALLOW_DUAL_READ"] !== "false");
  if (!allowDualRead) {
    return jsonResponse({ error: "Cloudflare R2 media provider is not configured." }, 503);
  }

  const token = extractBearerToken(request);
  if (!token) {
    return jsonResponse({ error: "Missing Bearer authorization token." }, 401);
  }

  const parsedBody = await readStrictJson(request);
  if (!parsedBody.ok) return parsedBody.response;

  const validated = signReadSchema.safeParse(parsedBody.data);
  if (!validated.success) {
    return jsonResponse({ error: "Invalid signed-read request." }, 400);
  }

  const parsedRef = parseMediaReference(validated.data.ref);
  if (
    parsedRef.provider !== "cloudflare_r2" ||
    !parsedRef.bucket ||
    !parsedRef.objectKey ||
    !isSafeDeletionTarget(parsedRef.bucket, parsedRef.objectKey)
  ) {
    return jsonResponse({ error: "Expected a valid r2://bucket/key reference." }, 400);
  }

  const user = await (deps.verifyAuthUser
    ? deps.verifyAuthUser(token)
    : defaultVerifySupabaseUser(token, fetchImpl));
  if (!user) {
    return jsonResponse({ error: "Invalid or expired authentication token." }, 401);
  }

  const authz = await (deps.authorizeAction
    ? deps.authorizeAction({
        token,
        userId: user.id,
        action: "read",
        bucket: parsedRef.bucket,
        objectKey: parsedRef.objectKey,
      })
    : defaultAuthorizeAgainstSupabase({
        token,
        userId: user.id,
        action: "read",
        bucket: parsedRef.bucket,
        objectKey: parsedRef.objectKey,
        fetchImpl,
      }));

  if (!authz.allowed) {
    return jsonResponse({ error: authz.reason || "Forbidden media access." }, 403);
  }

  const r2Bucket = resolveTargetR2Bucket(r2Cfg, parsedRef.bucket);
  const scopedKey =
    parsedRef.bucket === "media"
      ? parsedRef.objectKey
      : `${parsedRef.bucket}/${parsedRef.objectKey}`;
  const ttlSec = Math.min(
    MAX_SIGNED_READ_TTL_SEC,
    validated.data.expiresInSec ?? MAX_SIGNED_READ_TTL_SEC,
  );

  const signedUrl = await presignS3Request({
    method: "GET",
    endpointHost: getR2EndpointHost(r2Cfg.accountId),
    bucket: r2Bucket,
    objectKey: scopedKey,
    accessKeyId: r2Cfg.accessKeyId,
    secretAccessKey: r2Cfg.secretAccessKey,
    region: r2Cfg.region,
    expiresInSec: ttlSec,
  });

  return jsonResponse({
    signedUrl,
    expiresAtMs: Date.now() + ttlSec * 1000,
  });
}

/**
 * `POST /api/media/delete` (M6)
 * Authorizes caller ownership per key before issuing direct server-side R2 DELETE calls.
 */
export async function handleDeleteMediaRequest(
  request: Request,
  deps: MediaServerDeps = {},
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const r2Cfg = readR2ServerConfig(deps.env);
  if (!r2Cfg.accountId || !r2Cfg.accessKeyId || !r2Cfg.secretAccessKey) {
    return jsonResponse({ error: "Cloudflare R2 media provider is not configured." }, 503);
  }

  const token = extractBearerToken(request);
  if (!token) {
    return jsonResponse({ error: "Missing Bearer authorization token." }, 401);
  }

  const parsedBody = await readStrictJson(request);
  if (!parsedBody.ok) return parsedBody.response;

  const validated = deleteMediaSchema.safeParse(parsedBody.data);
  if (!validated.success) {
    return jsonResponse({ error: "Invalid media delete request." }, 400);
  }

  const user = await (deps.verifyAuthUser
    ? deps.verifyAuthUser(token)
    : defaultVerifySupabaseUser(token, fetchImpl));
  if (!user) {
    return jsonResponse({ error: "Invalid or expired authentication token." }, 401);
  }

  const { bucket, objectKeys } = validated.data;
  const r2Bucket = resolveTargetR2Bucket(r2Cfg, bucket);
  const deleted: string[] = [];
  const failed: string[] = [];

  for (const objectKey of objectKeys) {
    if (!isSafeDeletionTarget(bucket, objectKey)) {
      failed.push(objectKey);
      continue;
    }

    const authz = await (deps.authorizeAction
      ? deps.authorizeAction({
          token,
          userId: user.id,
          action: "delete",
          bucket,
          objectKey,
        })
      : defaultAuthorizeAgainstSupabase({
          token,
          userId: user.id,
          action: "delete",
          bucket,
          objectKey,
          fetchImpl,
        }));

    if (!authz.allowed) {
      failed.push(objectKey);
      continue;
    }

    const scopedKey = bucket === "media" ? objectKey : `${bucket}/${objectKey}`;
    const res = await deleteR2ObjectServer(r2Cfg, r2Bucket, scopedKey, fetchImpl);
    if (res.ok) {
      deleted.push(objectKey);
    } else {
      failed.push(objectKey);
    }
  }

  return jsonResponse({ deleted, failed }, failed.length > 0 && deleted.length === 0 ? 403 : 200);
}
