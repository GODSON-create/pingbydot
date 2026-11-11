import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/lib/pings";

export type MomentAudience = "public" | "followers" | "hub" | "close_circle";
export type MomentMediaType = "image" | "video";

export interface MomentSticker {
  id: string;
  emoji: string;
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  scale?: number;
  rotation?: number;
}

export interface Moment {
  id: string;
  author_id: string;
  media_url: string;
  media_type: MomentMediaType;
  caption: string | null;
  overlay_text: string | null;
  stickers: MomentSticker[];
  mentions: string[];
  location: string | null;
  duration: number;
  audience: MomentAudience;
  hub_id: string | null;
  is_discoverable: boolean;
  allow_comments: boolean;
  allow_sharing: boolean;
  allow_repings: boolean;
  expires_at: string;
  is_archived: boolean;
  deleted_at: string | null;
  view_count: number;
  like_count: number;
  reping_count: number;
  reply_count: number;
  created_at: string;
  updated_at: string;
  author?: Profile;
  hub?: { id: string; name: string; slug: string } | null;
  has_liked?: boolean;
  has_viewed?: boolean;
  has_repinged?: boolean;
}

export interface CreatorMomentsSequence {
  author: Profile;
  moments: Moment[];
  hasUnseen: boolean;
  latestCreatedAt: string;
}

export interface Highlight {
  id: string;
  user_id: string;
  title: string;
  cover_url: string | null;
  display_order: number;
  is_private: boolean;
  created_at: string;
  updated_at: string;
  moments_count?: number;
  moments?: Moment[];
}

export interface MomentRePing {
  id: string;
  moment_id: string;
  user_id: string;
  caption: string | null;
  audience: string;
  created_at: string;
  reping_user?: Profile;
  original_moment?: Moment;
}

/**
 * Fetch all active (non-expired) moments grouped by creator for the Moments Tray.
 */
export function activeMomentsTrayQuery(currentUserId?: string) {
  return {
    queryKey: ["moments-tray", currentUserId],
    queryFn: async (): Promise<CreatorMomentsSequence[]> => {
      const nowIso = new Date().toISOString();

      // Fetch active moments
      const { data: rawMoments, error } = await supabase
        .from("moments")
        .select(
          `
          id, author_id, media_url, media_type, caption, overlay_text, stickers, mentions,
          location, duration, audience, hub_id, is_discoverable, allow_comments, allow_sharing,
          allow_repings, expires_at, is_archived, deleted_at, view_count, like_count,
          reping_count, reply_count, created_at, updated_at,
          author:profiles!moments_author_id_fkey(id, username, display_name, avatar_url, bio, created_at),
          hub:hubs!moments_hub_id_fkey(id, name, slug)
        `,
        )
        .is("deleted_at", null)
        .gt("expires_at", nowIso)
        .order("created_at", { ascending: true });

      if (error) {
        console.warn("Failed to fetch moments for tray:", error);
        return [];
      }

      if (!rawMoments || rawMoments.length === 0) return [];

      // If current user is logged in, fetch their views, likes, and follows to compute status and ordering
      let viewedMomentIds = new Set<string>();
      let likedMomentIds = new Set<string>();
      let followedUserIds = new Set<string>();

      if (currentUserId) {
        const momentIds = rawMoments.map((m) => m.id);

        const [viewsRes, likesRes, followsRes] = await Promise.all([
          supabase
            .from("moment_views")
            .select("moment_id")
            .eq("viewer_id", currentUserId)
            .in("moment_id", momentIds),
          supabase
            .from("moment_likes")
            .select("moment_id")
            .eq("user_id", currentUserId)
            .in("moment_id", momentIds),
          supabase.from("follows").select("following_id").eq("follower_id", currentUserId),
        ]);

        if (viewsRes.data) {
          viewedMomentIds = new Set(viewsRes.data.map((v) => v.moment_id));
        }
        if (likesRes.data) {
          likedMomentIds = new Set(likesRes.data.map((l) => l.moment_id));
        }
        if (followsRes.data) {
          followedUserIds = new Set(followsRes.data.map((f) => f.following_id));
        }
      }

      // Group moments by creator
      const creatorMap = new Map<string, { author: Profile; moments: Moment[] }>();

      for (const m of rawMoments) {
        if (!m.author) continue;
        const authorProfile = m.author as unknown as Profile;
        const parsedMoment: Moment = {
          ...m,
          media_type: (m.media_type as MomentMediaType) || "image",
          audience: (m.audience as MomentAudience) || "public",
          stickers: (m.stickers as unknown as MomentSticker[]) || [],
          mentions: (m.mentions as unknown as string[]) || [],
          author: authorProfile,
          hub: m.hub as unknown as { id: string; name: string; slug: string } | null,
          has_viewed: viewedMomentIds.has(m.id),
          has_liked: likedMomentIds.has(m.id),
        };

        const existing = creatorMap.get(authorProfile.id);
        if (existing) {
          existing.moments.push(parsedMoment);
        } else {
          creatorMap.set(authorProfile.id, {
            author: authorProfile,
            moments: [parsedMoment],
          });
        }
      }

      const sequences: CreatorMomentsSequence[] = Array.from(creatorMap.values()).map(
        ({ author, moments }) => {
          const hasUnseen = moments.some((m) => !m.has_viewed && m.author_id !== currentUserId);
          const latestCreatedAt =
            moments[moments.length - 1]?.created_at || new Date().toISOString();
          return {
            author,
            moments,
            hasUnseen,
            latestCreatedAt,
          };
        },
      );

      // Prioritize:
      // 1. Current user first
      // 2. Creators with unseen moments who the user follows
      // 3. Other creators with unseen moments
      // 4. Seen moments
      sequences.sort((a, b) => {
        if (a.author.id === currentUserId) return -1;
        if (b.author.id === currentUserId) return 1;

        if (a.hasUnseen && !b.hasUnseen) return -1;
        if (!a.hasUnseen && b.hasUnseen) return 1;

        const aFollowed = followedUserIds.has(a.author.id);
        const bFollowed = followedUserIds.has(b.author.id);
        if (aFollowed && !bFollowed) return -1;
        if (!aFollowed && bFollowed) return 1;

        return new Date(b.latestCreatedAt).getTime() - new Date(a.latestCreatedAt).getTime();
      });

      return sequences;
    },
  };
}

