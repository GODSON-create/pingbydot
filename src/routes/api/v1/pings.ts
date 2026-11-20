import { createFileRoute } from "@tanstack/react-router";
import { PUBLIC_PING_SELECT } from "@/lib/public-queries";
import { buildPublicEdgeCacheHeaders, decodePingCursor, encodePingCursor } from "@/lib/scale";

const ALLOWED_CATEGORIES = new Set([
  "progress",
  "need",
  "offer",
  "opportunity",
  "idea",
  "question",
  "collaboration",
  "update",
  "launch",
  "milestone",
]);

/**
 * Public Keyset-Paginated Pings API (Phase 5.2 & 5.5).
 * Uses `(created_at, id)` cursor pagination to remain O(1) at 1M+ rows and
 * applies short CDN edge micro-caching (`s-maxage=15, stale-while-revalidate=60`).
 */
export const Route = createFileRoute("/api/v1/pings")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const rawCategory = url.searchParams.get("category")?.trim().toLowerCase() ?? "";
        const category = ALLOWED_CATEGORIES.has(rawCategory) ? rawCategory : null;
        const limitRaw = Number(url.searchParams.get("limit") ?? 20);
        const limit = Number.isFinite(limitRaw)
          ? Math.max(1, Math.min(50, Math.floor(limitRaw)))
          : 20;
        const rawCursor = url.searchParams.get("cursor");
        const cursor = rawCursor ? decodePingCursor(rawCursor) : null;

        if (rawCursor && !cursor) {
          return new Response(JSON.stringify({ error: "Invalid pagination cursor." }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { createPublicSupabaseClient } = await import("@/lib/supabase-public-config");
        const client = createPublicSupabaseClient();

        let query = client
          .from("pings")
          .select(PUBLIC_PING_SELECT)
          .is("hidden_at", null)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(limit + 1);

        if (category) {
          query = query.eq("category", category);
        }

        if (cursor) {
          query = query.or(
            `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
          );
        }

        const { data, error } = await query;
        if (error) {
          return new Response(JSON.stringify({ error: "Unable to query public Pings." }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
          });
        }

        const rows = (data ?? []) as Array<
          { id: string; created_at: string } & Record<string, unknown>
        >;
        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;
        const last = items[items.length - 1];
        const nextCursor =
          hasMore && last ? encodePingCursor({ createdAt: last.created_at, id: last.id }) : null;

        return new Response(
          JSON.stringify({
            items,
            nextCursor,
            pagination: { mode: "keyset", limit, hasMore },
          }),
          {
            status: 200,
            headers: {
              ...buildPublicEdgeCacheHeaders(15, 60),
              "X-RateLimit-Policy": "public-edge-cached",
            },
          },
        );
      },
    },
  },
});
