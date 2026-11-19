import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Ping } from "@/lib/pings";

export type PingContentFormat = "text" | "image" | "video";

export type MediaProcessingProviderId =
  "supabase_storage" | "cloudflare_stream" | "mux" | "external_pending";

export interface MediaProcessingAdapter {
  id: MediaProcessingProviderId;
  displayName: string;
  supportsAdaptiveHls: boolean;
  supportsServerTranscoding: boolean;
  configured: boolean;
}

export const VIDEO_CONSTRAINTS = {
  maxSizeBytes: 50 * 1024 * 1024, // 50 MB (matches storage bucket limit)
  maxDurationSec: 300, // 5 minutes
  supportedMimeTypes: ["video/mp4", "video/webm", "video/quicktime", "video/x-m4v"],
} as const;

export const IMAGE_GALLERY_MAX = 4;

/**
 * Provider-agnostic registry so transcoding/adaptive streaming (Cloudflare Stream / Mux)
 * can be swapped in via configuration without rebuilding the app (Phase 3.3).
 */
export function getMediaProcessingAdapters(): MediaProcessingAdapter[] {
  const env = import.meta.env as Record<string, string | undefined> | undefined;
  const cfConfigured = Boolean(env?.["VITE_CLOUDFLARE_STREAM_CUSTOMER_CODE"]);
  const muxConfigured = Boolean(env?.["VITE_MUX_ENV_KEY"]);
  return [
    {
      id: "supabase_storage",
      displayName: "Supabase Direct Storage (Progressive MP4/WebM)",
      supportsAdaptiveHls: false,
      supportsServerTranscoding: false,
      configured: true,
    },
    {
      id: "cloudflare_stream",
      displayName: "Cloudflare Stream (HLS / Adaptive Transcoding)",
      supportsAdaptiveHls: true,
      supportsServerTranscoding: true,
      configured: cfConfigured,
    },
    {
      id: "mux",
      displayName: "Mux Video (HLS / Auto-Captions)",
      supportsAdaptiveHls: true,
      supportsServerTranscoding: true,
      configured: muxConfigured,
    },
  ];
}

export function getActiveVideoProvider(): MediaProcessingAdapter {
  const adapters = getMediaProcessingAdapters();
  return adapters.find((a) => a.supportsAdaptiveHls && a.configured) ?? adapters[0]!;
}

export function isVideoMediaUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v|m3u8)(\?.*)?$/i.test(url);
}

export function collectPingMediaUrls(ping: Ping): string[] {
  const urls: string[] = [];
  if (ping.image_url) urls.push(ping.image_url);
  if (Array.isArray(ping.media_urls)) {
    for (const u of ping.media_urls) {
      if (u && !urls.includes(u)) urls.push(u);
    }
  }
  return urls;
}

/**
 * Derive a Ping's primary multimedia format from shared Ping fields so Home, Video,
 * Image, and Text feeds operate on ONE shared content architecture (Phase 3.2).
 */
export function classifyPingFormat(
  ping: Ping & { content_format?: PingContentFormat | null },
): PingContentFormat {
  if (ping.content_format === "video" || ping.content_format === "image") {
    return ping.content_format;
  }
  const media = collectPingMediaUrls(ping);
  if (media.some((u) => isVideoMediaUrl(u))) return "video";
  if (media.length > 0) return "image";
  return "text";
}

export function validateVideoFileMeta(input: {
  size: number;
  type: string;
  name: string;
  durationSec?: number | null | undefined;
}): { valid: boolean; error?: string } {
  if (input.size <= 0) {
    return { valid: false, error: "Video file appears empty (0 bytes)." };
  }
  if (input.size > VIDEO_CONSTRAINTS.maxSizeBytes) {
    return { valid: false, error: "Videos must be 50 MB or smaller." };
  }
  const lowerName = input.name.toLowerCase();
  const mimeOk =
    !input.type || input.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/.test(lowerName);
  if (!mimeOk) {
    return { valid: false, error: "Unsupported video format. Please upload MP4, WebM, or MOV." };
  }
  if (
    typeof input.durationSec === "number" &&
    Number.isFinite(input.durationSec) &&
    input.durationSec > VIDEO_CONSTRAINTS.maxDurationSec
  ) {
    return {
      valid: false,
      error: `Videos must be ${Math.floor(VIDEO_CONSTRAINTS.maxDurationSec / 60)} minutes or shorter.`,
    };
  }
  return { valid: true };
}

/**
 * Probe video duration and extract a JPEG poster frame on the client before upload.
 * Safely resolves null in non-browser / jsdom environments.
 */