/**
 * Fetch active moments for a specific creator.
 */
export function userActiveMomentsQuery(userId: string, currentUserId?: string) {
  return {
    queryKey: ["user-active-moments", userId, currentUserId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<Moment[]> => {
      const nowIso = new Date().toISOString();

      const { data, error } = await supabase
        .from("moments")
        .select(
          `
          id, author_id, media_url, media_type, caption, overlay_text, stickers, mentions,
          location, duration, audience, hub_id, is_discoverable, allow_comments, allow_sharing,
          allow_repings, expires_at, is_archived, deleted_at, view_count, like_count,
          reping_count, reply_count, created_at, updated_at,
          author:profiles!moments_author_id_fkey(id, username, display_name, avatar_url, bio, created_at),
          hub:hubs!moments_hub_id_fkey(id, name, slug)
        `,
        )
        .eq("author_id", userId)
        .is("deleted_at", null)
        .gt("expires_at", nowIso)
        .order("created_at", { ascending: true });

      if (error) throw error;
      if (!data) return [];

      let viewedMomentIds = new Set<string>();
      let likedMomentIds = new Set<string>();

      if (currentUserId && data.length > 0) {
        const momentIds = data.map((m) => m.id);
        const [views, likes] = await Promise.all([
          supabase
            .from("moment_views")
            .select("moment_id")
            .eq("viewer_id", currentUserId)
            .in("moment_id", momentIds),
          supabase
            .from("moment_likes")
            .select("moment_id")
            .eq("user_id", currentUserId)
            .in("moment_id", momentIds),
        ]);

        if (views.data) viewedMomentIds = new Set(views.data.map((v) => v.moment_id));
        if (likes.data) likedMomentIds = new Set(likes.data.map((l) => l.moment_id));
      }

      return data.map((m) => ({
        ...m,
        media_type: (m.media_type as MomentMediaType) || "image",
        audience: (m.audience as MomentAudience) || "public",
        stickers: (m.stickers as unknown as MomentSticker[]) || [],
        mentions: (m.mentions as unknown as string[]) || [],
        author: m.author as unknown as Profile,
        hub: m.hub as unknown as { id: string; name: string; slug: string } | null,
        has_viewed: viewedMomentIds.has(m.id),
        has_liked: likedMomentIds.has(m.id),
      })) as Moment[];
    },
  };
}

/**
 * Fetch highlights for a profile.
 */
export function userHighlightsQuery(userId: string) {
  return {
    queryKey: ["user-highlights", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<Highlight[]> => {
      const { data: highlights, error } = await supabase
        .from("highlights")
        .select(
          `
          id, user_id, title, cover_url, display_order, is_private, created_at, updated_at
        `,
        )
        .eq("user_id", userId)
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: false });

      if (error) {
        console.warn("Failed to fetch highlights:", error);
        return [];
      }

      if (!highlights || highlights.length === 0) return [];

      // Fetch items counts for each highlight
      const highlightIds = highlights.map((h) => h.id);
      const { data: items } = await supabase
        .from("highlight_items")
        .select("highlight_id")
        .in("highlight_id", highlightIds);

      const countMap = new Map<string, number>();
      if (items) {
        for (const item of items) {
          countMap.set(item.highlight_id, (countMap.get(item.highlight_id) || 0) + 1);
        }
      }

      return highlights.map((h) => ({
        ...h,
        moments_count: countMap.get(h.id) || 0,
      })) as Highlight[];
    },
  };
}

