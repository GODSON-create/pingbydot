/**
 * PING Developer Ecosystem — OAuth 2.0 PKCE, Scoped API Keys, Signed Webhooks,
 * Business Messaging API & OpenAPI 3.1 Specification (Phase 5.2).
 *
 * Security invariants:
 * - Client secrets, API keys, and webhook signing secrets are hashed (SHA-256) before
 *   persistence; raw credentials are displayed once at creation and never retrievable again.
 * - Private direct messages (`private_messages:read`) are explicitly FORBIDDEN across all
 *   third-party OAuth apps and API keys.
 * - Webhook endpoints require HTTPS and reject private/loopback/link-local SSRF hosts.
 * - Webhook deliveries are signed with HMAC-SHA256 (`X-Ping-Signature-256: t=...,v1=...`)
 *   with timestamp replay protection.
 */

import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SITE_ORIGIN } from "@/lib/site";

export const DEVELOPER_SCOPES = [
  {
    id: "profile:read",
    label: "Read public profile",
    description: "Read username, display name, avatar, bio, and public connections.",
  },
  {
    id: "pings:read",
    label: "Read public Pings",
    description: "Read non-hidden public Pings, categories, and engagement counts.",
  },
  {
    id: "opportunities:read",
    label: "Read Signal Opportunities",
    description: "Query open structured opportunities across the 14 Ping categories.",
  },
  {
    id: "business:inbox:read",
    label: "Read Business Inbox",
    description: "Read enquiries and lead stages for an authorised Business Profile.",
  },
  {
    id: "business:inbox:write",
    label: "Reply via Business Messaging API",
    description:
      "Post agent replies and update CRM lead stages for an authorised Business Profile.",
  },
  {
    id: "webhooks:manage",
    label: "Manage Webhooks",
    description: "Subscribe to signed Ping event notifications.",
  },
] as const;

export type DeveloperScope = (typeof DEVELOPER_SCOPES)[number]["id"];

export const FORBIDDEN_DEVELOPER_SCOPES = [
  "private_messages:read",
  "private_messages:write",
  "close_circle:read",
  "dot_wallet:credit",
  "admin:all",
] as const;

