import { pageHead } from "@/lib/site";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  Sparkles,
  Radio,
  Building2,
  Users,
  Lock,
  Globe,
  Plus,
  ArrowRight,
  CheckCircle,
  Bell,
  BellOff,
  Compass,
  Calendar,
  Check,
  Shield,
  Clock,
  Layers,
  ArrowUpRight,
  TrendingUp,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FounderAvatar } from "@/components/ping/Avatar";
import { PingCard, PingCardSkeleton } from "@/components/ping/PingCard";
import { MomentsTray } from "@/components/moments/MomentsTray";
import { AriseCallout } from "@/components/AriseCallout";
import { useAuth } from "@/lib/auth";
import { feedQuery, followingFeedQuery, type Ping } from "@/lib/pings";
import { hubsQuery, myHubsQuery, myPendingHubsQuery, hubError } from "@/lib/hub-queries";
import { HUB_CATEGORIES, type Hub, type HubCategory } from "@/lib/hubs";
import {
  signalsQuery,
  recentSignalBroadcastsQuery,
  myFollowedSignalsQuery,
  useSignalFollow,
  type Signal,
} from "@/lib/signals";
import { CATEGORIES, type Category } from "@/lib/validation";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  staticData: { sitemap: true },
  validateSearch: z.object({
    tab: z.enum(["foryou", "following"]).optional().default("foryou"),
    c: z.enum(["progress", "idea", "launch", "milestone", "question", "opportunity"]).optional(),
    page: z.coerce.number().int().min(0).max(10000).catch(0).default(0),
  }),
  head: () =>
    pageHead({
      title: "Ping by DOT — Build in Public, Discover Hubs & Signals",
      description:
        "Real-time social discovery for founders and builders. Share Pings, publish Moments, collaborate in Hubs, and subscribe to official institutional Signals.",
      path: "/",
      card: "summary_large_image",
    }),
  component: HomePage,
});

