/**
 * Ping by DOT — Lightweight Web Crypto AWS SigV4 Presigner for Cloudflare R2 / S3
 *
 * Designed strictly for Cloudflare Workers (`workerd` 50 ms CPU / 128 MB RAM) and
 * Node.js 22+: zero `@aws-sdk/client-s3` dependency bloat, < 1 ms CPU per presign,
 * and zero file-byte proxying through server functions.
 *
 * Security invariants (Phase 2 — C5 & M1):
 * - Supports signing arbitrary canonical headers (`content-type`, `content-length`, etc.)
 *   into `X-Amz-SignedHeaders` so R2 cryptographically enforces MIME & byte-size limits.
 * - Distinguishes `NoSuchKey` (safe idempotent success) from `NoSuchBucket` / misconfigured
 *   bucket 404 responses on server-side deletes.
 */

export interface R2ServerConfig {
  enabled: boolean;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBucket: string;
  privateBucket: string;
  publicCdnUrl: string;
  region: string;
}

/**
 * Resolves runtime environment variables across Node.js and Cloudflare Workers
 * (`process.env` via `nodejs_compat_populate_process_env` or explicit env bindings).
 */
export function resolveRuntimeEnv(
  override?: Record<string, string | undefined>,
): Record<string, string | undefined> {
  if (override) return override;
  const globalEnv = (globalThis as { __PING_ENV__?: Record<string, string | undefined> })
    .__PING_ENV__;
  if (globalEnv && typeof globalEnv === "object") return globalEnv;
  if (typeof process !== "undefined" && process.env) return process.env;
  return {};
}

export function readR2ServerConfig(env?: Record<string, string | undefined>): R2ServerConfig {
  const source = resolveRuntimeEnv(env);
  const providerFlag = (source["PING_MEDIA_PROVIDER"] ?? source["VITE_MEDIA_PROVIDER"] ?? "")
    .trim()
    .toLowerCase();
  const accountId = (source["R2_ACCOUNT_ID"] ?? "").trim();
  const accessKeyId = (source["R2_ACCESS_KEY_ID"] ?? "").trim();
  const secretAccessKey = (source["R2_SECRET_ACCESS_KEY"] ?? "").trim();
  const publicBucket = (source["R2_PUBLIC_BUCKET"] ?? "ping-media").trim();
  const privateBucket = (source["R2_PRIVATE_BUCKET"] ?? "ping-private").trim();
  const publicCdnUrl = (source["R2_PUBLIC_CDN_URL"] ?? "").trim().replace(/\/$/, "");
  const region = (source["R2_REGION"] ?? "auto").trim() || "auto";

  const hasCreds = Boolean(accountId && accessKeyId && secretAccessKey);
  const enabled = providerFlag === "cloudflare_r2" && hasCreds;

  return {
    enabled,
    accountId,
    accessKeyId,
    secretAccessKey,
    publicBucket,
    privateBucket,
    publicCdnUrl,
    region,
  };
}

export function isR2ServerConfigured(config: R2ServerConfig): boolean {
  return Boolean(config.accountId && config.accessKeyId && config.secretAccessKey);
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return toHex(digest);
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const keyBytes = key instanceof Uint8Array ? key : new Uint8Array(key);
  const rawKey = new Uint8Array(keyBytes.byteLength);
  rawKey.set(keyBytes);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
}

