/**
 * GRIOT AI — Permission-Bounded Contextual Intelligence Layer (Phase 5.1)
 *
 * Product Layer Separation & Privacy Invariants:
 * - GRIOT AI is strictly separate from Ping core, DOT credits, and Avantage.
 * - Opt-in ONLY (`enabled: false` by default).
 * - NEVER silently reads private direct messages (`private_messages`), Close Circle
 *   Moments, or private business notes (`allow_private_messages_access` is hard-locked
 *   to `false` in TypeScript and enforced via SQL CHECK in migration `0032`).
 * - Provider-agnostic: calls `/api/griot/assist` when an external LLM provider is
 *   configured server-side, and falls back transparently to deterministic local
 *   structuring tools without fabricating live LLM capabilities.
 */

import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { extractHashtags } from "@/lib/social";
import { sanitizeUserText } from "@/lib/shield";
import type { Category } from "@/lib/validation";

export type GriotTone = "concise" | "professional" | "warm" | "structured";

export type GriotActionType =
  | "draft_ping"
  | "clarity_audit"
  | "hashtag_suggest"
  | "opportunity_pitch"
  | "business_reply_draft"
  | "thread_summary"
  | "translation_prep";

export type GriotProviderMode = "deterministic_local" | "live_provider";

export interface GriotPreferences {
  user_id: string;
  enabled: boolean;
  allow_public_profile_context: boolean;
  allow_ping_composer_assist: boolean;
  allow_opportunity_matching: boolean;
  allow_business_reply_drafts: boolean;
  /** Architectural invariant: GRIOT never accesses private direct messages. */
  readonly allow_private_messages_access: false;
  preferred_tone: GriotTone;
  updated_at: string;
}

export interface GriotAuditEntry {
  id: string;
  user_id: string;
  action_type: GriotActionType;
  provider_mode: GriotProviderMode;
  source_surface: string;
  input_char_count: number;
  readonly private_messages_accessed: false;
  created_at: string;
}

export interface GriotAssistRequest {
  action: GriotActionType;
  inputText: string;
  tone?: GriotTone | undefined;
  category?: Category | undefined;
  targetLocale?: string | undefined;
  sourceSurface?: string | undefined;
}

export interface GriotAssistResult {
  action: GriotActionType;
  providerMode: GriotProviderMode;
  providerNotice: string;
  outputText: string;
  suggestedHeadline?: string;
  suggestedHashtags: string[];
  clarityScore?: number;
  suggestions: string[];
  privateMessagesAccessed: false;
}

const LOCAL_PREFS_KEY = "ping_griot_prefs_v5";
const LOCAL_AUDIT_KEY = "ping_griot_audit_v5";

export function createDefaultGriotPreferences(userId: string): GriotPreferences {
  return {
    user_id: userId,
    enabled: false,
    allow_public_profile_context: false,
    allow_ping_composer_assist: false,
    allow_opportunity_matching: false,
    allow_business_reply_drafts: false,
    allow_private_messages_access: false,
    preferred_tone: "concise",
    updated_at: new Date().toISOString(),
  };
}

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
    // Ignore storage limits in restricted browsers
  }
}

/**
 * Reports whether an external GRIOT LLM provider is configured.
 * Live model credentials live exclusively on the server (never exposed to browser bundles).
 */
export function getGriotProviderStatus(): {
  liveProviderConfigured: boolean;
  activeMode: GriotProviderMode;
  privacyGuarantee: string;
} {
  const env = import.meta.env as Record<string, string | undefined> | undefined;
  const liveConfigured = env?.["VITE_GRIOT_PROVIDER_ACTIVE"] === "true";
  return {
    liveProviderConfigured: liveConfigured,
    activeMode: liveConfigured ? "live_provider" : "deterministic_local",
    privacyGuarantee:
      "GRIOT AI is strictly opt-in and never silently reads private direct messages, Close Circle Moments, or internal business notes.",
  };
}

const TOPIC_KEYWORDS: Array<{ keyword: RegExp; tag: string }> = [
  { keyword: /\b(solar|energy|climate|grid|green|clean)\b/i, tag: "cleanenergy" },
  { keyword: /\b(fintech|payment|paystack|wallet|banking|finance)\b/i, tag: "fintech" },
  { keyword: /\b(startup|founder|mvp|launch|ship|product)\b/i, tag: "buildinpublic" },
  { keyword: /\b(design|ui|ux|brand|figma|creative)\b/i, tag: "design" },
  { keyword: /\b(ai|ml|llm|agent|data|analytics)\b/i, tag: "ai" },
  { keyword: /\b(job|hiring|role|grant|fellowship|scholarship|fund)\b/i, tag: "opportunities" },
  { keyword: /\b(africa|lagos|nairobi|accra|cape town|cairo|kigali)\b/i, tag: "africatech" },
  { keyword: /\b(developer|api|sdk|webhook|open source|code)\b/i, tag: "developers" },
  { keyword: /\b(music|audio|video|film|creator|podcast)\b/i, tag: "creators" },
  { keyword: /\b(business|sme|commerce|store|customer|lead)\b/i, tag: "business" },
];

