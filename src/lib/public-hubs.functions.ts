import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchPublicHub, fetchPublicHubs } from "@/lib/public-queries";

async function publicClient() {
  const { createPublicSupabaseClient } = await import("./supabase-public-config");
  return createPublicSupabaseClient();
}

export const readPublicHubs = createServerFn({ method: "GET" })
  .validator(
    z.object({
      q: z.string().max(60).default(""),
      category: z.string().max(20).nullable().default(null),
      page: z.number().int().min(0).max(10000).default(0),
    }),
  )
  .handler(async ({ data }) => fetchPublicHubs(await publicClient(), data));

/** Hub details for SSR. Feed is only returned for public hubs; private feeds load per viewer. */
export const readPublicHub = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string().max(40), intent: z.string().max(20).nullable() }))
  .handler(async ({ data }) => fetchPublicHub(await publicClient(), data));
