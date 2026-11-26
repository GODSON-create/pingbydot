import { useDeferredValue, useState } from "react";
import { pageHead } from "@/lib/site";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QueryErrorCard } from "@/components/QueryErrorCard";
import {
  ArrowRight,
  Building2,
  Compass,
  Eye,
  Flame,
  MessageSquare,
  Search,
  Sparkles,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PingCard } from "@/components/ping/PingCard";
import { FounderAvatar } from "@/components/ping/Avatar";
import { VerificationBadge } from "@/components/verification/VerificationBadge";
import { CascadingProfilePanel } from "@/components/profile/CascadingProfilePanel";
import { MomentsTray } from "@/components/moments/MomentsTray";
import { DiscoverableMomentsFeed } from "@/components/moments/DiscoverableMomentsFeed";
import { SpotlightFeedStrip } from "@/components/spotlight/SpotlightFeedStrip";
import { AriseCallout } from "@/components/AriseCallout";
import { feedQuery, likeCount, replyCount, type Ping, type Profile } from "@/lib/pings";
import { hubsQuery } from "@/lib/hub-queries";
import { parseStructuredPing } from "@/lib/validation";
import { useAuth } from "@/lib/auth";
import { blockedUsersQuery, useGetOrCreateDirectConversation } from "@/lib/messages";
import { mutedUsersQuery } from "@/lib/mutes";
import { extractTrendingTopics } from "@/lib/feed-engine";
import { CURATED_DOT_TAGS } from "@/lib/dot-tags";
import { followedTopicsQuery, useToggleFollowTopic } from "@/lib/social";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const DISCOVERY_FILTERS = [
  { id: "all", label: "All" },
  { id: "pings", label: "PINGs" },
  { id: "people", label: "People" },
  { id: "moments", label: "Moments" },
  { id: "communities", label: "Communities" },
  { id: "opportunities", label: "Opportunities" },
] as const;

type DiscoveryFilter = (typeof DISCOVERY_FILTERS)[number]["id"];

