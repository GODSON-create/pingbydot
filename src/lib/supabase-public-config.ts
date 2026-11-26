import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type SupabaseEnvSource = "server" | "vite-fallback" | "server+vite";

export interface PublicSupabaseConfig {
  url: string;
  publishableKey: string;
  projectRef: string | null;
  source: SupabaseEnvSource;
  serverProjectRef: string | null;
  viteProjectRef: string | null;
  mismatchDetected: boolean;
}

const warnedMismatches = new Set<string>();

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null") return undefined;
  return trimmed;
}

function readFromEnvMap(
  key: string,
  ...maps: Array<Record<string, unknown> | undefined>
): string | undefined {
  for (const map of maps) {
    if (!map) continue;
    const val = readNonEmptyString(map[key]);
    if (val) return val;
  }
  return undefined;
}

function normalizeSupabaseUrl(rawUrl: string | undefined): string | undefined {
  const value = readNonEmptyString(rawUrl);
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    const isLocalHttp =
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "[::1]");
    if (parsed.protocol !== "https:" && !isLocalHttp) return undefined;
    return value.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

export function extractSupabaseProjectRef(rawUrl: string | undefined): string | null {
  const normalized = normalizeSupabaseUrl(rawUrl);
  if (!normalized) return null;
  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    if (hostname.endsWith(".supabase.co") || hostname.endsWith(".supabase.in")) {
      return hostname.split(".")[0] || null;
    }
    return hostname || null;
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const json =
      typeof atob === "function"
        ? atob(padded)
        : typeof Buffer !== "undefined"
          ? Buffer.from(padded, "base64").toString("utf8")
          : null;
    if (!json) return null;
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function isPrivilegedSupabaseKey(key: string | undefined): boolean {
  const value = readNonEmptyString(key);
  if (!value) return false;
  if (value.startsWith("sb_secret_")) return true;
  const payload = decodeJwtPayload(value);
  return payload?.["role"] === "service_role";
}

function getRuntimeEnvMaps(runtimeEnv?: Record<string, unknown>) {
  const globalEnv = (globalThis as { __env__?: Record<string, unknown> }).__env__;
  const processEnv =
    typeof process !== "undefined" && process?.env
      ? (process.env as Record<string, unknown>)
      : undefined;
  return { runtimeEnv, globalEnv, processEnv };
}

export interface PublicSupabaseEnvSources {
  serverUrl?: unknown;
  serverKey?: unknown;
  viteUrl?: unknown;
  viteKey?: unknown;
}

export function resolvePublicSupabaseConfigFromSources(
  sources: PublicSupabaseEnvSources,
): PublicSupabaseConfig {
  const rawServerUrl = readNonEmptyString(sources.serverUrl);
  const rawServerKey = readNonEmptyString(sources.serverKey);
  const rawViteUrl = readNonEmptyString(sources.viteUrl);
  const rawViteKey = readNonEmptyString(sources.viteKey);

  if (isPrivilegedSupabaseKey(rawServerKey) || isPrivilegedSupabaseKey(rawViteKey)) {
    throw new Error("Refusing to use a service-role or secret key for public Supabase access.");
  }

  const serverUrl = normalizeSupabaseUrl(rawServerUrl);
  const serverKey = readNonEmptyString(rawServerKey);
  const viteUrl = normalizeSupabaseUrl(rawViteUrl);
  const viteKey = readNonEmptyString(rawViteKey);

  const serverProjectRef = extractSupabaseProjectRef(serverUrl);
  const viteProjectRef = extractSupabaseProjectRef(viteUrl);

  const hasServerPair = Boolean(serverUrl && serverKey);
  const hasVitePair = Boolean(viteUrl && viteKey);

  if (hasServerPair && hasVitePair && serverUrl && serverKey && viteUrl && viteKey) {
    const mismatchDetected =
      serverUrl !== viteUrl ||
      (Boolean(serverProjectRef && viteProjectRef) && serverProjectRef !== viteProjectRef) ||
      serverKey !== viteKey;

    if (mismatchDetected) {
      const warnKey = `${serverProjectRef ?? "unknown"}->${viteProjectRef ?? "unknown"}`;
      if (!warnedMismatches.has(warnKey)) {
        warnedMismatches.add(warnKey);
        console.warn(
          "[Supabase] Server SUPABASE_* config differs from browser VITE_SUPABASE_* config; aligning server reader to browser project.",
          {
            serverProjectRef,
            viteProjectRef,
          },
        );
      }
      return {
        url: viteUrl,
        publishableKey: viteKey,
        projectRef: viteProjectRef,
        source: "vite-fallback",
        serverProjectRef,
        viteProjectRef,
        mismatchDetected: true,
      };
    }

    return {
      url: serverUrl,
      publishableKey: serverKey,
      projectRef: serverProjectRef ?? viteProjectRef,
      source: "server+vite",
      serverProjectRef,
      viteProjectRef,
      mismatchDetected: false,
    };
  }

  if (hasVitePair && viteUrl && viteKey) {
    return {
      url: viteUrl,
      publishableKey: viteKey,
      projectRef: viteProjectRef,
      source: "vite-fallback",
      serverProjectRef,
      viteProjectRef,
      mismatchDetected: false,
    };
  }

  if (hasServerPair && serverUrl && serverKey) {
    return {
      url: serverUrl,
      publishableKey: serverKey,
      projectRef: serverProjectRef,
      source: "server",
      serverProjectRef,
      viteProjectRef,
      mismatchDetected: false,
    };
  }

  const missing: string[] = [];
  if (!serverUrl && !viteUrl) missing.push("SUPABASE_URL / VITE_SUPABASE_URL");
  if (!serverKey && !viteKey)
    missing.push("SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_PUBLISHABLE_KEY");

  throw new Error(
    missing.length > 0
      ? `Public Supabase configuration missing: ${missing.join(", ")}.`
      : "Public Supabase configuration is incomplete or invalid.",
  );
}

export function resolvePublicSupabaseConfig(
  runtimeEnv?: Record<string, unknown>,
): PublicSupabaseConfig {
  const { globalEnv, processEnv } = getRuntimeEnvMaps(runtimeEnv);

  // Direct bracket reads allow Vite to statically inline VITE_* at build time.
  const viteStaticUrl = readNonEmptyString(import.meta.env["VITE_SUPABASE_URL"]);
  const viteStaticKey = readNonEmptyString(import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"]);

  return resolvePublicSupabaseConfigFromSources({
    serverUrl: readFromEnvMap("SUPABASE_URL", runtimeEnv, globalEnv, processEnv),
    serverKey: readFromEnvMap("SUPABASE_PUBLISHABLE_KEY", runtimeEnv, globalEnv, processEnv),
    viteUrl:
      readFromEnvMap("VITE_SUPABASE_URL", runtimeEnv, globalEnv, processEnv) ?? viteStaticUrl,
    viteKey:
      readFromEnvMap("VITE_SUPABASE_PUBLISHABLE_KEY", runtimeEnv, globalEnv, processEnv) ??
      viteStaticKey,
  });
}

/**
 * Populates process.env with Cloudflare Worker bindings (when present) and ensures
 * process.env["SUPABASE_URL"] and process.env["SUPABASE_PUBLISHABLE_KEY"] align
 * with resolvePublicSupabaseConfig() so auto-generated middleware uses the same DB.
 */
export function syncServerSupabaseProcessEnv(runtimeEnv?: Record<string, unknown>): void {
  if (typeof process === "undefined" || !process?.env) return;

  const { globalEnv } = getRuntimeEnvMaps(runtimeEnv);
  const workerEnv = runtimeEnv ?? globalEnv;

  if (workerEnv) {
    for (const secretKey of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "LOVABLE_CRON_SECRET",
      "LOVABLE_CRON_SECRET_PREVIOUS",
    ]) {
      if (!readNonEmptyString(process.env[secretKey])) {
        const val = readNonEmptyString(workerEnv[secretKey]);
        if (val) process.env[secretKey] = val;
      }
    }
  }

  try {
    const resolved = resolvePublicSupabaseConfig(workerEnv);
    if (!readNonEmptyString(process.env["SUPABASE_URL"]) || resolved.mismatchDetected) {
      process.env["SUPABASE_URL"] = resolved.url;
    }
    if (!readNonEmptyString(process.env["SUPABASE_PUBLISHABLE_KEY"]) || resolved.mismatchDetected) {
      process.env["SUPABASE_PUBLISHABLE_KEY"] = resolved.publishableKey;
    }
  } catch {
    // Let individual callers surface configuration errors in context.
  }
}

export function createPublicSupabaseClient(runtimeEnv?: Record<string, unknown>) {
  const { url, publishableKey } = resolvePublicSupabaseConfig(runtimeEnv);
  return createClient<Database>(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(
          typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
        );
        if (init?.headers) {
          new Headers(init.headers).forEach((value, headerKey) => headers.set(headerKey, value));
        }
        if (
          publishableKey.startsWith("sb_") &&
          headers.get("Authorization") === `Bearer ${publishableKey}`
        ) {
          headers.delete("Authorization");
        }
        headers.set("apikey", publishableKey);
        return fetch(input, { ...init, headers });
      },
    },
  });
}
