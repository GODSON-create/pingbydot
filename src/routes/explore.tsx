import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { feedQuery } from "@/lib/pings";
import { CATEGORIES } from "@/lib/validation";
import { PingCard, PingCardSkeleton } from "@/components/ping/PingCard";
import { Button } from "@/components/ui/button";
import { AriseCallout } from "@/components/AriseCallout";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/explore")({
  validateSearch: z.object({ c: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Explore Pings — Ping" },
      { name: "description", content: "Browse the latest Pings: progress, ideas, launches, milestones and opportunities from people building in public." },
      { property: "og:title", content: "Explore Pings" },
      { property: "og:description", content: "See what people are building in public." },
    ],
  }),
  component: Explore,
});

function Explore() {
  const { c } = Route.useSearch();
  const cat = CATEGORIES.some((x) => x.value === c) ? c! : null;
  const { data, isLoading, error, refetch } = useQuery(feedQuery(cat));

  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="sticker rotate-[-2deg] bg-lime text-lime-foreground">fresh Pings</span>
          <h1 className="mt-4 font-display text-4xl font-extrabold sm:text-6xl">Explore</h1>
          <p className="mt-2 max-w-lg text-muted-foreground">The latest from people building in public, newest first.</p>
        </div>
        <Button asChild variant="hero"><Link to="/create">Share a Ping</Link></Button>
      </div>

      <nav className="-mx-5 mt-8 flex gap-2 overflow-x-auto px-5 pb-2" aria-label="Filter by type">
        <Link to="/explore" search={{}} className={cn("shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors", !cat ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-secondary")}>All</Link>
        {CATEGORIES.map((x) => (
          <Link key={x.value} to="/explore" search={{ c: x.value }} className={cn("shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors", cat === x.value ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-secondary")}>
            <span aria-hidden>{x.emoji}</span> {x.label}
          </Link>
        ))}
      </nav>

      <div className="mt-8 columns-1 gap-5 md:columns-2 lg:columns-3 [&>*]:mb-5 [&>*]:break-inside-avoid">
        {isLoading && Array.from({ length: 6 }).map((_, i) => <PingCardSkeleton key={i} />)}
        {data?.map((p) => <PingCard key={p.id} ping={p} />)}
      </div>

      {error && (
        <div className="surface-card rounded-3xl p-8 text-center">
          <p className="font-semibold">Couldn't load Pings.</p>
          <Button variant="outline" className="mt-4" onClick={() => refetch()}>Try again</Button>
        </div>
      )}

      {data && data.length === 0 && (
        <div className="surface-card mx-auto max-w-lg rounded-3xl p-10 text-center">
          <div className="mx-auto size-14 rounded-full border-[1.5px] border-foreground bg-lime animate-float-a" />
          <h2 className="mt-5 font-display text-2xl font-bold">{cat ? "No Pings of this type yet" : "It's quiet in here — for now"}</h2>
          <p className="mt-2 text-muted-foreground">Be the first to share what you're building. Your Ping gets its own public link.</p>
          <Button asChild variant="hero" className="mt-6"><Link to="/create">Create the first Ping</Link></Button>
        </div>
      )}

      <div className="mt-16"><AriseCallout /></div>
    </div>
  );
}
