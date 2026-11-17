import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { HUB_PAGE_SIZE, HUB_SELECT } from "@/lib/hubs";
import { PUBLIC_PING_SELECT } from "@/lib/public-pings.functions";

async function publicClient() {
  const { createPublicSupabaseClient } = await import("./supabase-public-config");
  return createPublicSupabaseClient();
}

export const readPublicHubs = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      q: z.string().max(60).default(""),
      category: z.string().max(20).nullable().default(null),
      page: z.number().int().min(0).max(10000).default(0),
    }),
  )
  .handler(async ({ data }) => {
    const client = await publicClient();
    let query = client
      .from("hubs")
      .select(HUB_SELECT)
      .is("hidden_at", null)
      .order("member_count", { ascending: false })
      .order("created_at", { ascending: false })
      .range(data.page * HUB_PAGE_SIZE, data.page * HUB_PAGE_SIZE + HUB_PAGE_SIZE - 1);
    if (data.category) query = query.eq("category", data.category);
    const term = data.q.replace(/[%_,()*]/g, " ").trim();
    if (term) query = query.or(`name.ilike.%${term}%,tagline.ilike.%${term}%`);
    const { data: hubs, error } = await query;
    if (error) throw new Error("Couldn't load hubs. Please try again.");
    return hubs ?? [];
  });

/** Hub details for SSR. Feed is only returned for public hubs; private feeds load per viewer. */
export const readPublicHub = createServerFn({ method: "GET" })
  .inputValidator(z.object({ slug: z.string().max(40), intent: z.string().max(20).nullable() }))
  .handler(async ({ data }) => {
    const client = await publicClient();
    const { data: hub, error } = await client
      .from("hubs")
      .select(HUB_SELECT)
      .eq("slug", data.slug.toLowerCase())
      .is("hidden_at", null)
      .maybeSingle();
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
  });