export const WEBHOOK_EVENTS = [
  "business.enquiry.created",
  "business.enquiry.updated",
  "business.booking.requested",
  "signal.opportunity.published",
  "ping.published",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export interface DeveloperApp {
  id: string;
  owner_id: string;
  business_id: string | null;
  name: string;
  description: string;
  homepage_url: string | null;
  client_id: string;
  redirect_uris: string[];
  allowed_scopes: DeveloperScope[];
  review_status: "sandbox" | "pending_security_review" | "approved" | "suspended";
  created_at: string;
  updated_at: string;
}

export interface DeveloperApiKey {
  id: string;
  owner_id: string;
  business_id: string | null;
  name: string;
  key_prefix: string;
  environment: "sandbox" | "production";
  scopes: DeveloperScope[];
  rate_limit_per_min: number;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface DeveloperWebhook {
  id: string;
  owner_id: string;
  business_id: string | null;
  endpoint_url: string;
  signing_secret_prefix: string;
  subscribed_events: WebhookEventType[];
  active: boolean;
  consecutive_failures: number;
  last_delivered_at: string | null;
  created_at: string;
}

const LOCAL_APPS_KEY = "ping_dev_apps_v5";
const LOCAL_KEYS_KEY = "ping_dev_keys_v5";
const LOCAL_HOOKS_KEY = "ping_dev_webhooks_v5";

function isMissingPhase5Schema(error: unknown): boolean {
  const msg = String((error as { message?: string })?.message ?? "").toLowerCase();
  const code = String((error as { code?: string })?.code ?? "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "42883" ||
    code === "PGRST202" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore restricted storage
  }
}

/* -------------------------------------------------------------------------- */
/*                    CRYPTOGRAPHY, PKCE & WEBHOOK SIGNING                    */
/* -------------------------------------------------------------------------- */

function randomBytesHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Computes RFC 7636 PKCE S256 code_challenge from a verifier string.
 */
export async function computePkceChallenge(verifier: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(verifier));
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Signs an outgoing Ping Developer Webhook payload using HMAC-SHA256 with timestamp.
 * Header format: `X-Ping-Signature-256: t=<unix_sec>,v1=<hex_hmac>`
 */
export async function signPingWebhookPayload(
  rawBody: string,
  signingSecret: string,
  timestampSec = Math.floor(Date.now() / 1000),
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signedContent = `${timestampSec}.${rawBody}`;
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(signedContent));
  const hex = Array.from(new Uint8Array(sigBuf), (b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${timestampSec},v1=${hex}`;
}

/**
 * Verifies an `X-Ping-Signature-256` header in constant time with a 5-minute replay tolerance.
 */
export async function verifyPingWebhookSignature(
  rawBody: string,
  headerValue: string | null | undefined,
  signingSecret: string | null | undefined,
  options?: { nowSec?: number; toleranceSec?: number },
): Promise<boolean> {
  if (!headerValue || !signingSecret) return false;
  const parts = Object.fromEntries(
    headerValue.split(",").map((segment) => {
      const [k, ...rest] = segment.trim().split("=");
      return [k ?? "", rest.join("=")];
    }),
  );
  const t = Number(parts["t"]);
  const v1 = (parts["v1"] ?? "").toLowerCase();
  if (!Number.isFinite(t) || !/^[0-9a-f]{64}$/.test(v1)) return false;

  const nowSec = options?.nowSec ?? Math.floor(Date.now() / 1000);
  const toleranceSec = options?.toleranceSec ?? 300;
  if (Math.abs(nowSec - t) > toleranceSec) return false;

  const expectedHeader = await signPingWebhookPayload(rawBody, signingSecret, t);
  const expectedSig = expectedHeader.split("v1=")[1] ?? "";
  if (expectedSig.length !== v1.length) return false;

  let diff = 0;
  for (let i = 0; i < expectedSig.length; i++) {
    diff |= expectedSig.charCodeAt(i) ^ v1.charCodeAt(i);
  }
  return diff === 0;
}

/* -------------------------------------------------------------------------- */
/*                       VALIDATION & SSRF PROTECTION                         */
/* -------------------------------------------------------------------------- */

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
  /^0\.0\.0\.0$/,
  /\.local$/i,
  /\.internal$/i,
];

export function validateWebhookEndpointUrl(rawUrl: string): { valid: boolean; error?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { valid: false, error: "Enter a valid HTTPS webhook URL." };
  }
  if (parsed.protocol !== "https:") {
    return { valid: false, error: "Webhook endpoints must use HTTPS." };
  }
  if (parsed.username || parsed.password) {
    return { valid: false, error: "Webhook URLs must not contain embedded credentials." };
  }
  if (PRIVATE_HOST_PATTERNS.some((re) => re.test(parsed.hostname))) {
    return {
      valid: false,
      error: "Webhook endpoints cannot target localhost or private internal IP ranges.",
    };
  }
  return { valid: true };
}

export function validateOAuthRedirectUri(rawUrl: string): { valid: boolean; error?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { valid: false, error: "Redirect URI must be a valid URL." };
  }
  if (parsed.hash) {
    return { valid: false, error: "OAuth 2.0 redirect URIs must not include a URL fragment (#)." };
  }
  const isLocalDev =
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (parsed.protocol !== "https:" && !isLocalDev) {
    return {
      valid: false,
      error: "Redirect URIs must use HTTPS (or http://localhost for local sandbox development).",
    };
  }
  return { valid: true };
}

export function sanitizeRequestedScopes(scopes: string[]): DeveloperScope[] {
  const allowed = new Set<string>(DEVELOPER_SCOPES.map((s) => s.id));
  const forbidden = new Set<string>(FORBIDDEN_DEVELOPER_SCOPES);
  const clean = new Set<DeveloperScope>();
  for (const s of scopes) {
    const trimmed = s.trim();
    if (!trimmed || forbidden.has(trimmed)) continue;
    if (allowed.has(trimmed)) {
      clean.add(trimmed as DeveloperScope);
    }
  }
  return Array.from(clean);
}

/* -------------------------------------------------------------------------- */
/*                      OPENAPI 3.1 SPECIFICATION BUILDER                     */
/* -------------------------------------------------------------------------- */

export function buildPingOpenApiSpec(origin = SITE_ORIGIN) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Ping by DOT Public & Business Messaging API",
      version: "1.0.0",
      description:
        "Scoped REST & Webhook API for Ping discovery, structured opportunities, and multi-agent Business Messaging. Private 1-on-1 direct messages are strictly excluded from third-party APIs.",
    },
    servers: [{ url: origin, description: "Ping Production / Staging Host" }],
    security: [{ BearerAuth: [] }],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "Scoped Ping Developer API Key (`ping_test_...` / `ping_live_...`) or OAuth 2.0 PKCE access token.",
        },
        OAuth2PKCE: {
          type: "oauth2",
          flows: {
            authorizationCode: {
              authorizationUrl: `${origin}/oauth/authorize`,
              tokenUrl: `${origin}/api/v1/oauth/token`,
              scopes: Object.fromEntries(DEVELOPER_SCOPES.map((s) => [s.id, s.description])),
            },
          },
        },
      },
    },
    paths: {
      "/api/v1/health": {
        get: {
          summary: "Service health & platform readiness check",
          security: [],
          responses: {
            "200": { description: "Healthy status and API version metadata" },
          },
        },
      },
      "/api/v1/pings": {
        get: {
          summary: "List public Pings using keyset cursor pagination",
          security: [],
          parameters: [
            { name: "category", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50 } },
            { name: "cursor", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Paginated list of public non-hidden Pings and `nextCursor`" },
          },
        },
      },
      "/api/v1/business/messages": {
        post: {
          summary: "Send an authorised Business Inbox enquiry reply or status update",
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["businessId", "enquiryId", "replyMessage"],
                  properties: {
                    businessId: { type: "string", format: "uuid" },
                    enquiryId: { type: "string", format: "uuid" },
                    replyMessage: { type: "string", minLength: 1, maxLength: 2000 },
                    leadStatus: {
                      type: "string",
                      enum: ["new", "qualified", "in_progress", "won", "lost", "closed"],
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Reply delivered and logged in Business Inbox" },
            "401": { description: "Invalid or missing scoped Bearer credential" },
            "403": { description: "Missing `business:inbox:write` scope or mismatched business" },
            "503": { description: "Server API key verification credentials not configured" },
          },
        },
      },
    },
  };
}

/**
 * Generates an embeddable HTML snippet for external websites to link directly into a
 * Ping Business Storefront / Enquiry workflow (Phase 4.4 -> Phase 5 bridge).
 */
export function buildWebsiteEnquiryEmbedSnippet(
  businessSlug: string,
  businessName: string,
): string {
  const safeSlug = businessSlug.replace(/[^a-z0-9-]/gi, "");
  const safeName = businessName.replace(/["<>]/g, "").trim() || "our team";
  const href = `${SITE_ORIGIN}/b/${safeSlug}?source=website_embed`;
  return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:9999px;background:#C7F36B;color:#090B0A;font-family:system-ui,sans-serif;font-weight:700;font-size:14px;text-decoration:none;">Message ${safeName} on Ping</a>`;
}

/* -------------------------------------------------------------------------- */
/*                     SUPABASE QUERIES & MUTATIONS (PORTAL)                  */
/* -------------------------------------------------------------------------- */

export function myDeveloperAppsQuery(userId?: string) {
  return queryOptions({
    queryKey: ["developer-apps", userId],
    enabled: Boolean(userId),
    staleTime: 20_000,
    queryFn: async (): Promise<DeveloperApp[]> => {
      if (!userId) return [];
      const { data, error } = await (supabase as any)
        .from("developer_apps")
        .select(
          "id,owner_id,business_id,name,description,homepage_url,client_id,redirect_uris,allowed_scopes,review_status,created_at,updated_at",
        )
        .eq("owner_id", userId)
        .order("created_at", { ascending: false });

      if (error) {
        if (!isMissingPhase5Schema(error)) throw error;
        return readLocal<DeveloperApp[]>(LOCAL_APPS_KEY, []).filter((a) => a.owner_id === userId);
      }
      return (data ?? []) as DeveloperApp[];
    },
  });
}

export function useCreateDeveloperApp(userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      description: string;
      homepageUrl?: string;
      redirectUri: string;
      scopes: DeveloperScope[];
      businessId?: string | null;
    }): Promise<{ app: DeveloperApp; oneTimeClientSecret: string }> => {
      if (!userId) throw new Error("Sign in to register a Ping Developer App.");
      const uriCheck = validateOAuthRedirectUri(input.redirectUri);
      if (!uriCheck.valid) throw new Error(uriCheck.error);

      const cleanScopes = sanitizeRequestedScopes(input.scopes);
      if (cleanScopes.length === 0) {
        throw new Error("Select at least one permitted OAuth scope.");
      }

      const clientId = `ping_app_${randomBytesHex(12)}`;
      const rawSecret = `ping_sec_${randomBytesHex(24)}`;
      const secretHash = await sha256Hex(rawSecret);

      const payload = {
        owner_id: userId,
        business_id: input.businessId ?? null,
        name: input.name.trim(),
        description: input.description.trim(),
        homepage_url: input.homepageUrl?.trim() || null,
        client_id: clientId,
        client_secret_hash: secretHash,
        redirect_uris: [input.redirectUri.trim()],
        allowed_scopes: cleanScopes,
        review_status: "sandbox" as const,
      };

      const { data, error } = await (supabase as any)
        .from("developer_apps")
        .insert(payload)
        .select(
          "id,owner_id,business_id,name,description,homepage_url,client_id,redirect_uris,allowed_scopes,review_status,created_at,updated_at",
        )
        .single();

      if (error) {
        if (!isMissingPhase5Schema(error)) throw error;
        const now = new Date().toISOString();
        const localApp: DeveloperApp = {
          id: `app_${Date.now()}`,
          owner_id: userId,
          business_id: payload.business_id,
          name: payload.name,
          description: payload.description,
          homepage_url: payload.homepage_url,
          client_id: clientId,
          redirect_uris: payload.redirect_uris,
          allowed_scopes: cleanScopes,
          review_status: "sandbox",
          created_at: now,
          updated_at: now,
        };
        const existing = readLocal<DeveloperApp[]>(LOCAL_APPS_KEY, []);
        writeLocal(LOCAL_APPS_KEY, [localApp, ...existing]);
        return { app: localApp, oneTimeClientSecret: rawSecret };
      }

      return { app: data as DeveloperApp, oneTimeClientSecret: rawSecret };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["developer-apps", userId] });
    },
  });
}