export const Route = createFileRoute("/explore")({
  staticData: { sitemap: true },
  validateSearch: z.object({
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
    filter: z
      .enum(["all", "pings", "people", "moments", "communities", "opportunities"])
      .optional(),
    q: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(0).max(10000).optional(),
  }),
  loaderDeps: ({ search: { c, page } }) => ({ cat: c ?? null, page: page ?? 0 }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(feedQuery(deps.cat, deps.page)),
  head: () =>
    pageHead({
      title: "Explore — PING Network Discovery",
      description:
        "Discover people, intentions, opportunities, communities, projects, and Moments on PING.",
      path: "/explore",
    }),
  component: Explore,
});

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

function Explore() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const startChat = useGetOrCreateDirectConversation();
  const { c, filter: filterParam, q, page } = Route.useSearch();
  const initialExplorePings = Route.useLoaderData();
  const cat = c ?? null;
  const pageNum = page ?? 0;
  const {
    data = [],
    isLoading: isFeedLoading,
    isError: isFeedError,
    error: feedError,
    refetch: refetchFeed,
  } = useQuery({
    ...feedQuery(cat, pageNum),
    initialData: initialExplorePings,
    initialDataUpdatedAt: 0,
  });

  const [activeFilter, setActiveFilter] = useState<DiscoveryFilter>(
    filterParam ?? (cat === "opportunity" ? "opportunities" : "all"),
  );
  const [sortBy, setSortBy] = useState<"relevant" | "recent" | "popular">("relevant");
  const [searchQuery, setSearchQuery] = useState(q ?? "");
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

  // Fetch real People & Communities for network discovery
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
    // relevant: boost followed topics slightly while respecting recency
    const aScore = followedTopics.some((t) => a.content.toLowerCase().includes(t)) ? 1 : 0;
    const bScore = followedTopics.some((t) => b.content.toLowerCase().includes(t)) ? 1 : 0;
    if (bScore !== aScore) return bScore - aScore;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const trendingTopics = extractTrendingTopics(allPings, 8);

  // Categorize Pings into discovery buckets
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

  return (
    <div className="mx-auto max-w-6xl w-full min-w-0 px-4 sm:px-6 py-8 pb-24 overflow-x-clip">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
            Explore
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Discover people, intentions, open opportunities, communities, and projects across PING.
          </p>
        </div>
      </div>

      {/* A. Search Bar */}
      <div className="relative mt-5">
        <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Find people, intentions, opportunities and more..."
          aria-label="Search people, intentions, opportunities, communities, projects, and Moments"
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

      {/* B. Horizontal Discovery Filters + Sort Controls + Signals Opportunities Shortcut */}
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

        <div className="flex items-center gap-2 shrink-0">
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
            <Link to="/clips">Ping Clips</Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="rounded-full text-xs h-8">
            <Link to="/spotlight">Spotlight</Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="rounded-full text-xs h-8">
            <Link to="/learn">Learn</Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="rounded-full text-xs h-8">
            <Link to="/media">Video &amp; Media</Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="rounded-full text-xs h-8">
            <Link to="/businesses">Businesses</Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="rounded-full text-xs h-8">
            <Link to="/signals/opportunities">Opportunities Hub</Link>
          </Button>
        </div>
      </div>

      {/* Live Ping Spotlight Explore Distribution Strip (renders only when published stories exist) */}
      <SpotlightFeedStrip channel="explore" maxItems={2} />

      {/* Trending DOT Tags & Legacy Hashtag-Compatible Discovery Chips */}
      {(() => {
        const mergedTagSlugs = Array.from(
          new Set([
            ...trendingTopics.map((t) => t.slug),
            ...CURATED_DOT_TAGS.slice(0, 10).map((t) => t.slug),
          ]),
        ).slice(0, 10);
        return (
          <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="Trending DOT Tags">
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
        );
      })()}

      {/* C. Moments Discovery Rail (Always accessible on All & Moments) */}
      {(activeFilter === "all" || activeFilter === "moments") && (
        <section className="mt-6 surface-card rounded-3xl p-4 sm:p-5 border border-border/80">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-sm font-bold text-foreground flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              Moments Discovery
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
          <section className="mt-8" aria-labelledby="explore-people-heading">
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

      {/* D2. Open Opportunities & Intentions Matching Yours */}
      {(activeFilter === "all" || activeFilter === "opportunities") && (
        <section className="mt-10" aria-labelledby="explore-opportunities-heading">
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
                Actionable needs, offers, roles, and collaboration requests you can respond to now.
              </p>
            </div>
            {activeFilter === "all" && opportunityPings.length > 3 && (
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
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 items-start min-w-0 [&>*]:min-w-0">
              {(activeFilter === "opportunities"
                ? opportunityPings.length > 0
                  ? opportunityPings
                  : matchingIntentPings
                : (opportunityPings.length > 0 ? opportunityPings : matchingIntentPings).slice(0, 3)
              ).map((p) => (
                <PingCard key={p.id} ping={p} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* D3. Recommended Communities (Hubs) */}
      {(activeFilter === "all" || activeFilter === "communities") && (
        <section className="mt-10" aria-labelledby="explore-communities-heading">
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(activeFilter === "communities" ? communities : communities.slice(0, 3)).map(
                (hub) => (
                  <Link
                    key={hub.id}
                    to="/hubs/$slug"
                    params={{ slug: hub.slug }}
                    className="surface-card lift flex flex-col justify-between rounded-3xl p-5 transition-all"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display text-base font-bold text-foreground truncate">
                          {hub.name}
                        </span>
                        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-semibold capitalize">
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

      {/* D4. Popular PINGs, Relevant Projects & New PINGs */}
      {(activeFilter === "all" || activeFilter === "pings") && (
        <>
          {activeFilter === "all" && popularPings.length > 0 && (
            <section className="mt-10" aria-labelledby="explore-popular-heading">
              <div className="mb-4">
                <h2
                  id="explore-popular-heading"
                  className="font-display text-xl font-bold tracking-tight flex items-center gap-2"
                >
                  <Flame className="size-5 text-primary" />
                  Popular PINGs & Relevant projects
                </h2>
                <p className="text-xs text-muted-foreground">
                  High-signal intentions and active builds gaining traction across the network.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 items-start min-w-0 [&>*]:min-w-0">
                {(projectPings.length >= 3 ? projectPings.slice(0, 6) : popularPings).map((p) => (
                  <PingCard key={p.id} ping={p} />
                ))}
              </div>
            </section>
          )}

          <section className="mt-10" aria-labelledby="explore-new-heading">
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
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3].map((i) => (
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
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 items-start min-w-0 [&>*]:min-w-0">
                {(activeFilter === "pings" ? filteredPings : newPings).map((p) => (
                  <PingCard key={p.id} ping={p} />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <nav aria-label="Feed pages" className="mt-8 flex justify-center gap-3">
        {pageNum > 0 && (
          <Button asChild variant="outline">
            <Link to="/explore" search={{ c, page: pageNum - 1 }}>
              Newer Pings
            </Link>
          </Button>
        )}
        {allPings.length === 60 && (
          <Button asChild variant="outline">
            <Link to="/explore" search={{ c, page: pageNum + 1 }}>
              Older Pings
            </Link>
          </Button>
        )}
      </nav>

      <div className="mt-14">
        <AriseCallout />
      </div>

      {/* Reusable Cascading Profile Inspection Drawer (Section 6 & 10) */}
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
                  navigate({ to: "/login", search: { next: "/explore" } });
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
