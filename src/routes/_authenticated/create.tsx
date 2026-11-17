import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { PingComposer, type PingDraft } from "@/components/ping/PingComposer";
import { pingSchema } from "@/lib/validation";

export const Route = createFileRoute("/_authenticated/create")({
  staticData: { sitemap: false },
  validateSearch: z.object({
    hub: z.string().optional(),
  }),
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Create a Ping — PING" },
      {
        name: "description",
        content: "Share an intention. Find the people and resources to make it happen.",
      },
      { property: "og:title", content: "Create a Ping" },
      { property: "og:description", content: "Share your intention on PING." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Create,
});

function Create() {
  const { hub: initialHubId } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: async (d: PingDraft) => {
      const { data: u } = await supabase.auth.getUser();
      const author = u.user;
      if (!author) throw new Error("Please log in again before publishing.");
      const draft = pingSchema.parse(d);
      const { data, error } = await supabase
        .from("pings")
        .insert({
          user_id: author.id,
          category: draft.category,
          content: draft.content,
          image_url: d.image_url || null,
          cta_url: draft.cta_url || null,
          cta_label: draft.cta_label || null,
        })
        .select("id")
        .single();
      if (error) throw error;

      if (d.hub_id) {
        const { error: hubError } = await supabase.rpc("share_ping_to_hub", {
          _hub: d.hub_id,
          _ping: data.id,
          ...(d.hub_intent ? { _intent: d.hub_intent } : {}),
        });
        if (hubError) {
          console.warn("Failed to attach to hub:", hubError);
        }
      }

      return data.id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries();
      toast.success("Your Ping is live");
      navigate({ to: "/p/$id", params: { id } });
    },
    onError: () => toast.error("Couldn't publish your Ping. Try again."),
  });
  return (
    <div className="mx-auto max-w-2xl px-5 py-10 pb-24">
      <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
        Create a Ping
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Share an intention. Find the people and resources to make it happen.
      </p>
      <div className="mt-6">
        <PingComposer
          initial={initialHubId ? { hub_id: initialHubId } : undefined}
          submitLabel="Publish Ping"
          pending={m.isPending}
          onSubmit={(d) => m.mutate(d)}
        />
      </div>
    </div>
  );
}
