import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { COMMENT_PAGE_SIZE } from "@/lib/comments";
import { PLATFORMS, publicConnections, type Platform } from "@/lib/connections";
import { HUB_PAGE_SIZE, HUB_SELECT, HUB_SELECT_LEGACY } from "@/lib/hubs";

function isMissingHubAvatarColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42703" || error.code === "PGRST204" || /avatar_url/i.test(error.message ?? "")
  );
}

export const PUBLIC_PING_SELECT =
  "id,user_id,category,content,image_url,cta_url,cta_label,created_at,updated_at,author:profiles!pings_user_id_fkey(id,username,display_name,avatar_url),likes(count),replies:comments!comments_ping_id_fkey(count),source_ping_id,source_comment_id,source_comment:comments!pings_source_comment_id_fkey(id,ping_id,content,deleted_at,author:profiles!comments_user_id_fkey(username,display_name))";

const COMMENT_SELECT =
  "id,ping_id,user_id,parent_id,root_id,depth,content,created_at,updated_at,deleted_at,author:profiles!comments_user_id_fkey(id,username,display_name,avatar_url),likes:comment_likes(count)";

export type PublicSupabaseLike = SupabaseClient<Database>;

export async function fetchPublicPings(
  client: PublicSupabaseLike,
  data: { kind: "feed" | "ping" | "profile"; value: string | null; page: number },
) {
  if (data.kind === "profile") {
    const { data: profile, error } = await client
      .from("profiles")
      .select("*")
      .eq("username", (data.value ?? "").toLowerCase())
      .maybeSingle();
    if (error) throw new Error("Couldn't load this profile. Please try again.");
    if (!profile) return { profile: null, pings: [] };
    const profileVisibility = (profile as { profile_visibility?: string | null })
      .profile_visibility;
    if (profileVisibility === "private" || profileVisibility === "followers") {
      return { profile, pings: [], connections: [], visibilityRestricted: true };
    }
    const { data: pings, error: pingError } = await client
      .from("pings")
      .select(PUBLIC_PING_SELECT)
      .is("hidden_at", null)
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (pingError) throw new Error("Couldn't load this profile's Pings. Please try again.");
    const { data: connections, error: connectionError } = await client
      .from("profile_connections")
      .select("platform,handle,is_public,is_primary")
      .eq("user_id", profile.id)
      .eq("is_public", true);
    if (connectionError)
      throw new Error("Couldn't load this profile's connections. Please try again.");
    const validConnections = (connections ?? []).filter(
      (row): row is typeof row & { platform: Platform } =>
        PLATFORMS.includes(row.platform as Platform),
    );
    return { profile, pings: pings ?? [], connections: publicConnections(validConnections) };
  }

  let query = client
    .from("pings")
    .select(PUBLIC_PING_SELECT)
    .is("hidden_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (data.kind === "ping") {
    if (!z.string().uuid().safeParse(data.value).success) return { profile: null, pings: [] };
    query = query.eq("id", data.value ?? "");
  } else {
    if (data.value) query = query.eq("category", data.value);
    query = query.range(data.page * 60, data.page * 60 + 59);
  }

  const { data: pings, error } = await query;
  if (error) throw new Error("Couldn't load Pings. Please try again.");
  return { profile: null, pings: pings ?? [] };
}

export async function fetchPublicHubs(
  client: PublicSupabaseLike,
  data: { q: string; category: string | null; page: number },
) {
  const buildQuery = (columns: string) => {
    let query = client
      .from("hubs")
      .select(columns)
      .is("hidden_at", null)
      .order("member_count", { ascending: false })
      .order("created_at", { ascending: false })
      .range(data.page * HUB_PAGE_SIZE, data.page * HUB_PAGE_SIZE + HUB_PAGE_SIZE - 1);
    if (data.category) query = query.eq("category", data.category);
    const term = data.q.replace(/[%_,()*]/g, " ").trim();
    if (term) query = query.or(`name.ilike.%${term}%,tagline.ilike.%${term}%`);
    return query;
  };

  let { data: hubs, error } = await buildQuery(HUB_SELECT);
  if (isMissingHubAvatarColumn(error)) {
    ({ data: hubs, error } = await buildQuery(HUB_SELECT_LEGACY));
  }
  if (error) throw new Error("Couldn't load hubs. Please try again.");
  return hubs ?? [];
}

export async function fetchPublicHub(
  client: PublicSupabaseLike,
  data: { slug: string; intent: string | null },
) {
  let { data: hub, error } = await client
    .from("hubs")
    .select(HUB_SELECT)
    .eq("slug", data.slug.toLowerCase())
    .is("hidden_at", null)
    .maybeSingle();
  if (isMissingHubAvatarColumn(error)) {
    const legacyRes = await client
      .from("hubs")
      .select(HUB_SELECT_LEGACY)
      .eq("slug", data.slug.toLowerCase())
      .is("hidden_at", null)
      .maybeSingle();
    hub = legacyRes.data ? { ...legacyRes.data, avatar_url: null } : null;
    error = legacyRes.error;
  }
  if (error) throw new Error("Couldn't load this hub. Please try again.");
  if (!hub) return { hub: null, feed: [] };
  if (hub.access !== "public") return { hub, feed: [] };

  let q = client
    .from("hub_pings")
    .select(`intent,is_pinned,created_at,ping:pings!inner(${PUBLIC_PING_SELECT})`)
    .eq("hub_id", hub.id)
    .is("removed_at", null)
    .is("ping.hidden_at", null)
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(60);
  if (data.intent) q = q.eq("intent", data.intent);
  const { data: feed, error: feedError } = await q;
  if (feedError) throw new Error("Couldn't load this hub's Pings. Please try again.");
  return { hub, feed: feed ?? [] };
}

export async function fetchPublicComments(
  client: PublicSupabaseLike,
  data: { pingId: string; page: number },
) {
  const start = data.page * COMMENT_PAGE_SIZE;
  const roots = await client
    .from("comments")
    .select(COMMENT_SELECT)
    .eq("ping_id", data.pingId)
    .eq("depth", 0)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(start, start + COMMENT_PAGE_SIZE);
  if (roots.error) throw new Error("Couldn't load replies. Please try again.");
  const rootRows = (roots.data ?? []).slice(0, COMMENT_PAGE_SIZE);
  const hasMore = (roots.data ?? []).length > COMMENT_PAGE_SIZE;
  if (rootRows.length === 0) return { rows: [], hasMore: false };
  const replies = await client
    .from("comments")
    .select(COMMENT_SELECT)
    .eq("ping_id", data.pingId)
    .gt("depth", 0)
    .in(
      "root_id",
      rootRows.map((r) => r.id),
    )
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(500);
  if (replies.error) throw new Error("Couldn't load replies. Please try again.");
  return { rows: [...rootRows, ...(replies.data ?? [])], hasMore };
}
