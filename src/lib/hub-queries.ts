import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Ping } from "@/lib/pings";
import { PUBLIC_PING_SELECT } from "@/lib/public-pings.functions";
import { readPublicHub, readPublicHubs } from "@/lib/public-hubs.functions";
import { safeResources, type Hub, type HubIntent, type HubRole } from "@/lib/hubs";

export type HubFeedItem = {
  intent: HubIntent | null;
  is_pinned: boolean;
  created_at: string;
  ping: Ping;
};

const toHub = (h: unknown) => {
  const hub = h as Hub;
  return { ...hub, resources: safeResources(hub.resources) };
};

export const hubsQuery = (q: string, category: string | null, page: number) =>
  queryOptions({
    queryKey: ["hubs", q, category, page],
    queryFn: async () => (await readPublicHubs({ data: { q, category, page } })).map(toHub),
  });

export const hubQuery = (slug: string, intent: string | null) =>
  queryOptions({
    queryKey: ["hub", slug, intent],
    queryFn: async () => {
      const r = await readPublicHub({ data: { slug, intent } });
      return r.hub ? { hub: toHub(r.hub), feed: r.feed as unknown as HubFeedItem[] } : null;
    },
  });

/** Viewer-scoped feed (needed for private hubs; RLS decides what is visible). */
export const memberFeedQuery = (hubId: string, intent: string | null, enabled: boolean) =>
  queryOptions({
    queryKey: ["hub-member-feed", hubId, intent],
    enabled,
    queryFn: async () => {
      let q = supabase
        .from("hub_pings")
        .select(`intent,is_pinned,created_at,ping:pings!inner(${PUBLIC_PING_SELECT})`)
        .eq("hub_id", hubId)
        .is("ping.hidden_at", null)
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(60);
      if (intent) q = q.eq("intent", intent);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as HubFeedItem[];
    },
  });

export const myMembershipQuery = (hubId: string, userId: string | undefined) =>
  queryOptions({
    queryKey: ["hub-membership", hubId, userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hub_members")
        .select("role,status")
        .eq("hub_id", hubId)
        .eq("user_id", userId ?? "")
        .maybeSingle();
      if (error) throw error;
      return data as { role: HubRole; status: "active" | "pending" | "invited" } | null;
    },
  });

export type HubMember = {
  role: HubRole;
  status: string;
  joined_at: string;
  user_id: string;
  profile: {
    id: string;
    username: string;
    display_name: string;
    bio: string;
    avatar_url: string | null;
  } | null;
};

export const hubMembersQuery = (
  hubId: string,
  search: string,
  page: number,
  status: "active" | "pending" = "active",
) =>
  queryOptions({
    queryKey: ["hub-members", hubId, search, page, status],
    queryFn: async () => {
      let q = supabase
        .from("hub_members")
        .select(
          "role,status,joined_at,user_id,profile:profiles!hub_members_user_id_fkey!inner(id,username,display_name,bio,avatar_url)",
        )
        .eq("hub_id", hubId)
        .eq("status", status)
        .order("joined_at", { ascending: false })
        .range(page * 30, page * 30 + 29);
      const term = search.replace(/[%_,()*]/g, " ").trim();
      if (term)
        q = q.or(`username.ilike.%${term}%,display_name.ilike.%${term}%`, {
          referencedTable: "profile",
        });
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as HubMember[];
    },
  });

export const myPendingHubsQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["my-pending-hubs", userId],
    enabled: !!userId,
    queryFn: async (): Promise<Set<string>> => {
      if (!userId) return new Set();
      const { data, error } = await supabase
        .from("hub_members")
        .select("hub_id")
        .eq("user_id", userId)
        .eq("status", "pending");

      if (error || !data) return new Set();
      return new Set(data.map((r) => r.hub_id));
    },
  });

export const myHubsQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["my-hubs", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hub_members")
        .select("role,hub:hubs!inner(id,slug,name)")
        .eq("user_id", userId ?? "")
        .eq("status", "active")
        .order("joined_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as {
        role: HubRole;
        hub: { id: string; slug: string; name: string };
      }[];
    },
  });

export const hubInvitesQuery = (hubId: string, enabled: boolean) =>
  queryOptions({
    queryKey: ["hub-invites", hubId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hub_invites")
        .select("id,token,uses,max_uses,expires_at,revoked_at,created_at")
        .eq("hub_id", hubId)
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });

export const followQuery = (profileId: string, userId: string | undefined) =>
  queryOptions({
    queryKey: ["follow", profileId, userId],
    queryFn: async () => {
      const [followers, following, mine] = await Promise.all([
        supabase
          .from("follows")
          .select("*", { count: "exact", head: true })
          .eq("following_id", profileId),
        supabase
          .from("follows")
          .select("*", { count: "exact", head: true })
          .eq("follower_id", profileId),
        userId
          ? supabase
              .from("follows")
              .select("follower_id")
              .eq("follower_id", userId)
              .eq("following_id", profileId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      return {
        followers: followers.count ?? 0,
        following: following.count ?? 0,
        isFollowing: !!mine.data,
      };
    },
  });

/** Friendly message from a database function error. */
export const hubError = (e: unknown, fallback: string) => {
  const m = (e as { message?: string })?.message ?? "";
  return /hub|ping|allowed|owner|member|full|username|quickly|unpin|sign in/i.test(m) &&
    m.length < 120
    ? m
    : fallback;
};
