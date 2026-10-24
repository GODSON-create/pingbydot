import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readPublicPings } from "@/lib/public-pings.functions";

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

export const likeCount = (p: Ping) => p.likes?.[0]?.count ?? 0;

export const feedQuery = (category: string | null, page = 0) =>
  queryOptions({
    queryKey: ["feed", category, page],
    queryFn: async () => {
      const result = await readPublicPings({ data: { kind: "feed", value: category, page } });
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
      return { profile: result.profile as Profile, pings: result.pings as unknown as Ping[] };
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

export const pingUrl = (id: string) =>
  `https://pingbydot.lovable.app/p/${encodeURIComponent(id)}`;
