/**
 * PING CLIPS — Dedicated Short-Form Vertical Video Publishing, Discovery & Moments-to-Clips
 *
 * Implements Part C of the Ping Product Addendum:
 * - Preserves clear Ping vocabulary: Pings (posts), Moments (temporary stories),
 *   Clips (persistent short-form discovery videos), Spotlights (editorial founder stories).
 * - Explicit Moments-to-Clips conversion (never auto-converts; preserves creator attribution,
 *   original Moment relationship, editable caption, visibility choice & media permissions).
 * - Reuses Ping's existing Supabase `media` storage pipeline, DOT Tags, Follow/Connect graph,
 *   and Spotlight video-feature links.
 */

import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { extractDotTags } from "@/lib/dot-tags";
import type { Moment } from "@/lib/moments";

export type ClipVisibility = "public" | "followers" | "hub";
export type ClipProcessingStatus = "uploading" | "processing" | "ready" | "failed";

export interface PingClip {
  id: string;
  creator_id: string;
  video_url: string;
  poster_url: string | null;
  caption: string;
  captions_text: string | null;
  duration_sec: number | null;
  visibility: ClipVisibility;
  dot_tags: string[];
  source_moment_id: string | null;
  linked_ping_id: string | null;
  processing_status: ClipProcessingStatus;
  views_count: number;
  likes_count: number;
  replies_count: number;
  shares_count: number;
  saves_count: number;
  hidden_at: string | null;
  created_at: string;
  creator?: {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
  } | null;
}

export interface ClipReply {
  id: string;
  clip_id: string;
  user_id: string;
  content: string;
  created_at: string;
  author?: {
    username: string;
    display_name: string;
    avatar_url: string | null;
  } | null;
}

/**
 * Validates whether an existing Moment can be explicitly republished as a persistent Clip.
 * Enforces creator ownership, video media type, and media privacy boundaries (Close Circle
 * Moments cannot silently leak publicly).
 */
export function validateMomentToClipConversion(input: {
  moment: Pick<Moment, "id" | "author_id" | "media_type" | "audience" | "media_url">;
  callerUserId?: string | null | undefined;
  targetVisibility: ClipVisibility;
}): { eligible: boolean; reason?: string } {
  if (!input.callerUserId || input.moment.author_id !== input.callerUserId) {
    return {
      eligible: false,
      reason: "Only the original Moment creator can republish a Moment as a Ping Clip.",
    };
  }
  if (input.moment.media_type !== "video") {
    return {
      eligible: false,
      reason: "Only video Moments can be converted into Ping Clips.",
    };
  }
  if (!input.moment.media_url || !/^https?:\/\//i.test(input.moment.media_url)) {
    return {
      eligible: false,
      reason: "Moment video source URL is unavailable.",
    };
  }
  if (input.moment.audience === "close_circle" && input.targetVisibility === "public") {
    return {
      eligible: false,
      reason:
        "Close Circle Moments respect original privacy boundaries and cannot be republished as Public Clips. Choose Followers visibility or publish a public video directly.",
    };
  }
  return { eligible: true };
}

function isMissingClipsSchema(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? "").toLowerCase();
  const code = String((err as { code?: string })?.code ?? "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "42883" ||
    code === "PGRST202" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

const LOCAL_CLIPS_KEY = "ping:clips:local-v1";

function readLocalClips(): PingClip[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_CLIPS_KEY);
    return raw ? (JSON.parse(raw) as PingClip[]) : [];
  } catch {
    return [];
  }
}

function writeLocalClips(clips: PingClip[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_CLIPS_KEY, JSON.stringify(clips.slice(0, 50)));
  } catch {
    // ignore storage quota errors
  }
}

export function clipsFeedQuery(tagSlug?: string) {
  return queryOptions({
    queryKey: ["ping-clips-feed", tagSlug ?? "all"],
    staleTime: 20_000,
    queryFn: async (): Promise<{ migrated: boolean; clips: PingClip[] }> => {
      let q = (supabase as any)
        .from("ping_clips")
        .select(
          "*, creator:profiles!ping_clips_creator_id_fkey(id,username,display_name,avatar_url)",
        )
        .is("hidden_at", null)
        .order("created_at", { ascending: false })
        .limit(40);

      if (tagSlug && tagSlug !== "all") {
        q = q.contains("dot_tags", [tagSlug.toLowerCase()]);
      }

      const { data, error } = await q;
      if (error) {
        if (!isMissingClipsSchema(error)) throw error;
        const local = readLocalClips().filter(
          (c) => !tagSlug || tagSlug === "all" || c.dot_tags.includes(tagSlug.toLowerCase()),
        );
        return { migrated: false, clips: local };
      }
      return { migrated: true, clips: (data ?? []) as PingClip[] };
    },
  });
}

export function clipRepliesQuery(clipId?: string) {
  return queryOptions({
    queryKey: ["clip-replies", clipId],
    enabled: Boolean(clipId),
    staleTime: 15_000,
    queryFn: async (): Promise<ClipReply[]> => {
      if (!clipId) return [];
      const { data, error } = await (supabase as any)
        .from("clip_replies")
        .select("*, author:profiles!clip_replies_user_id_fkey(username,display_name,avatar_url)")
        .eq("clip_id", clipId)
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) {
        if (!isMissingClipsSchema(error)) throw error;
        return [];
      }
      return (data ?? []) as ClipReply[];
    },
  });
}

