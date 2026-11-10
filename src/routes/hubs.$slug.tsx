import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useDeferredValue } from "react";
import { z } from "zod";
import {
  Users,
  Pin,
  Lock,
  Globe,
  Share2,
  ExternalLink,
  ShieldAlert,
  UserCheck,
  UserPlus,
  LogOut,
  MoreVertical,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  HUB_CATEGORIES,
  HUB_INTENTS,
  canSeeHubContent,
  isHubStaff,
  type HubIntent,
  type HubRole,
} from "@/lib/hubs";
import {
  hubQuery,
  myMembershipQuery,
  memberFeedQuery,
  hubMembersQuery,
  hubError,
} from "@/lib/hub-queries";
import { PingCard, PingCardSkeleton } from "@/components/ping/PingCard";
import { FounderAvatar } from "@/components/ping/Avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HubShareModal } from "@/components/hubs/HubShareModal";
import { cn } from "@/lib/utils";
import { pageHead } from "@/lib/site";

export const Route = createFileRoute("/hubs/$slug")({
  validateSearch: z.object({
    intent: z.string().optional(),
    tab: z.string().optional(),
  }),
  head: () =>
    pageHead({
      title: "Hub Details — Ping by DOT",
      description: "Community hub on Ping.",
    }),
  component: HubDetail,
});

