import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useDeferredValue } from "react";
import { z } from "zod";
import { Search, Plus, Users, Lock, Globe, Building2 } from "lucide-react";
import { hubsQuery } from "@/lib/hub-queries";
import { HUB_CATEGORIES, type HubCategory, type Hub } from "@/lib/hubs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { pageHead } from "@/lib/site";

export const Route = createFileRoute("/hubs")({
  staticData: { sitemap: true },
  validateSearch: z.object({
    category: z.string().optional(),
    q: z.string().optional(),
  }),
  head: () =>
    pageHead({
      title: "Hubs — Ping by DOT",
      description:
        "Explore builder collectives, university clubs, and startup communities on Ping.",
      path: "/hubs",
    }),
  component: HubsDirectory,
});

function HubCard({ hub }: { hub: Hub }) {
  const cat = HUB_CATEGORIES.find((c) => c.value === hub.category);
  const isPrivate = hub.access === "private";

  return (
    <article className="surface-card lift relative flex flex-col justify-between rounded-3xl p-5 sm:p-6">
      <div>
        <header className="flex items-start gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-secondary text-2xl font-bold">
            {cat?.emoji ?? "🏢"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Link
                to="/hubs/$slug"
                params={{ slug: hub.slug }}
                className="font-display text-lg font-bold hover:underline truncate"
              >
                {hub.name}
              </Link>
              {hub.verified && (
                <span
                  title="Verified Hub"
                  className="inline-flex items-center gap-1 rounded-full bg-gold/15 text-gold border border-gold/30 px-2 py-0.5 text-[10px] font-bold"
                >
                  ✓ Verified
                </span>
              )}
            </div>
            {hub.tagline && (
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{hub.tagline}</p>
            )}
          </div>
        </header>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold">
            <span>{cat?.emoji}</span>
            {cat?.label ?? hub.category}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
              isPrivate
                ? "bg-blush text-blush-foreground"
                : "bg-accent text-accent-foreground",
            )}
          >
            {isPrivate ? (
              <>
                <Lock className="size-3" /> Private
              </>
            ) : (
              <>
                <Globe className="size-3" /> Public
              </>
            )}
          </span>
        </div>

        <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Users className="size-3.5" />
            {(hub.member_count ?? 0).toLocaleString()} /{" "}
            {(hub.member_limit || 10000).toLocaleString()} builders
          </span>
          <span>·</span>
          <span>{(hub.ping_count ?? 0).toLocaleString()} pings</span>
        </div>
      </div>

      <div className="mt-5 pt-3 border-t border-border flex items-center justify-between gap-2">
        <Button asChild variant="outline" size="sm" className="w-full rounded-2xl">
          <Link to="/hubs/$slug" params={{ slug: hub.slug }}>
            View Hub
          </Link>
        </Button>
        <Button asChild variant="hero" size="sm" className="w-full rounded-2xl">
          <Link to="/hubs/$slug" params={{ slug: hub.slug }}>
            {isPrivate ? "Request Access" : "Join Hub"}
          </Link>
        </Button>
      </div>
    </article>
  );
}

function HubsDirectory() {
  const { category: catParam, q: qParam } = Route.useSearch();
  const [searchTerm, setSearchTerm] = useState(qParam ?? "");
  const deferredSearch = useDeferredValue(searchTerm);
  const { user } = useAuth();

  const selectedCategory = HUB_CATEGORIES.some((c) => c.value === catParam)
    ? (catParam as HubCategory)
    : null;

  const { data: hubs, isLoading, error, refetch } = useQuery(
    hubsQuery(deferredSearch, selectedCategory, 0),
  );

  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      {/* Hero header */}
      <div className="relative overflow-hidden rounded-[2.5rem] bg-hero p-8 sm:p-12 mb-10 border border-border">
        <span className="sticker rotate-[-2deg] bg-lime text-lime-foreground">
          builder collectives
        </span>
        <h1 className="mt-4 font-display text-4xl font-extrabold sm:text-6xl">Hubs</h1>
        <p className="mt-3 max-w-xl text-muted-foreground text-base sm:text-lg">
          Dedicated spaces for university clubs, accelerators, startup teams, and builder communities
          to build in public together.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button asChild variant="hero" size="lg" className="rounded-full shadow-lift">
            <Link to="/hubs/create">
              <Plus className="size-5" /> Create a Hub
            </Link>
          </Button>
          {!user && (
            <Button asChild variant="outline" size="lg" className="rounded-full">
              <Link to="/signup">Join Ping</Link>
            </Button>
          )}
        </div>
      </div>

      {/* Search and Category Filters */}
      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search hubs by name or tagline…"
            className="h-12 pl-11 rounded-2xl bg-card border-border shadow-sm text-sm"
          />
        </div>

        <nav
          className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-2"
          aria-label="Filter hubs by category"
        >
          <Link
            to="/hubs"
            search={(prev) => ({ ...prev, category: undefined })}
            className={cn(
              "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
              !selectedCategory
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card hover:bg-secondary",
            )}
          >
            All Hubs
          </Link>
          {HUB_CATEGORIES.map((c) => (
            <Link
              key={c.value}
              to="/hubs"
              search={(prev) => ({ ...prev, category: c.value })}
              className={cn(
                "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                selectedCategory === c.value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card hover:bg-secondary",
              )}
            >
              <span>{c.emoji}</span> {c.label}
            </Link>
          ))}
        </nav>
      </div>

      {/* Grid of Hubs */}
      <div className="mt-8">
        {isLoading && (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="surface-card h-56 animate-pulse rounded-3xl" />
            ))}
          </div>
        )}

        {error && (
          <div className="surface-card rounded-3xl p-10 text-center">
            <p className="font-semibold text-destructive">Couldn't load hubs right now.</p>
            <Button variant="outline" className="mt-4 rounded-full" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        )}

        {hubs && hubs.length > 0 && (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {hubs.map((hub) => (
              <HubCard key={hub.id} hub={hub} />
            ))}
          </div>
        )}

        {hubs && hubs.length === 0 && (
          <div className="surface-card mx-auto max-w-lg rounded-3xl p-10 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-secondary text-2xl animate-float-a">
              <Building2 className="size-7 text-muted-foreground" />
            </div>
            <h2 className="mt-5 font-display text-2xl font-bold">No hubs found</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {searchTerm
                ? `No hubs match "${searchTerm}". Try another search term or create one.`
                : "Be the first to create a space for your collective!"}
            </p>
            <Button asChild variant="hero" className="mt-6 rounded-full">
              <Link to="/hubs/create">
                <Plus className="size-4" /> Create a Hub
              </Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