/**
 * Fetch moments inside a specific highlight collection.
 */
export function highlightMomentsQuery(highlightId: string, currentUserId?: string) {
  return {
    queryKey: ["highlight-moments", highlightId, currentUserId],
    enabled: Boolean(highlightId),
    queryFn: async (): Promise<Moment[]> => {
      const { data: items, error } = await supabase
        .from("highlight_items")
        .select(
          `
          display_order,
          moment:moments!highlight_items_moment_id_fkey(
            id, author_id, media_url, media_type, caption, overlay_text, stickers, mentions,
            location, duration, audience, hub_id, is_discoverable, allow_comments, allow_sharing,
            allow_repings, expires_at, is_archived, deleted_at, view_count, like_count,
            reping_count, reply_count, created_at, updated_at,
            author:profiles!moments_author_id_fkey(id, username, display_name, avatar_url, bio, created_at)
          )
        `,
        )
        .eq("highlight_id", highlightId)
        .order("display_order", { ascending: true });

      if (error) throw error;
      if (!items) return [];

      return items
        .filter(
          (it) => it.moment && !(it.moment as unknown as { deleted_at: string | null }).deleted_at,
        )
        .map((it) => {
          const m = it.moment as unknown as Moment;
          return {
            ...m,
            media_type: (m.media_type as MomentMediaType) || "image",
            audience: (m.audience as MomentAudience) || "public",
            stickers: (m.stickers as unknown as MomentSticker[]) || [],
            mentions: (m.mentions as unknown as string[]) || [],
          };
        });
    },
  };
}

/**
 * Fetch Discoverable Moments for the For You Feed.
 * Strictly guarantees ZERO leak of private Hub or Close Circle content!
 */
export function discoverableMomentsQuery(currentUserId?: string) {
  return {
    queryKey: ["discoverable-moments", currentUserId],
    queryFn: async (): Promise<Moment[]> => {
      const { data, error } = await supabase
        .from("moments")
        .select(
          `
          id, author_id, media_url, media_type, caption, overlay_text, stickers, mentions,
          location, duration, audience, hub_id, is_discoverable, allow_comments, allow_sharing,
          allow_repings, expires_at, is_archived, deleted_at, view_count, like_count,
          reping_count, reply_count, created_at, updated_at,
          author:profiles!moments_author_id_fkey(id, username, display_name, avatar_url, bio, created_at)
        `,
        )
        .eq("is_discoverable", true)
        .eq("audience", "public") // STRICT: Only public discoverable moments appear on For You!
        .is("deleted_at", null)
        .order("like_count", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(30);

      if (error) {
        console.warn("Failed to load discoverable moments:", error);
        return [];
      }

      if (!data) return [];

      let likedIds = new Set<string>();
      if (currentUserId && data.length > 0) {
        const { data: likes } = await supabase
          .from("moment_likes")
          .select("moment_id")
          .eq("user_id", currentUserId)
          .in(
            "moment_id",
            data.map((m) => m.id),
          );

        if (likes) {
          likedIds = new Set(likes.map((l) => l.moment_id));
        }
      }

      return data.map((m) => ({
        ...m,
        media_type: (m.media_type as MomentMediaType) || "image",
        audience: (m.audience as MomentAudience) || "public",
        stickers: (m.stickers as unknown as MomentSticker[]) || [],
        mentions: (m.mentions as unknown as string[]) || [],
        author: m.author as unknown as Profile,
        has_liked: likedIds.has(m.id),
      })) as Moment[];
    },
  };
}

/**
 * Record a moment view (debounced & unique per user).
 */
export function useViewMoment() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (momentId: string) => {
      const { error } = await supabase.rpc("view_moment", {
        _moment_id: momentId,
      });
      if (error) console.warn("Failed to record view:", error);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["moments-tray"] });
    },
  });
}