export function myDeveloperApiKeysQuery(userId?: string) {
  return queryOptions({
    queryKey: ["developer-api-keys", userId],
    enabled: Boolean(userId),
    staleTime: 20_000,
    queryFn: async (): Promise<DeveloperApiKey[]> => {
      if (!userId) return [];
      const { data, error } = await (supabase as any)
        .from("developer_api_keys")
        .select(
          "id,owner_id,business_id,name,key_prefix,environment,scopes,rate_limit_per_min,last_used_at,revoked_at,created_at",
        )
        .eq("owner_id", userId)
        .order("created_at", { ascending: false });

      if (error) {
        if (!isMissingPhase5Schema(error)) throw error;
        return readLocal<DeveloperApiKey[]>(LOCAL_KEYS_KEY, []).filter(
          (k) => k.owner_id === userId,
        );
      }
      return (data ?? []) as DeveloperApiKey[];
    },
  });
}

export function useCreateDeveloperApiKey(userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      scopes: DeveloperScope[];
      businessId?: string | null;
      rateLimitPerMin?: number;
    }): Promise<{ key: DeveloperApiKey; oneTimeApiKey: string }> => {
      if (!userId) throw new Error("Sign in to create a scoped API key.");
      const cleanScopes = sanitizeRequestedScopes(input.scopes);
      if (cleanScopes.length === 0) throw new Error("Select at least one API scope.");

      const secretBody = randomBytesHex(24);
      const rawKey = `ping_test_${secretBody}`;
      const prefix = rawKey.slice(0, 18);
      const keyHash = await sha256Hex(rawKey);
      const rateLimit = Math.max(10, Math.min(600, input.rateLimitPerMin ?? 60));

      const payload = {
        owner_id: userId,
        business_id: input.businessId ?? null,
        name: input.name.trim(),
        key_prefix: prefix,
        key_hash: keyHash,
        environment: "sandbox" as const,
        scopes: cleanScopes,
        rate_limit_per_min: rateLimit,
      };

      const { data, error } = await (supabase as any)
        .from("developer_api_keys")
        .insert(payload)
        .select(
          "id,owner_id,business_id,name,key_prefix,environment,scopes,rate_limit_per_min,last_used_at,revoked_at,created_at",
        )
        .single();

      if (error) {
        if (!isMissingPhase5Schema(error)) throw error;
        const localKey: DeveloperApiKey = {
          id: `key_${Date.now()}`,
          owner_id: userId,
          business_id: payload.business_id,
          name: payload.name,
          key_prefix: prefix,
          environment: "sandbox",
          scopes: cleanScopes,
          rate_limit_per_min: rateLimit,
          last_used_at: null,
          revoked_at: null,
          created_at: new Date().toISOString(),
        };
        const existing = readLocal<DeveloperApiKey[]>(LOCAL_KEYS_KEY, []);
        writeLocal(LOCAL_KEYS_KEY, [localKey, ...existing]);
        return { key: localKey, oneTimeApiKey: rawKey };
      }

      return { key: data as DeveloperApiKey, oneTimeApiKey: rawKey };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["developer-api-keys", userId] });
    },
  });
}

