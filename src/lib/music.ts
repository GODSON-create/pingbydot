import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type MusicLicenseStatus =
  "original_user" | "licensed_catalog" | "rights_pending" | "taken_down";

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  duration_sec: number;
  preview_url: string | null;
  license_status: MusicLicenseStatus;
  provider: string;
  available_regions: string[];
  attribution: string;
  mood?: string | undefined;
}

export interface ContentMusicAttachment {
  id?: string | undefined;
  target_type: "ping" | "moment";
  target_id: string;
  track_id: string;
  track_title: string;
  track_artist: string;
  preview_url: string | null;
  clip_start_sec: number;
  clip_duration_sec: number;
  attribution_text: string;
  license_status: MusicLicenseStatus;
  available_regions: string[];
}

export interface MusicCatalogStatus {
  commercialCatalogActive: boolean;
  providerName: string;
  originalAudioUploadsEnabled: boolean;
  notice: string;
}

/**
 * Commercial licensed catalog remains gated until rights agreements & provider credentials
 * are confirmed. Original creator audio (with ownership declaration) & Ping Royalty-Free
 * starter stems work immediately with full attribution (Phase 3.4).
 */
export function getMusicCatalogStatus(): MusicCatalogStatus {
  const env = import.meta.env as Record<string, string | undefined> | undefined;
  const provider = env?.["VITE_LICENSED_MUSIC_PROVIDER"] || "";
  const active = Boolean(provider && env?.["VITE_LICENSED_MUSIC_API_KEY"]);
  return {
    commercialCatalogActive: active,
    providerName: active ? provider : "Unconfigured (Pending Licensing Agreement)",
    originalAudioUploadsEnabled: true,
    notice: active
      ? `Licensed commercial catalog powered by ${provider}.`
      : "Commercial licensed catalog is pending rights provider activation. You can attach Ping Royalty-Free stems or upload original audio with an ownership declaration.",
  };
}

/**
 * Zero scraped or copyrighted commercial music.
 * Starter tracks are Ping-owned / CC0 synthetic ambient stems with explicit attribution.
 */
export const PING_ORIGINAL_AUDIO_LIBRARY: readonly MusicTrack[] = [
  {
    id: "ping-stem-horizon-pulse",
    title: "Horizon Pulse (Ambient)",
    artist: "Ping Studio Originals",
    duration_sec: 45,
    preview_url: null,
    license_status: "original_user",
    provider: "ping_originals_cc0",
    available_regions: ["GLOBAL"],
    attribution: "Ping Studio Originals · CC0 Royalty-Free",
    mood: "Focus",
  },
  {
    id: "ping-stem-lagos-sunrise",
    title: "Lagos Sunrise Groove",
    artist: "Ping Studio Originals",
    duration_sec: 60,
    preview_url: null,
    license_status: "original_user",
    provider: "ping_originals_cc0",
    available_regions: ["GLOBAL"],
    attribution: "Ping Studio Originals · CC0 Royalty-Free",
    mood: "Upbeat",
  },
  {
    id: "ping-stem-builder-flow",
    title: "Builder Flow (Lo-Fi)",
    artist: "Ping Studio Originals",
    duration_sec: 90,
    preview_url: null,
    license_status: "original_user",
    provider: "ping_originals_cc0",
    available_regions: ["GLOBAL"],
    attribution: "Ping Studio Originals · CC0 Royalty-Free",
    mood: "Chill",
  },
  {
    id: "ping-stem-launch-momentum",
    title: "Launch Momentum",
    artist: "Ping Studio Originals",
    duration_sec: 40,
    preview_url: null,
    license_status: "original_user",
    provider: "ping_originals_cc0",
    available_regions: ["GLOBAL"],
    attribution: "Ping Studio Originals · CC0 Royalty-Free",
    mood: "Energetic",
  },
  {
    id: "ping-stem-warm-keys",
    title: "Warm Rhodes Reflections",
    artist: "Ping Studio Originals",
    duration_sec: 75,
    preview_url: null,
    license_status: "original_user",
    provider: "ping_originals_cc0",
    available_regions: ["GLOBAL"],
    attribution: "Ping Studio Originals · CC0 Royalty-Free",
    mood: "Storytelling",
  },
] as const;

