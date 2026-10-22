import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Profile = {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  created_at: string;
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
};

const SELECT = "*, author:profiles(id, username, display_name, avatar_url), likes(count)";

export const likeCount = (p: Ping) => p.likes?.[0]?.count ?? 0;

export const feedQuery = (category: string | null) =>
  queryOptions({
    queryKey: ["feed", category],
    queryFn: async () => {
      let q = supabase.from("pings").select(SELECT).order("created_at", { ascending: false }).limit(60);
      if (category) q = q.eq("category", category);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as Ping[];
    },
  });

export const pingQuery = (id: string) =>
  queryOptions({
    queryKey: ["ping", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("pings").select(SELECT).eq("id", id).maybeSingle();
      if (error) throw error;
      return data as unknown as Ping | null;
    },
  });

export const profileQuery = (username: string) =>
  queryOptions({
    queryKey: ["profile", username],
    queryFn: async () => {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("username", username.toLowerCase())
        .maybeSingle();
      if (error) throw error;
      if (!profile) return null;
      const { data: pings, error: e2 } = await supabase
        .from("pings")
        .select(SELECT)
        .eq("user_id", profile.id)
        .order("created_at", { ascending: false });
      if (e2) throw e2;
      return { profile: profile as Profile, pings: pings as unknown as Ping[] };
    },
  });

export const myLikesQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["my-likes", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from("likes").select("ping_id").eq("user_id", userId!);
      return new Set((data ?? []).map((r) => r.ping_id));
    },
  });

export const pingUrl = (id: string) =>
  (typeof window !== "undefined" ? window.location.origin : "") + `/p/${id}`;
