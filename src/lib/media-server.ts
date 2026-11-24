/**
 * Ping by DOT — Edge-Safe Direct-to-R2 Presigned Media Authorization Handlers
 *
 * Runs cleanly inside Cloudflare Workers (`workerd` 50 ms CPU / 128 MB RAM):
 * - NEVER proxies or buffers binary file bytes through server functions.
 * - Strict JSON-only metadata validation (max 16 KB body).
 * - Verifies caller identity via Supabase Bearer JWT and checks live Postgres
 *   authorization (conversation membership, Hub membership/access, restricted
 *   Moment audience, and non-expired Chat Retention state) before minting any
 *   short-lived presigned R2 URL.
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
import {
  getR2EndpointHost,
  presignS3Request,
  readR2ServerConfig,
  type R2ServerConfig,
} from "@/lib/r2-sigv4";

const MAX_JSON_BODY_BYTES = 16 * 1024;
const MAX_SIGNED_READ_TTL_SEC = 900;

const presignUploadSchema = z
  .object({
    bucket: z.enum(["media", "dm-attachments", "hub-attachments", "private-moments"]),
    objectKey: z.string().min(3).max(320),
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

export interface MediaServerDeps {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  verifyAuthUser?: (token: string) => Promise<{ id: string } | null>;
  authorizeAction?: (params: {
    token: string;
    userId: string;
    action: "upload" | "read";
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

async function defaultAuthorizeAgainstSupabase(params: {
  token: string;
  userId: string;
  action: "upload" | "read";
  bucket: string;
  objectKey: string;
  conversationId?: string;
  hubId?: string;
  momentAudience?: string;
  fetchImpl: typeof fetch;
}): Promise<{ allowed: boolean; reason?: string }> {
  let cfg: { url: string; publishableKey: string };
  try {
    cfg = resolvePublicSupabaseConfig();
  } catch {
    return { allowed: false, reason: "Supabase authorization endpoint unavailable." };
  }
  if (!cfg.url || !cfg.publishableKey) {
    return { allowed: false, reason: "Supabase authorization endpoint unavailable." };
  }
  const restBase = `${cfg.url.replace(/\/$/, "")}/rest/v1`;
  const headers = {
    Authorization: `Bearer ${params.token}`,
    apikey: cfg.publishableKey,
    Accept: "application/json",
  };

  if (params.bucket === "media") {
    if (params.action === "read") return { allowed: true };
    const firstSeg = params.objectKey.split("/")[0];
    return firstSeg === params.userId
      ? { allowed: true }
      : { allowed: false, reason: "Public media uploads must target caller's own UID folder." };
  }

  if (params.bucket === "dm-attachments") {
    const parts = params.objectKey.split("/");
    const convId = params.conversationId || parts[0];
    const senderSeg = parts[1];
    if (!convId || (params.action === "upload" && senderSeg !== params.userId)) {
      return { allowed: false, reason: "Invalid DM attachment object scope." };
    }

    const memRes = await params.fetchImpl(
      `${restBase}/conversation_members?conversation_id=eq.${encodeURIComponent(convId)}&user_id=eq.${encodeURIComponent(params.userId)}&hidden_at=is.null&select=conversation_id`,
      { headers },
    );
    const memRows = (await memRes.json().catch(() => [])) as Array<{ conversation_id: string }>;
    if (!memRes.ok || memRows.length === 0) {
      return { allowed: false, reason: "Caller is not an active conversation participant." };
    }

    if (params.action === "read") {
      // Recheck non-expired & non-deleted status in private_messages on every signed read request
      const refCandidates = [params.objectKey, `r2://dm-attachments/${params.objectKey}`]
        .map((v) => `"${v.replace(/"/g, "")}"`)
        .join(",");
      const msgRes = await params.fetchImpl(
        `${restBase}/private_messages?conversation_id=eq.${encodeURIComponent(convId)}&media_url=in.(${encodeURIComponent(refCandidates)})&select=deleted_at,expired_at,expires_at,is_saved_in_chat`,
        { headers },
      );
      if (msgRes.ok) {
        const msgs = (await msgRes.json().catch(() => [])) as Array<{
          deleted_at: string | null;
          expired_at: string | null;
          expires_at: string | null;
          is_saved_in_chat: boolean;
        }>;
        const blocked = msgs.some(
          (m) =>
            Boolean(m.deleted_at) ||
            Boolean(m.expired_at) ||
            (m.expires_at !== null &&
              new Date(m.expires_at).getTime() <= Date.now() &&
              !m.is_saved_in_chat),
        );
        if (blocked) {
          return { allowed: false, reason: "Attachment has expired or been deleted." };
        }
      }
    }
    return { allowed: true };
  }

  if (params.bucket === "hub-attachments") {
    const parts = params.objectKey.split("/");
    const hubId = params.hubId || parts[0];
    const senderSeg = parts[1];
    if (!hubId || (params.action === "upload" && senderSeg !== params.userId)) {
      return { allowed: false, reason: "Invalid Hub attachment object scope." };
    }

    const memRes = await params.fetchImpl(
      `${restBase}/hub_members?hub_id=eq.${encodeURIComponent(hubId)}&user_id=eq.${encodeURIComponent(params.userId)}&status=eq.active&select=role`,
      { headers },
    );
    const memRows = (await memRes.json().catch(() => [])) as Array<{ role: string }>;
    if (memRes.ok && memRows.length > 0) return { allowed: true };

    if (params.action === "read") {
      const hubRes = await params.fetchImpl(
        `${restBase}/hubs?id=eq.${encodeURIComponent(hubId)}&hidden_at=is.null&select=access`,
        { headers },
      );
      const hubs = (await hubRes.json().catch(() => [])) as Array<{ access: string }>;
      if (hubRes.ok && hubs[0]?.access === "public") return { allowed: true };
    }
    return { allowed: false, reason: "Active Hub membership required." };
  }

  if (params.bucket === "private-moments") {
    const parts = params.objectKey.split("/");
    const authorSeg = parts[0];
    if (authorSeg === params.userId) return { allowed: true };
    if (params.action === "upload") {
      return { allowed: false, reason: "Restricted Moments must be uploaded under author's UID." };
    }
    const rpcRes = await params.fetchImpl(`${restBase}/rpc/can_access_private_moment_object`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ p_object_name: params.objectKey }),
    });
    const allowed = (await rpcRes.json().catch(() => false)) as boolean;
    return allowed
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
 * Issues direct-to-R2 single PUT or Multipart presigned URLs (0 bytes proxied).
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
  if (input.objectKey.includes("..") || input.objectKey.startsWith("/")) {
    return jsonResponse({ error: "Invalid objectKey path." }, 400);
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
    input.visibility === "public" && r2Cfg.publicCdnUrl
      ? `${r2Cfg.publicCdnUrl}/${scopedKey}`
      : `r2://${input.bucket}/${input.objectKey}`;

  // Large files (> 6 MB): initiate direct-to-R2 S3 Multipart upload
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
        });
        return { partNumber, url };
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
    });

    const readUrl =
      input.visibility === "public" && r2Cfg.publicCdnUrl
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
      chunkSizeBytes: MULTIPART_CHUNK_SIZE_BYTES,
      r2Bucket,
      objectKey: input.objectKey,
      storedRef,
      readUrl,
      expiresAtMs: Date.now() + MAX_SIGNED_READ_TTL_SEC * 1000,
    });
  }

  // Standard <= 6 MB: direct-to-R2 single PUT presigned URL
  const uploadUrl = await presignS3Request({
    method: "PUT",
    endpointHost,
    bucket: r2Bucket,
    objectKey: scopedKey,
    accessKeyId: r2Cfg.accessKeyId,
    secretAccessKey: r2Cfg.secretAccessKey,
    region: r2Cfg.region,
    expiresInSec: 300,
  });

  const readUrl =
    input.visibility === "public" && r2Cfg.publicCdnUrl
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
    r2Bucket,
    objectKey: input.objectKey,
    storedRef,
    readUrl,
    expiresAtMs: Date.now() + MAX_SIGNED_READ_TTL_SEC * 1000,
  });
}

/**
 * `POST /api/media/sign-read`
 * Rechecks authorization on every call and issues a short-lived presigned R2 GET URL.
 */
export async function handleSignReadRequest(
  request: Request,
  deps: MediaServerDeps = {},
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const r2Cfg = readR2ServerConfig(deps.env);
  if (!r2Cfg.enabled) {
    return jsonResponse({ error: "Cloudflare R2 media provider is not enabled." }, 503);
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
  if (parsedRef.provider !== "cloudflare_r2" || !parsedRef.bucket || !parsedRef.objectKey) {
    return jsonResponse({ error: "Expected an r2://bucket/key reference." }, 400);
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
