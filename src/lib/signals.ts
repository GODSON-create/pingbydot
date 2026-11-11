import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export type SignalInstitutionType =
  | "university"
  | "company"
  | "incubator"
  | "government"
  | "community"
  | "other";

export interface Signal {
  id: string;
  slug: string;
  name: string;
  tagline?: string;
  description: string;
  avatar_url: string | null;
  cover_url: string | null;
  website_url: string | null;
  institution_type: string;
  verified: boolean;
  verification_status?: string;
  verification_details?: Record<string, unknown>;
  follower_count: number;
  post_count?: number;
  created_by?: string;
  created_at: string;
}

export interface SignalPost {
  id: string;
  signal_id: string;
  author_id: string;
  title: string;
  content: string;
  category?: string;
  is_urgent?: boolean;
  media_urls?: string[] | null;
  created_at: string;
  updated_at: string;
  has_read?: boolean;
}

export interface SignalPostAnalytics {
  post_id: string;
  total_delivered: number;
  total_read: number;
  read_percentage: number;
}

export interface SignalPublisherMember {
  signal_id: string;
  user_id: string;
  role: "admin" | "publisher";
  created_at: string;
  profile: {
    id: string;
    username: string;
    display_name: string;
    bio: string;
    avatar_url: string | null;
  } | null;
}

export function signalsQuery(filters?: { search?: string; category?: string }) {
  return {
    queryKey: ["signals", filters?.search, filters?.category],
    queryFn: async (): Promise<Signal[]> => {
      let q = supabase
        .from("signals")
        .select(
          "id, slug, name, tagline, description, avatar_url, cover_url, website_url, institution_type, verified, verification_status, follower_count, post_count, created_by, created_at",
        )
        .order("verified", { ascending: false })
        .order("follower_count", { ascending: false });

      if (filters?.category && filters.category !== "all") {
        q = q.eq("institution_type", filters.category);
      }

      if (filters?.search && filters.search.trim().length > 0) {
        q = q.ilike("name", `%${filters.search.trim()}%`);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as Signal[];
    },
  };
}

export function signalBySlugQuery(slug: string) {
  return {
    queryKey: ["signal", slug],
    enabled: Boolean(slug),
    queryFn: async (): Promise<Signal | null> => {
      const { data, error } = await supabase
        .from("signals")
        .select(
          "id, slug, name, tagline, description, avatar_url, cover_url, website_url, institution_type, verified, verification_status, verification_details, follower_count, post_count, created_by, created_at",
        )
        .eq("slug", slug)
        .maybeSingle();

      if (error) throw error;
      return (data as unknown as Signal) || null;
    },
  };
}

export function signalPostsQuery(signalId: string, currentUserId?: string) {
  return {
    queryKey: ["signal-posts", signalId, currentUserId],
    enabled: Boolean(signalId),
    queryFn: async (): Promise<SignalPost[]> => {
      const { data: rawPosts, error } = await supabase
        .from("signal_posts")
        .select("id, signal_id, author_id, title, content, category, is_urgent, media_urls, created_at, updated_at")
        .eq("signal_id", signalId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      if (!rawPosts || rawPosts.length === 0) return [];

      const posts = rawPosts as unknown as Array<{
        id: string;
        signal_id: string;
        author_id: string;
        title: string;
        content: string;
        category?: string;
        is_urgent?: boolean;
        media_urls?: string[] | null;
        created_at: string;
        updated_at: string;
      }>;

      let readPostIds = new Set<string>();
      if (currentUserId) {
        const postIds = posts.map((p) => p.id);
        const { data: reads } = await supabase
          .from("signal_reads")
          .select("post_id")
          .eq("user_id", currentUserId)
          .in("post_id", postIds);

        if (reads) {
          const typedReads = reads as unknown as Array<{ post_id: string }>;
          readPostIds = new Set(typedReads.map((r) => r.post_id));
        }
      }

      return posts.map((p) => ({
        ...p,
        has_read: readPostIds.has(p.id),
      }));
    },
  };
}

export function signalFollowingQuery(signalId: string, userId?: string) {
  return {
    queryKey: ["signal-following", signalId, userId],
    enabled: Boolean(signalId && userId),
    queryFn: async (): Promise<boolean> => {
      if (!userId) return false;
      const { data, error } = await supabase
        .from("signal_followers")
        .select("signal_id, user_id")
        .eq("signal_id", signalId)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) return false;
      return Boolean(data);
    },
  };
}

export function signalPublisherQuery(signalId: string, userId?: string) {
  return {
    queryKey: ["signal-publisher", signalId, userId],
    enabled: Boolean(signalId && userId),
    queryFn: async (): Promise<{ isPublisher: boolean; role?: "admin" | "publisher" }> => {
      if (!userId) return { isPublisher: false };
      const { data, error } = await supabase
        .from("signal_publishers")
        .select("role")
        .eq("signal_id", signalId)
        .eq("user_id", userId)
        .maybeSingle();

      if (error || !data) return { isPublisher: false };
      return { isPublisher: true, role: (data as { role: "admin" | "publisher" }).role };
    },
  };
}

export function signalPublishersListQuery(signalId: string) {
  return {
    queryKey: ["signal-publishers", signalId],
    enabled: Boolean(signalId),
    queryFn: async (): Promise<SignalPublisherMember[]> => {
      const { data, error } = await supabase
        .from("signal_publishers")
        .select("signal_id, user_id, role, created_at, profile:profiles!signal_publishers_user_id_fkey(id, username, display_name, bio, avatar_url)")
        .eq("signal_id", signalId)
        .order("created_at", { ascending: true });

      if (error) {
        console.warn("Failed to load signal publishers:", error);
        return [];
      }
      return (data ?? []) as unknown as SignalPublisherMember[];
    },
  };
}

export function useSignalFollow(signalId: string, userId?: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Please log in to follow this Signal");
      const { data, error } = await supabase.rpc("toggle_follow_signal", {
        _signal: signalId,
      });
      if (error) throw error;
      return { following: Boolean(data) };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["signal-following", signalId, userId] });
      qc.invalidateQueries({ queryKey: ["signal"] });
      qc.invalidateQueries({ queryKey: ["signals"] });
    },
  });
}