export function isTrackAvailableForViewer(
  attachment: Pick<ContentMusicAttachment, "license_status" | "available_regions">,
  viewerRegion = "GLOBAL",
): { available: boolean; reason?: string } {
  if (attachment.license_status === "taken_down") {
    return {
      available: false,
      reason: "Audio unavailable due to a copyright or rights takedown.",
    };
  }
  if (attachment.license_status === "rights_pending") {
    return {
      available: false,
      reason: "Audio playback is pending rights clearance in your region.",
    };
  }
  const regions = attachment.available_regions ?? ["GLOBAL"];
  if (!regions.includes("GLOBAL") && !regions.includes(viewerRegion.toUpperCase())) {
    return {
      available: false,
      reason: "This audio track is not currently licensed in your region.",
    };
  }
  return { available: true };
}

const LOCAL_MUSIC_ATTACHMENTS_KEY = "ping:content-music-attachments:v1";

function isMissingMusicSchema(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string; status?: number };
  const msg = (e.message ?? "").toLowerCase();
  return (
    e.code === "PGRST205" ||
    e.code === "42P01" ||
    e.status === 404 ||
    msg.includes("music_tracks") ||
    msg.includes("content_music_attachments") ||
    msg.includes("does not exist")
  );
}

function readLocalAttachments(): Record<string, ContentMusicAttachment> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LOCAL_MUSIC_ATTACHMENTS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ContentMusicAttachment>) : {};
  } catch {
    return {};
  }
}

function writeLocalAttachments(map: Record<string, ContentMusicAttachment>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_MUSIC_ATTACHMENTS_KEY, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
}

export function searchMusicTracks(query: string, extraTracks: MusicTrack[] = []): MusicTrack[] {
  const combined = [...extraTracks, ...PING_ORIGINAL_AUDIO_LIBRARY].filter(
    (t) => t.license_status === "original_user" || t.license_status === "licensed_catalog",
  );
  const term = query.trim().toLowerCase();
  if (!term) return combined;
  return combined.filter(
    (t) =>
      t.title.toLowerCase().includes(term) ||
      t.artist.toLowerCase().includes(term) ||
      (t.mood ?? "").toLowerCase().includes(term),
  );
}

export function musicCatalogQuery(search = "") {
  return {
    queryKey: ["music-catalog", search],
    staleTime: 60_000,
    queryFn: async (): Promise<MusicTrack[]> => {
      const { data, error } = await (supabase as any)
        .from("music_tracks")
        .select(
          "id, title, artist, duration_sec, preview_url, license_status, provider, available_regions",
        )
        .in("license_status", ["original_user", "licensed_catalog"])
        .order("created_at", { ascending: false })
        .limit(40);

      if (error) {
        if (!isMissingMusicSchema(error)) throw error;
        return searchMusicTracks(search);
      }

      const dbTracks: MusicTrack[] = ((data ?? []) as any[]).map((row) => ({
        id: row.id,
        title: row.title,
        artist: row.artist,
        duration_sec: row.duration_sec,
        preview_url: row.preview_url,
        license_status: row.license_status as MusicLicenseStatus,
        provider: row.provider,
        available_regions: Array.isArray(row.available_regions)
          ? row.available_regions
          : ["GLOBAL"],
        attribution:
          row.license_status === "original_user"
            ? `Original Audio by ${row.artist}`
            : `Licensed via ${row.provider}`,
      }));

      return searchMusicTracks(search, dbTracks);
    },
  };
}