async function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service = "s3",
): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(new TextEncoder().encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

function encodeRfc3986(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodePathSegments(key: string): string {
  return key
    .replace(/^\/+/, "")
    .split("/")
    .map((seg) => encodeRfc3986(seg))
    .join("/");
}

function formatAmzDates(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso, // YYYYMMDDTHHMMSSZ
    dateStamp: iso.slice(0, 8), // YYYYMMDD
  };
}

function normalizeHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export interface PresignS3Options {
  method: "GET" | "PUT" | "DELETE" | "POST" | "HEAD";
  endpointHost: string; // e.g. `<accountId>.r2.cloudflarestorage.com`
  bucket: string;
  objectKey: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  expiresInSec?: number;
  queryParams?: Record<string, string>;
  /** Additional HTTP headers cryptographically bound into `X-Amz-SignedHeaders` (e.g. `content-type`, `content-length`). */
  signedHeaders?: Record<string, string>;
  now?: Date;
}

/**
 * Generates an AWS SigV4 query-string presigned URL for direct-to-R2/S3 `PUT`, `GET`,
 * `DELETE`, `HEAD`, or Multipart `UploadPart` operations with optional cryptographically
 * bound headers (`content-type`, `content-length`, etc.).
 */
export async function presignS3Request(options: PresignS3Options): Promise<string> {
  const region = options.region ?? "auto";
  const expiresSec = Math.min(3600, Math.max(60, Math.round(options.expiresInSec ?? 900)));
  const { amzDate, dateStamp } = formatAmzDates(options.now ?? new Date());
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;

  const canonicalUri = `/${encodeRfc3986(options.bucket)}/${encodePathSegments(options.objectKey)}`;

  // Canonicalize & sort signed headers (always includes `host`)
  const headerMap = new Map<string, string>();
  headerMap.set("host", normalizeHeaderValue(options.endpointHost));
  if (options.signedHeaders) {
    for (const [rawKey, rawVal] of Object.entries(options.signedHeaders)) {
      const key = rawKey.trim().toLowerCase();
      if (!key || rawVal === undefined || rawVal === null) continue;
      headerMap.set(key, normalizeHeaderValue(String(rawVal)));
    }
  }
  const sortedHeaderNames = Array.from(headerMap.keys()).sort();
  const signedHeadersParam = sortedHeaderNames.join(";");
  const canonicalHeaders = sortedHeaderNames.map((k) => `${k}:${headerMap.get(k)!}\n`).join("");

  const params: Record<string, string> = {
    ...(options.queryParams ?? {}),
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${options.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresSec),
    "X-Amz-SignedHeaders": signedHeadersParam,
  };

  const sortedQuery = Object.keys(params)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(params[k]!)}`)
    .join("&");

  const canonicalRequest = [
    options.method,
    canonicalUri,
    sortedQuery,
    canonicalHeaders,
    signedHeadersParam,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = await deriveSigningKey(options.secretAccessKey, dateStamp, region, "s3");
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  return `https://${options.endpointHost}${canonicalUri}?${sortedQuery}&X-Amz-Signature=${signature}`;
}

export function getR2EndpointHost(accountId: string): string {
  return `${accountId}.r2.cloudflarestorage.com`;
}

/**
 * Extracts `<Code>...</Code>` from an S3/R2 XML error payload, if present.
 */
export function extractS3XmlErrorCode(xmlBody: string): string | null {
  const match = xmlBody.match(/<Code>\s*([^<\s]+)\s*<\/Code>/i);
  return match?.[1] ?? null;
}

/**
 * Executes a direct server-side R2/S3 DELETE via presigned URL (zero SDK overhead).
 *
 * M1 safety: On HTTP 404, treats `<Code>NoSuchKey</Code>` (or empty 404 body on already-deleted
 * object) as idempotent success, while explicitly FAILING on `<Code>NoSuchBucket</Code>` or any
 * bucket-level misconfiguration so jobs are never silently marked deleted against the wrong bucket.
 */
export async function deleteR2ObjectServer(
  config: R2ServerConfig,
  bucket: string,
  objectKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number; error?: string }> {
  if (!isR2ServerConfigured(config)) {
    return { ok: false, status: 503, error: "Cloudflare R2 credentials are not configured." };
  }
  const url = await presignS3Request({
    method: "DELETE",
    endpointHost: getR2EndpointHost(config.accountId),
    bucket,
    objectKey,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
    expiresInSec: 120,
  });
  const res = await fetchImpl(url, { method: "DELETE" });
  if (res.ok) {
    return { ok: true, status: res.status };
  }
  const errText = await res.text().catch(() => "");
  if (res.status === 404) {
    const code = extractS3XmlErrorCode(errText);
    if (code === "NoSuchBucket") {
      return {
        ok: false,
        status: 404,
        error: `R2 target bucket '${bucket}' does not exist (NoSuchBucket).`,
      };
    }
    if (code === "NoSuchKey" || !code) {
      return { ok: true, status: 404 };
    }
    return {
      ok: false,
      status: 404,
      error: `R2 DELETE returned 404 with unexpected code '${code}'.`,
    };
  }
  return { ok: false, status: res.status, error: errText || `HTTP ${res.status}` };
}

/**
 * Executes a server-side S3/R2 `AbortMultipartUpload` for failed or abandoned uploads.
 */
export async function abortR2MultipartUploadServer(
  config: R2ServerConfig,
  bucket: string,
  objectKey: string,
  uploadId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number; error?: string }> {
  if (!isR2ServerConfigured(config)) {
    return { ok: false, status: 503, error: "Cloudflare R2 credentials are not configured." };
  }
  const url = await presignS3Request({
    method: "DELETE",
    endpointHost: getR2EndpointHost(config.accountId),
    bucket,
    objectKey,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
    expiresInSec: 120,
    queryParams: { uploadId },
  });
  const res = await fetchImpl(url, { method: "DELETE" });
  if (res.ok || res.status === 404) {
    return { ok: true, status: res.status };
  }
  const errText = await res.text().catch(() => "");
  return { ok: false, status: res.status, error: errText || `HTTP ${res.status}` };
}
