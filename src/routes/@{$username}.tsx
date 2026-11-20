import { useEffect, useState } from "react";
import { pageHead, siteUrl, NOINDEX } from "@/lib/site";
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict } from "date-fns";
import {
  Link2,
  UserPlus,
  Check,
  Building2,
  MessageSquare,
  MoreVertical,
  Menu,
  BarChart3,
  Coins,
  Crown,
  Settings,
  Users,
  Sun,
  Moon,
  Laptop,
  LogOut,
  ShieldBan,
  ShieldCheck,
  Flag,
  Sparkles,
  UserCheck,
  CheckCircle2,
  Share2,
  Bell,
  HelpCircle,
  Lock,
  Wallet,
  Activity,
  MapPin,
  Globe,
  VolumeX,
  Bookmark,
} from "lucide-react";
import { toast } from "sonner";
import { profileQuery, likeCount, replyCount, type Profile, type Ping } from "@/lib/pings";
import { parseStructuredPing } from "@/lib/validation";
import {
  useGetOrCreateDirectConversation,
  blockedUsersQuery,
  useBlockUser,
  useUnblockUser,
} from "@/lib/messages";
import { mutedUsersQuery, useMuteUser, useUnmuteUser } from "@/lib/mutes";
import { mutualConnectionsQuery, savedAccountsQuery, useToggleSaveAccount } from "@/lib/social";
import { FounderAvatar } from "@/components/ping/Avatar";
import { PingCard } from "@/components/ping/PingCard";
import { UniversalShareDialog } from "@/components/sharing/UniversalShareDialog";
import { QueryErrorCard } from "@/components/QueryErrorCard";
import { ErrorComponent } from "@/routes/__root";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useSignOut } from "@/components/layout/SiteHeader";
import { useNavOverlay } from "@/lib/nav-overlay";
import { formatInterestLabel, formatPathwayLabel } from "@/lib/pathways";
import { PingMark } from "@/components/BrandLogo";
import { PublicConnections } from "@/components/connections/PublicConnections";
import { ProfileHighlights } from "@/components/moments/ProfileHighlights";
import { CloseCircleDialog } from "@/components/moments/CloseCircleDialog";
import {
  userActiveMomentsQuery,
  closeCircleQuery,
  useAddCloseCircleMember,
  useRemoveCloseCircleMember,
} from "@/lib/moments";
import { MomentViewerModal } from "@/components/moments/MomentViewerModal";
import { dotSummaryQuery, publicAccountTierQuery } from "@/lib/economy";
import { formatProfessionalBadgeLabel, publicVerificationQuery } from "@/lib/verification";
import { VerificationBadge } from "@/components/verification/VerificationBadge";
import { followQuery, myHubsQuery } from "@/lib/hub-queries";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/@{$username}")({
  staticData: { sitemap: true },
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(profileQuery(params.username));
    if (!data) throw notFound();
    return data;
  },
  errorComponent: ErrorComponent,
  notFoundComponent: () => (
    <div className="px-5 py-20 text-center">
      <h1 className="font-display text-4xl font-extrabold">No one here yet</h1>
      <p className="mt-2 text-sm text-muted-foreground">That Ping profile doesn&apos;t exist.</p>
      <Button asChild className="mt-6">
        <Link to="/explore">Explore Pings</Link>
      </Button>
    </div>
  ),
  head: ({ loaderData }) => {
    const p = loaderData?.profile;
    if (!p) return { meta: [{ title: "Profile unavailable — Ping by DOT" }, NOINDEX] };
    const name = p.display_name || `@${p.username}`;
    const head = pageHead({
      title: `${name} (@${p.username}) — Ping by DOT`,
      description: (p.bio || `See what @${p.username} is building in public on Ping.`).slice(
        0,
        200,
      ),
      path: `/@${encodeURIComponent(p.username)}`,
      type: "profile",
    });
    return { ...head, meta: [...head.meta, { property: "profile:username", content: p.username }] };
  },
  component: ProfilePage,
});

