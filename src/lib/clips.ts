/**
 * PING CLIPS — Dedicated Short-Form Vertical Video Publishing, Discovery & Moments-to-Clips
 *
 * - Preserves clear Ping vocabulary: Pings (posts), Moments (temporary updates),
 *   Clips (persistent short-form discovery videos), Spotlights (editorial founder stories).
 * - Explicit Moments-to-Clips conversion (never auto-converts; preserves creator attribution,
 *   original Moment relationship, editable caption, visibility choice & media permissions).
 * - Reuses Ping's existing Supabase `media` storage pipeline, DOT Tags, Follow/Connect graph,
 *   and Spotlight video-feature links.
 * - Never fakes likes, saves, comments, view counts, or publish success when backend tables
 *   are not yet provisioned.
 */

import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { extractDotTags } from "@/lib/dot-tags";
import type { Moment } from "@/lib/moments";

export type ClipVisibility = "public" | "followers" | "hub";
export type ClipProcessingStatus = "uploading" | "processing" | "ready" | "failed";
export type ClipFeedSort = "recent" | "popular";

/** Matches DB CHECK constraint `duration_sec BETWEEN 1 AND 180` in migration 0034. */
export const MAX_CLIP_DURATION_SEC = 180;
export const MAX_CLIP_SIZE_BYTES = 50 * 1024 * 1024;
export const CLIPS_SCHEMA_MIGRATION_HINT =
  "Clips database tables are not yet applied on this environment (migration 0034_ping_learn_spotlight_and_clips.sql required).";

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

export interface ViewerClipInteractions {
  likedIds: Set<string>;
  savedIds: Set<string>;
  followedCreatorIds: Set<string>;
}

/**
 * Validates whether an existing Moment can be explicitly republished as a persistent Clip.
 * Enforces creator ownership, video media type, and media privacy boundaries (Close Circle
 * and private-bucket Moments cannot silently leak publicly).
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
  if (
    !input.moment.media_url ||
    input.moment.media_url.startsWith("storage://") ||
    input.moment.media_url.startsWith("r2://") ||
    !/^https?:\/\//i.test(input.moment.media_url)
  ) {
    return {
      eligible: false,
      reason:
        input.moment.media_url &&
        (input.moment.media_url.startsWith("storage://") ||
          input.moment.media_url.startsWith("r2://"))
          ? "Restricted private-bucket Moments cannot be directly republished as Clips. Upload the video as a Clip directly."
          : "Moment video source URL is unavailable.",
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

export function isMissingClipsSchema(err: unknown): boolean {
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

/**
 * Extensible feed query supporting topic filtering (`tagSlug`) and ranking modes (`sortMode`)
 * so recommendations, categories, and creator discovery can expand without replacing the feed architecture.
 */
export function clipsFeedQuery(tagSlug?: string, sortMode: ClipFeedSort = "recent") {
  return queryOptions({
    queryKey: ["ping-clips-feed", tagSlug ?? "all", sortMode],
    staleTime: 20_000,
    queryFn: async (): Promise<{ migrated: boolean; clips: PingClip[] }> => {
      let q = (supabase as any)
        .from("ping_clips")
        .select(
          "*, creator:profiles!ping_clips_creator_id_fkey(id,username,display_name,avatar_url)",
        )
        .is("hidden_at", null);

      if (sortMode === "popular") {
        q = q.order("views_count", { ascending: false }).order("created_at", { ascending: false });
      } else {
        q = q.order("created_at", { ascending: false });
      }

      q = q.limit(40);

      if (tagSlug && tagSlug !== "all") {
        q = q.contains("dot_tags", [tagSlug.toLowerCase()]);
      }

      const { data, error } = await q;
      if (error) {
        if (!isMissingClipsSchema(error)) throw error;
        return { migrated: false, clips: [] };
      }
      return { migrated: true, clips: (data ?? []) as PingClip[] };
    },
  });
}

/**
 * Fetches persistent Clips belonging to a specific creator for Profile display.
 * RLS enforces public, followers-only, and creator-owned visibility rules server-side.
 */
export function userClipsQuery(creatorId?: string, viewerId?: string | null) {
  return queryOptions({
    queryKey: ["user-clips", creatorId ?? "", viewerId ?? "anon"],
    enabled: Boolean(creatorId),
    staleTime: 20_000,
    queryFn: async (): Promise<{ migrated: boolean; clips: PingClip[] }> => {
      if (!creatorId) return { migrated: true, clips: [] };
      const { data, error } = await (supabase as any)
        .from("ping_clips")
        .select(
          "*, creator:profiles!ping_clips_creator_id_fkey(id,username,display_name,avatar_url)",
        )
        .eq("creator_id", creatorId)
        .is("hidden_at", null)
        .order("created_at", { ascending: false })
        .limit(40);

      if (error) {
        if (!isMissingClipsSchema(error)) throw error;
        return { migrated: false, clips: [] };
      }
      return { migrated: true, clips: (data ?? []) as PingClip[] };
    },
  });
}

