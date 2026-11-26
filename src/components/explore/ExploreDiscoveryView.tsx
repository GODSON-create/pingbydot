import { useDeferredValue, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QueryErrorCard } from "@/components/QueryErrorCard";
import {
  ArrowRight,
  Building2,
  Clapperboard,
  Compass,
  Eye,
  Flame,
  MessageSquare,
  Plus,
  Radio,
  Search,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PingCard } from "@/components/ping/PingCard";
import { FounderAvatar } from "@/components/ping/Avatar";
import { VerificationBadge } from "@/components/verification/VerificationBadge";
import { CascadingProfilePanel } from "@/components/profile/CascadingProfilePanel";
import { MomentsTray } from "@/components/moments/MomentsTray";
import { DiscoverableMomentsFeed } from "@/components/moments/DiscoverableMomentsFeed";
import { ResolvedMomentThumb } from "@/components/media/ResolvedPrivateMedia";
import { SpotlightFeedStrip } from "@/components/spotlight/SpotlightFeedStrip";
import { AriseCallout } from "@/components/AriseCallout";
import { feedQuery, likeCount, replyCount, type Ping, type Profile } from "@/lib/pings";
import { hubsQuery } from "@/lib/hub-queries";
import { signalsQuery } from "@/lib/signals";
import { parseStructuredPing, type Category } from "@/lib/validation";
import { formatInterestLabel } from "@/lib/pathways";
import { useAuth } from "@/lib/auth";
import { blockedUsersQuery, useGetOrCreateDirectConversation } from "@/lib/messages";
import { mutedUsersQuery } from "@/lib/mutes";
import { extractTrendingTopics } from "@/lib/feed-engine";
import { CURATED_DOT_TAGS } from "@/lib/dot-tags";
import { followedTopicsQuery, useToggleFollowTopic } from "@/lib/social";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const DISCOVERY_FILTERS = [
  { id: "all", label: "All" },
  { id: "pings", label: "PINGs" },
  { id: "people", label: "People" },
  { id: "moments", label: "Moments" },
  { id: "communities", label: "Communities" },
  { id: "signals", label: "Signals" },
  { id: "opportunities", label: "Opportunities" },
] as const;

export type DiscoveryFilter = (typeof DISCOVERY_FILTERS)[number]["id"];

export interface ExploreDiscoveryViewProps {
  basePath: "/" | "/explore";
  initialPings?: Ping[] | undefined;
  category?: Category | null | undefined;
  initialFilter?: DiscoveryFilter | undefined;
  initialQuery?: string | undefined;
  pageNum?: number | undefined;
  onOpenIntroSlides?: (() => void) | undefined;
}

