import { supabase } from "@/integrations/supabase/client";
import { siteUrl } from "@/lib/site";

export type ShareTargetType =
  "ping" | "moment" | "hub" | "signal" | "profile" | "opportunity" | "business";

export type ShareDestinationId =
  | "native_share"
  | "copy_link"
  | "download_card"
  | "whatsapp"
  | "instagram"
  | "snapchat"
  | "x"
  | "facebook"
  | "telegram"
  | "linkedin"
  | "email"
  | "sms"
  | "hub"
  | "unknown";

export type ShareEventKind =
  | "share_initiated"
  | "link_clicked"
  | "preview_impression"
  | "signup_attributed"
  | "post_referral_engagement";

export interface UniversalSharePayload {
  targetType: ShareTargetType;
  targetId: string;
  title: string;
  description: string;
  path: string;
  shareCode?: string | undefined;
}

export interface PlatformShareDestination {
  id: ShareDestinationId;
  label: string;
  mode: "direct_url" | "card_or_sheet_fallback";
  href?: string | undefined;
  restrictionNote?: string | undefined;
}

const REFERRAL_STORAGE_KEY = "ping:referral-attribution:v1";
const LOCAL_SHARE_ANALYTICS_KEY = "ping:local-share-analytics:v1";

export function generateShareCode(targetType: ShareTargetType, targetId: string): string {
  const cleanId = targetId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "item";
  return `${targetType.slice(0, 2)}_${cleanId}`;
}

