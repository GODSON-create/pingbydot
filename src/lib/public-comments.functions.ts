import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchPublicComments } from "@/lib/public-queries";

export const readPublicComments = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({ pingId: z.string().uuid(), page: z.number().int().min(0).max(10000).default(0) }),
  )
  .handler(async ({ data }) => {
    const { createPublicSupabaseClient } = await import("./supabase-public-config");
    return fetchPublicComments(createPublicSupabaseClient(), data);
  });
