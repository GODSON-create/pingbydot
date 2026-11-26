import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { runLocalGriotAssist } from "@/lib/griot";
import { resolvePublicSupabaseConfig } from "@/lib/supabase-public-config";

export const GRIOT_RATE_LIMIT_MAX = 20;
export const GRIOT_RATE_LIMIT_WINDOW_SECONDS = 60;
const MAX_REQUEST_BYTES = 32_768;

// Strip ASCII control characters other than \t, \n, \r
function stripControlChars(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
      out += value[i];
    }
  }
  return out;
}

export const griotAssistBodySchema = z
  .object({
    action: z.enum([
      "draft_ping",
      "clarity_audit",
      "hashtag_suggest",
      "opportunity_pitch",
      "business_reply_draft",
      "thread_summary",
      "translation_prep",
    ]),
    inputText: z
      .string()
      .transform((s) => stripControlChars(s).trim())
      .pipe(z.string().min(1).max(4000)),
    tone: z.enum(["concise", "professional", "warm", "structured"]).optional(),
    targetLocale: z
      .string()
      .trim()
      .max(12)
      .regex(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})?$/, "Invalid locale tag")
      .optional(),
  })
  .strict();

export type GriotRateLimitSource = "database" | "memory_fallback";

export interface GriotRateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  source?: GriotRateLimitSource;
}

export interface GriotAuthResult {
  userId: string;
  checkRateLimit: () => Promise<GriotRateLimitDecision>;
}

export interface GriotAssistHandlerDeps {
  authenticateRequest?: (request: Request) => Promise<GriotAuthResult | null>;
  fetchUpstream?: typeof fetch;
  getEnv?: () => Record<string, string | undefined>;
  nowMs?: () => number;
}

const inMemoryRateWindows = new Map<string, number[]>();

export function resetGriotInMemoryRateLimiter(): void {
  inMemoryRateWindows.clear();
}

