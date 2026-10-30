import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import type { Ping } from "@/lib/pings";
import { PingComposer, type PingDraft } from "@/components/ping/PingComposer";
import { pingSchema, type Category } from "@/lib/validation";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/edit/$id")({
  head: () => ({
    meta: [
      { title: "Edit Ping — Ping" },
      { name: "description", content: "Edit your Ping." },
      { property: "og:title", content: "Edit Ping" },
      { property: "og:description", content: "Edit your Ping." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Edit,
});

function Edit() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: ping, isLoading, isError, refetch } = useQuery({
    queryKey: ["owner-ping", id, user?.id], enabled: !!user,
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase.from("pings").select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
      if (error) throw error;
      return data as Pick<Ping, "id" | "user_id" | "content" | "category" | "cta_url" | "cta_label"> & { hidden_at: string | null } | null;
    },
  });
  const m = useMutation({
    mutationFn: async (d: PingDraft) => {
      if (!user) throw new Error("Please log in again.");
      const draft = pingSchema.parse(d);
      const { data: saved, error } = await supabase.from("pings").update({ category: draft.category, content: draft.content, cta_url: draft.cta_url || null, cta_label: draft.cta_label || null }).eq("id", id).eq("user_id", user.id).select("id").single();
      if (error) throw error;
      if (!saved) throw new Error("Ping wasn't saved.");
    },
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Ping updated");
      if (!ping?.hidden_at) navigate({ to: "/p/$id", params: { id } });
    },
    onError: () => toast.error("Couldn't save changes."),
  });

  if (isLoading) return <div className="mx-auto max-w-2xl px-5 py-16 text-muted-foreground">Loading…</div>;
  if (isError) return <div className="mx-auto max-w-md px-5 py-20" role="alert">Couldn't load your Ping. <Button onClick={() => refetch()}>Retry</Button></div>;
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
      {ping.hidden_at && <p role="status" className="mt-4 text-muted-foreground">This Ping is hidden by moderation. Saving changes does not restore public visibility.</p>}
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
