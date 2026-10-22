import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { pingQuery } from "@/lib/pings";
import { PingComposer, type PingDraft } from "@/components/ping/PingComposer";
import type { Category } from "@/lib/validation";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/edit/$id")({
  head: () => ({
    meta: [
      { title: "Edit Ping — Ping" },
      { name: "description", content: "Edit your Ping." },
      { property: "og:title", content: "Edit Ping" },
      { property: "og:description", content: "Edit your Ping." },
    ],
  }),
  component: Edit,
});

function Edit() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: ping, isLoading } = useQuery(pingQuery(id));
  const m = useMutation({
    mutationFn: async (d: PingDraft) => {
      const { error } = await supabase.from("pings").update({ category: d.category, content: d.content, cta_url: d.cta_url || null, cta_label: d.cta_label || null }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Ping updated");
      navigate({ to: "/p/$id", params: { id } });
    },
    onError: () => toast.error("Couldn't save changes."),
  });

  if (isLoading) return <div className="mx-auto max-w-2xl px-5 py-16 text-muted-foreground">Loading…</div>;
  if (!ping || ping.user_id !== user?.id)
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <h1 className="font-display text-3xl font-bold">You can't edit this Ping</h1>
        <p className="mt-2 text-muted-foreground">Only the person who shared a Ping can change it.</p>
        <Button asChild className="mt-6"><Link to="/explore">Back to Explore</Link></Button>
      </div>
    );

  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="font-display text-4xl font-extrabold">Edit your Ping</h1>
      <p className="mt-2 text-muted-foreground">The link stays the same.</p>
      <div className="mt-8">
        <PingComposer
          initial={{ category: ping.category as Category, content: ping.content, cta_url: ping.cta_url ?? "", cta_label: ping.cta_label ?? "" }}
          submitLabel="Save changes"
          pending={m.isPending}
          onSubmit={(d) => m.mutate(d)}
        />
      </div>
    </div>
  );
}