/* -------------------------------------------------------------------------- */
/*                               HUB CARD (HOME)                              */
/* -------------------------------------------------------------------------- */
function HomeHubCard({
  hub,
  isMember,
  isPending,
  isOwner,
  currentUserId,
}: {
  hub: Hub;
  isMember: boolean;
  isPending: boolean;
  isOwner: boolean;
  currentUserId?: string | undefined;
}) {
  const qc = useQueryClient();
  const cat = HUB_CATEGORIES.find((c) => c.value === hub.category);
  const isPrivate = hub.access === "private";

  const joinMutation = useMutation({
    mutationFn: async () => {
      if (!currentUserId) {
        toast("Sign in to join or request access to Hubs", {
          action: { label: "Log in", onClick: () => (window.location.href = "/login") },
        });
        return;
      }
      const { data, error } = await supabase.rpc("join_hub", { _hub: hub.id });
      if (error) throw error;
      return data;
    },
    onSuccess: (status) => {
      qc.invalidateQueries({ queryKey: ["my-hubs"] });
      qc.invalidateQueries({ queryKey: ["my-pending-hubs"] });
      qc.invalidateQueries({ queryKey: ["hubs"] });
      qc.invalidateQueries({ queryKey: ["hub", hub.slug] });
      if (status === "active") {
        toast.success(`You joined ${hub.name}! 🎉`);
      } else {
        toast.info("Access request submitted for review.");
      }
    },
    onError: (e: any) => {
      toast.error(hubError(e, "Could not join hub."));
    },
  });

  return (
    <article className="surface-card group relative flex flex-col justify-between rounded-3xl p-5 border border-border/70 hover:border-border transition-all shadow-sm hover:shadow-md">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-secondary text-2xl shadow-soft">
            {cat?.emoji ?? "🏢"}
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
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

        <div className="mt-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Link
              to="/hubs/$slug"
              params={{ slug: hub.slug }}
              className="font-display text-base font-bold text-foreground hover:underline truncate"
            >
              {hub.name}
            </Link>
            {hub.verified && (
              <span className="rounded-full bg-gold/15 text-gold border border-gold/30 px-2 py-0.5 text-[10px] font-bold">
                ✓
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {hub.tagline || hub.description || "Builder community on Ping."}
          </p>
        </div>

        <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground font-medium">
          <span className="inline-flex items-center gap-1">
            <Users className="size-3.5 text-primary" />
            {(hub.member_count ?? 0).toLocaleString()} builders
          </span>
          <span>•</span>
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="size-3 text-muted-foreground" />
            {(hub.ping_count ?? 0).toLocaleString()} pings
          </span>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-border/50 flex items-center gap-2">
        <Button asChild variant="outline" size="sm" className="w-1/2 rounded-xl text-xs h-8">
          <Link to="/hubs/$slug" params={{ slug: hub.slug }}>
            Open
          </Link>
        </Button>

        {isOwner ? (
          <span className="w-1/2 text-center text-xs font-bold text-lime-foreground bg-lime/20 py-1.5 rounded-xl border border-lime/30">
            Owner
          </span>
        ) : isMember ? (
          <span className="w-1/2 inline-flex items-center justify-center gap-1 text-xs font-semibold text-primary bg-primary/10 py-1.5 rounded-xl border border-primary/20">
            <Check className="size-3" /> Joined
          </span>
        ) : isPending ? (
          <span className="w-1/2 inline-flex items-center justify-center gap-1 text-xs font-semibold text-amber-500 bg-amber-500/10 py-1.5 rounded-xl border border-amber-500/20">
            <Clock className="size-3" /> Pending
          </span>
        ) : (
          <Button
            variant="hero"
            size="sm"
            onClick={() => joinMutation.mutate()}
            disabled={joinMutation.isPending}
            className="w-1/2 rounded-xl text-xs h-8 shadow-sm"
          >
            {isPrivate ? "Request" : "Join"}
          </Button>
        )}
      </div>
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/*                             SIGNAL CARD (HOME)                             */
/* -------------------------------------------------------------------------- */
function HomeSignalCard({
  signal,
  isFollowing,
  latestPost,
  currentUserId,
}: {
  signal: Signal;
  isFollowing: boolean;
  latestPost?: { id: string; title: string; content: string; created_at: string } | undefined;
  currentUserId?: string | undefined;
}) {
  const followMutation = useSignalFollow(signal.id, currentUserId);

  const handleToggle = () => {
    if (!currentUserId) {
      toast("Sign in to subscribe to official Signals", {
        action: { label: "Log in", onClick: () => (window.location.href = "/login") },
      });
      return;
    }
    followMutation.mutate();
  };

  return (
    <article className="surface-card group relative flex flex-col justify-between rounded-3xl p-5 border border-border/70 hover:border-border transition-all shadow-sm hover:shadow-md">
      <div>
        <div className="flex items-start gap-3">
          {signal.avatar_url ? (
            <img
              src={signal.avatar_url}
              alt={signal.name}
              className="size-11 rounded-2xl object-cover shrink-0 border border-border/50"
            />
          ) : (
            <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary font-bold">
              <Radio className="size-5" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Link
                to="/signals/$slug"
                params={{ slug: signal.slug }}
                className="font-display text-base font-bold text-foreground hover:underline truncate"
              >
                {signal.name}
              </Link>
              {signal.verified && (
                <span
                  title="Verified Institution"
                  className="inline-flex items-center gap-1 rounded-full bg-gold/15 text-gold border border-gold/30 px-2 py-0.5 text-[10px] font-bold"
                >
                  <CheckCircle className="size-3" />
                  Verified
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
              <span className="capitalize font-semibold text-secondary-foreground bg-secondary px-2 py-0.5 rounded-full">
                {signal.institution_type}
              </span>
              <span>{(signal.follower_count ?? 0).toLocaleString()} subscribers</span>
            </div>
          </div>
        </div>

        {signal.description && (
          <p className="mt-3 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {signal.description}
          </p>
        )}

        {/* Latest broadcast snippet preview */}
        {latestPost ? (
          <div className="mt-3 rounded-2xl bg-secondary/50 p-2.5 border border-border/40 text-xs">
            <div className="flex items-center gap-1 text-[11px] font-semibold text-primary">
              <Radio className="size-3 animate-pulse" />
              <span className="truncate">Latest: {latestPost.title}</span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground line-clamp-1">
              {latestPost.content}
            </p>
          </div>
        ) : (
          <div className="mt-3 rounded-2xl bg-secondary/30 p-2 border border-border/30 text-[11px] text-muted-foreground text-center">
            Standing by for upcoming institutional broadcasts.
          </div>
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-border/50 flex items-center gap-2">
        <Button asChild variant="outline" size="sm" className="w-1/2 rounded-xl text-xs h-8">
          <Link to="/signals/$slug" params={{ slug: signal.slug }}>
            Tune In
          </Link>
        </Button>

        <Button
          variant={isFollowing ? "outline" : "hero"}
          size="sm"
          onClick={handleToggle}
          disabled={followMutation.isPending}
          className="w-1/2 rounded-xl text-xs h-8 gap-1 shadow-sm"
        >
          {isFollowing ? (
            <>
              <BellOff className="size-3" /> Subscribed
            </>
          ) : (
            <>
              <Bell className="size-3" /> Subscribe
            </>
          )}
        </Button>
      </div>
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/*                              HOMEPAGE COMPONENT                            */
/* -------------------------------------------------------------------------- */
function HomePage() {
  const { user, profile } = useAuth();
  const search = Route.useSearch();
  const activeTab = search.tab || "foryou";
  const categoryFilter = search.c ?? null;
  const page = search.page || 0;

  // Real Queries
  const { data: forYouPings = [], isLoading: pingsLoading } = useQuery(
    feedQuery(categoryFilter, page),
  );
  const { data: followingPings = [], isLoading: followingLoading } = useQuery(
    followingFeedQuery(user?.id, page),
  );
  const { data: hubs = [], isLoading: hubsLoading } = useQuery(hubsQuery("", null, 0));
  const { data: myHubs = [] } = useQuery(myHubsQuery(user?.id));
  const { data: myPendingHubs = new Set<string>() } = useQuery(myPendingHubsQuery(user?.id));

  const { data: signals = [], isLoading: signalsLoading } = useQuery(signalsQuery());
  const { data: followedSignals = new Set<string>() } = useQuery(myFollowedSignalsQuery(user?.id));
  const { data: recentBroadcasts = {} } = useQuery(recentSignalBroadcastsQuery());

  const displayedPings = activeTab === "following" ? followingPings : forYouPings;
  const isPingsLoading = activeTab === "following" ? followingLoading : pingsLoading;

  // Set of joined hub IDs
  const myHubIds = new Set(myHubs.map((h) => h.hub.id));

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 pb-24">
      {/* 1. TOP GREETING & MOMENTS TRAY */}
      <section className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div>
            <span className="sticker rotate-[-1deg] bg-lime text-lime-foreground">
              build in public
            </span>
            <h1 className="mt-2 font-display text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
              {user ? (
                <>Hey {profile?.display_name || profile?.username || "Builder"}, what's shipping?</>
              ) : (
                <>Where founders share daily progress.</>
              )}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            {user ? (
              <Button
                asChild
                variant="hero"
                size="sm"
                className="rounded-full shadow-lift h-9 px-4"
              >
                <Link to="/create">
                  <Plus className="size-4" /> Post a Ping
                </Link>
              </Button>
            ) : (
              <Button
                asChild
                variant="hero"
                size="sm"
                className="rounded-full shadow-lift h-9 px-5"
              >
                <Link to="/signup">Join Ping</Link>
              </Button>
            )}
          </div>
        </div>

        {/* Moments Tray */}
        <div className="surface-card rounded-3xl p-4 sm:p-5 border border-border/80 shadow-soft">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-primary" /> Active Moments
            </span>
            <span className="text-[11px] text-muted-foreground">Stories expire in 24 hours</span>
          </div>
          <MomentsTray />
        </div>
      </section>

      {/* 2. MAIN 2-COLUMN DISCOVERY GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] xl:grid-cols-[1fr_360px] gap-6 xl:gap-8 items-start">
        {/* =================================================================== */}
        {/* LEFT COLUMN: PINGS FEED                                             */}
        {/* =================================================================== */}
        <main className="space-y-6">
          {/* Feed Header Tabs: For You vs Following */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/60 pb-3">
            <div className="flex items-center gap-2">
              <Link
                to="/"
                search={{ tab: "foryou", c: categoryFilter ?? undefined, page: 0 }}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-semibold transition-all",
                  activeTab === "foryou"
                    ? "bg-foreground text-background shadow-sm"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                For You
              </Link>
              <Link
                to="/"
                search={{ tab: "following", c: categoryFilter ?? undefined, page: 0 }}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-semibold transition-all flex items-center gap-1.5",
                  activeTab === "following"
                    ? "bg-foreground text-background shadow-sm"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                Following
                {!user && <Lock className="size-3 text-muted-foreground" />}
              </Link>
            </div>

            <span className="text-xs text-muted-foreground font-medium">
              {categoryFilter ? `Filtering by #${categoryFilter}` : "Showing all categories"}
            </span>
          </div>

          {/* Category Filter Bar */}
          <nav
            className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-2 scrollbar-none sm:-mx-0 sm:px-0"
            aria-label="Filter by type"
          >
            <Link
              to="/"
              search={{ tab: activeTab, c: undefined, page: 0 }}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-1 text-xs font-semibold transition-colors",
                !categoryFilter
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card hover:bg-secondary",
              )}
            >
              All Types
            </Link>
            {CATEGORIES.map((cat) => (
              <Link
                key={cat.value}
                to="/"
                search={{ tab: activeTab, c: cat.value as any, page: 0 }}
                className={cn(
                  "shrink-0 rounded-full border px-3.5 py-1 text-xs font-semibold transition-colors flex items-center gap-1",
                  categoryFilter === cat.value
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card hover:bg-secondary",
                )}
              >
                <span>{cat.emoji}</span>
                <span>{cat.label}</span>
              </Link>
            ))}
          </nav>

          {/* Quick Post Banner for Logged-In Users */}
          {user && (
            <div className="surface-card flex items-center justify-between gap-3 rounded-2xl p-3 sm:p-4 border border-border/80">
              <Link
                to="/@{$username}"
                params={{ username: profile?.username || "" }}
                className="flex items-center gap-2.5 min-w-0"
              >
                <FounderAvatar
                  name={profile?.display_name || profile?.username || "You"}
                  src={profile?.avatar_url}
                  size="sm"
                />
                <span className="text-xs text-muted-foreground truncate font-medium">
                  What did you ship today?
                </span>
              </Link>
              <Button asChild variant="hero" size="sm" className="rounded-xl h-8 px-3 text-xs">
                <Link to="/create">Post Ping</Link>
              </Button>
            </div>
          )}

          {/* Pings Grid */}
          <div className="space-y-4">
            {isPingsLoading ? (
              <div className="space-y-4">
                <PingCardSkeleton />
                <PingCardSkeleton />
                <PingCardSkeleton />
              </div>
            ) : activeTab === "following" && !user ? (
              <div className="surface-card rounded-3xl p-10 text-center border border-border/60">
                <Users className="mx-auto size-10 text-primary" />
                <h3 className="mt-3 font-display font-bold text-lg">
                  See updates from people you follow
                </h3>
                <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
                  Log in to create a tailored timeline of founders and collaborators you care about.
                </p>
                <Button asChild variant="hero" size="sm" className="mt-4 rounded-xl">
                  <Link to="/login" search={{ next: "/?tab=following" }}>
                    Sign in to Follow
                  </Link>
                </Button>
              </div>
            ) : displayedPings.length === 0 ? (
              <div className="surface-card rounded-3xl p-10 text-center border border-border/60">
                <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-lime/20 text-lime-foreground font-bold">
                  <Sparkles className="size-6" />
                </div>
                <h3 className="mt-4 font-display font-bold text-lg">
                  {activeTab === "following"
                    ? "Your following feed is quiet"
                    : categoryFilter
                      ? `No Pings tagged #${categoryFilter} yet`
                      : "No Pings shared yet"}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
                  {activeTab === "following"
                    ? "Explore discoverable builders and Hubs to follow founders building exciting things."
                    : "Be the first to share an update with the Ping network!"}
                </p>
                <div className="mt-5 flex justify-center gap-3">
                  <Button asChild variant="hero" size="sm" className="rounded-xl">
                    <Link to="/create">Post a Ping</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="rounded-xl">
                    <Link to="/explore">Explore Directory</Link>
                  </Button>
                </div>
              </div>
            ) : (
              displayedPings.map((ping) => <PingCard key={ping.id} ping={ping} />)
            )}
          </div>

          {/* Feed Pagination */}
          {displayedPings.length > 0 && (
            <div className="flex items-center justify-center gap-3 pt-4">
              {page > 0 && (
                <Button asChild variant="outline" size="sm" className="rounded-xl">
                  <Link
                    to="/"
                    search={{
                      tab: activeTab,
                      c: categoryFilter ?? undefined,
                      page: Math.max(0, page - 1),
                    }}
                  >
                    Newer Pings
                  </Link>
                </Button>
              )}
              {displayedPings.length >= 25 && (
                <Button asChild variant="outline" size="sm" className="rounded-xl">
                  <Link
                    to="/"
                    search={{ tab: activeTab, c: categoryFilter ?? undefined, page: page + 1 }}
                  >
                    Older Pings
                  </Link>
                </Button>
              )}
            </div>
          )}

          {/* Arise Callout */}
          <div className="pt-6">
            <AriseCallout />
          </div>
        </main>

        {/* =================================================================== */}
        {/* RIGHT COLUMN: HUBS & SIGNALS DISCOVERY (STICKY ON DESKTOP)          */}
        {/* =================================================================== */}
        <aside className="space-y-8 lg:sticky lg:top-20">
          {/* 3. HUBS DISCOVERY SECTION */}
          <section aria-labelledby="hubs-discovery-heading">
            <div className="flex items-center justify-between mb-3">
              <h2
                id="hubs-discovery-heading"
                className="font-display text-lg font-bold flex items-center gap-2 text-foreground"
              >
                <Building2 className="size-5 text-primary" />
                <span>Community Hubs</span>
              </h2>
              <div className="flex items-center gap-2">
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-2 text-primary font-semibold"
                >
                  <Link to="/hubs">Browse All</Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="h-7 text-xs px-2 rounded-lg">
                  <Link to="/hubs/create">+ Create</Link>
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              {hubsLoading ? (
                <div className="space-y-3">
                  {[1, 2].map((i) => (
                    <div key={i} className="h-36 rounded-3xl bg-muted/40 animate-pulse" />
                  ))}
                </div>
              ) : hubs.length === 0 ? (
                <div className="surface-card rounded-2xl p-6 text-center text-xs text-muted-foreground border border-border/60">
                  <Building2 className="mx-auto size-8 text-muted-foreground/40 mb-2" />
                  <p className="font-semibold text-foreground">No public Hubs yet</p>
                  <p className="mt-1">Create a hub for your collective or accelerator.</p>
                  <Button asChild variant="hero" size="sm" className="mt-3 rounded-xl text-xs h-7">
                    <Link to="/hubs/create">Create Hub</Link>
                  </Button>
                </div>
              ) : (
                hubs
                  .slice(0, 3)
                  .map((hub) => (
                    <HomeHubCard
                      key={hub.id}
                      hub={hub}
                      isMember={myHubIds.has(hub.id)}
                      isPending={myPendingHubs.has(hub.id)}
                      isOwner={hub.owner_id === user?.id}
                      currentUserId={user?.id}
                    />
                  ))
              )}
            </div>
          </section>

          {/* 4. SIGNALS DISCOVERY SECTION */}
          <section aria-labelledby="signals-discovery-heading">
            <div className="flex items-center justify-between mb-3">
              <h2
                id="signals-discovery-heading"
                className="font-display text-lg font-bold flex items-center gap-2 text-foreground"
              >
                <Radio className="size-5 text-primary" />
                <span>Official Signals</span>
              </h2>
              <div className="flex items-center gap-2">
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-2 text-primary font-semibold"
                >
                  <Link to="/signals">Browse All</Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="h-7 text-xs px-2 rounded-lg">
                  <Link to="/signals/create">+ Register</Link>
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              {signalsLoading ? (
                <div className="space-y-3">
                  {[1, 2].map((i) => (
                    <div key={i} className="h-36 rounded-3xl bg-muted/40 animate-pulse" />
                  ))}
                </div>
              ) : signals.length === 0 ? (
                <div className="surface-card rounded-2xl p-6 text-center text-xs text-muted-foreground border border-border/60">
                  <Radio className="mx-auto size-8 text-muted-foreground/40 mb-2" />
                  <p className="font-semibold text-foreground">No official Signals yet</p>
                  <p className="mt-1">Register an official channel for your institution.</p>
                  <Button asChild variant="hero" size="sm" className="mt-3 rounded-xl text-xs h-7">
                    <Link to="/signals/create">Register Channel</Link>
                  </Button>
                </div>
              ) : (
                signals
                  .slice(0, 3)
                  .map((signal) => (
                    <HomeSignalCard
                      key={signal.id}
                      signal={signal}
                      isFollowing={followedSignals.has(signal.id)}
                      latestPost={recentBroadcasts[signal.id]}
                      currentUserId={user?.id}
                    />
                  ))
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