function FollowButton({
  profileId,
  currentUserId,
}: {
  profileId: string;
  currentUserId?: string | undefined;
}) {
  const qc = useQueryClient();
  const { data: follow } = useQuery(followQuery(profileId, currentUserId));

  const followMutation = useMutation({
    mutationFn: async (following: boolean) => {
      if (!currentUserId) throw new Error("Please log in to follow builders");
      if (following) {
        const { error } = await supabase
          .from("follows")
          .delete()
          .eq("follower_id", currentUserId)
          .eq("following_id", profileId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("follows")
          .insert({ follower_id: currentUserId, following_id: profileId });
        if (error) throw error;
      }
    },
    onMutate: async (following) => {
      await qc.cancelQueries({ queryKey: ["follow", profileId, currentUserId] });
      const previous = qc.getQueryData(["follow", profileId, currentUserId]);
      qc.setQueryData(["follow", profileId, currentUserId], (old: any) => ({
        ...old,
        isFollowing: !following,
        followers: (old?.followers ?? 0) + (following ? -1 : 1),
      }));
      return { previous };
    },
    onError: (_err, _variables, context: any) => {
      if (context?.previous) {
        qc.setQueryData(["follow", profileId, currentUserId], context.previous);
      }
      toast.error("Couldn't update follow status.");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["follow", profileId] });
      qc.invalidateQueries({ queryKey: ["profile-follow-list", profileId] });
      qc.invalidateQueries({ queryKey: ["following-feed"] });
      qc.invalidateQueries({ queryKey: ["explore-followed"] });
      qc.invalidateQueries({ queryKey: ["header-notifications"] });
    },
  });

  const isFollowing = follow?.isFollowing ?? false;

  return (
    <Button
      variant={isFollowing ? "outline" : "hero"}
      size="sm"
      className="rounded-full"
      disabled={followMutation.isPending}
      onClick={() => {
        if (!currentUserId) {
          toast("Sign in to follow people", {
            action: { label: "Log in", onClick: () => (window.location.href = "/login") },
          });
          return;
        }
        followMutation.mutate(isFollowing);
      }}
    >
      {isFollowing ? (
        <>
          <Check className="size-4" /> Following
        </>
      ) : (
        <>
          <UserPlus className="size-4" /> Follow
        </>
      )}
    </Button>
  );
}