/**
 * Hydrates real viewer interaction state (likes, saves, creator follows) for a set of Clips.
 */
export function viewerClipInteractionsQuery(
  clipIds: string[],
  creatorIds: string[],
  userId?: string | null,
) {
  const sortedClipKey = [...new Set(clipIds)].sort().join(",");
  const sortedCreatorKey = [...new Set(creatorIds)].sort().join(",");

  return queryOptions({
    queryKey: ["clip-viewer-interactions", userId ?? "anon", sortedClipKey, sortedCreatorKey],
    enabled: Boolean(userId && (clipIds.length > 0 || creatorIds.length > 0)),
    staleTime: 15_000,
    queryFn: async (): Promise<ViewerClipInteractions> => {
      const empty: ViewerClipInteractions = {
        likedIds: new Set(),
        savedIds: new Set(),
        followedCreatorIds: new Set(),
      };
      if (!userId) return empty;

      const uniqueClips = [...new Set(clipIds)];
      const uniqueCreators = [...new Set(creatorIds)].filter((id) => id !== userId);

      const [likesRes, savesRes, followsRes] = await Promise.all([
        uniqueClips.length > 0
          ? (supabase as any)
              .from("clip_likes")
              .select("clip_id")
              .eq("user_id", userId)
              .in("clip_id", uniqueClips)
          : Promise.resolve({ data: [], error: null }),
        uniqueClips.length > 0
          ? (supabase as any)
              .from("clip_saves")
              .select("clip_id")
              .eq("user_id", userId)
              .in("clip_id", uniqueClips)
          : Promise.resolve({ data: [], error: null }),
        uniqueCreators.length > 0
          ? supabase
              .from("follows")
              .select("following_id")
              .eq("follower_id", userId)
              .in("following_id", uniqueCreators)
          : Promise.resolve({ data: [], error: null }),
      ]);

      return {
        likedIds: new Set(
          !likesRes?.error && Array.isArray(likesRes?.data)
            ? likesRes.data.map((r: { clip_id: string }) => r.clip_id)
            : [],
        ),
        savedIds: new Set(
          !savesRes?.error && Array.isArray(savesRes?.data)
            ? savesRes.data.map((r: { clip_id: string }) => r.clip_id)
            : [],
        ),
        followedCreatorIds: new Set(
          !followsRes?.error && Array.isArray(followsRes?.data)
            ? followsRes.data.map((r: { following_id: string }) => r.following_id)
            : [],
        ),
      };
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

export function usePublishClip(userId?: string, _creatorProfile?: PingClip["creator"]) {
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
      const cleanedUrl = input.videoUrl.trim();
      if (!/^https?:\/\//i.test(cleanedUrl)) {
        throw new Error("A valid uploaded HTTPS video URL is required to publish a Clip.");
      }
      if (
        typeof input.durationSec === "number" &&
        Number.isFinite(input.durationSec) &&
        input.durationSec > MAX_CLIP_DURATION_SEC
      ) {
        throw new Error(
          `Clips must be ${MAX_CLIP_DURATION_SEC} seconds (3 minutes) or shorter.`,
        );
      }

      const safeDuration =
        typeof input.durationSec === "number" && Number.isFinite(input.durationSec)
          ? Math.min(MAX_CLIP_DURATION_SEC, Math.max(1, Math.round(input.durationSec)))
          : null;

      const dotTags = extractDotTags(input.caption);
      const payload = {
        creator_id: userId,
        video_url: cleanedUrl,
        poster_url: input.posterUrl ?? null,
        caption: input.caption.trim(),
        captions_text: input.captionsText?.trim() || null,
        duration_sec: safeDuration,
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
        if (isMissingClipsSchema(error)) {
          throw new Error(CLIPS_SCHEMA_MIGRATION_HINT);
        }
        throw error;
      }
      return data as PingClip;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ping-clips-feed"] });
      void qc.invalidateQueries({ queryKey: ["user-clips"] });
    },
  });
}

export function usePublishMomentAsClip(userId?: string, _creatorProfile?: PingClip["creator"]) {
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
        if (isMissingClipsSchema(error)) {
          throw new Error(CLIPS_SCHEMA_MIGRATION_HINT);
        }
        throw error;
      }
      return data as PingClip;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ping-clips-feed"] });
      void qc.invalidateQueries({ queryKey: ["user-clips"] });
    },
  });
}

