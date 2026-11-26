import {
  createFileRoute,
  Link,
  Outlet,
  useChildMatches,
  useNavigate,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useDeferredValue, useEffect } from "react";
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
  MessageSquare,
} from "lucide-react";
import { hubsQuery, myHubsQuery, myPendingHubsQuery } from "@/lib/hub-queries";
import { HUB_CATEGORIES, type HubCategory, type Hub } from "@/lib/hubs";
import { InboxSectionTabs } from "@/components/inbox/InboxSectionTabs";
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
    view: z.enum(["moments"]).optional(),
  }),
  head: () =>
    pageHead({
      title: "Hubs — Group Communication on PING",
      description:
        "Discover and join collaborative group spaces for communities, universities, companies, incubators, and cohorts on PING.",
      path: "/hubs",
    }),
  component: HubsLayout,
});

function HubsLayout() {
  const childMatches = useChildMatches();
  if (childMatches.length > 0) return <Outlet />;
  return <HubsDirectoryRoutePage />;
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
                  title="Verified Group Hub"
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
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="size-3" /> Group Chat
          </span>
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

export interface HubsDirectorySectionProps {
  embeddedInInbox?: boolean | undefined;
  initialCategory?: string | undefined;
  initialQuery?: string | undefined;
}

export function HubsDirectorySection({
  embeddedInInbox = false,
  initialCategory,
  initialQuery,
}: HubsDirectorySectionProps) {
  const [searchTerm, setSearchTerm] = useState(initialQuery ?? "");
  const [selectedCatValue, setSelectedCatValue] = useState<string | undefined>(initialCategory);
  const deferredSearch = useDeferredValue(searchTerm);
  const { user } = useAuth();

  useEffect(() => {
    setSelectedCatValue(initialCategory);
  }, [initialCategory]);

  const selectedCategory = HUB_CATEGORIES.some((c) => c.value === selectedCatValue)
    ? (selectedCatValue as HubCategory)
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

  return (
    <div className="space-y-8">
      {!embeddedInInbox && <InboxSectionTabs activeSection="hubs" />}

      {/* Hubs Group Communication Hero */}
      <div className="relative overflow-hidden rounded-[2rem] bg-hero p-6 sm:p-10 border border-border flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 text-primary px-3 py-1 text-xs font-bold mb-3">
            <Users className="size-3.5" /> Group Communication
          </div>
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">Hubs</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Discover and join collaborative group spaces for communities, builder cohorts, teams,
            schools, and organizations — with live group messaging, shared media, and member
            coordination.
          </p>
        </div>

        <Button asChild variant="hero" size="sm" className="rounded-full gap-1.5 shrink-0">
          <Link to="/hubs/create">
            <Plus className="size-4" /> Create a Hub
          </Link>
        </Button>
      </div>

      {/* Search & Category Filter */}
      <div className="space-y-4">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search group Hubs by name, topic, or community…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-11 rounded-full pl-10 pr-4 bg-card"
            aria-label="Search hubs"
          />
        </div>

        <nav
          className="flex max-w-full min-w-0 gap-2 overflow-x-auto pb-2 scrollbar-none"
          aria-label="Filter hubs by category"
        >
          <button
            type="button"
            onClick={() => setSelectedCatValue(undefined)}
            className={cn(
              "shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition-colors",
              !selectedCategory
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card hover:bg-secondary",
            )}
          >
            All Hubs
          </button>
          {HUB_CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setSelectedCatValue(c.value)}
              className={cn(
                "shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition-colors",
                selectedCategory === c.value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card hover:bg-secondary",
              )}
            >
              {c.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Joined Hubs */}
      {myHubs.length > 0 && !selectedCategory && !deferredSearch && (
        <section>
          <h3 className="font-display text-lg font-bold mb-3 flex items-center gap-2">
            <Building2 className="size-4 text-primary" /> Your Joined Hubs
          </h3>
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
          <p className="mt-1 text-xs text-muted-foreground">Check your connection and try again.</p>
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
            <Users className="size-7" />
          </div>
          <h3 className="mt-4 font-display text-xl font-bold">
            {deferredSearch || selectedCategory ? "No matching Hubs found" : "No public Hubs yet"}
          </h3>
          <p className="mt-2 text-xs text-muted-foreground">
            {deferredSearch || selectedCategory
              ? "Try clearing your search or selecting another group category."
              : "Create a group Hub to collaborate and chat with your community in real time."}
          </p>
          <Button asChild variant="hero" className="mt-5 rounded-full">
            <Link to="/hubs/create">Create a Hub</Link>
          </Button>
        </div>
      )}
    </div>
  );
}

function HubsDirectoryRoutePage() {
  const { category: catParam, q: qParam, view } = Route.useSearch();
  const navigate = useNavigate();

  useEffect(() => {
    if (view === "moments") {
      navigate({ to: "/explore", search: { filter: "moments" }, replace: true });
    }
  }, [view, navigate]);

  return (
    <div className="mx-auto max-w-6xl w-full min-w-0 px-4 sm:px-6 py-6 pb-24 overflow-x-clip">
      <HubsDirectorySection initialCategory={catParam} initialQuery={qParam} />
    </div>
  );
}
