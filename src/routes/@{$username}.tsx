import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { profileQuery } from "@/lib/pings";
import { FounderAvatar } from "@/components/ping/Avatar";
import { PingCard } from "@/components/ping/PingCard";
import { ErrorComponent } from "@/routes/__root";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/@{$username}")({
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(profileQuery(params.username));
    if (!data) throw notFound();
    return data;
  },
  errorComponent: ErrorComponent,
  notFoundComponent: () => <div className="px-5 py-20 text-center"><h1 className="font-display text-4xl font-extrabold">No one here yet</h1><p>That founder profile doesn't exist.</p><Button asChild className="mt-6"><Link to="/explore">Explore Pings</Link></Button></div>,
  head: ({ params }) => ({
    meta: [
      { title: `@${params.username} — Ping` },
      { name: "description", content: `See what @${params.username} is building in public on Ping.` },
      { property: "og:title", content: `@${params.username} on Ping` },
      { property: "og:description", content: `Pings from @${params.username}.` },
      { property: "og:type", content: "profile" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { username } = Route.useParams();
  const { user } = useAuth();
  const { data } = useSuspenseQuery(profileQuery(username));
  if (!data)
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <h1 className="font-display text-4xl font-extrabold">No one here yet</h1>
        <p className="mt-2 text-muted-foreground">There's no founder with the username @{username}.</p>
        <Button asChild variant="hero" className="mt-6"><Link to="/explore">Explore Pings</Link></Button>
      </div>
    );

  const { profile, pings } = data;
  const isMe = user?.id === profile.id;
  const name = profile.display_name || profile.username;

  return (
    <div>
      <section className="bg-hero">
        <div className="mx-auto max-w-4xl px-5 pb-10 pt-12">
          <div className="surface-card relative rounded-[2rem] p-6 sm:p-9">
            <span className="sticker absolute -top-3 right-6 rotate-3 bg-lime text-lime-foreground">founder</span>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <FounderAvatar name={name} src={profile.avatar_url} size="xl" />
              <div className="flex-1">
                <h1 className="font-display text-3xl font-extrabold sm:text-4xl">{name}</h1>
                <p className="text-muted-foreground">@{profile.username} · on Ping since {format(new Date(profile.created_at), "MMM yyyy")}</p>
                {profile.bio && <p className="mt-3 max-w-xl whitespace-pre-line">{profile.bio}</p>}
              </div>
              <div className="flex gap-2 sm:flex-col">
                <Button variant="outline" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(`https://pingbydot.lovable.app/@${encodeURIComponent(profile.username)}`); toast.success("Profile link copied"); } catch { toast.error("Couldn't copy. Copy the link from the address bar."); } }}><Link2 /> Copy profile link</Button>
                {isMe && <Button asChild size="sm" variant="secondary"><Link to="/settings">Edit profile</Link></Button>}
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-4xl px-5">
        <h2 className="font-display text-xl font-bold">{pings.length} {pings.length === 1 ? "Ping" : "Pings"}</h2>
        {pings.length === 0 ? (
          <div className="mt-5 rounded-3xl border border-dashed p-10 text-center text-muted-foreground">
            {isMe ? (<><p>You haven't shared anything yet.</p><Button asChild variant="hero" className="mt-4"><Link to="/create">Create your first Ping</Link></Button></>) : <p>{name} hasn't shared a Ping yet.</p>}
          </div>
        ) : (
          <div className="mt-5 grid gap-5 md:grid-cols-2">{pings.map((p) => <PingCard key={p.id} ping={p} />)}</div>
        )}
      </section>
    </div>
  );
}
