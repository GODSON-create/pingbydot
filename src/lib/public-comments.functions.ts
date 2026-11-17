import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { COMMENT_PAGE_SIZE } from "./comments";

const COMMENT_SELECT =
  "id,ping_id,user_id,parent_id,root_id,depth,content,created_at,updated_at,deleted_at,author:profiles!comments_user_id_fkey(id,username,display_name,avatar_url),likes:comment_likes(count)";

export const readPublicComments = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({ pingId: z.string().uuid(), page: z.number().int().min(0).max(10000).default(0) }),
  )
  .handler(async ({ data }) => {
    const { createPublicSupabaseClient } = await import("./supabase-public-config");
    const client = createPublicSupabaseClient();
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
  });