export function useCreateSignalPost(signalId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      title: string;
      content: string;
      category?: string;
      media_urls?: string[];
    }) => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("Unauthorized");

      const { data, error } = await supabase
        .from("signal_posts")
        .insert({
          signal_id: signalId,
          author_id: user.user.id,
          title: payload.title,
          content: payload.content,
          ...(payload.category ? { category: payload.category } : {}),
          ...(payload.media_urls ? { media_urls: payload.media_urls } : {}),
        })
        .select("id")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["signal-posts", signalId] });
      qc.invalidateQueries({ queryKey: ["signal", signalId] });
    },
  });
}

export function useManageSignalPublisher(signalId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      username,
      action,
      role = "publisher",
    }: {
      username: string;
      action: "add" | "remove" | "role";
      role?: "admin" | "publisher";
    }) => {
      const { error } = await supabase.rpc("manage_signal_publisher", {
        _signal: signalId,
        _username: username.trim(),
        _action: action,
        _role: role,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["signal-publishers", signalId] });
      qc.invalidateQueries({ queryKey: ["signal-publisher", signalId] });
    },
  });
}

export function useRequestSignalVerification(signalId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (details?: Json) => {
      const { error } = await supabase.rpc("request_signal_verification", {
        _signal: signalId,
        ...(details ? { _details: details } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["signal"] });
      qc.invalidateQueries({ queryKey: ["signals"] });
    },
  });
}

export function useMarkSignalRead() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (postId: string) => {
      const { error } = await supabase.rpc("mark_signal_read", {
        _post_id: postId,
      });
      if (error) {
        console.warn("Could not mark signal read:", error);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["signal-posts"] });
    },
  });
}

export function signalAnalyticsQuery(postId: string, isPublisher: boolean) {
  return {
    queryKey: ["signal-analytics", postId],
    enabled: Boolean(postId && isPublisher),
    queryFn: async (): Promise<SignalPostAnalytics | null> => {
      const { data, error } = await supabase.rpc("get_signal_post_analytics", {
        _post_id: postId,
      });

      if (error || !data) return null;
      const res = data as unknown as Record<string, unknown>;
      return {
        post_id: (res["post_id"] as string) || postId,
        total_delivered: Number(res["total_recipients"] ?? res["total_delivered"] ?? 0),
        total_read: Number(res["read_count"] ?? res["total_read"] ?? 0),
        read_percentage: Number(res["read_percentage"] ?? 0),
      };
    },
  };
}
