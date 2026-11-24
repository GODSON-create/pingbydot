/**
 * Ping by DOT — Lightweight Web Crypto AWS SigV4 Presigner for Cloudflare R2 / S3
 *
 * Designed strictly for Cloudflare Workers (`workerd` 50 ms CPU / 128 MB RAM) and
 * Node.js 22+: zero `@aws-sdk/client-s3` dependency bloat, < 1 ms CPU per presign,
 * and zero file-byte proxying through server functions.
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

export function readR2ServerConfig(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): R2ServerConfig {
  const providerFlag = (env["PING_MEDIA_PROVIDER"] ?? env["VITE_MEDIA_PROVIDER"] ?? "")
    .trim()
    .toLowerCase();
  const accountId = (env["R2_ACCOUNT_ID"] ?? "").trim();
  const accessKeyId = (env["R2_ACCESS_KEY_ID"] ?? "").trim();
  const secretAccessKey = (env["R2_SECRET_ACCESS_KEY"] ?? "").trim();
  const publicBucket = (env["R2_PUBLIC_BUCKET"] ?? "ping-media").trim();
  const privateBucket = (env["R2_PRIVATE_BUCKET"] ?? "ping-private").trim();
  const publicCdnUrl = (env["R2_PUBLIC_CDN_URL"] ?? "").trim().replace(/\/$/, "");
  const region = (env["R2_REGION"] ?? "auto").trim() || "auto";

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

export interface PresignS3Options {
  method: "GET" | "PUT" | "DELETE" | "POST";
  endpointHost: string; // e.g. `<accountId>.r2.cloudflarestorage.com`
  bucket: string;
  objectKey: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  expiresInSec?: number;
  queryParams?: Record<string, string>;
  now?: Date;
}

/**
 * Generates an AWS SigV4 query-string presigned URL for direct-to-R2/S3 `PUT`, `GET`,
 * `DELETE`, or Multipart `UploadPart` operations.
 */
export async function presignS3Request(options: PresignS3Options): Promise<string> {
  const region = options.region ?? "auto";
  const expiresSec = Math.min(3600, Math.max(60, Math.round(options.expiresInSec ?? 900)));
  const { amzDate, dateStamp } = formatAmzDates(options.now ?? new Date());
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;

  const canonicalUri = `/${encodeRfc3986(options.bucket)}/${encodePathSegments(options.objectKey)}`;

  const params: Record<string, string> = {
    ...(options.queryParams ?? {}),
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${options.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresSec),
    "X-Amz-SignedHeaders": "host",
  };

  const sortedQuery = Object.keys(params)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(params[k]!)}`)
    .join("&");

  const canonicalHeaders = `host:${options.endpointHost}\n`;
  const canonicalRequest = [
    options.method,
    canonicalUri,
    sortedQuery,
    canonicalHeaders,
    "host",
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
 * Executes a direct server-side R2/S3 DELETE via presigned URL (zero SDK overhead).
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
  if (res.ok || res.status === 404) {
    return { ok: true, status: res.status };
  }
  const errText = await res.text().catch(() => "");
  return { ok: false, status: res.status, error: errText || `HTTP ${res.status}` };
}