export function useRevokeDeveloperApiKey(userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (keyId: string) => {
      const revokedAt = new Date().toISOString();
      const { error } = await (supabase as any)
        .from("developer_api_keys")
        .update({ revoked_at: revokedAt })
        .eq("id", keyId);

      if (error) {
        if (!isMissingPhase5Schema(error)) throw error;
        const list = readLocal<DeveloperApiKey[]>(LOCAL_KEYS_KEY, []).map((k) =>
          k.id === keyId ? { ...k, revoked_at: revokedAt } : k,
        );
        writeLocal(LOCAL_KEYS_KEY, list);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["developer-api-keys", userId] });
    },
  });
}

export function myDeveloperWebhooksQuery(userId?: string) {
  return queryOptions({
    queryKey: ["developer-webhooks", userId],
    enabled: Boolean(userId),
    staleTime: 20_000,
    queryFn: async (): Promise<DeveloperWebhook[]> => {
      if (!userId) return [];
      const { data, error } = await (supabase as any)
        .from("developer_webhooks")
        .select(
          "id,owner_id,business_id,endpoint_url,signing_secret_prefix,subscribed_events,active,consecutive_failures,last_delivered_at,created_at",
        )
        .eq("owner_id", userId)
        .order("created_at", { ascending: false });

      if (error) {
        if (!isMissingPhase5Schema(error)) throw error;
        return readLocal<DeveloperWebhook[]>(LOCAL_HOOKS_KEY, []).filter(
          (w) => w.owner_id === userId,
        );
      }
      return (data ?? []) as DeveloperWebhook[];
    },
  });
}

