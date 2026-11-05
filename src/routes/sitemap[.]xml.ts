import { createFileRoute } from "@tanstack/react-router";
import { getRouterInstance } from "@tanstack/react-start";
import {
  sitemapPathForLocation,
  sitemapStaticPaths,
  sitemapXML,
  isSitemapRouteIncluded,
  type SitemapEntry,
} from "@/lib/sitemap";
import { SITE_ORIGIN } from "@/lib/site";

export const Route = createFileRoute("/sitemap.xml")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      GET: async () => {
        const router = await getRouterInstance();
        const entries: SitemapEntry[] = sitemapStaticPaths(router).map((path) => ({ path }));

        const { createClient } = await import("@supabase/supabase-js");
        const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
        const supabase = createClient(process.env["SUPABASE_URL"]!, key, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: {
            fetch: (input, init) => {
              const headers = new Headers(init?.headers);
              if (key.startsWith("sb_") && headers.get("Authorization") === "Bearer " + key)
                headers.delete("Authorization");
              headers.set("apikey", key);
              return fetch(input, { ...init, headers });
            },
          },
        });
        const pageSize = 1000;

        // Public Pings: same visibility filter as public readers (hidden Pings excluded).
        if (isSitemapRouteIncluded(router.routesById["/p/$id"])) {
          for (let offset = 0; ;) {
            const { data, error } = await supabase
              .from("pings")
              .select("id,updated_at")
              .is("hidden_at", null)
              .order("id")
              .range(offset, offset + pageSize - 1);
            if (error) throw error;
            if (!data || data.length === 0) break;
            for (const row of data) {
              const location = router.buildLocation({
                to: "/p/$id",
                params: { id: row.id },
                search: () => ({}),
                hash: "",
              });
              const path = sitemapPathForLocation(router, location, "/p/$id");
              if (path) entries.push({ path, lastmod: row.updated_at });
            }
            offset += data.length;
          }
        }

        // Public founder profiles.
        if (isSitemapRouteIncluded(router.routesById["/@{$username}"])) {
          for (let offset = 0; ;) {
            const { data, error } = await supabase
              .from("profiles")
              .select("id,username")
              .order("id")
              .range(offset, offset + pageSize - 1);
            if (error) throw error;
            if (!data || data.length === 0) break;
            for (const row of data) {
              if (!row.username) continue;
              const location = router.buildLocation({
                to: "/@{$username}",
                params: { username: row.username },
                search: () => ({}),
                hash: "",
              });
              const path = sitemapPathForLocation(router, location, "/@{$username}");
              if (path) entries.push({ path });
            }
            offset += data.length;
          }
        }

        return new Response(sitemapXML(SITE_ORIGIN, entries), {
          headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=3600" },
        });
      },
    },
  },
});