/**
 * Toggle like / reaction on a Moment.
 */
export function useLikeMoment() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ momentId, reaction = "❤️" }: { momentId: string; reaction?: string }) => {
      const { data, error } = await supabase.rpc("toggle_like_moment", {
        _moment_id: momentId,
        _reaction: reaction,
      });
      if (error) throw error;
      return Boolean(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["moments-tray"] });
      qc.invalidateQueries({ queryKey: ["discoverable-moments"] });
    },
  });
}

/**
 * Send a private reply to a Moment.
 */
export function useReplyMoment() {
  return useMutation({
    mutationFn: async ({
      momentId,
      recipientId,
      message,
    }: {
      momentId: string;
      recipientId: string;
      message: string;
    }) => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("Please log in to reply.");

      const { data, error } = await supabase
        .from("moment_replies")
        .insert({
          moment_id: momentId,
          sender_id: user.user.id,
          recipient_id: recipientId,
          message: message.trim(),
        })
        .select("id")
        .single();

      if (error) throw error;
      return data;
    },
  });
}

/**
 * Native Re-Ping Action for Moments.
 * Enforces original creator's audience & sharing permissions.
 */
export function useRePingMoment() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      momentId,
      caption,
      audience = "public",
    }: {
      momentId: string;
      caption?: string;
      audience?: "public" | "followers";
    }) => {
      const { data, error } = await supabase.rpc("reping_moment", {
        _moment_id: momentId,
        ...(caption ? { _caption: caption.trim() } : {}),
        _audience: audience,
      });

      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["moments-tray"] });
      qc.invalidateQueries({ queryKey: ["discoverable-moments"] });
    },
  });
}

/**
 * Delete Re-Ping.
 */
export function useDeleteRePing() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (repingId: string) => {
      const { error } = await supabase.rpc("delete_reping", {
        _reping_id: repingId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["moments-tray"] });
      qc.invalidateQueries({ queryKey: ["discoverable-moments"] });
    },
  });
}

/**
 * Delete a Moment (Creator only).
 */
export function useDeleteMoment() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (momentId: string) => {
      const { error } = await supabase
        .from("moments")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", momentId);

      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["moments-tray"] });
      qc.invalidateQueries({ queryKey: ["discoverable-moments"] });
      qc.invalidateQueries({ queryKey: ["user-active-moments"] });
    },
  });
}

/**
 * Highlights Management.
 */
export function useCreateHighlight() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { title: string; cover_url?: string; is_private?: boolean }) => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("Please log in first.");

      const { data, error } = await supabase
        .from("highlights")
        .insert({
          user_id: user.user.id,
          title: payload.title.trim(),
          cover_url: payload.cover_url || null,
          is_private: payload.is_private ?? false,
        })
        .select("id")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-highlights"] });
    },
  });
}

export function useAddMomentToHighlight() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ highlightId, momentId }: { highlightId: string; momentId: string }) => {
      const { data, error } = await supabase
        .from("highlight_items")
        .insert({
          highlight_id: highlightId,
          moment_id: momentId,
        })
        .select("id")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-highlights"] });
      qc.invalidateQueries({ queryKey: ["highlight-moments"] });
    },
  });
}

export function useDeleteHighlight() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (highlightId: string) => {
      const { error } = await supabase.from("highlights").delete().eq("id", highlightId);

      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-highlights"] });
    },
  });
}
