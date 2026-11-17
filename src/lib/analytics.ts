import { queryOptions } from "@tanstack/react-query";
import { format, subDays, startOfDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { CATEGORIES } from "@/lib/validation";

export interface DailyMetricPoint {
  date: string;
  label: string;
  pings: number;
  likes: number;
  replies: number;
}

export interface CategoryBreakdownItem {
  category: string;
  label: string;
  emoji: string;
  count: number;
  engagement: number;
}

export interface TopPingItem {
  id: string;
  category: string;
  content: string;
  created_at: string;
  likes: number;
  replies: number;
}

export interface CreatorAnalytics {
  days: number;
  totals: {
    pingsCount: number;
    likesReceived: number;
    commentsReceived: number;
    followersCount: number;
    followingCount: number;
    momentsCount: number;
    momentViews: number;
    momentLikes: number;
    hubsJoined: number;
    signalsSubscribed: number;
    avgEngagementPerPing: number;
  };
  dailySeries: DailyMetricPoint[];
  categoryBreakdown: CategoryBreakdownItem[];
  topPings: TopPingItem[];
}

export function buildDailySeries(
  pings: Array<{ created_at: string; likes: number; replies: number }>,
  days: number,
): DailyMetricPoint[] {
  const today = startOfDay(new Date());
  const bucketMap = new Map<string, DailyMetricPoint>();

  for (let i = days - 1; i >= 0; i--) {
    const d = subDays(today, i);
    const key = format(d, "yyyy-MM-dd");
    bucketMap.set(key, {
      date: key,
      label: format(d, days <= 14 ? "MMM d" : "M/d"),
      pings: 0,
      likes: 0,
      replies: 0,
    });
  }

  for (const p of pings) {
    const key = format(new Date(p.created_at), "yyyy-MM-dd");
    const bucket = bucketMap.get(key);
    if (bucket) {
      bucket.pings += 1;
      bucket.likes += p.likes;
      bucket.replies += p.replies;
    }
  }

  return Array.from(bucketMap.values());
}

export function creatorAnalyticsQuery(userId?: string, days = 30) {
  return queryOptions({
    queryKey: ["creator-analytics", userId, days],
    enabled: Boolean(userId),
    queryFn: async (): Promise<CreatorAnalytics> => {
      if (!userId) {
        return {
          days,
          totals: {
            pingsCount: 0,
            likesReceived: 0,
            commentsReceived: 0,
            followersCount: 0,
            followingCount: 0,
            momentsCount: 0,
            momentViews: 0,
            momentLikes: 0,
            hubsJoined: 0,
            signalsSubscribed: 0,
            avgEngagementPerPing: 0,
          },
          dailySeries: buildDailySeries([], days),
          categoryBreakdown: [],
          topPings: [],
        };
      }

      const sinceIso = subDays(new Date(), days).toISOString();

      // Core Pings & Follows queries (always present across migrations 0000-0016)
      const [pingsRes, followersRes, followingRes, hubsRes, rpcRes] = await Promise.all([
        supabase
          .from("pings")
          .select(
            "id, category, content, created_at, likes(count), replies:comments!comments_ping_id_fkey(count)",
          )
          .eq("user_id", userId)
          .is("hidden_at", null)
          .order("created_at", { ascending: false })
          .limit(250),
        supabase
          .from("follows")
          .select("follower_id", { count: "exact", head: true })
          .eq("following_id", userId),
        supabase
          .from("follows")
          .select("following_id", { count: "exact", head: true })
          .eq("follower_id", userId),
        supabase
          .from("hub_members")
          .select("hub_id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("status", "active"),
        supabase.rpc("get_creator_analytics", { _days: days }),
      ]);

      const rawPings = (pingsRes.data ?? []) as unknown as Array<{
        id: string;
        category: string;
        content: string;
        created_at: string;
        likes?: Array<{ count: number }>;
        replies?: Array<{ count: number }>;
      }>;

      const normalizedPings: TopPingItem[] = rawPings.map((p) => ({
        id: p.id,
        category: p.category,
        content: p.content,
        created_at: p.created_at,
        likes: p.likes?.[0]?.count ?? 0,
        replies: p.replies?.[0]?.count ?? 0,
      }));

      const windowPings = normalizedPings.filter((p) => p.created_at >= sinceIso);
      const totalLikesInWindow = windowPings.reduce((acc, p) => acc + p.likes, 0);
      const totalRepliesInWindow = windowPings.reduce((acc, p) => acc + p.replies, 0);

      const rpcData =
        !rpcRes.error && rpcRes.data && typeof rpcRes.data === "object"
          ? (rpcRes.data as Record<string, number>)
          : null;

      const pingsCount = rpcData?.["pings_count"] ?? windowPings.length;
      const likesReceived = rpcData?.["likes_received"] ?? totalLikesInWindow;
      const commentsReceived = rpcData?.["comments_received"] ?? totalRepliesInWindow;

      const catMap = new Map<string, { count: number; engagement: number }>();
      for (const p of windowPings) {
        const prev = catMap.get(p.category) ?? { count: 0, engagement: 0 };
        catMap.set(p.category, {
          count: prev.count + 1,
          engagement: prev.engagement + p.likes + p.replies,
        });
      }

      const categoryBreakdown: CategoryBreakdownItem[] = CATEGORIES.map((c) => ({
        category: c.value,
        label: c.label,
        emoji: c.emoji,
        count: catMap.get(c.value)?.count ?? 0,
        engagement: catMap.get(c.value)?.engagement ?? 0,
      })).filter((c) => c.count > 0);

      const topPings = [...normalizedPings]
        .sort((a, b) => b.likes + b.replies - (a.likes + a.replies))
        .slice(0, 5);

      return {
        days,
        totals: {
          pingsCount,
          likesReceived,
          commentsReceived,
          followersCount: rpcData?.["followers_count"] ?? followersRes.count ?? 0,
          followingCount: rpcData?.["following_count"] ?? followingRes.count ?? 0,
          momentsCount: rpcData?.["moments_count"] ?? 0,
          momentViews: rpcData?.["moment_views"] ?? 0,
          momentLikes: rpcData?.["moment_likes"] ?? 0,
          hubsJoined: rpcData?.["hubs_joined"] ?? hubsRes.count ?? 0,
          signalsSubscribed: rpcData?.["signals_subscribed"] ?? 0,
          avgEngagementPerPing:
            pingsCount > 0
              ? Number(((likesReceived + commentsReceived) / pingsCount).toFixed(1))
              : 0,
        },
        dailySeries: buildDailySeries(windowPings, days),
        categoryBreakdown,
        topPings,
      };
    },
  });
}