export function suggestHashtagsFromText(text: string): string[] {
  const existing = extractHashtags(text);
  const found = new Set<string>(existing);
  for (const rule of TOPIC_KEYWORDS) {
    if (rule.keyword.test(text)) {
      found.add(rule.tag);
    }
    if (found.size >= 5) break;
  }
  if (found.size === 0 && text.trim().length > 0) {
    found.add("ping");
  }
  return Array.from(found).slice(0, 5);
}

/**
 * Deterministic local GRIOT assistant engine.
 * Transparently executes locally with zero fabricated LLM claims and zero private-DM access.
 */
export function runLocalGriotAssist(req: GriotAssistRequest): GriotAssistResult {
  const clean = sanitizeUserText(req.inputText).slice(0, 4000);
  const tone = req.tone ?? "concise";
  const tags = suggestHashtagsFromText(clean);
  const providerNotice =
    "Deterministic Local Assistant active (no external AI provider credentials provisioned). Only the text you explicitly pasted below was processed.";

  if (!clean) {
    return {
      action: req.action,
      providerMode: "deterministic_local",
      providerNotice,
      outputText: "",
      suggestedHashtags: [],
      clarityScore: 0,
      suggestions: ["Paste or write a few words first so GRIOT can structure or review them."],
      privateMessagesAccessed: false,
    };
  }

  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const firstSentence = sentences[0] ?? clean;
  const suggestedHeadline =
    firstSentence.length > 78 ? `${firstSentence.slice(0, 75).trim()}…` : firstSentence;

  if (req.action === "clarity_audit") {
    const words = clean.split(/\s+/).filter(Boolean);
    const hasQuestionOrAsk = /\?|looking for|need|seeking|apply|join|dm|reach out/i.test(clean);
    const hasConcreteDetail = /\d+|http|@|#|\b(in|by|for|with)\b/i.test(clean);
    const isOverlong = clean.length > 600;
    const isAllCaps = clean.length > 20 && clean === clean.toUpperCase();

    let score = 55;
    if (words.length >= 12) score += 15;
    if (hasQuestionOrAsk) score += 15;
    if (hasConcreteDetail) score += 15;
    if (isOverlong) score -= 10;
    if (isAllCaps) score -= 20;
    score = Math.max(10, Math.min(100, score));

    const suggestions: string[] = [];
    if (!hasQuestionOrAsk) {
      suggestions.push(
        "Add a clear call to action or specific ask so readers know how to collaborate.",
      );
    }
    if (!hasConcreteDetail) {
      suggestions.push("Include concrete scope (timeline, city/region, or measurable milestone).");
    }
    if (isOverlong) {
      suggestions.push(
        "Trim to under 500 characters or break into bullet points for mobile readability.",
      );
    }
    if (isAllCaps) {
      suggestions.push("Switch from ALL CAPS to sentence case to avoid engagement-bait damping.");
    }
    if (tags.length > 0 && extractHashtags(clean).length === 0) {
      suggestions.push(
        `Consider adding 1–3 relevant topics: ${tags.map((t) => `#${t}`).join(" ")}`,
      );
    }
    if (suggestions.length === 0) {
      suggestions.push("Clear, structured, and easy to act on — ready to publish.");
    }

    return {
      action: req.action,
      providerMode: "deterministic_local",
      providerNotice,
      outputText: clean,
      suggestedHeadline,
      suggestedHashtags: tags,
      clarityScore: score,
      suggestions,
      privateMessagesAccessed: false,
    };
  }

  if (req.action === "hashtag_suggest") {
    return {
      action: req.action,
      providerMode: "deterministic_local",
      providerNotice,
      outputText: `${clean}\n\n${tags.map((t) => `#${t}`).join(" ")}`,
      suggestedHashtags: tags,
      suggestions: [
        "Use 2–4 specific hashtags so your Ping reaches followed-topic feeds without looking spammy.",
      ],
      privateMessagesAccessed: false,
    };
  }

  if (req.action === "opportunity_pitch") {
    const bulletBody = sentences
      .slice(0, 3)
      .map((s) => `• ${s}`)
      .join("\n");
    const outputText = [
      `Opportunity Summary: ${suggestedHeadline}`,
      "",
      bulletBody || `• ${clean}`,
      "",
      "How to respond: Reply in thread or send a structured application via Ping Signals.",
    ].join("\n");
    return {
      action: req.action,
      providerMode: "deterministic_local",
      providerNotice,
      outputText,
      suggestedHeadline,
      suggestedHashtags: tags,
      suggestions: [
        "Specify eligibility criteria, location/remote policy, and closing deadline before publishing.",
      ],
      privateMessagesAccessed: false,
    };
  }

  if (req.action === "business_reply_draft") {
    const greeting =
      tone === "professional"
        ? "Hello — thank you for contacting our team on Ping."
        : tone === "warm"
          ? "Hi there! Thanks so much for reaching out to us on Ping."
          : "Thanks for reaching out!";
    const outputText = [
      greeting,
      "",
      `Regarding your request: "${firstSentence.slice(0, 140)}"`,
      "We have reviewed your note and can confirm next steps and availability today. Please reply with your preferred timeline or any extra specifications so we can finalise.",
    ].join("\n");
    return {
      action: req.action,
      providerMode: "deterministic_local",
      providerNotice,
      outputText,
      suggestedHashtags: [],
      suggestions: [
        "Review pricing, dates, and fulfillment details before sending — GRIOT never auto-sends customer replies.",
      ],
      privateMessagesAccessed: false,
    };
  }

  if (req.action === "thread_summary") {
    const keyPoints = sentences.slice(0, 3).map((s, idx) => `${idx + 1}. ${s}`);
    return {
      action: req.action,
      providerMode: "deterministic_local",
      providerNotice,
      outputText: `Key Takeaways:\n${keyPoints.join("\n")}`,
      suggestedHashtags: tags,
      suggestions: [
        "Summary generated strictly from the text provided above; private chats are excluded.",
      ],
      privateMessagesAccessed: false,
    };
  }

  if (req.action === "translation_prep") {
    const localeLabel = req.targetLocale || "fr";
    return {
      action: req.action,
      providerMode: "deterministic_local",
      providerNotice,
      outputText: `[Localisation Brief -> ${localeLabel.toUpperCase()}]\nSource (${clean.length} chars):\n${clean}\n\nPreserved entities: ${tags.map((t) => `#${t}`).join(", ") || "none"}`,
      suggestedHashtags: tags,
      suggestions: [
        "Connect an approved translation/LLM provider key on the server to enable neural cross-language translation.",
      ],
      privateMessagesAccessed: false,
    };
  }

  // Default: draft_ping
  const prefix =
    tone === "structured" ? `Update — ${suggestedHeadline}\n\n` : tone === "professional" ? "" : "";
  const formattedBody =
    tone === "structured" && sentences.length > 1
      ? sentences.map((s) => `• ${s}`).join("\n")
      : clean;
  const tagLine =
    tags.length > 0
      ? `\n\n${tags
          .slice(0, 3)
          .map((t) => `#${t}`)
          .join(" ")}`
      : "";

  return {
    action: "draft_ping",
    providerMode: "deterministic_local",
    providerNotice,
    outputText: `${prefix}${formattedBody}${tagLine}`.trim(),
    suggestedHeadline,
    suggestedHashtags: tags,
    suggestions: [
      "Always review AI-assisted drafts before publishing so your voice stays authentic.",
    ],
    privateMessagesAccessed: false,
  };
}

/**
 * Executes GRIOT assistance: tries the server endpoint `/api/griot/assist` first when live
 * provider mode is enabled, and otherwise runs the deterministic local engine cleanly.
 */
export async function executeGriotAssist(
  req: GriotAssistRequest,
  userId?: string | null,
): Promise<GriotAssistResult> {
  let result: GriotAssistResult | null = null;
  const status = getGriotProviderStatus();

  if (status.liveProviderConfigured && typeof fetch === "function") {
    try {
      const resp = await fetch("/api/griot/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: req.action,
          inputText: req.inputText,
          tone: req.tone ?? "concise",
          targetLocale: req.targetLocale,
        }),
      });
      if (resp.ok) {
        const json = (await resp.json()) as GriotAssistResult;
        result = { ...json, privateMessagesAccessed: false };
      }
    } catch {
      // Fall back transparently to local deterministic structuring
    }
  }

  if (!result) {
    result = runLocalGriotAssist(req);
  }

  if (userId) {
    void recordGriotAuditEntry(userId, {
      action_type: req.action,
      provider_mode: result.providerMode,
      source_surface: req.sourceSurface ?? "griot_workspace",
      input_char_count: req.inputText.length,
    });
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/*                      SUPABASE PERSISTENCE & AUDIT LOGS                     */
/* -------------------------------------------------------------------------- */

export function griotPreferencesQuery(userId?: string) {
  return queryOptions({
    queryKey: ["griot-preferences", userId],
    enabled: Boolean(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<GriotPreferences> => {
      if (!userId) return createDefaultGriotPreferences("");
      const { data, error } = await (supabase as any)
        .from("griot_ai_preferences")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        if (!isMissingPhase5Schema(error)) throw error;
        const localMap = readLocal<Record<string, GriotPreferences>>(LOCAL_PREFS_KEY, {});
        return localMap[userId] ?? createDefaultGriotPreferences(userId);
      }

      if (!data) {
        const localMap = readLocal<Record<string, GriotPreferences>>(LOCAL_PREFS_KEY, {});
        return localMap[userId] ?? createDefaultGriotPreferences(userId);
      }
      return { ...(data as GriotPreferences), allow_private_messages_access: false };
    },
  });
}

export function useUpdateGriotPreferences(userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      patch: Partial<Omit<GriotPreferences, "user_id" | "allow_private_messages_access">>,
    ): Promise<GriotPreferences> => {
      if (!userId) throw new Error("Sign in to configure GRIOT AI preferences.");
      const existing =
        qc.getQueryData<GriotPreferences>(["griot-preferences", userId]) ??
        createDefaultGriotPreferences(userId);

      const next: GriotPreferences = {
        ...existing,
        ...patch,
        user_id: userId,
        allow_private_messages_access: false,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await (supabase as any)
        .from("griot_ai_preferences")
        .upsert(
          {
            user_id: next.user_id,
            enabled: next.enabled,
            allow_public_profile_context: next.allow_public_profile_context,
            allow_ping_composer_assist: next.allow_ping_composer_assist,
            allow_opportunity_matching: next.allow_opportunity_matching,
            allow_business_reply_drafts: next.allow_business_reply_drafts,
            allow_private_messages_access: false,
            preferred_tone: next.preferred_tone,
            consent_updated_at: next.updated_at,
            updated_at: next.updated_at,
          },
          { onConflict: "user_id" },
        )
        .select("*")
        .single();

      if (error) {
        if (!isMissingPhase5Schema(error)) throw error;
        const localMap = readLocal<Record<string, GriotPreferences>>(LOCAL_PREFS_KEY, {});
        localMap[userId] = next;
        writeLocal(LOCAL_PREFS_KEY, localMap);
        return next;
      }

      return { ...(data as GriotPreferences), allow_private_messages_access: false };
    },
    onSuccess: (saved) => {
      if (userId) {
        qc.setQueryData(["griot-preferences", userId], saved);
      }
    },
  });
}

export function griotAuditLogsQuery(userId?: string) {
  return queryOptions({
    queryKey: ["griot-audit-logs", userId],
    enabled: Boolean(userId),
    staleTime: 15_000,
    queryFn: async (): Promise<GriotAuditEntry[]> => {
      if (!userId) return [];
      const { data, error } = await (supabase as any)
        .from("griot_audit_logs")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(30);

      if (error) {
        if (!isMissingPhase5Schema(error)) throw error;
        return readLocal<GriotAuditEntry[]>(LOCAL_AUDIT_KEY, []).filter(
          (e) => e.user_id === userId,
        );
      }
      return (data ?? []) as GriotAuditEntry[];
    },
  });
}

async function recordGriotAuditEntry(
  userId: string,
  entry: {
    action_type: GriotActionType;
    provider_mode: GriotProviderMode;
    source_surface: string;
    input_char_count: number;
  },
): Promise<void> {
  const payload = {
    user_id: userId,
    action_type: entry.action_type,
    provider_mode: entry.provider_mode,
    source_surface: entry.source_surface.slice(0, 60),
    input_char_count: Math.max(0, Math.min(20000, Math.round(entry.input_char_count))),
    private_messages_accessed: false as const,
  };

  const { error } = await (supabase as any).from("griot_audit_logs").insert(payload);
  if (error && isMissingPhase5Schema(error)) {
    const existing = readLocal<GriotAuditEntry[]>(LOCAL_AUDIT_KEY, []);
    const localEntry: GriotAuditEntry = {
      id: `griot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ...payload,
      created_at: new Date().toISOString(),
    };
    writeLocal(LOCAL_AUDIT_KEY, [localEntry, ...existing].slice(0, 50));
  }
}
