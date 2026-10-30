import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/api/public/ping-card/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        if (!z.string().uuid().safeParse(params.id).success) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
        try {
          const { createClient } = await import("@supabase/supabase-js");
          const url = process.env["SUPABASE_URL"];
          const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
          if (!url || !key) throw new Error("Public reading unavailable");
          const client = createClient(url, key, {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { fetch: (input, init) => {
              const headers = new Headers(init?.headers);
              if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
              headers.set("apikey", key);
              return fetch(input, { ...init, headers });
            } },
          });
          const { data, error } = await client.from("pings").select("id,content,category,image_url,updated_at,author:profiles!pings_user_id_fkey(id,username,display_name,avatar_url)").is("hidden_at", null).eq("id", params.id).maybeSingle();
          if (error) throw new Error("Public reading failed");
          if (!data) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
          const { renderSocialPng } = await import("@/lib/sharing/social");
          const author = Array.isArray(data.author) ? data.author[0] ?? null : data.author;
          const ping = { ...data, author };
          const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`card-v1:${JSON.stringify(ping)}`));
          const etag = `"${Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("")}"`;
          const headers = { "Content-Type": "image/png", "Cache-Control": "public, max-age=300, must-revalidate", "ETag": etag, "X-Content-Type-Options": "nosniff" };
          if (request.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers });
          const png = await renderSocialPng(ping);
          return new Response(new Uint8Array(png).buffer, { headers });
        } catch (error) {
          console.error("Ping social image failed", error instanceof Error ? error.message : "Unknown error");
          return new Response("Card temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } });
        }
      },
    },
  },
});