import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

export const PUBLIC_PING_SELECT = "id,user_id,category,content,image_url,cta_url,cta_label,created_at,updated_at,author:profiles!pings_user_id_fkey(id,username,display_name,avatar_url),likes(count)";

export const readPublicPings = createServerFn({ method: "GET" })
  .inputValidator(z.object({ kind: z.enum(["feed", "ping", "profile"]), value: z.string().nullable(), page: z.number().int().min(0).max(100000).default(0) }))
  .handler(async ({ data }) => {
    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!url || !key) throw new Error("Public reading is temporarily unavailable.");
    const client = createClient<Database>(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      } },
    });
    if (data.kind === "profile") {
      const { data: profile, error } = await client.from("profiles").select("id,username,display_name,bio,avatar_url,created_at").eq("username", (data.value ?? "").toLowerCase()).maybeSingle();
      if (error) throw new Error("Couldn't load this profile. Please try again.");
      if (!profile) return { profile: null, pings: [] };
      const { data: pings, error: pingError } = await client.from("pings").select(PUBLIC_PING_SELECT).eq("user_id", profile.id).order("created_at", { ascending: false }).order("id", { ascending: false });
      if (pingError) throw new Error("Couldn't load this profile's Pings. Please try again.");
      return { profile, pings: pings ?? [] };
    }
    let query = client.from("pings").select(PUBLIC_PING_SELECT).order("created_at", { ascending: false }).order("id", { ascending: false });
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
  });