export function useUpdateClipVisibility(userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      clipId,
      visibility,
    }: {
      clipId: string;
      visibility: ClipVisibility;
    }) => {
      if (!userId) throw new Error("Sign in to update Clip visibility.");
      const { data, error } = await (supabase as any)
        .from("ping_clips")
        .update({ visibility })
        .eq("id", clipId)
        .eq("creator_id", userId)
        .select("*")
        .single();

      if (error) {
        if (isMissingClipsSchema(error)) throw new Error(CLIPS_SCHEMA_MIGRATION_HINT);
        throw error;
      }
      return data as PingClip;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ping-clips-feed"] });
      void qc.invalidateQueries({ queryKey: ["user-clips"] });
    },
  });
}

export function useDeleteClip(userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (clipId: string) => {
      if (!userId) throw new Error("Sign in to delete a Clip.");
      const { error } = await (supabase as any)
        .from("ping_clips")
        .delete()
        .eq("id", clipId)
        .eq("creator_id", userId);

      if (error) {
        if (isMissingClipsSchema(error)) throw new Error(CLIPS_SCHEMA_MIGRATION_HINT);
        throw error;
      }
      return clipId;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ping-clips-feed"] });
      void qc.invalidateQueries({ queryKey: ["user-clips"] });
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
        if (error) {
          if (isMissingClipsSchema(error)) throw new Error(CLIPS_SCHEMA_MIGRATION_HINT);
          throw error;
        }
      } else {
        const { error } = await (supabase as any)
          .from("clip_likes")
          .insert({ clip_id: clipId, user_id: userId });
        if (error && error.code !== "23505") {
          if (isMissingClipsSchema(error)) throw new Error(CLIPS_SCHEMA_MIGRATION_HINT);
          throw error;
        }
      }
      return !liked;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["clip-viewer-interactions"] });
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
        if (error) {
          if (isMissingClipsSchema(error)) throw new Error(CLIPS_SCHEMA_MIGRATION_HINT);
          throw error;
        }
      } else {
        const { error } = await (supabase as any)
          .from("clip_saves")
          .insert({ clip_id: clipId, user_id: userId });
        if (error && error.code !== "23505") {
          if (isMissingClipsSchema(error)) throw new Error(CLIPS_SCHEMA_MIGRATION_HINT);
          throw error;
        }
      }
      return !saved;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["clip-viewer-interactions"] });
      void qc.invalidateQueries({ queryKey: ["ping-clips-feed"] });
    },
  });
}

export function usePostClipReply(userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ clipId, content }: { clipId: string; content: string }) => {
      if (!userId) throw new Error("Sign in to comment on Clips.");
      const cleaned = content.trim();
      if (!cleaned) throw new Error("Write a comment before sending.");
      const { error } = await (supabase as any).from("clip_replies").insert({
        clip_id: clipId,
        user_id: userId,
        content: cleaned,
      });
      if (error) {
        if (isMissingClipsSchema(error)) throw new Error(CLIPS_SCHEMA_MIGRATION_HINT);
        throw error;
      }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ["clip-replies", vars.clipId] });
      void qc.invalidateQueries({ queryKey: ["ping-clips-feed"] });
    },
  });
}

export function useDeleteClipReply(userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ replyId, clipId }: { replyId: string; clipId: string }) => {
      if (!userId) throw new Error("Sign in to delete your comment.");
      const { error } = await (supabase as any)
        .from("clip_replies")
        .delete()
        .eq("id", replyId)
        .eq("user_id", userId);
      if (error) {
        if (isMissingClipsSchema(error)) throw new Error(CLIPS_SCHEMA_MIGRATION_HINT);
        throw error;
      }
      return clipId;
    },
    onSuccess: (clipId) => {
      void qc.invalidateQueries({ queryKey: ["clip-replies", clipId] });
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
      if (error) {
        if (isMissingClipsSchema(error)) throw new Error(CLIPS_SCHEMA_MIGRATION_HINT);
        throw error;
      }
    },
  });
}

export async function recordObservedClipView(clipId: string): Promise<boolean> {
  try {
    const { error } = await (supabase as any).rpc("record_clip_view", { p_clip_id: clipId });
    return !error;
  } catch {
    return false;
  }
}

export async function recordObservedClipShare(clipId: string): Promise<boolean> {
  try {
    const { error } = await (supabase as any).rpc("record_clip_share", { p_clip_id: clipId });
    return !error;
  } catch {
    return false;
  }
}