export function checkInMemoryGriotRateLimit(
  userId: string,
  nowMs: number = Date.now(),
  maxRequests: number = GRIOT_RATE_LIMIT_MAX,
  windowSeconds: number = GRIOT_RATE_LIMIT_WINDOW_SECONDS,
): GriotRateLimitDecision {
  const windowMs = windowSeconds * 1000;
  const cutoff = nowMs - windowMs;
  const existing = (inMemoryRateWindows.get(userId) ?? []).filter((ts) => ts > cutoff);

  // Opportunistic cap to avoid unbounded memory growth under churn
  if (inMemoryRateWindows.size > 5_000) {
    for (const [key, stamps] of inMemoryRateWindows) {
      if (stamps.every((ts) => ts <= cutoff)) {
        inMemoryRateWindows.delete(key);
      }
    }
  }

  if (existing.length >= maxRequests) {
    const oldest = existing[0] ?? nowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - nowMs) / 1000));
    inMemoryRateWindows.set(userId, existing);
    return { allowed: false, remaining: 0, retryAfterSeconds, source: "memory_fallback" };
  }

  existing.push(nowMs);
  inMemoryRateWindows.set(userId, existing);
  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - existing.length),
    retryAfterSeconds: windowSeconds,
    source: "memory_fallback",
  };
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function isSafeUpstreamHttpsUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function createUserScopedSupabaseClient(token: string) {
  const { url, publishableKey } = resolvePublicSupabaseConfig();
  return createClient<Database>(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      fetch: (input, init) => {
        const headers = new Headers(
          typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
        );
        if (init?.headers) {
          new Headers(init.headers).forEach((value, key) => headers.set(key, value));
        }
        headers.set("apikey", publishableKey);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

async function defaultAuthenticateRequest(
  request: Request,
  nowMs: () => number,
): Promise<GriotAuthResult | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !/^Bearer\s+/i.test(authHeader)) {
    return null;
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token || token.split(".").length !== 3) {
    return null;
  }

  try {
    const userSupabase = createUserScopedSupabaseClient(token);
    const { data, error } = await userSupabase.auth.getClaims(token);
    const claims = data?.claims as { sub?: unknown; role?: unknown } | undefined;
    const sub = typeof claims?.sub === "string" ? claims.sub.trim() : "";
    const role = typeof claims?.role === "string" ? claims.role.trim().toLowerCase() : "";
    if (error || !sub || role === "anon") {
      return null;
    }

    return {
      userId: sub,
      checkRateLimit: async () => {
        try {
          const { data: rpcData, error: rpcError } = await (userSupabase as any).rpc(
            "check_server_rate_limit",
            {
              p_action: "griot_assist",
              p_limit: GRIOT_RATE_LIMIT_MAX,
              p_window_seconds: GRIOT_RATE_LIMIT_WINDOW_SECONDS,
            },
          );

          if (!rpcError && rpcData && typeof rpcData === "object" && "allowed" in rpcData) {
            const allowed = Boolean((rpcData as { allowed?: unknown }).allowed);
            const remaining = Math.max(
              0,
              Number((rpcData as { remaining?: unknown }).remaining ?? 0),
            );
            const resetAtRaw = (rpcData as { reset_at?: unknown }).reset_at;
            const resetAtMs = typeof resetAtRaw === "string" ? Date.parse(resetAtRaw) : Number.NaN;
            const retryAfterSeconds = Number.isFinite(resetAtMs)
              ? Math.max(1, Math.ceil((resetAtMs - nowMs()) / 1000))
              : GRIOT_RATE_LIMIT_WINDOW_SECONDS;
            return { allowed, remaining, retryAfterSeconds, source: "database" };
          }
        } catch {
          // Fall back to isolate-local rate limiter ONLY for zero-cost local mode (paid LLM fails closed below)
        }

        return checkInMemoryGriotRateLimit(
          sub,
          nowMs(),
          GRIOT_RATE_LIMIT_MAX,
          GRIOT_RATE_LIMIT_WINDOW_SECONDS,
        );
      },
    };
  } catch {
    return null;
  }
}

export async function handleGriotAssistRequest(
  request: Request,
  deps: GriotAssistHandlerDeps = {},
): Promise<Response> {
  const nowMs = deps.nowMs ?? (() => Date.now());
  const authenticate =
    deps.authenticateRequest ?? ((req: Request) => defaultAuthenticateRequest(req, nowMs));

  // 1. Enforce authenticated access via verified Supabase Bearer JWT
  const auth = await authenticate(request);
  if (!auth?.userId) {
    return jsonResponse({ error: "Authentication required. Sign in to use GRIOT AI." }, 401, {
      "WWW-Authenticate": 'Bearer realm="ping-griot"',
    });
  }

  // 2. Enforce per-user rate limiting BEFORE parsing or invoking upstream providers
  const rate = await auth.checkRateLimit();
  const rateLimitSource: GriotRateLimitSource = rate.source ?? "database";
  const rateHeaders: Record<string, string> = {
    "X-RateLimit-Limit": String(GRIOT_RATE_LIMIT_MAX),
    "X-RateLimit-Remaining": String(Math.max(0, rate.remaining)),
    "X-RateLimit-Mode": rateLimitSource,
  };

  if (!rate.allowed) {
    return jsonResponse(
      { error: "GRIOT AI rate limit exceeded. Please wait before trying again." },
      429,
      {
        ...rateHeaders,
        "Retry-After": String(Math.max(1, rate.retryAfterSeconds)),
      },
    );
  }

  // 3. Require explicit application/json Content-Type, body size cap, and strict JSON schema
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonResponse({ error: "Content-Type must be application/json." }, 415, rateHeaders);
  }

  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_REQUEST_BYTES) {
    return jsonResponse(
      { error: "GRIOT request payload exceeds maximum allowed size." },
      413,
      rateHeaders,
    );
  }

  let parsedBody: z.infer<typeof griotAssistBodySchema>;
  try {
    const rawText = await request.text();
    if (new TextEncoder().encode(rawText).byteLength > MAX_REQUEST_BYTES) {
      return jsonResponse(
        { error: "GRIOT request payload exceeds maximum allowed size." },
        413,
        rateHeaders,
      );
    }
    const rawJson: unknown = JSON.parse(rawText);
    parsedBody = griotAssistBodySchema.parse(rawJson);
  } catch {
    return jsonResponse({ error: "Invalid GRIOT request payload." }, 400, rateHeaders);
  }

  // 4. Optional server-side LLM proxy:
  //    - Credentials never leave the server.
  //    - Fail-closed for paid upstream LLM calls whenever centralized DB rate limiting
  //      is unavailable (prevents multi-isolate / edge PoP spend bypass).
  const env =
    deps.getEnv?.() ??
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ??
    {};
  const apiUrl = env["GRIOT_AI_API_URL"]?.trim();
  const apiKey = env["GRIOT_AI_API_KEY"]?.trim();
  const model = env["GRIOT_AI_MODEL"]?.trim() || "gpt-4o-mini";
  const fetchFn = deps.fetchUpstream ?? fetch;

  if (apiUrl && apiKey && rateLimitSource === "database" && isSafeUpstreamHttpsUrl(apiUrl)) {
    try {
      const timeoutSignal =
        typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
          ? AbortSignal.timeout(15_000)
          : null;
      const upstream = await fetchFn(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        ...(timeoutSignal ? { signal: timeoutSignal } : {}),
        body: JSON.stringify({
          model,
          temperature: 0.4,
          messages: [
            {
              role: "system",
              content:
                "You are GRIOT AI, a permission-bounded writing & structuring assistant for Ping by DOT. Operate strictly on the user-supplied text. Never claim access to private messages or confidential records. Keep responses concise, helpful, and grounded.",
            },
            {
              role: "user",
              content: `Action: ${parsedBody.action}\nTone: ${parsedBody.tone ?? "concise"}\n${parsedBody.targetLocale ? `Target Locale: ${parsedBody.targetLocale}\n` : ""}Input:\n${parsedBody.inputText}`,
            },
          ],
        }),
      });

      if (upstream.ok) {
        const json = (await upstream.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const text = json.choices?.[0]?.message?.content?.trim();
        if (text) {
          const baseline = runLocalGriotAssist({
            action: parsedBody.action,
            inputText: parsedBody.inputText,
            tone: parsedBody.tone,
            targetLocale: parsedBody.targetLocale,
          });
          return jsonResponse(
            {
              ...baseline,
              providerMode: "live_provider",
              providerNotice: `Processed via configured GRIOT server model (${model}). Only explicitly submitted text was sent.`,
              outputText: text,
              privateMessagesAccessed: false,
            },
            200,
            rateHeaders,
          );
        }
      }
    } catch {
      // Fall through cleanly to deterministic local mode without leaking upstream errors or secrets
    }
  }

  const localResult = runLocalGriotAssist({
    action: parsedBody.action,
    inputText: parsedBody.inputText,
    tone: parsedBody.tone,
    targetLocale: parsedBody.targetLocale,
  });

  if (apiUrl && apiKey && rateLimitSource !== "database") {
    localResult.providerNotice =
      "Deterministic Local Assistant active (centralized DB rate limiter unavailable; external LLM calls paused for spend safety).";
  }

  return jsonResponse({ ...localResult }, 200, rateHeaders);
}
