import { pageHead } from "@/lib/site";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  Sparkles,
  Building2,
  Users,
  Lock,
  Globe,
  Plus,
  ArrowRight,
  CheckCircle,
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
import { PingMark } from "@/components/BrandLogo";
import { useAuth } from "@/lib/auth";
import { feedQuery, followingFeedQuery, type Ping } from "@/lib/pings";
import { QueryErrorCard } from "@/components/QueryErrorCard";
import { WelcomeCarousel } from "@/components/onboarding/WelcomeCarousel";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ONBOARDING_INTERESTS,
  formatInterestLabel,
  hasSeenWelcome,
  markWelcomeSeen,
} from "@/lib/pathways";
import { hubsQuery, myHubsQuery, myPendingHubsQuery, hubError } from "@/lib/hub-queries";
import { HUB_CATEGORIES, type Hub, type HubCategory } from "@/lib/hubs";
import { blockedUsersQuery, userConversationsQuery } from "@/lib/messages";
import { mutedUsersQuery } from "@/lib/mutes";
import { extractTrendingTopics, rankFeedPings, type FeedMode } from "@/lib/feed-engine";
import { followedTopicsQuery, useToggleFollowTopic } from "@/lib/social";
import { INTENT_FORMATS, parseStructuredPing, type Category } from "@/lib/validation";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  staticData: { sitemap: true },
  validateSearch: z.object({
    tab: z.enum(["foryou", "following", "latest", "trending", "opportunities"]).optional(),
    c: z
      .enum([
        "progress",
        "need",
        "offer",
        "opportunity",
        "idea",
        "question",
        "collaboration",
        "update",
        "launch",
        "milestone",
      ])
      .optional(),
    page: z.coerce.number().int().min(0).max(10000).optional().catch(undefined),
  }),
  loaderDeps: ({ search: { c, page } }) => ({ cat: c ?? null, page: page ?? 0 }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(feedQuery(deps.cat, deps.page)),
  head: () =>
    pageHead({
      title: "Ping by DOT — Connect, Share, Discover Hubs & Signals",
      description:
        "Social, communication, discovery, and economic network for everyone. Share Pings, publish Moments, join Hubs, and chat 1-on-1 in Signal.",
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
          <span className="w-1/2 text-center text-xs font-bold text-lime-foreground dark:text-lime bg-lime/20 dark:bg-lime/15 py-1.5 rounded-xl border border-lime/30">
            Owner
          </span>
        ) : isMember ? (
          <span className="w-1/2 inline-flex items-center justify-center gap-1 text-xs font-semibold text-primary bg-primary/10 py-1.5 rounded-xl border border-primary/20">
            <Check className="size-3" /> Joined
          </span>
        ) : isPending ? (
          <span className="w-1/2 inline-flex items-center justify-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-400 bg-amber-500/10 py-1.5 rounded-xl border border-amber-500/20">
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
/*                              HOMEPAGE COMPONENT                            */
/* -------------------------------------------------------------------------- */
function HomePage() {
  const { user, ready } = useAuth();
  const [hydrated, setHydrated] = useState(false);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);

  useEffect(() => {
    setHydrated(true);
    setWelcomeDismissed(hasSeenWelcome());
  }, []);

  if (!hydrated || !ready) {
    return (
      <div className="bg-hero flex min-h-[calc(100dvh-5rem)] items-center justify-center px-4 pb-24">
        <div
          role="status"
          aria-live="polite"
          className="surface-card flex flex-col items-center gap-3 rounded-3xl px-8 py-7 text-center shadow-lift"
        >
          <PingMark variant="lime" size="lg" alt="Ping by DOT" />
          <p className="text-sm font-medium text-muted-foreground">Opening Ping…</p>
        </div>
      </div>
    );
  }

  if (!user && !welcomeDismissed) {
    return (
      <div className="bg-hero min-h-[calc(100dvh-5rem)] px-3.5 sm:px-6 py-5 pb-24 sm:py-12">
        <div className="mx-auto max-w-5xl">
          <WelcomeCarousel
            nextPath="/"
            onCompleteOrSkip={() => {
              markWelcomeSeen();
              setWelcomeDismissed(true);
            }}
          />
        </div>
      </div>
    );
  }

  return <HomeFeedContent />;
}

function HomeFeedContent() {
  const { user, profile } = useAuth();
  const search = Route.useSearch();
  const initialForYouPings = Route.useLoaderData();
  const activeTab: FeedMode = search.tab || "foryou";
  const categoryFilter = search.c ?? null;
  const page = search.page || 0;
  const [welcomeModalOpen, setWelcomeModalOpen] = useState(false);

  // Real Queries
  const {
    data: forYouPings = [],
    isLoading: pingsLoading,
    isError: isForYouError,
    error: forYouError,
    refetch: refetchForYou,
  } = useQuery({
    ...feedQuery(categoryFilter, page),
    initialData: initialForYouPings,
    initialDataUpdatedAt: 0,
  });
  const {
    data: followingPings = [],
    isLoading: followingLoading,
    isError: isFollowingError,
    error: followingError,
    refetch: refetchFollowing,
  } = useQuery(followingFeedQuery(user?.id, page));
  const { data: mutedUsers = [] } = useQuery(mutedUsersQuery(user?.id));
  const { data: blockedUsers = [] } = useQuery(blockedUsersQuery(user?.id));
  const { data: followedTopics = [] } = useQuery(followedTopicsQuery(user?.id));
  const toggleFollowTopic = useToggleFollowTopic(user?.id);
  const {
    data: hubs = [],
    isLoading: hubsLoading,
    isError: isHubsError,
    error: hubsError,
    refetch: refetchHubs,
  } = useQuery(hubsQuery("", null, 0));
  const { data: myHubs = [] } = useQuery(myHubsQuery(user?.id));
  const { data: myPendingHubs = new Set<string>() } = useQuery(myPendingHubsQuery(user?.id));

  const { data: conversations = [] } = useQuery(userConversationsQuery(user?.id));
  const unreadSignalCount = conversations.reduce((sum, c) => sum + (c.unread_count ?? 0), 0);

  const mutedIds = new Set(mutedUsers.map((m) => m.muted_id));
  const blockedIds = new Set(blockedUsers.map((b) => b.blocked_id));
  const followedAuthorIds = new Set(followingPings.map((p) => p.user_id));

  const rawPings = activeTab === "following" ? followingPings : forYouPings;
  const categoryMatched = categoryFilter
    ? rawPings.filter((p) => {
        const meta = parseStructuredPing(p);
        return meta.intentFormat === categoryFilter || p.category === categoryFilter;
      })
    : rawPings;
  const displayedPings = rankFeedPings(categoryMatched, {
    mode: activeTab,
    viewerId: user?.id ?? null,
    interests: profile?.interests ?? [],
    followedTopics,
    followedAuthorIds,
    mutedUserIds: mutedIds,
    blockedUserIds: blockedIds,
  });
  const trendingTopics = extractTrendingTopics(forYouPings, 6);
  const isPingsLoading = activeTab === "following" ? followingLoading : pingsLoading;
  const isPingsError = activeTab === "following" ? isFollowingError : isForYouError;
  const activeFeedError = activeTab === "following" ? followingError : forYouError;
  const refetchActiveFeed = activeTab === "following" ? refetchFollowing : refetchForYou;

  // Set of joined hub IDs
  const myHubIds = new Set(myHubs.map((h) => h.hub.id));

  return (
    <div className="mx-auto max-w-7xl w-full min-w-0 px-4 sm:px-6 py-5 pb-24 overflow-x-clip">
      {/* 1. MOMENTS RAIL */}
      <section className="mb-6">
        <div className="hidden md:flex items-center justify-between gap-4 mb-4">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
              {user ? (
                <>Hey {profile?.display_name || profile?.username || "there"}, what&apos;s new?</>
              ) : (
                <>Your world. Your people. Your possibilities.</>
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
                  <Plus className="size-4" /> Create a Ping
                </Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="outline" size="sm" className="rounded-full h-9 px-4">
                  <Link to="/login">Sign in</Link>
                </Button>
                <Button
                  asChild
                  variant="hero"
                  size="sm"
                  className="rounded-full shadow-lift h-9 px-5"
                >
                  <Link to="/signup">Create account</Link>
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Horizontal Moments Rail */}
        <div className="surface-card rounded-3xl p-4 sm:p-5 border border-border/80 shadow-soft">
          <MomentsTray />
        </div>
      </section>

      {/* Signed-out prompt for returning guests who skipped the welcome slides */}
      {!user && (
        <section
          aria-label="Sign in or join Ping"
          className="surface-card mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-3xl border border-primary/25 bg-hero p-5"
        >
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-primary">Ping by DOT</p>
            <h2 className="mt-0.5 font-display text-lg font-extrabold text-foreground">
              Connect, communicate, and make something happen
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Sign in with Google or email to post Pings, join Hubs, and message people 1-on-1.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button asChild variant="hero" size="sm" className="rounded-full gap-1.5">
              <Link to="/login">Sign in</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <Link to="/signup">Create account</Link>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setWelcomeModalOpen(true)}
              className="rounded-full text-xs text-muted-foreground"
            >
              Intro slides
            </Button>
          </div>
        </section>
      )}

      <Dialog
        open={welcomeModalOpen}
        onOpenChange={(open) => {
          setWelcomeModalOpen(open);
          if (!open) {
            markWelcomeSeen();
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto border-none bg-transparent p-0 shadow-none">
          <DialogHeader className="sr-only">
            <DialogTitle>Welcome to Ping by DOT</DialogTitle>
          </DialogHeader>
          <WelcomeCarousel
            compact
            nextPath="/"
            onCompleteOrSkip={() => {
              markWelcomeSeen();
              setWelcomeModalOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* 2. MAIN 2-COLUMN DISCOVERY GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] xl:grid-cols-[1fr_360px] gap-6 xl:gap-8 items-start min-w-0">
        {/* =================================================================== */}
        {/* LEFT COLUMN: PINGS FEED                                             */}
        {/* =================================================================== */}
        <div className="min-w-0 space-y-6">
          {/* Feed Header Tabs: For You, Following, Latest, Trending, Opportunities */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border/60 pb-3">
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
              {(
                [
                  { id: "foryou", label: "For You" },
                  { id: "following", label: "Following", locked: !user },
                  { id: "latest", label: "Latest" },
                  { id: "trending", label: "Trending" },
                  { id: "opportunities", label: "Opportunities" },
                ] as Array<{ id: FeedMode; label: string; locked?: boolean }>
              ).map((t) => (
                <Link
                  key={t.id}
                  to="/"
                  search={{ tab: t.id, c: categoryFilter ?? undefined, page: 0 }}
                  className={cn(
                    "shrink-0 rounded-full px-3.5 py-1.5 text-xs sm:text-sm font-semibold transition-all inline-flex items-center gap-1.5",
                    activeTab === t.id
                      ? "bg-foreground text-background shadow-sm"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  {t.label}
                  {t.locked && <Lock className="size-3 text-muted-foreground" />}
                </Link>
              ))}
            </div>

            <span className="text-xs text-muted-foreground font-medium shrink-0">
              {categoryFilter ? `Filtering by #${categoryFilter}` : "Ranked for relevance"}
            </span>
          </div>

          {trendingTopics.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Topics to follow">
              <span className="text-[11px] font-semibold text-muted-foreground mr-1">Topics:</span>
              {trendingTopics.map((topic) => {
                const isFollowingTopic = followedTopics.includes(topic.slug);
                return (
                  <button
                    key={topic.slug}
                    type="button"
                    onClick={() => {
                      if (!user) {
                        toast.info("Sign in to follow topics and personalise your feed");
                        return;
                      }
                      toggleFollowTopic.mutate(
                        { topicSlug: topic.slug, currentlyFollowing: isFollowingTopic },
                        {
                          onSuccess: (nowFollowing) =>
                            toast.success(
                              nowFollowing
                                ? `Following #${topic.slug}`
                                : `Unfollowed #${topic.slug}`,
                            ),
                        },
                      );
                    }}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                      isFollowingTopic
                        ? "border-primary bg-primary/15 text-primary font-semibold"
                        : "border-border/70 bg-card text-muted-foreground hover:border-border hover:text-foreground",
                    )}
                  >
                    #{topic.slug} {isFollowingTopic ? "✓" : "+"}
                  </button>
                );
              })}
            </div>
          )}

          {/* Intent Category Filter Bar */}
          <nav
            className="flex max-w-full min-w-0 items-center gap-2 overflow-x-auto pb-2 scrollbar-none"
            aria-label="Filter by intent"
          >
            <Link
              to="/"
              search={{ tab: activeTab, c: undefined, page: 0 }}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
                !categoryFilter
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card hover:bg-secondary",
              )}
            >
              All Intents
            </Link>
            {INTENT_FORMATS.map((cat) => (
              <Link
                key={cat.value}
                to="/"
                search={{ tab: activeTab, c: cat.value as any, page: 0 }}
                className={cn(
                  "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
                  categoryFilter === cat.value
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card hover:bg-secondary",
                )}
              >
                {cat.label}
              </Link>
            ))}
          </nav>

          {/* Recommended First Actions & Interest Shortcuts for Logged-In Users */}
          {user && (
            <div className="surface-card space-y-3 rounded-2xl p-3.5 sm:p-4 border border-border/80">
              <div className="flex items-center justify-between gap-3">
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
                    Share an update, question, or idea with Ping…
                  </span>
                </Link>
                <Button
                  asChild
                  variant="hero"
                  size="sm"
                  className="rounded-xl h-8 px-3 text-xs shrink-0"
                >
                  <Link to="/create">Create Ping</Link>
                </Button>
              </div>
              {profile?.interests && profile.interests.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2.5">
                  <span className="text-[11px] font-semibold text-muted-foreground mr-1">
                    Recommended:
                  </span>
                  {profile.interests.slice(0, 5).map((interestId) => {
                    const mapped = ONBOARDING_INTERESTS.find((item) => item.id === interestId);
                    const catTarget = mapped?.pingCategory ?? "progress";
                    return (
                      <Link
                        key={interestId}
                        to="/"
                        search={{ tab: activeTab, c: catTarget as any, page: 0 }}
                        className="rounded-full border border-border/80 bg-secondary/60 px-2.5 py-0.5 text-[11px] font-medium text-foreground hover:border-primary/50 hover:bg-primary/10 transition-colors"
                      >
                        {formatInterestLabel(interestId)}
                      </Link>
                    );
                  })}
                  <Link
                    to="/explore"
                    search={{ filter: "people" }}
                    className="ml-auto text-[11px] font-semibold text-primary hover:underline"
                  >
                    Find people & Hubs &rarr;
                  </Link>
                </div>
              )}
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
                  Sign in to build a tailored feed of people, creators, and communities you care
                  about.
                </p>
                <Button asChild variant="hero" size="sm" className="mt-4 rounded-xl">
                  <Link to="/login" search={{ next: "/?tab=following" }}>
                    Sign in to Follow
                  </Link>
                </Button>
              </div>
            ) : isPingsError ? (
              <QueryErrorCard
                title="Couldn't load Pings"
                description="A connection issue prevented loading the feed. Your Pings are safe — try refreshing below."
                error={activeFeedError}
                onRetry={() => void refetchActiveFeed()}
              />
            ) : displayedPings.length === 0 ? (
              <div className="surface-card rounded-3xl p-10 text-center border border-border/60">
                <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-lime/20 dark:bg-lime/15 text-lime-foreground dark:text-lime font-bold">
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
              {(activeTab === "following"
                ? displayedPings.length >= 30
                : displayedPings.length >= 60) && (
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
        </div>

        {/* =================================================================== */}
        {/* RIGHT COLUMN: HUBS & SIGNALS DISCOVERY (STICKY ON DESKTOP)          */}
        {/* =================================================================== */}
        <aside className="min-w-0 space-y-8 lg:sticky lg:top-6">
          {/* 3. HUBS DISCOVERY SECTION */}
          <section aria-labelledby="hubs-discovery-heading">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
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
              ) : isHubsError ? (
                <QueryErrorCard
                  compact
                  title="Couldn't load Hubs"
                  error={hubsError}
                  onRetry={() => void refetchHubs()}
                />
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

          {/* 4. SIGNAL — 1-ON-1 CHATS & CONVERSATIONS */}
          <section aria-labelledby="signals-discovery-heading">
            <div className="flex items-center justify-between mb-3">
              <h2
                id="signals-discovery-heading"
                className="font-display text-lg font-bold flex items-center gap-2 text-foreground"
              >
                <MessageSquare className="size-5 text-primary" />
                <span>Signal · 1-on-1 Chats</span>
              </h2>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="h-7 text-xs px-2 text-primary font-semibold"
              >
                <Link to="/signals">Open Signal</Link>
              </Button>
            </div>

            <div className="surface-card rounded-2xl p-5 border border-border/60">
              {user && conversations.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      <strong className="text-foreground">{conversations.length}</strong>{" "}
                      {conversations.length === 1 ? "conversation" : "conversations"}
                    </span>
                    {unreadSignalCount > 0 && (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
                        {unreadSignalCount} unread
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {conversations.slice(0, 3).map((conv) => {
                      const peer = conv.other_member;
                      const peerName = peer?.display_name || peer?.username || "Founder";
                      return (
                        <Link
                          key={conv.id}
                          to="/signals"
                          search={{ conversationId: conv.id }}
                          className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-secondary/35 p-2.5 hover:bg-secondary/70 transition-colors"
                        >
                          <FounderAvatar name={peerName} src={peer?.avatar_url} size="sm" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold text-foreground truncate">{peerName}</p>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {conv.last_message_preview || "Open conversation"}
                            </p>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                  <Button
                    asChild
                    variant="hero"
                    size="sm"
                    className="w-full rounded-xl text-xs h-8"
                  >
                    <Link to="/signals">Open 1-on-1 Chats</Link>
                  </Button>
                </div>
              ) : (
                <div className="text-center text-xs text-muted-foreground">
                  <MessageSquare className="mx-auto size-8 text-muted-foreground/40 mb-2" />
                  <p className="font-semibold text-foreground">Private 1-on-1 Conversations</p>
                  <p className="mt-1">Message anyone directly inside Signal across Ping.</p>
                  <Button asChild variant="hero" size="sm" className="mt-3 rounded-xl text-xs h-7">
                    <Link to="/signals">Open Signal Chats</Link>
                  </Button>
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