export async function attachMusicToContent(params: {
  userId: string;
  targetType: "ping" | "moment";
  targetId: string;
  track: MusicTrack;
  clipStartSec: number;
  clipDurationSec: number;
}): Promise<ContentMusicAttachment> {
  const payload: ContentMusicAttachment = {
    target_type: params.targetType,
    target_id: params.targetId,
    track_id: params.track.id,
    track_title: params.track.title,
    track_artist: params.track.artist,
    preview_url: params.track.preview_url,
    clip_start_sec: Math.max(0, Math.round(params.clipStartSec)),
    clip_duration_sec: Math.max(5, Math.min(180, Math.round(params.clipDurationSec))),
    attribution_text: params.track.attribution,
    license_status: params.track.license_status,
    available_regions: params.track.available_regions,
  };

  const { data, error } = await (supabase as any)
    .from("content_music_attachments")
    .upsert(
      {
        ...payload,
        created_by: params.userId,
      },
      { onConflict: "target_type,target_id" },
    )
    .select("*")
    .single();

  if (error) {
    if (!isMissingMusicSchema(error)) throw error;
    const all = readLocalAttachments();
    all[`${params.targetType}:${params.targetId}`] = payload;
    writeLocalAttachments(all);
    return payload;
  }

  return data as ContentMusicAttachment;
}

export function contentMusicAttachmentQuery(targetType: "ping" | "moment", targetId?: string) {
  return {
    queryKey: ["content-music-attachment", targetType, targetId],
    enabled: Boolean(targetId),
    staleTime: 60_000,
    queryFn: async (): Promise<ContentMusicAttachment | null> => {
      if (!targetId) return null;
      const { data, error } = await (supabase as any)
        .from("content_music_attachments")
        .select(
          "id, target_type, target_id, track_id, track_title, track_artist, preview_url, clip_start_sec, clip_duration_sec, attribution_text, license_status, available_regions",
        )
        .eq("target_type", targetType)
        .eq("target_id", targetId)
        .maybeSingle();

      if (error) {
        if (!isMissingMusicSchema(error)) throw error;
        return readLocalAttachments()[`${targetType}:${targetId}`] ?? null;
      }

      return (data as ContentMusicAttachment | null) ?? null;
    },
  };
}

export function useRegisterOriginalAudioTrack(userId?: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      title: string;
      artist: string;
      durationSec: number;
      previewUrl: string;
      ownershipDeclared: boolean;
    }): Promise<MusicTrack> => {
      if (!userId) throw new Error("Sign in to upload original audio.");
      if (!input.ownershipDeclared) {
        throw new Error(
          "You must confirm you own or hold commercial rights to this audio before uploading.",
        );
      }

      const { data, error } = await (supabase as any)
        .from("music_tracks")
        .insert({
          title: input.title.trim(),
          artist: input.artist.trim(),
          duration_sec: Math.max(5, Math.min(1800, Math.round(input.durationSec))),
          preview_url: input.previewUrl,
          license_status: "original_user",
          provider: "user_original",
          available_regions: ["GLOBAL"],
          uploader_id: userId,
          ownership_declared: true,
        })
        .select("*")
        .single();

      if (error) {
        if (!isMissingMusicSchema(error)) throw error;
        return {
          id: `user-audio-${Date.now()}`,
          title: input.title.trim(),
          artist: input.artist.trim(),
          duration_sec: Math.max(5, Math.round(input.durationSec)),
          preview_url: input.previewUrl,
          license_status: "original_user",
          provider: "user_original",
          available_regions: ["GLOBAL"],
          attribution: `Original Audio by ${input.artist.trim()}`,
        };
      }

      return {
        id: data.id,
        title: data.title,
        artist: data.artist,
        duration_sec: data.duration_sec,
        preview_url: data.preview_url,
        license_status: "original_user",
        provider: "user_original",
        available_regions: ["GLOBAL"],
        attribution: `Original Audio by ${data.artist}`,
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["music-catalog"] });
    },
  });
}
