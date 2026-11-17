import { siteUrl } from "@/lib/site";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { RepingSource } from "@/lib/comments";
import { readPublicPings } from "@/lib/public-pings.functions";

export type Profile = {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  created_at: string;
  participation_pathways?: string[];
  onboarding_completed_at?: string | null;
};

export type Ping = {
  id: string;
  user_id: string;
  category: string;
  content: string;
  image_url: string | null;
  cta_url: string | null;
  cta_label: string | null;
  created_at: string;
  updated_at: string;
  author: Pick<Profile, "id" | "username" | "display_name" | "avatar_url"> | null;
  likes: { count: number }[];
  replies?: { count: number }[];
  headline?: string | null;
  needs?: string[] | null;
  offers?: string[] | null;
  skills?: string[] | null;
  desired_outcome?: string | null;
  media_urls?: string[] | null;
} & Partial<RepingSource>;

export const replyCount = (p: Ping) => p.replies?.[0]?.count ?? 0;
export const likeCount = (p: Ping) => p.likes?.[0]?.count ?? 0;

export const followingFeedQuery = (userId: string | undefined, page = 0) =>
  queryOptions({
    queryKey: ["following-feed", userId, page],
    enabled: !!userId,
    queryFn: async (): Promise<Ping[]> => {
      if (!userId) return [];
      const { data: followRows, error: followError } = await supabase
        .from("follows")
        .select("following_id")
        .eq("follower_id", userId);

      if (followError) throw followError;
      if (!followRows || followRows.length === 0) return [];
      const followingIds = followRows.map((r) => r.following_id);

      const { data, error } = await supabase
        .from("pings")
        .select(
          `
          id, user_id, category, content, image_url, cta_url, cta_label, created_at, updated_at,
          author:profiles!pings_user_id_fkey(id, username, display_name, avatar_url),
          likes(count),
          replies:comments!comments_ping_id_fkey(count),
          source_ping_id, source_comment_id,
          source_comment:comments!pings_source_comment_id_fkey(id, ping_id, content, deleted_at, author:profiles!comments_user_id_fkey(username, display_name))
        `,
        )
        .in("user_id", followingIds)
        .is("hidden_at", null)
        .order("created_at", { ascending: false })
        .range(page * 30, page * 30 + 29);

      if (error) {
        throw error;
      }
      return (data ?? []) as unknown as Ping[];
    },
  });

const DB_CATEGORY_MAP: Record<string, string> = {
  building: "progress",
  update: "progress",
  need: "opportunity",
  offer: "opportunity",
  collaboration: "opportunity",
};

export const feedQuery = (category: string | null, page = 0) =>
  queryOptions({
    queryKey: ["feed", category, page],
    queryFn: async () => {
      const dbCat = category ? (DB_CATEGORY_MAP[category] ?? category) : null;
      const result = await readPublicPings({ data: { kind: "feed", value: dbCat, page } });
      return result.pings as unknown as Ping[];
    },
  });

export const pingQuery = (id: string) =>
  queryOptions({
    queryKey: ["ping", id],
    queryFn: async () => {
      const result = await readPublicPings({ data: { kind: "ping", value: id, page: 0 } });
      return (result.pings[0] ?? null) as unknown as Ping | null;
    },
  });

export const profileQuery = (username: string) =>
  queryOptions({
    queryKey: ["profile", username],
    queryFn: async () => {
      const result = await readPublicPings({ data: { kind: "profile", value: username, page: 0 } });
      if (!result.profile) return null;
      return {
        profile: result.profile as Profile,
        pings: result.pings as unknown as Ping[],
        connections: result.connections ?? [],
      };
    },
  });

export const myLikesQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["my-likes", userId],
    enabled: !!userId,
    queryFn: async () => {
      if (!userId) return new Set<string>();
      const { data, error } = await supabase.from("likes").select("ping_id").eq("user_id", userId);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.ping_id));
    },
  });

const SAVED_STORAGE_PREFIX = "ping_saved_ids_";

function readLocalSaved(userId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`${SAVED_STORAGE_PREFIX}${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeLocalSaved(userId: string, ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`${SAVED_STORAGE_PREFIX}${userId}`, JSON.stringify([...ids]));
  } catch {
    // Ignore storage quota errors
  }
}

export const mySavedPingsQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["my-saved-pings", userId],
    enabled: !!userId,
    queryFn: async (): Promise<Set<string>> => {
      if (!userId) return new Set<string>();
      const localSet = new Set(readLocalSaved(userId));
      const { data, error } = await supabase
        .from("saved_pings")
        .select("ping_id")
        .eq("user_id", userId);
      if (error || !data) {
        return localSet;
      }
      for (const r of data) {
        localSet.add(r.ping_id);
      }
      return localSet;
    },
  });

export function useToggleSavePing(userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ pingId, currentlySaved }: { pingId: string; currentlySaved: boolean }) => {
      if (!userId) throw new Error("Sign in to save Pings.");
      const next = new Set(readLocalSaved(userId));
      if (currentlySaved) {
        next.delete(pingId);
      } else {
        next.add(pingId);
      }
      writeLocalSaved(userId, next);

      if (currentlySaved) {
        await supabase.from("saved_pings").delete().eq("user_id", userId).eq("ping_id", pingId);
      } else {
        await supabase.from("saved_pings").insert({ user_id: userId, ping_id: pingId });
      }
      return !currentlySaved;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-saved-pings", userId] });
    },
  });
}

export const pingUrl = (id: string) => siteUrl(`/p/${encodeURIComponent(id)}`);
