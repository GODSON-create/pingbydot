import { createFileRoute } from "@tanstack/react-router";
import { buildPingOpenApiSpec } from "@/lib/developer";
import { buildPublicEdgeCacheHeaders } from "@/lib/scale";
import { SITE_ORIGIN } from "@/lib/site";

export const Route = createFileRoute("/api/v1/openapi.json")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      GET: async () => {
        const spec = buildPingOpenApiSpec(SITE_ORIGIN);
        return new Response(JSON.stringify(spec, null, 2), {
          status: 200,
          headers: buildPublicEdgeCacheHeaders(300, 600),
        });
      },
    },
  },
});
