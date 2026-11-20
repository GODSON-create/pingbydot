import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { PUBLIC_PING_SELECT, fetchPublicPings } from "@/lib/public-queries";

export { PUBLIC_PING_SELECT };

export const readPublicPings = createServerFn({ method: "GET" })
  .validator(
    z.object({
      kind: z.enum(["feed", "ping", "profile"]),
      value: z.string().nullable(),
      page: z.number().int().min(0).max(100000).default(0),
    }),
  )
  .handler(async ({ data }) => {
    const { createPublicSupabaseClient } = await import("./supabase-public-config");
    return fetchPublicPings(createPublicSupabaseClient(), data);
  });
