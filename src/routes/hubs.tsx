import {
  createFileRoute,
  Link,
  Outlet,
  useChildMatches,
  useNavigate,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useDeferredValue } from "react";
import { z } from "zod";
import {
  Search,
  Plus,
  Users,
  Lock,
  Globe,
  Building2,
  Check,
  Clock,
  Radio,
  Sparkles,
  Camera,
} from "lucide-react";
import { hubsQuery, myHubsQuery, myPendingHubsQuery } from "@/lib/hub-queries";
import { HUB_CATEGORIES, type HubCategory, type Hub } from "@/lib/hubs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MomentsTray } from "@/components/moments/MomentsTray";
import { DiscoverableMomentsFeed } from "@/components/moments/DiscoverableMomentsFeed";
import { MomentComposer } from "@/components/moments/MomentComposer";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { pageHead } from "@/lib/site";

export const Route = createFileRoute("/hubs")({
  staticData: { sitemap: true },
  validateSearch: z.object({
    category: z.string().optional(),
    q: z.string().optional(),
    view: z.enum(["moments"]).optional(),
  }),
  head: () =>
    pageHead({
      title: "Hub — Organizational & Community Spaces on PING",
      description:
        "Explore universities, companies, government institutions, NGOs, professional associations, and community Hubs with Forums and institutional broadcasts.",
      path: "/hubs",
    }),
  component: HubsLayout,
});

function HubsLayout() {
  const childMatches = useChildMatches();
  if (childMatches.length > 0) return <Outlet />;
  return <HubsDirectory />;
}

function HubCard({
  hub,
  isOwner,
  isMember,
  isPending,
}: {
  hub: Hub;
  isOwner: boolean;
  isMember: boolean;
  isPending: boolean;
}) {
  const cat = HUB_CATEGORIES.find((c) => c.value === hub.category);
  const isPrivate = hub.access === "private";

  return (
    <article className="surface-card lift relative flex flex-col justify-between rounded-3xl p-5 sm:p-6">
      <div>
        <header className="flex items-start gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-secondary text-xl font-bold">
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
                  title="Verified Institutional Hub"
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
            {cat?.label ?? hub.category}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
              isPrivate ? "bg-blush text-blush-foreground" : "bg-accent text-accent-foreground",
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

        <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
          <span className="flex items-center gap-1">
            <Users className="size-3.5" />
            {(hub.member_count ?? 0).toLocaleString()} members
          </span>
          <span>·</span>
          <span>Forums & Broadcasts</span>
        </div>
      </div>

      <div className="mt-5 pt-3 border-t border-border flex items-center justify-between gap-2">
        <Button asChild variant="outline" size="sm" className="w-full rounded-2xl">
          <Link to="/hubs/$slug" params={{ slug: hub.slug }}>
            Open Hub
          </Link>
        </Button>
        {isOwner ? (
          <span className="w-full text-center text-xs font-bold text-lime-foreground dark:text-lime bg-lime/20 dark:bg-lime/15 py-2 rounded-2xl border border-lime/30">
            Owner
          </span>
        ) : isMember ? (
          <span className="w-full inline-flex items-center justify-center gap-1 text-xs font-semibold text-primary bg-primary/10 py-2 rounded-2xl border border-primary/20">
            <Check className="size-3.5" /> Joined
          </span>
        ) : isPending ? (
          <span className="w-full inline-flex items-center justify-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-400 bg-amber-500/10 py-2 rounded-2xl border border-amber-500/20">
            <Clock className="size-3.5" /> Pending
          </span>
        ) : (
          <Button asChild variant="hero" size="sm" className="w-full rounded-2xl">
            <Link to="/hubs/$slug" params={{ slug: hub.slug }}>
              {isPrivate ? "Request Access" : "Join Hub"}
            </Link>
          </Button>
        )}
      </div>
    </article>
  );
}