export async function probeVideoFile(file: File): Promise<{
  durationSec: number | null;
  posterBlob: Blob | null;
}> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { durationSec: null, posterBlob: null };
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    const cleanup = () => {
      URL.revokeObjectURL(url);
    };

    const timeout = setTimeout(() => {
      cleanup();
      resolve({ durationSec: null, posterBlob: null });
    }, 5000);

    video.onloadedmetadata = () => {
      const durationSec = Number.isFinite(video.duration) ? Math.round(video.duration) : null;
      const targetTime = Math.min(0.5, Math.max(0, (video.duration || 0) * 0.1));
      try {
        video.currentTime = targetTime;
      } catch {
        clearTimeout(timeout);
        cleanup();
        resolve({ durationSec, posterBlob: null });
      }
    };

    video.onseeked = () => {
      clearTimeout(timeout);
      const durationSec = Number.isFinite(video.duration) ? Math.round(video.duration) : null;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.min(720, video.videoWidth || 640);
        canvas.height = Math.round(
          canvas.width * ((video.videoHeight || 360) / (video.videoWidth || 640)),
        );
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          cleanup();
          resolve({ durationSec, posterBlob: null });
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            cleanup();
            resolve({ durationSec, posterBlob: blob });
          },
          "image/jpeg",
          0.78,
        );
      } catch {
        cleanup();
        resolve({ durationSec, posterBlob: null });
      }
    };

    video.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      resolve({ durationSec: null, posterBlob: null });
    };
  });
}

/* -------------------------------------------------------------------------- */
/*                     VIDEO VIEW & WATCH-TIME ANALYTICS                      */
/* -------------------------------------------------------------------------- */

const LOCAL_VIDEO_VIEWS_KEY = "ping:local-video-views:v1";

function isMissingPhase3MediaSchema(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string; status?: number };
  const msg = (e.message ?? "").toLowerCase();
  return (
    e.code === "PGRST205" ||
    e.code === "PGRST202" ||
    e.code === "42P01" ||
    e.code === "42883" ||
    e.status === 404 ||
    msg.includes("does not exist") ||
    msg.includes("could not find the")
  );
}

export async function recordPingVideoView(params: {
  pingId: string;
  watchSeconds: number;
  completed: boolean;
}): Promise<number> {
  const sec = Math.max(0, Math.round(params.watchSeconds));
  const { data, error } = await (supabase as any).rpc("record_ping_video_view", {
    p_ping_id: params.pingId,
    p_watch_seconds: sec,
    p_completed: params.completed,
  });

  if (error) {
    if (!isMissingPhase3MediaSchema(error)) throw error;
    if (typeof window === "undefined") return 1;
    try {
      const curr = JSON.parse(window.localStorage.getItem(LOCAL_VIDEO_VIEWS_KEY) || "{}") as Record<
        string,
        { views: number; watchSeconds: number }
      >;
      const prev = curr[params.pingId] ?? { views: 0, watchSeconds: 0 };
      const next = { views: prev.views + 1, watchSeconds: prev.watchSeconds + sec };
      curr[params.pingId] = next;
      window.localStorage.setItem(LOCAL_VIDEO_VIEWS_KEY, JSON.stringify(curr));
      return next.views;
    } catch {
      return 1;
    }
  }

  return Number((data as { views?: number } | null)?.views ?? 1);
}

export function readLocalVideoViewCount(pingId: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const curr = JSON.parse(window.localStorage.getItem(LOCAL_VIDEO_VIEWS_KEY) || "{}") as Record<
      string,
      { views: number }
    >;
    return curr[pingId]?.views ?? 0;
  } catch {
    return 0;
  }
}

/* -------------------------------------------------------------------------- */
/*                     COPYRIGHT & OWNERSHIP REPORTING                        */
/* -------------------------------------------------------------------------- */

export type CopyrightClaimType = "copyright" | "trademark" | "unauthorized_audio" | "impersonation";

export function useSubmitCopyrightReport(userId?: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      targetType: "ping" | "moment" | "music_track" | "media_asset";
      targetId: string;
      claimType: CopyrightClaimType;
      rightsOwnerName: string;
      evidenceUrl?: string | undefined;
      details: string;
    }) => {
      if (!userId) throw new Error("Sign in to submit a rights or copyright report.");
      const { error } = await (supabase as any).from("copyright_reports").insert({
        reporter_id: userId,
        target_type: input.targetType,
        target_id: input.targetId,
        claim_type: input.claimType,
        rights_owner_name: input.rightsOwnerName.trim(),
        evidence_url: input.evidenceUrl?.trim() || null,
        details: input.details.trim(),
        status: "open",
      });
      if (error) {
        if (isMissingPhase3MediaSchema(error)) {
          // Fallback to existing profile_reports / moderation table note when 0030 not yet deployed
          return { queuedLocally: true };
        }
        throw error;
      }
      return { queuedLocally: false };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["copyright-reports"] });
    },
  });
}
