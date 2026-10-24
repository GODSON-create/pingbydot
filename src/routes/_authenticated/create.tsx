import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PingComposer, type PingDraft } from "@/components/ping/PingComposer";
import { pingSchema } from "@/lib/validation";

export const Route = createFileRoute("/_authenticated/create")({
  head: () => ({
    meta: [
      { title: "Create a Ping — Ping" },
      { name: "description", content: "Share progress, an idea, a launch or a milestone." },
      { property: "og:title", content: "Create a Ping" },
      { property: "og:description", content: "Share your story on Ping." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Create,
});

function Create() {
  const { user } = useAuth();
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
        .insert({ user_id: author.id, category: draft.category, content: draft.content, cta_url: draft.cta_url || null, cta_label: draft.cta_label || null })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries();
      toast.success("Your Ping is live 🎉");
      navigate({ to: "/p/$id", params: { id } });
    },
    onError: () => toast.error("Couldn't publish your Ping. Try again."),
  });
  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <span className="sticker -rotate-2 bg-blush text-blush-foreground">new Ping</span>
      <h1 className="mt-4 font-display text-4xl font-extrabold sm:text-5xl">What are you building?</h1>
      <p className="mt-2 text-muted-foreground">Share a step, however small. Every Ping gets its own public link.</p>
      <div className="mt-8"><PingComposer submitLabel="Publish Ping" pending={m.isPending} onSubmit={(d) => m.mutate(d)} /></div>
    </div>
  );
}