export function buildAttributedShareUrl(path: string, shareCode?: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const base = siteUrl(normalizedPath);
  if (!shareCode) return base;
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}ref=${encodeURIComponent(shareCode)}`;
}

/**
 * Build honest platform-specific share destinations (Phase 3.5 & 3.8).
 * Platforms that do NOT expose direct web auto-publishing APIs (Instagram, Snapchat)
 * explicitly use `card_or_sheet_fallback` with clear guidance — never claiming silent posting.
 */
export function buildShareDestinations(payload: UniversalSharePayload): {
  url: string;
  destinations: PlatformShareDestination[];
} {
  const code = payload.shareCode ?? generateShareCode(payload.targetType, payload.targetId);
  const url = buildAttributedShareUrl(payload.path, code);
  const text = `${payload.title} — ${payload.description}`.slice(0, 220);
  const combined = `${text}\n${url}`;

  const destinations: PlatformShareDestination[] = [
    {
      id: "whatsapp",
      label: "WhatsApp",
      mode: "direct_url",
      href: `https://wa.me/?text=${encodeURIComponent(combined)}`,
    },
    {
      id: "x",
      label: "X",
      mode: "direct_url",
      href: `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
    },
    {
      id: "telegram",
      label: "Telegram",
      mode: "direct_url",
      href: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
    },
    {
      id: "facebook",
      label: "Facebook",
      mode: "direct_url",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    },
    {
      id: "linkedin",
      label: "LinkedIn",
      mode: "direct_url",
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
    },
    {
      id: "email",
      label: "Email",
      mode: "direct_url",
      href: `mailto:?subject=${encodeURIComponent(payload.title)}&body=${encodeURIComponent(combined)}`,
    },
    {
      id: "sms",
      label: "SMS",
      mode: "direct_url",
      href: `sms:?&body=${encodeURIComponent(combined)}`,
    },
    {
      id: "instagram",
      label: "Instagram",
      mode: "card_or_sheet_fallback",
      restrictionNote:
        "Instagram does not permit direct web auto-posting. Share the branded Ping Card via your device Share Sheet or paste the copied link in Stories/DMs.",
    },
    {
      id: "snapchat",
      label: "Snapchat",
      mode: "card_or_sheet_fallback",
      restrictionNote:
        "Snapchat restricts direct web publishing. Use the Share Sheet with the Ping Card image or paste the link in Snapchat.",
    },
  ];

  return { url, destinations };
}

function isMissingShareEventsSchema(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string; status?: number };
  const msg = (e.message ?? "").toLowerCase();
  return (
    e.code === "PGRST205" ||
    e.code === "PGRST202" ||
    e.code === "42P01" ||
    e.code === "42883" ||
    e.status === 404 ||
    msg.includes("share_events") ||
    msg.includes("record_share_event") ||
    msg.includes("does not exist")
  );
}

/**
 * Record honest share analytics (shares initiated, link clicks, attributed signups).
 * Never claims an external platform share completed when that app does not report back (Phase 3.10).
 */
export async function recordShareEvent(params: {
  targetType: ShareTargetType;
  targetId: string;
  eventKind: ShareEventKind;
  destination?: ShareDestinationId | undefined;
  shareCode?: string | undefined;
  referrerDomain?: string | undefined;
}): Promise<void> {
  const destination = params.destination ?? "unknown";
  const referrerDomain =
    params.referrerDomain ??
    (typeof document !== "undefined" && document.referrer
      ? (() => {
          try {
            return new URL(document.referrer).hostname.replace(/^www\./, "");
          } catch {
            return undefined;
          }
        })()
      : undefined);

  // Local mirror for immediate counter feedback
  if (typeof window !== "undefined") {
    try {
      const store = JSON.parse(
        window.localStorage.getItem(LOCAL_SHARE_ANALYTICS_KEY) || "{}",
      ) as Record<string, { initiated: number; clicks: number }>;
      const key = `${params.targetType}:${params.targetId}`;
      const curr = store[key] ?? { initiated: 0, clicks: 0 };
      if (params.eventKind === "share_initiated") curr.initiated += 1;
      if (params.eventKind === "link_clicked") curr.clicks += 1;
      store[key] = curr;
      window.localStorage.setItem(LOCAL_SHARE_ANALYTICS_KEY, JSON.stringify(store));
    } catch {
      // ignore storage errors
    }
  }

  const { error } = await (supabase as any).rpc("record_share_event", {
    p_target_type: params.targetType,
    p_target_id: params.targetId,
    p_event_kind: params.eventKind,
    p_destination: destination,
    p_share_code: params.shareCode ?? null,
    p_referrer_domain: referrerDomain ?? null,
  });

  if (error && !isMissingShareEventsSchema(error)) {
    throw error;
  }
}

export function readLocalShareCounts(
  targetType: ShareTargetType,
  targetId: string,
): { initiated: number; clicks: number } {
  if (typeof window === "undefined") return { initiated: 0, clicks: 0 };
  try {
    const store = JSON.parse(
      window.localStorage.getItem(LOCAL_SHARE_ANALYTICS_KEY) || "{}",
    ) as Record<string, { initiated: number; clicks: number }>;
    return store[`${targetType}:${targetId}`] ?? { initiated: 0, clicks: 0 };
  } catch {
    return { initiated: 0, clicks: 0 };
  }
}

/**
 * Capture inbound `?ref=` referral attribution on landing without overwriting existing destination (Phase 3.7).
 */
export function captureInboundReferral(searchStr: string, pathname: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(searchStr);
    const ref = params.get("ref")?.trim();
    if (!ref || ref.length > 64) return null;
    window.sessionStorage.setItem(
      REFERRAL_STORAGE_KEY,
      JSON.stringify({ ref, landingPath: pathname, capturedAt: new Date().toISOString() }),
    );
    return ref;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*                CROSS-PLATFORM SHARE IMPORT PARSER (Phase 3.9)              */
/* -------------------------------------------------------------------------- */

export interface ImportedShareReference {
  url: string;
  hostname: string;
  platform: "x" | "youtube" | "instagram" | "snapchat" | "whatsapp" | "linkedin" | "tiktok" | "web";
  platformLabel: string;
  title: string;
  note: string;
  attributionNotice: string;
}

export function parseExternalShareImport(input: {
  url?: string | undefined;
  title?: string | undefined;
  text?: string | undefined;
}): ImportedShareReference | null {
  let candidateUrl = (input.url ?? "").trim();
  const rawText = (input.text ?? "").trim();

  // Extract URL from text payload if OS share sheet placed link inside text
  if (!candidateUrl && rawText) {
    const match = rawText.match(/https?:\/\/[^\s]+/i);
    if (match?.[0]) candidateUrl = match[0];
  }
  if (!candidateUrl) return null;

  let parsed: URL;
  try {
    parsed = new URL(candidateUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  let platform: ImportedShareReference["platform"] = "web";
  let platformLabel = "Web Article / Link";

  if (host === "x.com" || host === "twitter.com" || host.endsWith(".twitter.com")) {
    platform = "x";
    platformLabel = "X (Twitter)";
  } else if (host === "youtu.be" || host.includes("youtube.com")) {
    platform = "youtube";
    platformLabel = "YouTube";
  } else if (host.includes("instagram.com")) {
    platform = "instagram";
    platformLabel = "Instagram";
  } else if (host.includes("snapchat.com")) {
    platform = "snapchat";
    platformLabel = "Snapchat";
  } else if (host.includes("whatsapp.com") || host === "wa.me") {
    platform = "whatsapp";
    platformLabel = "WhatsApp";
  } else if (host.includes("linkedin.com")) {
    platform = "linkedin";
    platformLabel = "LinkedIn";
  } else if (host.includes("tiktok.com")) {
    platform = "tiktok";
    platformLabel = "TikTok";
  }

  const cleanNote = rawText.replace(candidateUrl, "").trim();
  const title = (input.title ?? "").trim() || `Shared from ${platformLabel}`;

  return {
    url: parsed.toString(),
    hostname: host,
    platform,
    platformLabel,
    title,
    note: cleanNote,
    attributionNotice: `External reference preserved from ${platformLabel} (${host}). Original media is linked, not copied without permission.`,
  };
}