function PeopleDiscoveryCard({
  person,
  currentUserId,
  followed,
  onFollowChanged,
  onInspect,
}: {
  person: Profile;
  currentUserId?: string | undefined;
  followed: boolean;
  onFollowChanged: () => void;
  onInspect?: (person: Profile) => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const startChat = useGetOrCreateDirectConversation();
  const [followPending, setFollowPending] = useState(false);
  const name = person.display_name || person.username;

  const handleFollow = async () => {
    if (!currentUserId) {
      navigate({ to: "/login", search: { next: `/@${person.username}` } });
      return;
    }
    setFollowPending(true);
    try {
      if (followed) {
        const { error } = await supabase
          .from("follows")
          .delete()
          .eq("follower_id", currentUserId)
          .eq("following_id", person.id);
        if (error) throw error;
        toast.success(`Unfollowed @${person.username}`);
      } else {
        const { error } = await supabase
          .from("follows")
          .insert({ follower_id: currentUserId, following_id: person.id });
        if (error && error.code !== "23505") throw error;
        toast.success(`Following @${person.username}`);
      }
      onFollowChanged();
      qc.invalidateQueries({ queryKey: ["follow", person.id] });
      qc.invalidateQueries({ queryKey: ["following-feed"] });
      qc.invalidateQueries({ queryKey: ["header-notifications"] });
    } catch {
      toast.error("Could not update follow status.");
    } finally {
      setFollowPending(false);
    }
  };

  return (
    <article className="surface-card flex flex-col justify-between rounded-3xl p-5 transition-all hover:border-primary/50">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/@{$username}" params={{ username: person.username }} className="shrink-0">
              <FounderAvatar name={name} src={person.avatar_url} size="md" />
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <Link
                  to="/@{$username}"
                  params={{ username: person.username }}
                  className="truncate font-display text-sm font-bold text-foreground hover:underline"
                >
                  {name}
                </Link>
                <VerificationBadge userId={person.id} size="xs" />
              </div>
              <p className="truncate text-xs text-muted-foreground">@{person.username}</p>
            </div>
          </div>
          {onInspect && (
            <button
              type="button"
              onClick={() => onInspect(person)}
              aria-label={`Inspect ${name}`}
              title="Quick profile preview"
              className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            >
              <Eye className="size-3.5" />
            </button>
          )}
        </div>
        {person.bio ? (
          <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {person.bio}
          </p>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            Coordinating projects and intentions on PING.
          </p>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2 pt-3 border-t border-border/60">
        <Button
          type="button"
          size="sm"
          variant={followed ? "outline" : "hero"}
          disabled={followPending}
          onClick={handleFollow}
          className="h-8 flex-1 rounded-full text-xs font-semibold"
        >
          <UserPlus className="size-3.5" />
          {followed ? "Following" : "Follow"}
        </Button>
        {currentUserId && currentUserId !== person.id && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={startChat.isPending}
            onClick={async () => {
              try {
                const convId = await startChat.mutateAsync(person.id);
                navigate({ to: "/messages", search: { conversationId: convId } });
              } catch {
                navigate({ to: "/@{$username}", params: { username: person.username } });
              }
            }}
            className="h-8 rounded-full px-3 text-xs"
            aria-label={`Message ${name}`}
          >
            <MessageSquare className="size-3.5" />
          </Button>
        )}
      </div>
    </article>
  );
}

export function ExploreDiscoveryView({
  basePath,
  initialPings,
  category = null,
  initialFilter,
  initialQuery = "",
  pageNum = 0,
  onOpenIntroSlides,
}: ExploreDiscoveryViewProps) {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const startChat = useGetOrCreateDirectConversation();

  const {
    data = [],
    isLoading: isFeedLoading,
    isError: isFeedError,
    error: feedError,
    refetch: refetchFeed,
  } = useQuery({
    ...feedQuery(category, pageNum),
    ...(initialPings ? { initialData: initialPings, initialDataUpdatedAt: 0 } : {}),
  });

  const [activeFilter, setActiveFilter] = useState<DiscoveryFilter>(
    initialFilter ?? (category === "opportunity" ? "opportunities" : "all"),
  );
  const [sortBy, setSortBy] = useState<"relevant" | "recent" | "popular">("relevant");
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [inspectedPerson, setInspectedPerson] = useState<Profile | null>(null);
  const deferredQuery = useDeferredValue(searchQuery.trim().toLowerCase());

  const { data: mutedUsers = [] } = useQuery(mutedUsersQuery(user?.id));
  const { data: blockedUsers = [] } = useQuery(blockedUsersQuery(user?.id));
  const { data: followedTopics = [] } = useQuery(followedTopicsQuery(user?.id));
  const toggleFollowTopic = useToggleFollowTopic(user?.id);
  const hiddenAuthorIds = new Set([
    ...mutedUsers.map((m) => m.muted_id),
    ...blockedUsers.map((b) => b.blocked_id),
  ]);

  // Fetch real People, Hubs & Institutional Signals for network discovery
  const {
    data: people = [],
    isLoading: isPeopleLoading,
    isError: isPeopleError,
    error: peopleError,
    refetch: refetchPeople,
  } = useQuery({
    queryKey: ["explore-people", deferredQuery, user?.id],
    queryFn: async (): Promise<Profile[]> => {
      let query = supabase
        .from("profiles")
        .select("id, username, display_name, bio, avatar_url, created_at")
        .order("created_at", { ascending: false })
        .limit(12);
      if (user?.id) {
        query = query.neq("id", user.id);
      }
      if (deferredQuery) {
        const clean = deferredQuery.replace(/[%_,()*@]/g, "");
        if (clean) {
          query = query.or(
            `username.ilike.%${clean}%,display_name.ilike.%${clean}%,bio.ilike.%${clean}%`,
          );
        }
      }
      const { data: rows, error } = await query;
      if (error) throw error;
      return (rows ?? []) as Profile[];
    },
  });

  const { data: followedIds = new Set<string>(), refetch: refetchFollowed } = useQuery({
    queryKey: ["explore-followed", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async (): Promise<Set<string>> => {
      if (!user?.id) return new Set();
      const { data: rows, error } = await supabase
        .from("follows")
        .select("following_id")
        .eq("follower_id", user.id);
      if (error) throw error;
      return new Set((rows ?? []).map((r) => r.following_id));
    },
  });

  const {
    data: communities = [],
    isError: isCommunitiesError,
    error: communitiesError,
    refetch: refetchCommunities,
  } = useQuery(hubsQuery(deferredQuery, null, 0));

  const {
    data: institutionalSignals = [],
    isLoading: isSignalsLoading,
    isError: isSignalsError,
    error: signalsError,
    refetch: refetchSignals,
  } = useQuery(signalsQuery(deferredQuery ? { search: deferredQuery } : undefined));

  const allPings: Ping[] = (data ?? []).filter((p) => !hiddenAuthorIds.has(p.user_id));
  const matchedPings = deferredQuery
    ? allPings.filter((p) => {
        const text = p.content.toLowerCase();
        const username = p.author?.username?.toLowerCase() ?? "";
        const displayName = p.author?.display_name?.toLowerCase() ?? "";
        const meta = parseStructuredPing(p);
        const headline = (meta.headline ?? "").toLowerCase();
        const needs = meta.needs.join(" ").toLowerCase();
        const offers = meta.offers.join(" ").toLowerCase();
        const cleanQuery = deferredQuery.replace(/^[#.]/, "");
        return (
          text.includes(deferredQuery) ||
          text.includes(cleanQuery) ||
          username.includes(cleanQuery) ||
          displayName.includes(cleanQuery) ||
          headline.includes(cleanQuery) ||
          needs.includes(cleanQuery) ||
          offers.includes(cleanQuery)
        );
      })
    : allPings;

  const filteredPings = [...matchedPings].sort((a, b) => {
    if (sortBy === "popular") {
      return likeCount(b) + replyCount(b) * 2 - (likeCount(a) + replyCount(a) * 2);
    }
    if (sortBy === "recent") {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    const aScore = followedTopics.some((t) => a.content.toLowerCase().includes(t)) ? 1 : 0;
    const bScore = followedTopics.some((t) => b.content.toLowerCase().includes(t)) ? 1 : 0;
    if (bScore !== aScore) return bScore - aScore;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const trendingTopics = extractTrendingTopics(allPings, 8);
  const mergedTagSlugs = Array.from(
    new Set([
      ...trendingTopics.map((t) => t.slug),
      ...CURATED_DOT_TAGS.slice(0, 10).map((t) => t.slug),
    ]),
  ).slice(0, 10);

  const opportunityPings = filteredPings.filter((p) => {
    const fmt = parseStructuredPing(p).intentFormat;
    return (
      fmt === "opportunity" ||
      fmt === "need" ||
      fmt === "offer" ||
      fmt === "collaboration" ||
      p.category === "opportunity"
    );
  });

  const matchingIntentPings = filteredPings.filter((p) => {
    const meta = parseStructuredPing(p);
    return (
      meta.needs.length > 0 ||
      meta.offers.length > 0 ||
      meta.intentFormat === "collaboration" ||
      meta.intentFormat === "idea" ||
      meta.intentFormat === "question"
    );
  });

  const projectPings = filteredPings.filter((p) => {
    const fmt = parseStructuredPing(p).intentFormat;
    return fmt === "progress" || fmt === "building" || fmt === "launch" || fmt === "milestone";
  });

  const popularPings = [...filteredPings]
    .sort((a, b) => likeCount(b) + replyCount(b) - (likeCount(a) + replyCount(a)))
    .slice(0, 6);

  const newPings = filteredPings.slice(0, 6);
  const userInterests = profile?.interests ?? [];

  return (
    <div
      data-explore-discovery-home="true"
      className="mx-auto max-w-7xl w-full min-w-0 px-4 sm:px-6 py-6 sm:py-8 pb-24 overflow-x-clip"
    >
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            Explore
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Discover people, Moments, Hubs, institutional Signals, open opportunities, and Pings
            across PING.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {user ? (
            <Button asChild variant="hero" size="sm" className="rounded-full shadow-lift h-9 px-4">
              <Link to="/create">
                <Plus className="size-4" /> Create Ping
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

      {/* Signed-out prompt for returning guests */}
      {!user && onOpenIntroSlides && (
        <section
          aria-label="Sign in or join Ping"
          className="surface-card mt-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-3xl border border-primary/25 bg-hero p-5"
        >
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-primary">Ping by DOT</p>
            <h2 className="mt-0.5 font-display text-lg font-extrabold text-foreground">
              Connect, communicate, and make something happen
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Sign in with Google or email to post Pings, publish Clips, join Hubs, and message
              people 1-on-1.
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
              onClick={onOpenIntroSlides}
              className="rounded-full text-xs text-muted-foreground"
            >
              Intro slides
            </Button>
          </div>
        </section>
      )}

      {/* Search Bar */}
      <div className="relative mt-5">
        <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Find people, intentions, opportunities and more..."
          aria-label="Search people, intentions, opportunities, Hubs, Signals, projects, and Moments"
          className="h-12 rounded-2xl pl-11 pr-10 bg-card border-border text-sm shadow-soft"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Horizontal Discovery Filters + Sort Controls + Category Links */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav
          className="flex max-w-full min-w-0 gap-2 overflow-x-auto pb-1 scrollbar-none"
          aria-label="Discovery filters"
        >
          {DISCOVERY_FILTERS.map((f) => {
            const isSelected = activeFilter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setActiveFilter(f.id)}
                aria-pressed={isSelected}
                className={cn(
                  "shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition-colors",
                  isSelected
                    ? "border-foreground bg-foreground text-background shadow-sm"
                    : "border-border bg-card text-foreground hover:bg-secondary",
                )}
              >
                {f.label}
              </button>
            );
          })}
        </nav>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div
            className="inline-flex items-center rounded-full border border-border bg-card p-0.5 text-[11px]"
            role="group"
            aria-label="Sort results"
          >
            {(["relevant", "recent", "popular"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setSortBy(mode)}
                className={cn(
                  "rounded-full px-2.5 py-1 font-semibold capitalize transition-colors",
                  sortBy === mode
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {mode}
              </button>
            ))}
          </div>
          <Button asChild size="sm" variant="outline" className="rounded-full text-xs h-8">
            <Link to="/spotlight">Spotlight</Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="rounded-full text-xs h-8">
            <Link to="/learn">Learn</Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="rounded-full text-xs h-8">
            <Link to="/businesses">Businesses</Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="rounded-full text-xs h-8">
            <Link to="/signals/opportunities">Opportunities Hub</Link>
          </Button>
        </div>
      </div>

      {/* Personalized Recommended Interests Strip (for signed-in users with interests) */}
      {userInterests.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-semibold text-muted-foreground">Recommended:</span>
          {userInterests.slice(0, 6).map((interest) => (
            <button
              key={interest}
              type="button"
              onClick={() => setSearchQuery(interest)}
              className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary hover:bg-primary/15 transition-colors"
            >
              {formatInterestLabel(interest)}
            </button>
          ))}
        </div>
      )}

      {/* Main Responsive Discovery Grid (Centre Discovery + Desktop Right Rail) */}
      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px] xl:grid-cols-[1fr_360px] items-start">
        <div className="min-w-0 space-y-8">
          {/* Live Ping Spotlight Explore Strip */}
          <SpotlightFeedStrip channel="explore" maxItems={2} />

          {/* Trending DOT Tags */}
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Trending DOT Tags">
            <span className="text-[11px] font-semibold text-muted-foreground mr-1">
              Trending DOT Tags:
            </span>
            {mergedTagSlugs.map((slug) => {
              const followed = followedTopics.includes(slug);
              return (
                <div
                  key={slug}
                  className="inline-flex items-center rounded-full border border-border/70 bg-card text-[11px] overflow-hidden"
                >
                  <Link
                    to="/tag/$slug"
                    params={{ slug }}
                    className="px-2.5 py-1 font-semibold text-primary hover:bg-secondary"
                  >
                    .{slug}
                  </Link>
                  {user && (
                    <button
                      type="button"
                      onClick={() =>
                        toggleFollowTopic.mutate(
                          { topicSlug: slug, currentlyFollowing: followed },
                          {
                            onSuccess: (now) =>
                              toast.success(now ? `Following .${slug}` : `Unfollowed .${slug}`),
                          },
                        )
                      }
                      className={cn(
                        "px-2 py-1 border-l border-border/60 font-semibold transition-colors",
                        followed
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      aria-label={
                        followed ? `Remove .${slug} from your feed` : `Add .${slug} to your feed`
                      }
                    >
                      {followed ? "✓" : "+"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* C. Moments Discovery Rail (Temporary updates — distinct from persistent Clips) */}
          {(activeFilter === "all" || activeFilter === "moments") && (
            <section
              aria-labelledby="explore-moments-heading"
              className="surface-card rounded-3xl p-4 sm:p-5 border border-border/80"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2
                  id="explore-moments-heading"
                  className="font-display text-sm font-bold text-foreground flex items-center gap-2"
                >
                  <Sparkles className="size-4 text-primary" />
                  Moments Discovery
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    Temporary updates
                  </span>
                </h2>
                <span className="text-xs text-muted-foreground">
                  Tap any circle for full-screen view
                </span>
              </div>
              <MomentsTray />
              <DiscoverableMomentsFeed />
            </section>
          )}

          {/* D1. People You Should Know */}
          {(activeFilter === "all" || activeFilter === "people") &&
            (activeFilter === "people" || isPeopleError || people.length > 0) && (
              <section aria-labelledby="explore-people-heading">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2
                      id="explore-people-heading"
                      className="font-display text-xl font-bold tracking-tight flex items-center gap-2"
                    >
                      <Users className="size-5 text-primary" />
                      People you should know
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Creators, businesses, builders, investors, and community members across PING.
                    </p>
                  </div>
                  {activeFilter === "all" && people.length > 4 && (
                    <button
                      type="button"
                      onClick={() => setActiveFilter("people")}
                      className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
                    >
                      See all <ArrowRight className="size-3.5" />
                    </button>
                  )}
                </div>
                {isPeopleLoading ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="surface-card h-44 animate-pulse rounded-3xl p-5" />
                    ))}
                  </div>
                ) : isPeopleError ? (
                  <QueryErrorCard
                    compact
                    title="Couldn't load people directory"
                    error={peopleError}
                    onRetry={() => void refetchPeople()}
                  />
                ) : people.length === 0 ? (
                  <div className="surface-card rounded-3xl p-8 text-center">
                    <p className="font-display text-base font-bold">
                      {deferredQuery
                        ? `No people matching "${searchQuery.trim()}"`
                        : "No other people to show yet"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {deferredQuery
                        ? "Try a different name, @handle, or clear your search filter."
                        : "Explore public Pings or join a Hub to meet members across the network."}
                    </p>
                    {deferredQuery && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setSearchQuery("")}
                        className="mt-4 rounded-full"
                      >
                        Clear search
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {(activeFilter === "people" ? people : people.slice(0, 4)).map((person) => (
                      <PeopleDiscoveryCard
                        key={person.id}
                        person={person}
                        currentUserId={user?.id}
                        followed={followedIds.has(person.id)}
                        onFollowChanged={() => void refetchFollowed()}
                        onInspect={setInspectedPerson}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

          {/* D2. Institutional Signals Discovery */}
          {(activeFilter === "all" || activeFilter === "signals") && (
            <section aria-labelledby="explore-signals-heading">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2
                    id="explore-signals-heading"
                    className="font-display text-xl font-bold tracking-tight flex items-center gap-2"
                  >
                    <Radio className="size-5 text-gold" />
                    Institutional Signals
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Official broadcast channels from verified universities, companies, and
                    organizations.
                  </p>
                </div>
                <Link
                  to="/inbox"
                  search={{ section: "signals" }}
                  className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
                >
                  Open Signals in Inbox <ArrowRight className="size-3.5" />
                </Link>
              </div>

              {isSignalsLoading ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {[1, 2].map((i) => (
                    <div key={i} className="surface-card h-36 animate-pulse rounded-3xl p-5" />
                  ))}
                </div>
              ) : isSignalsError ? (
                <QueryErrorCard
                  compact
                  title="Couldn't load institutional Signals"
                  error={signalsError}
                  onRetry={() => void refetchSignals()}
                />
              ) : institutionalSignals.length === 0 ? (
                <div className="surface-card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-3xl p-6">
                  <div>
                    <p className="font-display text-base font-bold">
                      {deferredQuery
                        ? `No Signals matching "${searchQuery.trim()}"`
                        : "Discover official institutional Signals"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Authorized organizations can publish verified announcements and broadcasts via
                      Signals.
                    </p>
                  </div>
                  <Button asChild variant="outline" size="sm" className="rounded-full shrink-0">
                    <Link to="/signals">Browse Signals</Link>
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {(activeFilter === "signals"
                    ? institutionalSignals
                    : institutionalSignals.slice(0, 4)
                  ).map((signal) => (
                    <Link
                      key={signal.id}
                      to="/signals/$slug"
                      params={{ slug: signal.slug }}
                      className="surface-card lift flex flex-col justify-between rounded-3xl p-5 transition-all"
                    >
                      <div className="flex items-start gap-3">
                        <div className="size-11 shrink-0 overflow-hidden rounded-2xl bg-secondary flex items-center justify-center">
                          {signal.avatar_url ? (
                            <ResolvedMomentThumb
                              mediaUrl={signal.avatar_url}
                              mediaType="image"
                              alt={signal.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <Radio className="size-5 text-gold" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-display text-base font-bold text-foreground truncate">
                              {signal.name}
                            </span>
                            {signal.verified && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-gold/15 text-gold border border-gold/30 px-2 py-0.5 text-[10px] font-bold">
                                <ShieldCheck className="size-3" /> Verified
                              </span>
                            )}
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {signal.tagline ||
                              signal.description ||
                              "Official institutional broadcast channel."}
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-xs">
                        <span className="text-muted-foreground tabular-nums">
                          {(signal.follower_count ?? 0).toLocaleString()} followers
                        </span>
                        <span className="font-semibold text-primary">View Broadcasts →</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* D3. Recommended Communities (Hubs) */}
          {(activeFilter === "all" || activeFilter === "communities") && (
            <section aria-labelledby="explore-communities-heading">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2
                    id="explore-communities-heading"
                    className="font-display text-xl font-bold tracking-tight flex items-center gap-2"
                  >
                    <Building2 className="size-5 text-primary" />
                    Recommended communities
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Collaborative group Hubs for teams, campuses, organizations, and communities.
                  </p>
                </div>
                <Link
                  to="/inbox"
                  search={{ section: "hubs" }}
                  className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
                >
                  Open Hubs in Inbox <ArrowRight className="size-3.5" />
                </Link>
              </div>

              {isCommunitiesError ? (
                <QueryErrorCard
                  compact
                  title="Couldn't load Hubs"
                  error={communitiesError}
                  onRetry={() => void refetchCommunities()}
                />
              ) : communities.length === 0 ? (
                <div className="surface-card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-3xl p-6">
                  <div>
                    <p className="font-display text-base font-bold">Launch the first Hub</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Start a dedicated group Hub for real-time team and community conversations.
                    </p>
                  </div>
                  <Button asChild variant="hero" size="sm" className="rounded-full shrink-0">
                    <Link to="/hubs/create">Create a Hub</Link>
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {(activeFilter === "communities" ? communities : communities.slice(0, 4)).map(
                    (hub) => (
                      <Link
                        key={hub.id}
                        to="/hubs/$slug"
                        params={{ slug: hub.slug }}
                        className="surface-card lift flex flex-col justify-between rounded-3xl p-5 transition-all"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 min-w-0">
                              <span className="font-display text-base font-bold text-foreground truncate">
                                {hub.name}
                              </span>
                              {hub.verified && (
                                <span className="shrink-0 rounded-full bg-gold/15 text-gold border border-gold/30 px-2 py-0.5 text-[10px] font-bold">
                                  ✓
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-semibold capitalize">
                              {hub.category}
                            </span>
                          </div>
                          {hub.tagline && (
                            <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                              {hub.tagline}
                            </p>
                          )}
                        </div>
                        <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-xs">
                          <span className="text-muted-foreground tabular-nums">
                            {(hub.member_count ?? 0).toLocaleString()} members
                          </span>
                          <span className="font-semibold text-primary">Explore Hub →</span>
                        </div>
                      </Link>
                    ),
                  )}
                </div>
              )}
            </section>
          )}

          {/* D4. Open Opportunities & Intentions Matching Yours */}
          {(activeFilter === "all" || activeFilter === "opportunities") && (
            <section aria-labelledby="explore-opportunities-heading">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2
                    id="explore-opportunities-heading"
                    className="font-display text-xl font-bold tracking-tight flex items-center gap-2"
                  >
                    <Compass className="size-5 text-gold" />
                    {activeFilter === "opportunities"
                      ? "Open Opportunities & Needs"
                      : "Intentions matching yours & Open opportunities"}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Actionable needs, offers, roles, and collaboration requests you can respond to
                    now.
                  </p>
                </div>
                {activeFilter === "all" && opportunityPings.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setActiveFilter("opportunities")}
                    className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
                  >
                    View all <ArrowRight className="size-3.5" />
                  </button>
                )}
              </div>

              {opportunityPings.length === 0 && matchingIntentPings.length === 0 ? (
                <div className="surface-card rounded-3xl p-8 text-center">
                  <p className="font-display text-base font-bold">No open opportunity Pings yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Share a Need, Offer, or Opportunity to coordinate with the network.
                  </p>
                  <Button asChild variant="hero" size="sm" className="mt-4 rounded-full">
                    <Link to="/create">Share an Opportunity</Link>
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2 items-start min-w-0 [&>*]:min-w-0">
                  {(activeFilter === "opportunities"
                    ? opportunityPings.length > 0
                      ? opportunityPings
                      : matchingIntentPings
                    : (opportunityPings.length > 0 ? opportunityPings : matchingIntentPings).slice(
                        0,
                        4,
                      )
                  ).map((p) => (
                    <PingCard key={p.id} ping={p} />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* D5. Popular PINGs, Relevant Projects & New PINGs */}
          {(activeFilter === "all" || activeFilter === "pings") && (
            <>
              {activeFilter === "all" && popularPings.length > 0 && (
                <section aria-labelledby="explore-popular-heading">
                  <div className="mb-4">
                    <h2
                      id="explore-popular-heading"
                      className="font-display text-xl font-bold tracking-tight flex items-center gap-2"
                    >
                      <Flame className="size-5 text-primary" />
                      Popular PINGs &amp; Relevant projects
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      High-signal intentions and active builds gaining traction across the network.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2 items-start min-w-0 [&>*]:min-w-0">
                    {(projectPings.length >= 2 ? projectPings.slice(0, 4) : popularPings.slice(0, 4)).map(
                      (p) => (
                        <PingCard key={p.id} ping={p} />
                      ),
                    )}
                  </div>
                </section>
              )}

              <section aria-labelledby="explore-new-heading">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2
                      id="explore-new-heading"
                      className="font-display text-xl font-bold tracking-tight"
                    >
                      {activeFilter === "pings" ? "All Matching PINGs" : "New PINGs"}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Fresh intentions and updates published by the community.
                    </p>
                  </div>
                </div>

                {isFeedLoading && allPings.length === 0 ? (
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="surface-card h-48 animate-pulse rounded-3xl p-5" />
                    ))}
                  </div>
                ) : isFeedError ? (
                  <QueryErrorCard
                    title="Couldn't load Explore Pings"
                    description="A connection issue prevented loading public Pings. Try again below."
                    error={feedError}
                    onRetry={() => void refetchFeed()}
                  />
                ) : filteredPings.length === 0 ? (
                  <div className="surface-card mx-auto mt-4 max-w-lg rounded-3xl p-10 text-center">
                    <h3 className="font-display text-xl font-bold">
                      {deferredQuery
                        ? `No results match "${searchQuery.trim()}"`
                        : "No Pings in this view yet"}
                    </h3>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {deferredQuery
                        ? "Try searching for another skill, person, intention, or opportunity."
                        : "Be the first to share an intention with the network."}
                    </p>
                    <div className="mt-5 flex justify-center gap-2">
                      {deferredQuery && (
                        <Button variant="outline" size="sm" onClick={() => setSearchQuery("")}>
                          Clear search
                        </Button>
                      )}
                      <Button asChild variant="hero" size="sm">
                        <Link to="/create">Create a Ping</Link>
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2 items-start min-w-0 [&>*]:min-w-0">
                    {(activeFilter === "pings" ? filteredPings : newPings).map((p) => (
                      <PingCard key={p.id} ping={p} />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          <nav aria-label="Feed pages" className="pt-2 flex justify-center gap-3">
            {pageNum > 0 && (
              <Button asChild variant="outline">
                <Link
                  to={basePath}
                  search={{ ...(category ? { c: category } : {}), page: pageNum - 1 }}
                >
                  Newer Pings
                </Link>
              </Button>
            )}
            {allPings.length === 60 && (
              <Button asChild variant="outline">
                <Link
                  to={basePath}
                  search={{ ...(category ? { c: category } : {}), page: pageNum + 1 }}
                >
                  Older Pings
                </Link>
              </Button>
            )}
          </nav>

          <div className="pt-4">
            <AriseCallout />
          </div>
        </div>

        {/* Desktop Right Discovery Rail (lightweight shortcuts without embedding Clips player) */}
        <aside className="hidden lg:flex flex-col gap-5 sticky top-6" aria-label="Discovery shortcuts">
          {/* Clips Pointer Card (distinct product — opens /clips) */}
          <div className="surface-card rounded-3xl p-5 border border-primary/25 bg-primary/5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex size-9 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <Clapperboard className="size-4" />
              </div>
              <div>
                <h3 className="font-display text-sm font-bold text-foreground">Ping Clips</h3>
                <p className="text-[11px] text-muted-foreground">Persistent short-form videos</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Watch full-screen vertical creator videos on the dedicated Clips feed, separate from
              temporary Moments.
            </p>
            <Button asChild size="sm" variant="hero" className="w-full rounded-full text-xs">
              <Link to="/clips">
                Open Clips <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>

          {/* Quick Institutional Signals Rail */}
          <div className="surface-card rounded-3xl p-5 border border-border/70 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold flex items-center gap-1.5">
                <Radio className="size-4 text-gold" /> Institutional Signals
              </h3>
              <Link
                to="/inbox"
                search={{ section: "signals" }}
                className="text-[11px] font-semibold text-primary hover:underline"
              >
                All
              </Link>
            </div>
            {institutionalSignals.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Follow official broadcast channels from institutions in Inbox → Signals.
              </p>
            ) : (
              <div className="space-y-2.5">
                {institutionalSignals.slice(0, 3).map((sig) => (
                  <Link
                    key={sig.id}
                    to="/signals/$slug"
                    params={{ slug: sig.slug }}
                    className="flex items-center justify-between gap-2 rounded-2xl p-2 -mx-2 hover:bg-secondary/60 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-foreground truncate flex items-center gap-1">
                        {sig.name}
                        {sig.verified && (
                          <span className="rounded-full bg-gold/15 text-gold border border-gold/30 px-1.5 py-0.2 text-[9px] font-bold">
                            ✓
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-muted-foreground tabular-nums">
                        {(sig.follower_count ?? 0).toLocaleString()} followers
                      </p>
                    </div>
                    <ArrowRight className="size-3.5 text-muted-foreground shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Quick Hubs Rail */}
          <div className="surface-card rounded-3xl p-5 border border-border/70 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold flex items-center gap-1.5">
                <Building2 className="size-4 text-primary" /> Active Hubs
              </h3>
              <Link
                to="/inbox"
                search={{ section: "hubs" }}
                className="text-[11px] font-semibold text-primary hover:underline"
              >
                All
              </Link>
            </div>
            {communities.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Discover collaborative group Hubs in Inbox → Hubs.
              </p>
            ) : (
              <div className="space-y-2.5">
                {communities.slice(0, 3).map((hub) => (
                  <Link
                    key={hub.id}
                    to="/hubs/$slug"
                    params={{ slug: hub.slug }}
                    className="flex items-center justify-between gap-2 rounded-2xl p-2 -mx-2 hover:bg-secondary/60 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-foreground truncate">{hub.name}</p>
                      <p className="text-[11px] text-muted-foreground tabular-nums">
                        {(hub.member_count ?? 0).toLocaleString()} members
                      </p>
                    </div>
                    <ArrowRight className="size-3.5 text-muted-foreground shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Reusable Cascading Profile Inspection Drawer */}
      {inspectedPerson && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-[2px]"
          onClick={() => setInspectedPerson(null)}
        >
          <div
            className="h-full w-full max-w-sm bg-card shadow-lift border-l border-border"
            onClick={(e) => e.stopPropagation()}
          >
            <CascadingProfilePanel
              profile={inspectedPerson}
              onClose={() => setInspectedPerson(null)}
              onStartChat={async (targetUserId) => {
                if (!user) {
                  navigate({ to: "/login", search: { next: basePath } });
                  return;
                }
                try {
                  const convId = await startChat.mutateAsync(targetUserId);
                  setInspectedPerson(null);
                  navigate({ to: "/messages", search: { conversationId: convId } });
                } catch {
                  toast.error("Couldn't start conversation.");
                }
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