export function usePublishClip(userId?: string, creatorProfile?: PingClip["creator"]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      videoUrl: string;
      posterUrl?: string | null | undefined;
      caption: string;
      captionsText?: string | null | undefined;
      durationSec?: number | null | undefined;
      visibility: ClipVisibility;
    }) => {
      if (!userId) throw new Error("Sign in to publish a Ping Clip.");
      const dotTags = extractDotTags(input.caption);
      const payload = {
        creator_id: userId,
        video_url: input.videoUrl.trim(),
        poster_url: input.posterUrl ?? null,
        caption: input.caption.trim(),
        captions_text: input.captionsText?.trim() || null,
        duration_sec: input.durationSec ?? null,
        visibility: input.visibility,
        dot_tags: dotTags,
        processing_status: "ready" as const,
      };
      const { data, error } = await (supabase as any)
        .from("ping_clips")
        .insert(payload)
        .select("*")
        .single();

      if (error) {
        if (!isMissingClipsSchema(error)) throw error;
        const localClip: PingClip = {
          id: `local-clip-${Date.now()}`,
          ...payload,
          source_moment_id: null,
          linked_ping_id: null,
          views_count: 0,
          likes_count: 0,
          replies_count: 0,
          shares_count: 0,
          saves_count: 0,
          hidden_at: null,
          created_at: new Date().toISOString(),
          creator: creatorProfile ?? null,
        };
        writeLocalClips([localClip, ...readLocalClips()]);
        return localClip;
      }
      return data as PingClip;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ping-clips-feed"] });
    },
  });
}

export function usePublishMomentAsClip(userId?: string, creatorProfile?: PingClip["creator"]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { moment: Moment; caption: string; visibility: ClipVisibility }) => {
      const check = validateMomentToClipConversion({
        moment: input.moment,
        callerUserId: userId,
        targetVisibility: input.visibility,
      });
      if (!check.eligible) {
        throw new Error(check.reason || "This Moment cannot be converted to a Clip.");
      }

      const dotTags = extractDotTags(input.caption);
      const { data, error } = await (supabase as any).rpc("publish_moment_as_clip", {
        p_moment_id: input.moment.id,
        p_caption: input.caption.trim(),
        p_visibility: input.visibility,
        p_dot_tags: dotTags,
      });

      if (error) {
        if (!isMissingClipsSchema(error)) throw error;
        const localClip: PingClip = {
          id: `local-clip-from-moment-${Date.now()}`,
          creator_id: input.moment.author_id,
          video_url: input.moment.media_url,
          poster_url: null,
          caption: input.caption.trim() || input.moment.caption || "",
          captions_text: input.moment.overlay_text || null,
          duration_sec: input.moment.duration || 15,
          visibility: input.visibility,
          dot_tags: dotTags,
          source_moment_id: input.moment.id,
          linked_ping_id: null,
          processing_status: "ready",
          views_count: 0,
          likes_count: 0,
          replies_count: 0,
          shares_count: 0,
          saves_count: 0,
          hidden_at: null,
          created_at: new Date().toISOString(),
          creator: creatorProfile ?? {
            id: input.moment.author_id,
            username: input.moment.author?.username ?? "creator",
            display_name: input.moment.author?.display_name ?? "Creator",
            avatar_url: input.moment.author?.avatar_url ?? null,
          },
        };
        writeLocalClips([localClip, ...readLocalClips()]);
        return localClip;
      }
      return data as PingClip;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ping-clips-feed"] });
    },
  });
}

export function useToggleClipLike(userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ clipId, liked }: { clipId: string; liked: boolean }) => {
      if (!userId) throw new Error("Sign in to like Clips.");
      if (liked) {
        const { error } = await (supabase as any)
          .from("clip_likes")
          .delete()
          .eq("clip_id", clipId)
          .eq("user_id", userId);
        if (error && !isMissingClipsSchema(error)) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("clip_likes")
          .insert({ clip_id: clipId, user_id: userId });
        if (error && error.code !== "23505" && !isMissingClipsSchema(error)) throw error;
      }
      return !liked;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ping-clips-feed"] });
    },
  });
}

export function useToggleClipSave(userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ clipId, saved }: { clipId: string; saved: boolean }) => {
      if (!userId) throw new Error("Sign in to save Clips.");
      if (saved) {
        const { error } = await (supabase as any)
          .from("clip_saves")
          .delete()
          .eq("clip_id", clipId)
          .eq("user_id", userId);
        if (error && !isMissingClipsSchema(error)) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("clip_saves")
          .insert({ clip_id: clipId, user_id: userId });
        if (error && error.code !== "23505" && !isMissingClipsSchema(error)) throw error;
      }
      return !saved;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ping-clips-feed"] });
    },
  });
}

export function usePostClipReply(userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ clipId, content }: { clipId: string; content: string }) => {
      if (!userId) throw new Error("Sign in to reply to Clips.");
      const { error } = await (supabase as any).from("clip_replies").insert({
        clip_id: clipId,
        user_id: userId,
        content: content.trim(),
      });
      if (error && !isMissingClipsSchema(error)) throw error;
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ["clip-replies", vars.clipId] });
      void qc.invalidateQueries({ queryKey: ["ping-clips-feed"] });
    },
  });
}

export function useReportClip(userId?: string) {
  return useMutation({
    mutationFn: async (input: { clipId: string; reason: string; details?: string }) => {
      if (!userId) throw new Error("Sign in to report Clips.");
      const { error } = await (supabase as any).from("clip_reports").insert({
        clip_id: input.clipId,
        reporter_id: userId,
        reason: input.reason.trim(),
        details: (input.details ?? "").trim(),
      });
      if (error && !isMissingClipsSchema(error)) throw error;
    },
  });
}

export async function recordObservedClipView(clipId: string): Promise<void> {
  await (supabase as any).rpc("record_clip_view", { p_clip_id: clipId }).then(
    () => {},
    () => {},
  );
}