function MemberRow({
  member,
  hubId,
  isStaff,
  isOwner,
  currentUserId,
  onRefetch,
}: {
  member: any;
  hubId: string;
  isStaff: boolean;
  isOwner: boolean;
  currentUserId?: string;
  onRefetch: () => void;
}) {
  const profile = member.profile;
  const name = profile?.display_name || profile?.username || "Builder";
  const [following, setFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  // Check initial follow state
  const { data: followData } = useQuery({
    queryKey: ["follow-status", profile?.id, currentUserId],
    enabled: !!currentUserId && !!profile?.id && profile?.id !== currentUserId,
    queryFn: async () => {
      const { data } = await supabase
        .from("follows")
        .select("follower_id")
        .eq("follower_id", currentUserId!)
        .eq("following_id", profile.id)
        .maybeSingle();
      return !!data;
    },
  });

  const isFollowing = following || !!followData;

  const toggleFollow = async () => {
    if (!currentUserId || !profile?.id) {
      toast("Sign in to follow founders", { action: { label: "Log in", onClick: () => window.location.href = "/login" } });
      return;
    }
    setFollowLoading(true);
    try {
      if (isFollowing) {
        await supabase
          .from("follows")
          .delete()
          .eq("follower_id", currentUserId)
          .eq("following_id", profile.id);
        setFollowing(false);
        toast.success(`Unfollowed @${profile.username}`);
      } else {
        await supabase
          .from("follows")
          .insert({ follower_id: currentUserId, following_id: profile.id });
        setFollowing(true);
        toast.success(`Following @${profile.username}!`);
      }
    } catch {
      toast.error("Couldn't update follow status.");
    } finally {
      setFollowLoading(false);
    }
  };

  const manageRole = async (action: string, role?: string) => {
    try {
      const { error } = await supabase.rpc("manage_hub_member", {
        _hub: hubId,
        _user: member.user_id,
        _action: action,
        _role: role || null,
      });
      if (error) {
        toast.error(hubError(error, "Action failed."));
      } else {
        toast.success("Member updated!");
        onRefetch();
      }
    } catch (e) {
      toast.error(hubError(e, "Action failed."));
    }
  };

  const isSelf = currentUserId === member.user_id;

  return (
    <div className="surface-card flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4 sm:p-5">
      <div className="flex items-center gap-3.5 min-w-0">
        <FounderAvatar name={name} src={profile?.avatar_url ?? null} size="md" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              to="/@{$username}"
              params={{ username: profile?.username ?? "" }}
              className="font-semibold text-sm sm:text-base hover:underline truncate"
            >
              {name}
            </Link>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                member.role === "owner"
                  ? "bg-lime text-lime-foreground"
                  : member.role === "admin"
                  ? "bg-primary text-primary-foreground"
                  : member.role === "moderator"
                  ? "bg-accent text-accent-foreground"
                  : "bg-secondary text-secondary-foreground",
              )}
            >
              {member.role}
            </span>
          </div>
          {profile?.bio && (
            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{profile.bio}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {!isSelf && currentUserId && (
          <Button
            size="sm"
            variant={isFollowing ? "outline" : "hero"}
            onClick={toggleFollow}
            disabled={followLoading}
            className="rounded-full text-xs h-8 px-3"
          >
            {isFollowing ? (
              <>
                <Check className="size-3.5" /> Following
              </>
            ) : (
              <>
                <UserPlus className="size-3.5" /> Follow
              </>
            )}
          </Button>
        )}

        {isStaff && !isSelf && member.role !== "owner" && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8 rounded-full">
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-2xl w-44">
              {isOwner && member.role !== "admin" && (
                <DropdownMenuItem onSelect={() => manageRole("role", "admin")}>
                  Promote to Admin
                </DropdownMenuItem>
              )}
              {isOwner && member.role === "admin" && (
                <DropdownMenuItem onSelect={() => manageRole("role", "member")}>
                  Demote to Member
                </DropdownMenuItem>
              )}
              {member.role !== "moderator" && (
                <DropdownMenuItem onSelect={() => manageRole("role", "moderator")}>
                  Make Moderator
                </DropdownMenuItem>
              )}
              {member.role === "moderator" && (
                <DropdownMenuItem onSelect={() => manageRole("role", "member")}>
                  Remove Moderator
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() => manageRole("remove")}
                className="text-destructive focus:text-destructive"
              >
                Remove from Hub
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

function HubDetail() {
  const { slug } = Route.useParams();
  const { intent: intentParam, tab: tabParam } = Route.useSearch();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [shareOpen, setShareOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const deferredMemberSearch = useDeferredValue(memberSearch);

  const activeIntent = HUB_INTENTS.some((i) => i.value === intentParam)
    ? (intentParam as HubIntent)
    : null;
  const activeTab = tabParam || "feed";

  // Hub data query
  const { data: hubData, isLoading: hubLoading, error: hubErrorData } = useQuery(
    hubQuery(slug, activeIntent),
  );
  const hub = hubData?.hub;

  // Membership status
  const { data: membership } = useQuery(myMembershipQuery(hub?.id ?? "", user?.id));
  const isMember = membership?.status === "active";
  const isPending = membership?.status === "pending";
  const isStaff = isHubStaff(membership?.role);
  const isOwner = membership?.role === "owner";

  // Private hub feed query (viewer-scoped)
  const isPrivate = hub?.access === "private";
  const { data: privateFeed, isLoading: privateFeedLoading } = useQuery(
    memberFeedQuery(hub?.id ?? "", activeIntent, isPrivate && isMember),
  );

  // Members list query
  const { data: members, refetch: refetchMembers } = useQuery(
    hubMembersQuery(hub?.id ?? "", deferredMemberSearch, 0, "active"),
  );

  // Join mutation
  const joinMutation = useMutation({
    mutationFn: async () => {
      if (!user || !hub) throw new Error("Please log in first.");
      const { data, error } = await supabase.rpc("join_hub", { _hub: hub.id });
      if (error) throw error;
      return data;
    },
    onSuccess: (status) => {
      qc.invalidateQueries({ queryKey: ["hub-membership", hub?.id] });
      qc.invalidateQueries({ queryKey: ["hub", slug] });
      qc.invalidateQueries({ queryKey: ["my-hubs"] });
      if (status === "active") {
        toast.success(`You joined ${hub?.name}! 🎉`);
      } else {
        toast.info("Membership request sent for review.");
      }
    },
    onError: (e) => {
      toast.error(hubError(e, "Couldn't join hub. Please try again."));
    },
  });

  // Leave mutation
  const leaveMutation = useMutation({
    mutationFn: async () => {
      if (!user || !hub) throw new Error("Please log in first.");
      const { error } = await supabase.rpc("leave_hub", { _hub: hub.id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub-membership", hub?.id] });
      qc.invalidateQueries({ queryKey: ["hub", slug] });
      qc.invalidateQueries({ queryKey: ["my-hubs"] });
      toast.success("You left the hub.");
    },
    onError: (e) => {
      toast.error(hubError(e, "Couldn't leave hub."));
    },
  });

  if (hubLoading) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-12">
        <div className="surface-card h-64 animate-pulse rounded-[2.5rem]" />
        <div className="mt-8 space-y-4">
          <PingCardSkeleton />
          <PingCardSkeleton />
        </div>
      </div>
    );
  }

  if (!hub || hubErrorData) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <ShieldAlert className="mx-auto size-14 text-muted-foreground" />
        <h1 className="mt-4 font-display text-3xl font-extrabold">Hub not found</h1>
        <p className="mt-2 text-muted-foreground">
          This hub doesn't exist, has been made private, or was removed.
        </p>
        <Button asChild variant="hero" className="mt-6 rounded-full">
          <Link to="/hubs">Browse all Hubs</Link>
        </Button>
      </div>
    );
  }

  const categoryInfo = HUB_CATEGORIES.find((c) => c.value === hub.category);
  const feedItems = isPrivate ? privateFeed ?? [] : hubData?.feed ?? [];
  const pinnedPings = feedItems.filter((i) => i.is_pinned);
  const regularPings = feedItems.filter((i) => !i.is_pinned);
  const canViewFeed = canSeeHubContent(hub.access, membership?.role);

  return (
    <div className="pb-24">
      {/* Cover Banner */}
      <section className="bg-hero">
        <div className="mx-auto max-w-5xl px-5 pb-8 pt-10">
          <div className="surface-card relative overflow-hidden rounded-[2.5rem] p-6 sm:p-10 border border-border shadow-lift">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4 sm:gap-5 min-w-0">
                <div className="flex size-16 sm:size-20 shrink-0 items-center justify-center rounded-3xl bg-secondary text-3xl sm:text-4xl shadow-soft">
                  {categoryInfo?.emoji ?? "🏢"}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="font-display text-2xl sm:text-4xl font-extrabold truncate">
                      {hub.name}
                    </h1>
                    {hub.verified && (
                      <span className="rounded-full bg-lime px-2.5 py-0.5 text-xs font-bold text-lime-foreground">
                        ✓ Verified
                      </span>
                    )}
                  </div>
                  {hub.tagline && (
                    <p className="mt-1 text-sm sm:text-base text-muted-foreground">{hub.tagline}</p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-xs font-semibold">
                      <span>{categoryInfo?.emoji}</span> {categoryInfo?.label ?? hub.category}
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold",
                        isPrivate
                          ? "bg-blush text-blush-foreground"
                          : "bg-accent text-accent-foreground",
                      )}
                    >
                      {isPrivate ? (
                        <>
                          <Lock className="size-3.5" /> Private
                        </>
                      ) : (
                        <>
                          <Globe className="size-3.5" /> Public
                        </>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground ml-1">
                      {(hub.member_count ?? 0).toLocaleString()} /{" "}
                      {(hub.member_limit || 10000).toLocaleString()} builders
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShareOpen(true)}
                  className="rounded-full h-10 px-4"
                >
                  <Share2 className="size-4" /> Share
                </Button>

                {user ? (
                  isOwner ? (
                    <span className="rounded-full bg-lime/20 text-lime-foreground px-4 py-2 text-xs font-bold border border-lime/30">
                      Owner
                    </span>
                  ) : isMember ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => leaveMutation.mutate()}
                      disabled={leaveMutation.isPending}
                      className="rounded-full h-10 px-4 hover:border-destructive hover:text-destructive"
                    >
                      <LogOut className="size-4" /> Leave
                    </Button>
                  ) : isPending ? (
                    <Button variant="secondary" size="sm" disabled className="rounded-full h-10 px-4">
                      Request Pending
                    </Button>
                  ) : (
                    <Button
                      variant="hero"
                      size="sm"
                      onClick={() => joinMutation.mutate()}
                      disabled={joinMutation.isPending}
                      className="rounded-full h-10 px-5 shadow-lift"
                    >
                      <UserPlus className="size-4" /> {isPrivate ? "Request Access" : "Join Hub"}
                    </Button>
                  )
                ) : (
                  <Button asChild variant="hero" size="sm" className="rounded-full h-10 px-5 shadow-lift">
                    <Link to="/login" search={{ redirect: `/hubs/${hub.slug}` }}>
                      Sign in to Join
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Tabs Layout */}
      <section className="mx-auto max-w-5xl px-5 mt-6">
        <Tabs defaultValue={activeTab}>
          <TabsList className="h-11 rounded-full p-1 bg-secondary/80">
            <TabsTrigger value="feed" className="rounded-full px-5 text-sm font-semibold">
              Feed ({hub.ping_count ?? 0})
            </TabsTrigger>
            <TabsTrigger value="members" className="rounded-full px-5 text-sm font-semibold">
              Builders ({(hub.member_count ?? 0).toLocaleString()})
            </TabsTrigger>
            <TabsTrigger value="about" className="rounded-full px-5 text-sm font-semibold">
              About & Resources
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: FEED */}
          <TabsContent value="feed" className="mt-6 space-y-6">
            {!canViewFeed ? (
              <div className="surface-card mx-auto max-w-lg rounded-3xl p-12 text-center">
                <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-blush text-blush-foreground">
                  <Lock className="size-7" />
                </div>
                <h2 className="mt-5 font-display text-2xl font-bold">This hub is private</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Join or request access to participate in discussions and see what founders are
                  shipping here.
                </p>
                {user && !isPending && (
                  <Button
                    variant="hero"
                    className="mt-6 rounded-full"
                    onClick={() => joinMutation.mutate()}
                    disabled={joinMutation.isPending}
                  >
                    Request to Join
                  </Button>
                )}
              </div>
            ) : (
              <>
                {/* Intent Filter Bar */}
                <div className="-mx-5 flex items-center gap-2 overflow-x-auto px-5 pb-2">
                  <Link
                    to="/hubs/$slug"
                    params={{ slug: hub.slug }}
                    search={(prev) => ({ ...prev, intent: undefined })}
                    className={cn(
                      "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
                      !activeIntent
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-card hover:bg-secondary",
                    )}
                  >
                    All Pings
                  </Link>
                  {HUB_INTENTS.map((i) => (
                    <Link
                      key={i.value}
                      to="/hubs/$slug"
                      params={{ slug: hub.slug }}
                      search={(prev) => ({ ...prev, intent: i.value })}
                      className={cn(
                        "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
                        activeIntent === i.value
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-card hover:bg-secondary",
                      )}
                    >
                      <span>{i.emoji}</span> {i.label}
                    </Link>
                  ))}
                </div>

                {/* Pinned Pings */}
                {pinnedPings.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-primary uppercase tracking-wider">
                      <Pin className="size-3.5" /> Pinned Updates
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {pinnedPings.map((item) => (
                        <div key={item.ping.id} className="relative">
                          <PingCard
                            ping={item.ping}
                            hubBadge={{
                              name: hub.name,
                              slug: hub.slug,
                              intent: item.intent,
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Feed Pings */}
                {privateFeedLoading && !feedItems.length && (
                  <div className="grid gap-5 sm:grid-cols-2">
                    <PingCardSkeleton />
                    <PingCardSkeleton />
                  </div>
                )}

                {regularPings.length > 0 && (
                  <div className="grid gap-5 sm:grid-cols-2">
                    {regularPings.map((item) => (
                      <PingCard
                        key={item.ping.id}
                        ping={item.ping}
                        hubBadge={{
                          name: hub.name,
                          slug: hub.slug,
                          intent: item.intent,
                        }}
                      />
                    ))}
                  </div>
                )}

                {feedItems.length === 0 && (
                  <div className="surface-card rounded-3xl p-10 text-center">
                    <p className="font-semibold text-lg">No updates here yet</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {activeIntent
                        ? `No pings tagged #${activeIntent} in this hub yet.`
                        : "Be the first to share an update to this hub!"}
                    </p>
                    {isMember && (
                      <Button asChild variant="hero" className="mt-5 rounded-full">
                        <Link to="/create">Post a Ping</Link>
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* TAB 2: MEMBERS DIRECTORY */}
          <TabsContent value="members" className="mt-6 space-y-4">
            <div className="relative">
              <Input
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Search builders in this hub by name or handle…"
                className="h-11 rounded-2xl bg-card border-border shadow-sm text-sm"
              />
            </div>

            <div className="space-y-3">
              {members && members.length > 0 ? (
                members.map((member) => (
                  <MemberRow
                    key={member.user_id}
                    member={member}
                    hubId={hub.id}
                    isStaff={isStaff}
                    isOwner={isOwner}
                    currentUserId={user?.id}
                    onRefetch={() => refetchMembers()}
                  />
                ))
              ) : (
                <div className="surface-card rounded-2xl p-8 text-center text-sm text-muted-foreground">
                  {memberSearch ? `No builders match "${memberSearch}"` : "No members found."}
                </div>
              )}
            </div>
          </TabsContent>

          {/* TAB 3: ABOUT & RESOURCES */}
          <TabsContent value="about" className="mt-6 space-y-6">
            {hub.description && (
              <div className="surface-card rounded-3xl p-6 sm:p-8">
                <h2 className="font-display text-xl font-bold">About this Hub</h2>
                <p className="mt-3 whitespace-pre-line text-sm sm:text-base leading-relaxed text-foreground/90">
                  {hub.description}
                </p>
              </div>
            )}

            {hub.rules && (
              <div className="surface-card rounded-3xl p-6 sm:p-8">
                <h2 className="font-display text-xl font-bold">Community Guidelines</h2>
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                  {hub.rules}
                </p>
              </div>
            )}

            {hub.resources && hub.resources.length > 0 && (
              <div className="surface-card rounded-3xl p-6 sm:p-8">
                <h2 className="font-display text-xl font-bold">Official Resources</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {hub.resources.map((res, i) => (
                    <a
                      key={i}
                      href={res.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-secondary/50 p-4 transition-colors hover:bg-secondary hover:border-primary"
                    >
                      <span className="font-semibold text-sm">{res.label}</span>
                      <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </section>

      {/* Share Modal */}
      <HubShareModal hub={hub} open={shareOpen} onClose={() => setShareOpen(false)} />
    </div>
  );
}