function HubsDirectory() {
  const { category: catParam, q: qParam, view } = Route.useSearch();
  const [searchTerm, setSearchTerm] = useState(qParam ?? "");
  const [momentComposerOpen, setMomentComposerOpen] = useState(false);
  const deferredSearch = useDeferredValue(searchTerm);
  const { user } = useAuth();
  const navigate = useNavigate();

  const selectedCategory = HUB_CATEGORIES.some((c) => c.value === catParam)
    ? (catParam as HubCategory)
    : null;

  const {
    data: hubs,
    isLoading,
    error,
    refetch,
  } = useQuery(hubsQuery(deferredSearch, selectedCategory, 0));

  const { data: myHubs = [] } = useQuery(myHubsQuery(user?.id));
  const { data: myPendingHubs = new Set<string>() } = useQuery(myPendingHubsQuery(user?.id));
  const myHubIds = new Set(myHubs.map((h) => h.hub.id));

  const isMomentsView = view === "moments";

  return (
    <div className="mx-auto max-w-6xl w-full min-w-0 px-4 sm:px-6 py-8 pb-24 overflow-x-clip">
      {/* Community Section Switcher: Hub | Signal | Moment */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-secondary/80 p-1">
          <Link
            to="/hubs"
            search={{}}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors",
              !isMomentsView
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Building2 className="size-3.5" /> Hub
          </Link>
          <Link
            to="/signals"
            title="1-on-1 Chats & Conversations"
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <Radio className="size-3.5" /> Signal
          </Link>
          <Link
            to="/hubs"
            search={{ view: "moments" }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors",
              isMomentsView
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Sparkles className="size-3.5" /> Moment
          </Link>
        </div>

        {isMomentsView ? (
          <Button
            type="button"
            variant="hero"
            size="sm"
            onClick={() => {
              if (!user) {
                navigate({ to: "/login", search: { next: "/hubs?view=moments" } });
                return;
              }
              setMomentComposerOpen(true);
            }}
            className="rounded-full gap-1.5"
          >
            <Camera className="size-4" /> Share Community Moment
          </Button>
        ) : (
          <Button asChild variant="hero" size="sm" className="rounded-full gap-1.5">
            <Link to="/hubs/create">
              <Plus className="size-4" /> Create a Hub
            </Link>
          </Button>
        )}
      </div>

      {isMomentsView ? (
        /* COMMUNITY DESTINATION 4: COMMUNITY MOMENTS */
        <section className="space-y-8" aria-label="Community Moments">
          <div className="rounded-3xl bg-hero p-6 sm:p-9 border border-border">
            <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
              Community Moments
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
              Visual updates, events, and real-time media shared across your joined Hubs, Forums,
              and community participants.
            </p>
          </div>

          <div className="surface-card rounded-3xl p-5 sm:p-6 border border-border/80">
            <h2 className="font-display text-base font-bold mb-3 flex items-center gap-2">
              <Sparkles className="size-4 text-primary" /> Active Community Moments Rail
            </h2>
            <MomentsTray />
          </div>

          <DiscoverableMomentsFeed />

          <MomentComposer open={momentComposerOpen} onOpenChange={setMomentComposerOpen} />
        </section>
      ) : (
        /* COMMUNITY DESTINATION 2: HUB — ORGANIZATIONAL & INSTITUTIONAL ENVIRONMENT */
        <>
          <div className="relative overflow-hidden rounded-[2rem] bg-hero p-6 sm:p-10 mb-8 border border-border">
            <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
              Hubs
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
              Organizational and institutional environments for educational institutions, companies,
              government agencies, NGOs, professional associations, and communities — equipped with
              multi-topic Forums and official institutional Broadcasts.
            </p>
          </div>

          {/* Search & Institutional Category Filter */}
          <div className="mb-8 space-y-4">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search institutions, universities, companies, or communities…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-11 rounded-full pl-10 pr-4 bg-card"
                aria-label="Search hubs"
              />
            </div>

            <nav
              className="flex max-w-full min-w-0 gap-2 overflow-x-auto pb-2 scrollbar-none"
              aria-label="Filter hubs by organization type"
            >
              <Link
                to="/hubs"
                search={searchTerm ? { q: searchTerm } : {}}
                className={cn(
                  "shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition-colors",
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
                  search={{
                    category: c.value,
                    ...(searchTerm ? { q: searchTerm } : {}),
                  }}
                  className={cn(
                    "shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition-colors",
                    selectedCategory === c.value
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-card hover:bg-secondary",
                  )}
                >
                  {c.label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Joined Hubs */}
          {myHubs.length > 0 && !selectedCategory && !deferredSearch && (
            <section className="mb-10">
              <h2 className="font-display text-lg font-bold mb-3 flex items-center gap-2">
                <Building2 className="size-4 text-primary" /> Your Joined Hubs
              </h2>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {myHubs.map((mh) => (
                  <Link
                    key={mh.hub.id}
                    to="/hubs/$slug"
                    params={{ slug: mh.hub.slug }}
                    className="surface-card shrink-0 flex items-center gap-3 rounded-2xl p-3.5 pr-5 hover:border-primary transition-colors"
                  >
                    <div className="flex size-9 items-center justify-center rounded-xl bg-primary/15 text-primary font-bold text-sm">
                      {mh.hub.name[0]?.toUpperCase()}
                    </div>
                    <div>
                      <p className="font-display font-bold text-sm">{mh.hub.name}</p>
                      <p className="text-[11px] text-muted-foreground capitalize">{mh.role}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Hubs Grid */}
          {isLoading ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="surface-card h-56 animate-pulse rounded-3xl p-6" />
              ))}
            </div>
          ) : error ? (
            <div className="surface-card mx-auto max-w-md rounded-3xl p-8 text-center">
              <p className="font-display text-lg font-bold">Couldn't load Hubs</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Check your connection and try again.
              </p>
              <Button onClick={() => refetch()} variant="outline" className="mt-4 rounded-full">
                Retry
              </Button>
            </div>
          ) : hubs && hubs.length > 0 ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {hubs.map((h) => (
                <HubCard
                  key={h.id}
                  hub={h}
                  isOwner={Boolean(user?.id && h.owner_id === user.id)}
                  isMember={myHubIds.has(h.id)}
                  isPending={myPendingHubs.has(h.id)}
                />
              ))}
            </div>
          ) : (
            <div className="surface-card mx-auto max-w-lg rounded-3xl p-10 text-center">
              <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-lime text-lime-foreground">
                <Building2 className="size-7" />
              </div>
              <h2 className="mt-4 font-display text-xl font-bold">
                {deferredSearch || selectedCategory
                  ? "No matching Hubs found"
                  : "No public Hubs yet"}
              </h2>
              <p className="mt-2 text-xs text-muted-foreground">
                {deferredSearch || selectedCategory
                  ? "Try clearing your search or selecting another organization category."
                  : "Create an institutional or community Hub with Forums and official Broadcasts."}
              </p>
              <Button asChild variant="hero" className="mt-5 rounded-full">
                <Link to="/hubs/create">Create a Hub</Link>
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
