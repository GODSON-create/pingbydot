/**
 * PING Scale, Keyset Cursor Pagination, Server Rate Limiting & Search Registry (Phase 5.5)
 *
 * Addresses 1M+ user readiness bottlenecks documented in `docs/ONE_MILLION_USER_READINESS.md`:
 * - Opaque keyset cursor pagination `(created_at, id)` eliminating deep OFFSET degradation.
 * - Server-side rate limiting RPC (`check_server_rate_limit`) complementing client PING SHIELD.
 * - Swappable full-text search backend registry (`postgres_fts` active via migration `0032`
 *   GIN indexes; `meilisearch` and `typesense` pluggable via env without app rebuild).
 */

import { supabase } from "@/integrations/supabase/client";
import { checkShieldRateLimit, type ShieldValidationResult } from "@/lib/shield";

export interface PingKeysetCursor {
  createdAt: string;
  id: string;
}

/**
 * Encodes a `(created_at, id)` pair into a URL-safe opaque base64url cursor.
 */
export function encodePingCursor(cursor: PingKeysetCursor): string {
  const json = JSON.stringify({ c: cursor.createdAt, i: cursor.id });
  const encoded =
    typeof btoa === "function"
      ? btoa(unescape(encodeURIComponent(json)))
      : Buffer.from(json, "utf8").toString("base64");
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decodes and validates an opaque base64url keyset cursor.
 */
export function decodePingCursor(raw: string | null | undefined): PingKeysetCursor | null {
  if (!raw || raw.length > 256) return null;
  try {
    const padded =
      raw.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (raw.length % 4)) % 4);
    const json =
      typeof atob === "function"
        ? decodeURIComponent(escape(atob(padded)))
        : Buffer.from(padded, "base64").toString("utf8");
    const parsed = JSON.parse(json) as { c?: unknown; i?: unknown };
    if (typeof parsed.c !== "string" || typeof parsed.i !== "string") return null;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(parsed.c))
      return null;
    const parsedMs = Date.parse(parsed.c);
    if (Number.isNaN(parsedMs)) return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.i))
      return null;
    return { createdAt: new Date(parsedMs).toISOString(), id: parsed.i.toLowerCase() };
  } catch {
    return null;
  }
}

export type SearchEngineProvider = "postgres_fts" | "meilisearch" | "typesense";

export interface SearchEngineStatus {
  activeProvider: SearchEngineProvider;
  providers: Array<{
    id: SearchEngineProvider;
    label: string;
    configured: boolean;
    notes: string;
  }>;
}

export function getSearchEngineStatus(): SearchEngineStatus {
  const env = import.meta.env as Record<string, string | undefined> | undefined;
  const meiliConfigured = Boolean(env?.["VITE_MEILISEARCH_HOST"]);
  const typesenseConfigured = Boolean(env?.["VITE_TYPESENSE_HOST"]);
  const activeProvider: SearchEngineProvider = meiliConfigured
    ? "meilisearch"
    : typesenseConfigured
      ? "typesense"
      : "postgres_fts";

  return {
    activeProvider,
    providers: [
      {
        id: "postgres_fts",
        label: "PostgreSQL GIN Full-Text Search",
        configured: true,
        notes:
          "Active baseline via migration 0032 partial GIN indexes on Pings, Hubs, Businesses & Opportunities.",
      },
      {
        id: "meilisearch",
        label: "Meilisearch Dedicated Cluster",
        configured: meiliConfigured,
        notes: meiliConfigured
          ? "Configured via VITE_MEILISEARCH_HOST."
          : "Optional dedicated search cluster (provision credentials for >1M instant typo-tolerant search).",
      },
      {
        id: "typesense",
        label: "Typesense Cloud",
        configured: typesenseConfigured,
        notes: typesenseConfigured
          ? "Configured via VITE_TYPESENSE_HOST."
          : "Optional dedicated search engine pluggable without schema rewrite.",
      },
    ],
  };
}

/**
 * Enforces client PING SHIELD immediately and validates against server-side
 * `check_server_rate_limit` RPC when migration `0032` is applied remotely.
 */
export async function enforceHybridRateLimit(input: {
  action: string;
  identifier: string;
  limit?: number;
  windowSeconds?: number;
}): Promise<ShieldValidationResult & { enforcedBy: "server_and_client" | "client_fallback" }> {
  const clientCheck = checkShieldRateLimit(input.action, input.identifier);
  if (!clientCheck.allowed) {
    return { ...clientCheck, enforcedBy: "client_fallback" };
  }

  try {
    const { data, error } = await (supabase as any).rpc("check_server_rate_limit", {
      p_action: input.action,
      p_limit: input.limit ?? 30,
      p_window_seconds: input.windowSeconds ?? 60,
    });
    if (error || !data) {
      return { ...clientCheck, enforcedBy: "client_fallback" };
    }
    const res = data as { allowed?: boolean; remaining?: number };
    if (res.allowed === false) {
      return {
        allowed: false,
        remaining: 0,
        reason: `Server rate limit reached for ${input.action}. Please wait a moment.`,
        enforcedBy: "server_and_client",
      };
    }
    const nextRemaining = typeof res.remaining === "number" ? res.remaining : clientCheck.remaining;
    return {
      allowed: true,
      ...(typeof nextRemaining === "number" ? { remaining: nextRemaining } : {}),
      enforcedBy: "server_and_client",
    };
  } catch {
    return { ...clientCheck, enforcedBy: "client_fallback" };
  }
}

/**
 * Builds public edge micro-cache headers strictly for unauthenticated GET endpoints.
 */
export function buildPublicEdgeCacheHeaders(maxAgeSec = 15, swrSec = 60): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `public, max-age=0, s-maxage=${maxAgeSec}, stale-while-revalidate=${swrSec}`,
    "X-Content-Type-Options": "nosniff",
  };
}