export function useCreateDeveloperWebhook(userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      endpointUrl: string;
      events: WebhookEventType[];
      businessId?: string | null;
    }): Promise<{ webhook: DeveloperWebhook; oneTimeSigningSecret: string }> => {
      if (!userId) throw new Error("Sign in to register a webhook endpoint.");
      const urlCheck = validateWebhookEndpointUrl(input.endpointUrl);
      if (!urlCheck.valid) throw new Error(urlCheck.error);
      if (input.events.length === 0) throw new Error("Select at least one webhook event.");

      const rawSecret = `whsec_${randomBytesHex(24)}`;
      const secretPrefix = rawSecret.slice(0, 14);
      const secretHash = await sha256Hex(rawSecret);

      const payload = {
        owner_id: userId,
        business_id: input.businessId ?? null,
        endpoint_url: input.endpointUrl.trim(),
        signing_secret_prefix: secretPrefix,
        signing_secret_hash: secretHash,
        subscribed_events: input.events,
        active: true,
      };

      const { data, error } = await (supabase as any)
        .from("developer_webhooks")
        .insert(payload)
        .select(
          "id,owner_id,business_id,endpoint_url,signing_secret_prefix,subscribed_events,active,consecutive_failures,last_delivered_at,created_at",
        )
        .single();

      if (error) {
        if (!isMissingPhase5Schema(error)) throw error;
        const localHook: DeveloperWebhook = {
          id: `wh_${Date.now()}`,
          owner_id: userId,
          business_id: payload.business_id,
          endpoint_url: payload.endpoint_url,
          signing_secret_prefix: secretPrefix,
          subscribed_events: input.events,
          active: true,
          consecutive_failures: 0,
          last_delivered_at: null,
          created_at: new Date().toISOString(),
        };
        const existing = readLocal<DeveloperWebhook[]>(LOCAL_HOOKS_KEY, []);
        writeLocal(LOCAL_HOOKS_KEY, [localHook, ...existing]);
        return { webhook: localHook, oneTimeSigningSecret: rawSecret };
      }

      return { webhook: data as DeveloperWebhook, oneTimeSigningSecret: rawSecret };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["developer-webhooks", userId] });
    },
  });
}