function FollowListDialog({
  profileId,
  displayName,
  initialMode,
  open,
  onOpenChange,
}: {
  profileId: string;
  displayName: string;
  initialMode: "followers" | "following";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [mode, setMode] = useState<"followers" | "following">(initialMode);

  useEffect(() => {
    if (open) setMode(initialMode);
  }, [open, initialMode]);

  const {
    data: rows = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["profile-follow-list", profileId, mode],
    enabled: open && Boolean(profileId),
    queryFn: async (): Promise<Profile[]> => {
      if (mode === "followers") {
        const { data, error: queryError } = await supabase
          .from("follows")
          .select(
            "follower:profiles!follows_follower_id_fkey(id, username, display_name, bio, avatar_url, created_at)",
          )
          .eq("following_id", profileId)
          .order("created_at", { ascending: false })
          .limit(60);
        if (queryError) throw queryError;
        return (data ?? [])
          .map((r) => (r as unknown as { follower: Profile | null }).follower)
          .filter((p): p is Profile => Boolean(p));
      }
      const { data, error: queryError } = await supabase
        .from("follows")
        .select(
          "following:profiles!follows_following_id_fkey(id, username, display_name, bio, avatar_url, created_at)",
        )
        .eq("follower_id", profileId)
        .order("created_at", { ascending: false })
        .limit(60);
      if (queryError) throw queryError;
      return (data ?? [])
        .map((r) => (r as unknown as { following: Profile | null }).following)
        .filter((p): p is Profile => Boolean(p));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl p-6 max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{displayName}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Browse people connected with this profile.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 grid grid-cols-2 gap-2 rounded-full bg-secondary p-1">
          <button
            type="button"
            onClick={() => setMode("followers")}
            className={cn(
              "rounded-full py-1.5 text-xs font-semibold transition-colors",
              mode === "followers"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Followers
          </button>
          <button
            type="button"
            onClick={() => setMode("following")}
            className={cn(
              "rounded-full py-1.5 text-xs font-semibold transition-colors",
              mode === "following"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Following
          </button>
        </div>

        <div className="mt-4 flex-1 overflow-y-auto space-y-2 pr-1">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-2xl bg-muted/40" />
              ))}
            </div>
          ) : isError ? (
            <QueryErrorCard
              compact
              title="Couldn't load connections"
              error={error}
              onRetry={() => void refetch()}
            />
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {mode === "followers" ? "No followers yet." : "Not following anyone yet."}
            </p>
          ) : (
            rows.map((p) => {
              const pName = p.display_name || p.username;
              return (
                <Link
                  key={p.id}
                  to="/@{$username}"
                  params={{ username: p.username }}
                  onClick={() => onOpenChange(false)}
                  className="flex items-center gap-3 rounded-2xl border border-border/60 p-2.5 transition-colors hover:bg-secondary/60"
                >
                  <FounderAvatar name={pName} src={p.avatar_url} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate text-foreground">{pName}</p>
                    <p className="text-xs text-muted-foreground truncate">@{p.username}</p>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReportProfileDialog({
  targetProfile,
  reporterId,
  open,
  onOpenChange,
}: {
  targetProfile: Profile;
  reporterId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("Impersonation or spam");
  const [details, setDetails] = useState("");

  const submitMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("profile_reports").insert({
        reported_user_id: targetProfile.id,
        reporter_id: reporterId,
        reason: reason.trim(),
        details: details.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Profile report submitted for review.");
      setDetails("");
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast.error(err?.message || "Could not submit profile report.");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl p-6">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">
            Report @{targetProfile.username}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Reports help moderators review abuse, impersonation, or unsafe content.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitMutation.mutate();
          }}
          className="mt-3 space-y-4"
        >
          <div>
            <Label htmlFor="profile-report-reason" className="text-xs font-semibold">
              Reason
            </Label>
            <Input
              id="profile-report-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={120}
              required
              className="mt-1.5 rounded-xl"
            />
          </div>
          <div>
            <Label htmlFor="profile-report-details" className="text-xs font-semibold">
              Additional details (optional)
            </Label>
            <Textarea
              id="profile-report-details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Share specific context or links…"
              rows={3}
              maxLength={500}
              className="mt-1.5 rounded-xl resize-none"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={submitMutation.isPending || !reason.trim()}
              className="rounded-xl"
            >
              {submitMutation.isPending ? "Submitting…" : "Submit Report"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProfilePage() {
  const { username } = Route.useParams();
  const { data } = useSuspenseQuery(profileQuery(username));
  if (!data) return null;
  return (
    <ProfileContent
      data={data as { profile: Profile; pings: Ping[]; connections: any[] }}
      username={username}
    />
  );
}

function ProfileContent({
  data,
  username,
}: {
  data: { profile: Profile; pings: Ping[]; connections: any[] };
  username: string;
}) {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const startChatMutation = useGetOrCreateDirectConversation();
  const addCloseCircle = useAddCloseCircleMember();
  const removeCloseCircle = useRemoveCloseCircleMember();
  const blockUser = useBlockUser();
  const unblockUser = useUnblockUser();
  const muteUser = useMuteUser();
  const unmuteUser = useUnmuteUser();

  const { isOpen, openOverlay, onOpenChangeFor, closeOverlays } = useNavOverlay();
  const [momentModalOpen, setMomentModalOpen] = useState(false);
  const [closeCircleOpen, setCloseCircleOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [shareProfileOpen, setShareProfileOpen] = useState(false);
  const [followDialog, setFollowDialog] = useState<{
    open: boolean;
    mode: "followers" | "following";
  }>({ open: false, mode: "followers" });

  const { profile, pings, connections } = data;
  const isMe = user?.id === profile.id;
  const name = profile.display_name || profile.username || username;

  const { data: follow } = useQuery(followQuery(profile.id, user?.id));
  const { data: joinedHubs = [] } = useQuery(myHubsQuery(profile.id));
  const { data: activeMoments = [] } = useQuery(userActiveMomentsQuery(profile.id, user?.id));
  const { data: accountTier = "free" } = useQuery(publicAccountTierQuery(profile.id));
  const { data: verificationBadges } = useQuery(publicVerificationQuery(profile.id));
  // Retrieve DOT balance from the authenticated user's real wallet/account query
  const { data: dotSummary } = useQuery(dotSummaryQuery(user?.id));
  const { data: closeCircleMembers = [] } = useQuery(closeCircleQuery(user?.id));
  const { data: blockedUsers = [] } = useQuery(blockedUsersQuery(user?.id));
  const { data: mutedUsers = [] } = useQuery(mutedUsersQuery(user?.id));
  const { data: savedAccounts = new Set<string>() } = useQuery(savedAccountsQuery(user?.id));
  const toggleSaveAccount = useToggleSaveAccount(user?.id);
  const { data: mutualInfo } = useQuery(mutualConnectionsQuery(user?.id, profile.id));

  const hasActiveMoments = activeMoments.length > 0;
  const hasUnseenMoments = activeMoments.some((m) => !m.has_viewed);
  const inCloseCircle = closeCircleMembers.some((m) => m.member_id === profile.id);
  const isBlocked = blockedUsers.some((b) => b.blocked_id === profile.id);
  const isMuted = mutedUsers.some((m) => m.muted_id === profile.id);
  const isAccountSaved = savedAccounts.has(profile.id);

  // Extract relevant skills / interests from the creator's structured Pings & bio hashtags
  const skillTags = (() => {
    const set = new Set<string>();
    for (const p of pings) {
      const meta = parseStructuredPing(p);
      for (const s of [...meta.skills, ...meta.offers, ...meta.needs]) {
        if (s.length <= 28) set.add(s);
      }
      if (meta.intentLabel) set.add(meta.intentLabel);
    }
    if (profile.bio) {
      const hashMatches = profile.bio.match(/#[a-zA-Z0-9_-]{2,24}/g) ?? [];
      for (const tag of hashMatches) {
        set.add(tag.replace(/^#/, ""));
      }
    }
    return [...set].slice(0, 6);
  })();

  const cycleTheme = () => {
    const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    setTheme(next);
    toast.success(`Theme set to ${next}`);
  };

  const professionalBadgeLabel = verificationBadges?.professional_verified
    ? formatProfessionalBadgeLabel(verificationBadges.professional_pathway)
    : null;

  const verificationBadge = (
    <>
      {verificationBadges?.identity_verified && (
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary border border-primary/30 px-2.5 py-0.5 text-[11px] font-bold">
          <CheckCircle2 className="size-3" /> Verified Identity
        </span>
      )}
      {professionalBadgeLabel && (
        <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 text-gold border border-gold/30 px-2.5 py-0.5 text-[11px] font-bold">
          <ShieldCheck className="size-3" /> {professionalBadgeLabel}
        </span>
      )}
      {accountTier === "institution" ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-secondary text-secondary-foreground border border-border px-2.5 py-0.5 text-[11px] font-bold">
          <Building2 className="size-3" /> Organization Plan
        </span>
      ) : accountTier === "pro" ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 text-gold border border-gold/30 px-2.5 py-0.5 text-[11px] font-bold">
          <Crown className="size-3" /> Founder Pro
        </span>
      ) : accountTier === "plus" ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-lime/20 dark:bg-lime/15 text-lime-foreground dark:text-lime border border-lime/30 px-2.5 py-0.5 text-[11px] font-bold">
          <Sparkles className="size-3" /> Builder Plus
        </span>
      ) : null}
    </>
  );

  const drawerLinkClass =
    "flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="pb-24">
      <section className="bg-hero">
        <div className="mx-auto max-w-4xl px-4 sm:px-5 pb-8 pt-8 sm:pt-12">
          <div className="surface-card relative rounded-[2rem] p-6 sm:p-9 border border-border shadow-lift">
            {/* Top-Right Three-Line Menu Button (opens full-height account & profile drawer) */}
            <div className="absolute top-4 right-4 sm:top-6 sm:right-6 z-10">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => openOverlay("profile-drawer")}
                aria-label="Profile options menu"
                title="Open account & profile menu"
                className="size-10 rounded-full bg-card/90 shadow-sm hover:bg-secondary"
              >
                <Menu className="size-5" />
                <MoreVertical className="sr-only" />
              </Button>
            </div>

            <div className="flex flex-col gap-5 sm:flex-row sm:items-start pr-12">
              {hasActiveMoments ? (
                <button
                  type="button"
                  onClick={() => setMomentModalOpen(true)}
                  className={cn(
                    "self-start rounded-full p-1 transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary",
                    hasUnseenMoments
                      ? "bg-gradient-to-tr from-lime via-primary to-gold"
                      : "border-2 border-muted-foreground/40",
                  )}
                  aria-label={`View active Moments from ${name}`}
                >
                  <div className="rounded-full bg-card p-0.5">
                    <FounderAvatar name={name} src={profile.avatar_url} size="xl" />
                  </div>
                </button>
              ) : (
                <FounderAvatar name={name} src={profile.avatar_url} size="xl" />
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="font-display text-2xl font-extrabold sm:text-4xl">{name}</h1>
                  <VerificationBadge userId={profile.id} badges={verificationBadges} size="md" />
                  {verificationBadge}
                </div>
                <p className="text-muted-foreground text-sm mt-0.5">
                  @{profile.username} · Joined {format(new Date(profile.created_at), "MMM yyyy")}
                </p>

                {/* Interactive Follower / Following Counts */}
                <div className="mt-2.5 flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                  <button
                    type="button"
                    onClick={() => setFollowDialog({ open: true, mode: "followers" })}
                    className="hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
                  >
                    <strong className="text-foreground">
                      {(follow?.followers ?? 0).toLocaleString()}
                    </strong>{" "}
                    followers
                  </button>
                  <span>·</span>
                  <button
                    type="button"
                    onClick={() => setFollowDialog({ open: true, mode: "following" })}
                    className="hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
                  >
                    <strong className="text-foreground">
                      {(follow?.following ?? 0).toLocaleString()}
                    </strong>{" "}
                    following
                  </button>
                </div>

                {/* Biography */}
                {profile.bio && (
                  <p className="mt-3 max-w-xl whitespace-pre-line text-sm leading-relaxed text-foreground/90">
                    {profile.bio}
                  </p>
                )}

                {/* Optional Location, Country & Website */}
                {(profile.location || profile.country || profile.website_url) && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {(profile.location || profile.country) && (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="size-3.5 text-primary" />
                        {[profile.location, profile.country].filter(Boolean).join(", ")}
                      </span>
                    )}
                    {profile.website_url && /^https?:\/\//i.test(profile.website_url) && (
                      <a
                        href={profile.website_url}
                        target="_blank"
                        rel="noopener noreferrer nofollow ugc"
                        className="inline-flex items-center gap-1.5 text-primary hover:underline"
                      >
                        <Globe className="size-3.5" />
                        {profile.website_url
                          .replace(/^https?:\/\/(www\.)?/i, "")
                          .replace(/\/$/, "")}
                      </a>
                    )}
                  </div>
                )}

                {profile.interests && profile.interests.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Interests">
                    {profile.interests.map((id) => (
                      <span
                        key={id}
                        className="rounded-full border border-border bg-secondary/70 px-2.5 py-0.5 text-[11px] font-medium text-secondary-foreground"
                      >
                        {formatInterestLabel(id)}
                      </span>
                    ))}
                  </div>
                )}

                {/* Optional Participation Pathways */}
                {profile.participation_pathways && profile.participation_pathways.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Participation pathways">
                    {profile.participation_pathways.map((id) => (
                      <span
                        key={id}
                        className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-foreground"
                      >
                        {formatPathwayLabel(id)}
                      </span>
                    ))}
                  </div>
                )}

                {/* Relevant Skills / Interests */}
                {skillTags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Skills and interests">
                    {skillTags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-border bg-secondary/70 px-2.5 py-0.5 text-[11px] font-medium text-secondary-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Mutual Connections Badge */}
                {!isMe &&
                  (mutualInfo?.isMutualFollow ||
                    (mutualInfo?.sharedConnections.length ?? 0) > 0) && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {mutualInfo?.isMutualFollow && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                          <UserCheck className="size-3" /> Mutual connection
                        </span>
                      )}
                      {mutualInfo && mutualInfo.sharedConnections.length > 0 && (
                        <span>
                          Followed by{" "}
                          <strong className="text-foreground">
                            @{mutualInfo.sharedConnections[0]?.username}
                          </strong>
                          {mutualInfo.sharedConnections.length > 1
                            ? ` and ${mutualInfo.sharedConnections.length - 1} other${mutualInfo.sharedConnections.length > 2 ? "s" : ""} you follow`
                            : " whom you follow"}
                        </span>
                      )}
                    </div>
                  )}

                {/* Primary Profile Actions: Edit Profile / Follow / Message / Save & Share Profile */}
                <div className="mt-5 flex flex-wrap items-center gap-2.5">
                  {isMe ? (
                    <Button asChild size="sm" variant="hero" className="rounded-full px-5">
                      <Link to="/settings">Edit Profile</Link>
                    </Button>
                  ) : (
                    <>
                      <FollowButton profileId={profile.id} currentUserId={user?.id} />
                      {user && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="rounded-full font-semibold"
                            disabled={startChatMutation.isPending}
                            onClick={async () => {
                              try {
                                const convId = await startChatMutation.mutateAsync(profile.id);
                                navigate({
                                  to: "/messages",
                                  search: { conversationId: convId },
                                });
                              } catch (e: any) {
                                toast.error(e.message || "Failed to start direct conversation");
                              }
                            }}
                          >
                            <MessageSquare className="size-4 mr-1.5" /> Message
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={isAccountSaved ? "secondary" : "outline"}
                            className="rounded-full"
                            disabled={toggleSaveAccount.isPending}
                            onClick={() =>
                              toggleSaveAccount.mutate(
                                { targetUserId: profile.id, currentlySaved: isAccountSaved },
                                {
                                  onSuccess: (saved) =>
                                    toast.success(
                                      saved
                                        ? `Saved @${profile.username}`
                                        : `Removed @${profile.username} from saved accounts`,
                                    ),
                                },
                              )
                            }
                          >
                            <Bookmark
                              className={cn(
                                "size-4 mr-1",
                                isAccountSaved && "fill-current text-primary",
                              )}
                            />
                            {isAccountSaved ? "Saved" : "Save"}
                          </Button>
                        </>
                      )}
                    </>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => setShareProfileOpen(true)}
                  >
                    <Share2 className="size-4" /> Share Profile
                  </Button>
                </div>
                <UniversalShareDialog
                  open={shareProfileOpen}
                  onOpenChange={setShareProfileOpen}
                  payload={{
                    targetType: "profile",
                    targetId: profile.id,
                    title: `${name} (@${profile.username}) on Ping`,
                    description: profile.bio || `Connect with ${name} on Ping by DOT.`,
                    path: `/@${profile.username}`,
                  }}
                />
              </div>
            </div>

            <PublicConnections
              connections={connections}
              ownerId={profile.id}
              currentUserId={user?.id}
            />
          </div>
        </div>
      </section>

      {/* Profile Content Tabs: PINGs | Moments | Activity */}
      <section className="mx-auto max-w-4xl px-4 sm:px-5 mt-4">
        <Tabs defaultValue="pings">
          <TabsList className="h-11 rounded-full p-1 bg-secondary/80 overflow-x-auto max-w-full">
            <TabsTrigger value="pings" className="rounded-full px-6 text-sm font-semibold">
              PINGs ({pings.length})
            </TabsTrigger>
            <TabsTrigger value="moments" className="rounded-full px-6 text-sm font-semibold">
              Moments ({activeMoments.length})
            </TabsTrigger>
            <TabsTrigger value="activity" className="rounded-full px-6 text-sm font-semibold">
              Activity
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: PINGS */}
          <TabsContent value="pings" className="mt-6">
            {pings.length === 0 ? (
              <div className="rounded-3xl border border-dashed p-10 text-center text-muted-foreground">
                {isMe ? (
                  <>
                    <p>You haven't published a Ping yet.</p>
                    <Button asChild variant="hero" className="mt-4 rounded-full">
                      <Link to="/create">Create your first Ping</Link>
                    </Button>
                  </>
                ) : (
                  <p>{name} hasn't shared a Ping yet.</p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 items-start">
                {pings.map((p: any) => (
                  <PingCard key={p.id} ping={p} />
                ))}
              </div>
            )}
          </TabsContent>

          {/* TAB 2: MOMENTS (Highlights & Active Moments) */}
          <TabsContent value="moments" className="mt-6 space-y-6">
            <div className="surface-card rounded-3xl p-5 sm:p-6">
              <ProfileHighlights profile={profile} isMe={isMe} />
            </div>

            {activeMoments.length === 0 ? (
              <div className="surface-card rounded-3xl p-10 text-center text-muted-foreground">
                <Sparkles className="mx-auto size-9 text-muted-foreground/40" />
                <p className="mt-3 font-medium">No active Moments right now.</p>
                <p className="mt-1 text-xs">Moments and saved Highlight collections appear here.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
                {activeMoments.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMomentModalOpen(true)}
                    className="group relative aspect-[9/14] overflow-hidden rounded-3xl bg-black text-left shadow-sm"
                  >
                    {m.media_type === "video" ? (
                      <video
                        src={m.media_url}
                        muted
                        playsInline
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                    ) : (
                      <img
                        src={m.media_url}
                        alt={m.caption || "Moment"}
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-3 text-white">
                      {m.caption && <p className="line-clamp-2 text-xs font-medium">{m.caption}</p>}
                      <p className="mt-1 text-[10px] text-white/70">
                        {formatDistanceToNowStrict(new Date(m.created_at))} ago
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </TabsContent>

          {/* TAB 3: ACTIVITY (Coordination & Community Participation) */}
          <TabsContent value="activity" className="mt-6 space-y-6">
            <div className="grid gap-4 sm:grid-cols-3 tabular-nums">
              <div className="surface-card rounded-3xl p-5">
                <p className="text-xs text-muted-foreground">Published PINGs</p>
                <p className="mt-1 font-display text-2xl font-extrabold">{pings.length}</p>
              </div>
              <div className="surface-card rounded-3xl p-5">
                <p className="text-xs text-muted-foreground">Responses & Likes</p>
                <p className="mt-1 font-display text-2xl font-extrabold">
                  {pings.reduce((acc, p) => acc + likeCount(p) + replyCount(p), 0)}
                </p>
              </div>
              <div className="surface-card rounded-3xl p-5">
                <p className="text-xs text-muted-foreground">Joined Hubs</p>
                <p className="mt-1 font-display text-2xl font-extrabold">{joinedHubs.length}</p>
              </div>
            </div>

            {joinedHubs.length > 0 && (
              <div className="surface-card rounded-3xl p-6">
                <h3 className="font-display text-base font-bold flex items-center gap-2">
                  <Building2 className="size-4 text-primary" /> Community Hubs & Forums
                </h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {joinedHubs.map((jh) => (
                    <Link
                      key={jh.hub.id}
                      to="/hubs/$slug"
                      params={{ slug: jh.hub.slug }}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 p-3.5 transition-colors hover:border-primary"
                    >
                      <div className="min-w-0">
                        <p className="font-display font-bold text-sm truncate">{jh.hub.name}</p>
                        <p className="text-xs text-muted-foreground">Community Hub</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                        {jh.role}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {isMe && (
              <div className="surface-card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-3xl p-6">
                <div>
                  <h3 className="font-display text-base font-bold flex items-center gap-2">
                    <Activity className="size-4 text-primary" /> Full Creator Telemetry
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Inspect 7/30/90-day engagement charts, category breakdowns, and top PINGs.
                  </p>
                </div>
                <Button asChild variant="outline" size="sm" className="rounded-full shrink-0">
                  <Link to="/analytics">
                    <BarChart3 className="size-4" /> Open Analytics
                  </Link>
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </section>

      {/* THREE-LINE MENU SIDE DRAWER (Full-Height Account & Profile Menu) */}
      <Sheet open={isOpen("profile-drawer")} onOpenChange={onOpenChangeFor("profile-drawer")}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-sm overflow-y-auto rounded-l-3xl p-6 flex flex-col justify-between"
        >
          <div>
            <SheetHeader className="text-left pb-4 border-b border-border/60">
              <SheetTitle className="font-display text-xl font-extrabold">
                {isMe ? "Account & Coordination" : `@${profile.username}`}
              </SheetTitle>
              <SheetDescription className="text-xs text-muted-foreground">
                {isMe
                  ? "Manage your DOT balance, verification, privacy, and account settings."
                  : `Interact with ${name} on PING.`}
              </SheetDescription>
            </SheetHeader>

            {user ? (
              <div className="mt-5 space-y-1.5">
                {/* 1. DOT Balance Summary (Connected to real wallet/account data) */}
                <div className="mb-3 rounded-2xl border border-gold/30 bg-gold/10 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
                      <PingMark variant="gold" size="xs" />
                      <Coins className="size-4 text-gold" /> DOT Balance Summary
                    </span>
                    <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-bold text-gold uppercase">
                      {dotSummary?.subscription.tier ?? "free"}
                    </span>
                  </div>
                  <p className="mt-2 font-display text-2xl font-extrabold tabular-nums text-foreground">
                    {(dotSummary?.wallet.balance ?? 0).toLocaleString()} DOT
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                    Streak: {dotSummary?.wallet.streak_days ?? 0} days · Lifetime earned:{" "}
                    {(dotSummary?.wallet.lifetime_earned ?? 0).toLocaleString()} DOT
                  </p>
                </div>

                {/* 2. DOT Wallet */}
                <Link to="/balance" onClick={() => closeOverlays()} className={drawerLinkClass}>
                  <span className="flex items-center gap-3">
                    <Wallet className="size-4 text-primary" /> DOT Wallet
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {(dotSummary?.wallet.balance ?? 0).toLocaleString()} DOT
                  </span>
                </Link>

                {/* 3. Verification */}
                <Link to="/upgrades" onClick={() => closeOverlays()} className={drawerLinkClass}>
                  <span className="flex items-center gap-3">
                    <ShieldCheck className="size-4 text-gold" /> Verification & Upgrades
                  </span>
                  <span className="text-xs capitalize text-muted-foreground">{accountTier}</span>
                </Link>

                {/* 4. Settings */}
                <Link to="/settings" onClick={() => closeOverlays()} className={drawerLinkClass}>
                  <span className="flex items-center gap-3">
                    <Settings className="size-4" /> Settings
                  </span>
                </Link>

                {/* 5. Privacy and Security */}
                <button
                  type="button"
                  onClick={() => {
                    closeOverlays();
                    setCloseCircleOpen(true);
                  }}
                  className={drawerLinkClass}
                >
                  <span className="flex items-center gap-3">
                    <Lock className="size-4 text-primary" /> Privacy and Security
                  </span>
                  <span className="text-xs text-muted-foreground">Close Circle</span>
                </button>

                {/* 6. Notifications */}
                <Link to="/settings" onClick={() => closeOverlays()} className={drawerLinkClass}>
                  <span className="flex items-center gap-3">
                    <Bell className="size-4" /> Notifications
                  </span>
                </Link>

                {/* 7. Help and Support */}
                <Link to="/terms" onClick={() => closeOverlays()} className={drawerLinkClass}>
                  <span className="flex items-center gap-3">
                    <HelpCircle className="size-4" /> Help and Support
                  </span>
                </Link>

                {/* 8. Account Management & Analytics */}
                <Link to="/analytics" onClick={() => closeOverlays()} className={drawerLinkClass}>
                  <span className="flex items-center gap-3">
                    <BarChart3 className="size-4 text-primary" /> Account Management & Analytics
                  </span>
                </Link>

                <button type="button" onClick={cycleTheme} className={drawerLinkClass}>
                  <span className="flex items-center gap-3">
                    {theme === "light" ? (
                      <Sun className="size-4" />
                    ) : theme === "dark" ? (
                      <Moon className="size-4" />
                    ) : (
                      <Laptop className="size-4" />
                    )}
                    Appearance
                  </span>
                  <span className="text-xs capitalize text-muted-foreground">{theme}</span>
                </button>

                {!isMe && (
                  <div className="mt-3 pt-3 border-t border-border/60 space-y-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        closeOverlays();
                        if (inCloseCircle) {
                          removeCloseCircle.mutate(profile.id, {
                            onSuccess: () =>
                              toast.success(`Removed @${profile.username} from Close Circle`),
                          });
                        } else {
                          addCloseCircle.mutate(profile.id, {
                            onSuccess: () =>
                              toast.success(`Added @${profile.username} to Close Circle`),
                          });
                        }
                      }}
                      className={drawerLinkClass}
                    >
                      <span className="flex items-center gap-3">
                        <UserCheck className="size-4" />
                        {inCloseCircle ? "Remove from Close Circle" : "Add to Close Circle"}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        closeOverlays();
                        if (!user) return;
                        if (isMuted) {
                          unmuteUser.mutate(
                            { userId: user.id, targetUserId: profile.id },
                            {
                              onSuccess: () => toast.success(`Unmuted @${profile.username}`),
                              onError: (e: any) =>
                                toast.error(e?.message || "Could not unmute user."),
                            },
                          );
                        } else {
                          muteUser.mutate(
                            { userId: user.id, targetUserId: profile.id },
                            {
                              onSuccess: () => toast.success(`Muted @${profile.username}`),
                              onError: (e: any) =>
                                toast.error(e?.message || "Could not mute user."),
                            },
                          );
                        }
                      }}
                      className={drawerLinkClass}
                    >
                      <span className="flex items-center gap-3">
                        <VolumeX className="size-4" />
                        {isMuted ? "Unmute Account" : "Mute Account"}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        closeOverlays();
                        if (isBlocked) {
                          unblockUser.mutate(profile.id, {
                            onSuccess: () => toast.success(`Unblocked @${profile.username}`),
                          });
                        } else {
                          blockUser.mutate(profile.id, {
                            onSuccess: () => toast.success(`Blocked @${profile.username}`),
                          });
                        }
                      }}
                      className={drawerLinkClass}
                    >
                      <span className="flex items-center gap-3">
                        <ShieldBan className="size-4" />
                        {isBlocked ? "Unblock User" : "Block User"}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        closeOverlays();
                        setReportOpen(true);
                      }}
                      className={cn(drawerLinkClass, "text-destructive")}
                    >
                      <span className="flex items-center gap-3">
                        <Flag className="size-4" /> Report Profile
                      </span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                <button
                  type="button"
                  onClick={() => {
                    closeOverlays();
                    setShareProfileOpen(true);
                  }}
                  className={drawerLinkClass}
                >
                  <span className="flex items-center gap-3">
                    <Link2 className="size-4" /> Share Profile Link
                  </span>
                </button>
                <Link to="/terms" onClick={() => closeOverlays()} className={drawerLinkClass}>
                  <span className="flex items-center gap-3">
                    <HelpCircle className="size-4" /> Help and Support
                  </span>
                </Link>
                <Button asChild variant="hero" className="w-full rounded-full mt-2">
                  <Link to="/login">Sign in to PING</Link>
                </Button>
              </div>
            )}
          </div>

          {/* 9. Logout */}
          {user && (
            <div className="pt-4 border-t border-border/60">
              <button
                type="button"
                onClick={() => {
                  closeOverlays();
                  signOut();
                }}
                className={cn(drawerLinkClass, "text-destructive hover:bg-destructive/10")}
              >
                <span className="flex items-center gap-3">
                  <LogOut className="size-4" /> Logout
                </span>
              </button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Active Moments Modal */}
      {hasActiveMoments && (
        <MomentViewerModal
          sequences={[
            {
              author: profile,
              moments: activeMoments,
              hasUnseen: hasUnseenMoments,
              latestCreatedAt:
                activeMoments[activeMoments.length - 1]?.created_at ?? new Date().toISOString(),
            },
          ]}
          open={momentModalOpen}
          onOpenChange={setMomentModalOpen}
        />
      )}

      {/* Followers / Following Modal */}
      <FollowListDialog
        profileId={profile.id}
        displayName={name}
        initialMode={followDialog.mode}
        open={followDialog.open}
        onOpenChange={(open) => setFollowDialog((prev) => ({ ...prev, open }))}
      />

      {/* Close Circle Modal */}
      {user && <CloseCircleDialog open={closeCircleOpen} onOpenChange={setCloseCircleOpen} />}

      {/* Visitor Report Profile Modal */}
      {!isMe && user && (
        <ReportProfileDialog
          targetProfile={profile}
          reporterId={user.id}
          open={reportOpen}
          onOpenChange={setReportOpen}
        />
      )}
    </div>
  );
}
