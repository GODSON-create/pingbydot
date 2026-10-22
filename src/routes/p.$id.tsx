import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, Copy } from "lucide-react";
import { toast } from "sonner";
import { pingQuery, pingUrl } from "@/lib/pings";
import { FounderAvatar } from "@/components/ping/Avatar";
import { CategoryTag, CtaLink } from "@/components/ping/PingCard";
import { LikeButton, PingMenu, ShareMenu } from "@/components/ping/PingActions";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/p/$id")({
  head: () => ({
    meta: [
      { title: "A Ping — Ping" },
      { name: "description", content: "Read this Ping: a story from someone building in public." },
      { property: "og:title", content: "A Ping on Ping" },
      { property: "og:description", content: "Someone is building in public. Read their Ping." },
      { property: "og:type", content: "article" },
    ],
  }),
  component: PingDetail,
});

function PingDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: ping, isLoading, error } = useQuery(pingQuery(id));

  if (isLoading)
    return <div className="mx-auto max-w-2xl px-5 py-16"><div className="surface-card h-72 animate-pulse rounded-3xl" /></div>;
  if (error || !ping)
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <span className="sticker bg-blush text-blush-foreground">not found</span>
        <h1 className="mt-5 font-display text-4xl font-extrabold">This Ping isn't here</h1>
        <p className="mt-2 text-muted-foreground">It may have been deleted, or the link is mistyped.</p>
        <Button asChild variant="hero" className="mt-6"><Link to="/explore">Explore Pings</Link></Button>
      </div>
    );

  const name = ping.author?.display_name || ping.author?.username || "Founder";
  const url = pingUrl(ping.id);

  return (
    <div className="bg-hero">
      <div className="mx-auto max-w-2xl px-5 py-10 sm:py-14">
        <Link to="/explore" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Explore</Link>
        <article className="surface-card mt-5 rounded-[2rem] p-6 sm:p-9">
          <header className="flex items-center gap-3">
            {ping.author && (
              <Link to="/@{$username}" params={{ username: ping.author.username }} className="flex flex-1 items-center gap-3">
                <FounderAvatar name={name} src={ping.author.avatar_url} size="lg" />
                <span>
                  <span className="block font-display text-lg font-bold hover:underline">{name}</span>
                  <span className="block text-sm text-muted-foreground">@{ping.author.username}</span>
                </span>
              </Link>
            )}
            <CategoryTag value={ping.category} />
          </header>
          <p className="mt-6 whitespace-pre-line break-words text-lg leading-relaxed sm:text-xl">{ping.content}</p>
          <CtaLink ping={ping} />
          <p className="mt-6 text-sm text-muted-foreground">
            <time dateTime={ping.created_at}>{format(new Date(ping.created_at), "MMM d, yyyy · h:mm a")}</time>
            {ping.updated_at !== ping.created_at && new Date(ping.updated_at).getTime() - new Date(ping.created_at).getTime() > 5000 && " · edited"}
          </p>
          <footer className="mt-4 flex items-center justify-between border-t border-border pt-4">
            <LikeButton ping={ping} />
            <div className="flex items-center gap-1">
              <ShareMenu ping={ping} variant="outline" />
              <PingMenu ping={ping} onDeleted={() => navigate({ to: "/explore" })} />
            </div>
          </footer>
        </article>

        <div className="glass mt-5 flex items-center gap-3 rounded-2xl p-3 pl-5">
          <span className="min-w-0 flex-1 truncate font-mono text-sm text-muted-foreground">{url}</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(url);
              toast.success("Link copied");
            }}
          >
            <Copy /> Copy link
          </Button>
        </div>

        {!user && (
          <div className="mt-8 rounded-3xl border border-dashed border-primary/40 p-6 text-center">
            <p className="font-display text-xl font-bold">Building something too?</p>
            <p className="mt-1 text-sm text-muted-foreground">Join Ping to like this and share your own story.</p>
            <Button asChild variant="hero" className="mt-4"><Link to="/signup">Create your first Ping</Link></Button>
          </div>
        )}
      </div>
    </div>
  );
}
