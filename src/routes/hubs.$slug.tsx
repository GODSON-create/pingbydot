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
  UserX,
  LogOut,
  MoreVertical,
  Check,
  Settings,
  Pencil,
  Trash2,
  Plus,
  Clock,
  PinOff,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  HUB_CATEGORIES,
  HUB_INTENTS,
  canSeeHubContent,
  isHubStaff,
  type Hub,
  type HubCategory,
  type HubIntent,
  type HubRole,
  type HubResource,
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HubShareModal } from "@/components/hubs/HubShareModal";
import { HubChat } from "@/components/hubs/HubChat";
import { cn } from "@/lib/utils";
import { pageHead } from "@/lib/site";

export const Route = createFileRoute("/hubs/$slug")({
  staticData: { sitemap: true },
  validateSearch: z.object({
    intent: z.string().optional(),
    tab: z.string().optional(),
    invite: z.string().optional(),
  }),
  head: () =>
    pageHead({
      title: "Hub Details — Ping by DOT",
      description: "Community hub on Ping.",
      path: "/hubs",
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
  currentUserId?: string | undefined;
  onRefetch: () => void | Promise<any>;
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
      toast("Sign in to follow founders", {
        action: { label: "Log in", onClick: () => (window.location.href = "/login") },
      });
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

  const manageRole = async (
    action: "approve" | "decline" | "remove" | "role",
    newRole?: string,
  ) => {
    try {
      const { error } = await supabase.rpc("manage_hub_member", {
        _hub: hubId,
        _user: member.user_id,
        _action: action,
        ...(newRole ? { _role: newRole } : {}),
      });
      if (error) throw error;
      toast.success(
        action === "remove"
          ? "Removed from Hub."
          : action === "role"
            ? `Updated role to ${newRole}.`
            : "Action completed.",
      );
      onRefetch();
    } catch (e: any) {
      toast.error(hubError(e, "Could not update member."));
    }
  };

  const isSelf = currentUserId === member.user_id;

  return (
    <div className="surface-card flex items-center justify-between gap-4 rounded-2xl p-4 border border-border">
      <Link
        to="/@{$username}"
        params={{ username: profile?.username ?? "" }}
        className="flex items-center gap-3 min-w-0"
      >
        <FounderAvatar name={name} src={profile?.avatar_url} size="md" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-display font-bold text-sm truncate">{name}</span>
            <span className="text-xs text-muted-foreground truncate">@{profile?.username}</span>
            {member.role === "owner" && (
              <span className="rounded-full bg-lime/20 text-lime-foreground px-2 py-0.5 text-[10px] font-bold border border-lime/30">
                Owner
              </span>
            )}
            {member.role === "admin" && (
              <span className="rounded-full bg-primary/20 text-primary px-2 py-0.5 text-[10px] font-bold border border-primary/30">
                Admin
              </span>
            )}
            {member.role === "moderator" && (
              <span className="rounded-full bg-accent text-accent-foreground px-2 py-0.5 text-[10px] font-bold">
                Mod
              </span>
            )}
          </div>
          {profile?.bio && (
            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{profile.bio}</p>
          )}
        </div>
      </Link>

      <div className="flex items-center gap-2 shrink-0">
        {!isSelf && currentUserId && (
          <Button
            variant={isFollowing ? "secondary" : "outline"}
            size="sm"
            onClick={toggleFollow}
            disabled={followLoading}
            className="rounded-full h-8 px-3 text-xs gap-1"
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

function PendingRequestsSection({
  hubId,
  onProcessed,
}: {
  hubId: string;
  onProcessed: () => void;
}) {
  const { data: pendingMembers = [], refetch } = useQuery(hubMembersQuery(hubId, "", 0, "pending"));

  if (!pendingMembers || pendingMembers.length === 0) return null;

  const handleAction = async (userId: string, action: "approve" | "decline") => {
    try {
      const { error } = await supabase.rpc("manage_hub_member", {
        _hub: hubId,
        _user: userId,
        _action: action,
      });
      if (error) throw error;
      toast.success(action === "approve" ? "Member approved!" : "Request declined.");
      refetch();
      onProcessed();
    } catch (e: any) {
      toast.error(hubError(e, `Could not ${action} request.`));
    }
  };

  return (
    <div className="surface-card rounded-3xl p-5 sm:p-6 border border-amber-500/30 bg-amber-500/5 mb-6">
      <div className="flex items-center gap-2 text-sm font-bold text-amber-500 mb-3">
        <Clock className="size-4" />
        <span>Pending Access Requests ({pendingMembers.length})</span>
      </div>
      <div className="space-y-3">
        {pendingMembers.map((req) => {
          const profile = req.profile;
          const name = profile?.display_name || profile?.username || "Builder";
          return (
            <div
              key={req.user_id}
              className="flex items-center justify-between gap-4 rounded-2xl bg-card p-3 border border-border"
            >
              <Link
                to="/@{$username}"
                params={{ username: profile?.username ?? "" }}
                className="flex items-center gap-3 min-w-0"
              >
                <FounderAvatar name={name} src={profile?.avatar_url} size="sm" />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-xs truncate">{name}</span>
                    <span className="text-[11px] text-muted-foreground truncate">
                      @{profile?.username}
                    </span>
                  </div>
                  {profile?.bio && (
                    <p className="text-[11px] text-muted-foreground line-clamp-1">{profile.bio}</p>
                  )}
                </div>
              </Link>

              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  size="sm"
                  variant="hero"
                  className="rounded-xl h-8 px-3 text-xs"
                  onClick={() => handleAction(req.user_id, "approve")}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl h-8 px-3 text-xs text-destructive hover:bg-destructive/10"
                  onClick={() => handleAction(req.user_id, "decline")}
                >
                  Decline
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EditHubDialog({
  hub,
  open,
  onOpenChange,
}: {
  hub: Hub;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(hub.name);
  const [tagline, setTagline] = useState(hub.tagline || "");
  const [description, setDescription] = useState(hub.description || "");
  const [rules, setRules] = useState(hub.rules || "");
  const [category, setCategory] = useState<HubCategory>(hub.category);
  const [access, setAccess] = useState<"public" | "private">(hub.access);
  const [resources, setResources] = useState<HubResource[]>(hub.resources || []);
  const [newResLabel, setNewResLabel] = useState("");
  const [newResUrl, setNewResUrl] = useState("");

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("update_hub", {
        _hub: hub.id,
        _name: name.trim(),
        _tagline: tagline.trim(),
        _description: description.trim(),
        _rules: rules.trim(),
        _category: category,
        _access: access,
        _resources: resources as any,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub", hub.slug] });
      qc.invalidateQueries({ queryKey: ["hubs"] });
      toast.success("Hub settings updated!");
      onOpenChange(false);
    },
    onError: (e: any) => {
      toast.error(hubError(e, "Could not update hub settings."));
    },
  });

  const handleAddResource = () => {
    if (!newResLabel.trim() || !newResUrl.trim()) return;
    if (!/^https:\/\//i.test(newResUrl.trim())) {
      toast.error("Resource URL must begin with https://");
      return;
    }
    setResources([...resources, { label: newResLabel.trim(), url: newResUrl.trim() }]);
    setNewResLabel("");
    setNewResUrl("");
  };

  const handleRemoveResource = (index: number) => {
    setResources(resources.filter((_, i) => i !== index));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-3xl p-6 sm:p-8 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <Settings className="size-5 text-primary" /> Edit Hub Settings
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Update your hub identity, visibility, guidelines, and official resources.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateMutation.mutate();
          }}
          className="mt-4 space-y-4"
        >
          <div>
            <Label className="text-xs font-semibold">Hub Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 rounded-xl"
              required
              minLength={2}
              maxLength={60}
            />
          </div>

          <div>
            <Label className="text-xs font-semibold">Tagline</Label>
            <Input
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="e.g. Where European AI founders share daily progress"
              className="mt-1 rounded-xl"
              maxLength={120}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-semibold">Category</Label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as HubCategory)}
                className="mt-1 flex h-10 w-full rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {HUB_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.emoji} {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label className="text-xs font-semibold">Access Visibility</Label>
              <select
                value={access}
                onChange={(e) => setAccess(e.target.value as "public" | "private")}
                className="mt-1 flex h-10 w-full rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="public">🌐 Public (Anyone can join & view)</option>
                <option value="private">🔒 Private (Request or invite only)</option>
              </select>
            </div>
          </div>

          <div>
            <Label className="text-xs font-semibold">Description / About</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the mission and scope of this Hub…"
              rows={4}
              className="mt-1 rounded-xl resize-none text-xs"
            />
          </div>

          <div>
            <Label className="text-xs font-semibold">Community Guidelines / Rules</Label>
            <Textarea
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              placeholder="1. Build in public with integrity&#10;2. Help fellow founders&#10;3. No unsolicited sales spam"
              rows={3}
              className="mt-1 rounded-xl resize-none text-xs"
            />
          </div>

          {/* Resources Manager */}
          <div>
            <Label className="text-xs font-semibold">
              Official Resources ({resources.length}/10)
            </Label>
            <div className="mt-2 space-y-2">
              {resources.map((res, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-2 rounded-xl bg-secondary/50 p-2.5 text-xs border border-border/50"
                >
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{res.label}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{res.url}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => handleRemoveResource(i)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}

              {resources.length < 10 && (
                <div className="flex gap-2 pt-1">
                  <Input
                    placeholder="Link Label (e.g. Handbook)"
                    value={newResLabel}
                    onChange={(e) => setNewResLabel(e.target.value)}
                    className="rounded-xl h-8 text-xs w-1/3"
                  />
                  <Input
                    placeholder="https://…"
                    value={newResUrl}
                    onChange={(e) => setNewResUrl(e.target.value)}
                    className="rounded-xl h-8 text-xs flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddResource}
                    className="rounded-xl h-8 px-2.5 text-xs shrink-0"
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="pt-2 flex justify-end gap-2">
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
              variant="hero"
              disabled={updateMutation.isPending}
              className="rounded-xl"
            >
              {updateMutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HubFeedItemCard({
  item,
  hubId,
  hubName,
  hubSlug,
  isStaff,
  currentUserId,
  onModerated,
}: {
  item: { intent: HubIntent | null; is_pinned: boolean; created_at: string; ping: any };
  hubId: string;
  hubName: string;
  hubSlug: string;
  isStaff: boolean;
  currentUserId?: string | undefined;
  onModerated: () => void;
}) {
  const canModerate = isStaff || (currentUserId && item.ping.user_id === currentUserId);

  const handleModerate = async (action: "pin" | "unpin" | "remove") => {
    try {
      const { error } = await supabase.rpc("moderate_hub_ping", {
        _hub: hubId,
        _ping: item.ping.id,
        _action: action,
      });
      if (error) throw error;
      toast.success(
        action === "pin"
          ? "Ping pinned to Hub!"
          : action === "unpin"
            ? "Ping unpinned."
            : "Ping removed from Hub.",
      );
      onModerated();
    } catch (e: any) {
      toast.error(hubError(e, `Could not ${action} ping.`));
    }
  };

  return (
    <div className="relative group">
      <PingCard
        ping={item.ping}
        hubBadge={{
          name: hubName,
          slug: hubSlug,
          intent: item.intent,
        }}
      />

      {canModerate && (
        <div className="absolute top-4 right-4 z-10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className="size-7 rounded-full opacity-80 group-hover:opacity-100 shadow-sm border border-border"
                aria-label="Moderate Hub Ping"
              >
                <MoreVertical className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-2xl w-44">
              {isStaff &&
                (item.is_pinned ? (
                  <DropdownMenuItem onSelect={() => handleModerate("unpin")}>
                    <PinOff className="size-3.5 mr-2" /> Unpin from Hub
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => handleModerate("pin")}>
                    <Pin className="size-3.5 mr-2" /> Pin to Hub
                  </DropdownMenuItem>
                ))}
              <DropdownMenuItem
                onSelect={() => handleModerate("remove")}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="size-3.5 mr-2" /> Remove from Hub
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}

function HubDetail() {
  const { slug } = Route.useParams();
  const { intent: intentParam, tab: tabParam, invite: inviteTokenParam } = Route.useSearch();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [shareOpen, setShareOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const deferredMemberSearch = useDeferredValue(memberSearch);

  const activeIntent = HUB_INTENTS.some((i) => i.value === intentParam)
    ? (intentParam as HubIntent)
    : null;
  const activeTab = tabParam || "feed";

  // Hub data query
  const {
    data: hubData,
    isLoading: hubLoading,
    error: hubErrorData,
  } = useQuery(hubQuery(slug, activeIntent));
  const hub = hubData?.hub;

  // Membership status
  const { data: membership } = useQuery(myMembershipQuery(hub?.id ?? "", user?.id));
  const isMember = membership?.status === "active";
  const isPending = membership?.status === "pending";
  const isStaff = isHubStaff(membership?.role);
  const isOwner = membership?.role === "owner";
  const canEdit = isOwner || membership?.role === "admin";

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
      const { data, error } = await supabase.rpc("join_hub", {
        _hub: hub.id,
        ...(inviteTokenParam ? { _token: inviteTokenParam } : {}),
      });
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
  const feedItems = isPrivate ? (privateFeed ?? []) : (hubData?.feed ?? []);
  const pinnedPings = feedItems.filter((i) => i.is_pinned);
  const regularPings = feedItems.filter((i) => !i.is_pinned);
  const canViewFeed = canSeeHubContent(hub.access, membership?.role);

  return (
    <div className="pb-24">
      {/* Cover Banner */}
      <section className="bg-hero">
        <div className="mx-auto max-w-5xl px-5 pb-8 pt-10">
          {/* Invitation Acceptance Banner */}
          {inviteTokenParam && (
            <div className="mb-6 rounded-3xl border border-primary/30 bg-primary/10 p-5 sm:p-6 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shrink-0 font-bold">
                    <UserPlus className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-sm sm:text-base text-foreground">
                      You have been invited to join {hub.name}!
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {isMember
                        ? "You are already an active member of this hub."
                        : isPending
                          ? "Your request to join is pending review."
                          : "Accept this invitation to instantly join this hub and access discussions."}
                    </p>
                  </div>
                </div>
                <div>
                  {user ? (
                    !isMember &&
                    !isPending && (
                      <Button
                        variant="hero"
                        size="sm"
                        className="rounded-full px-5 text-xs font-semibold shadow-lift shrink-0"
                        onClick={() => joinMutation.mutate()}
                        disabled={joinMutation.isPending}
                      >
                        {joinMutation.isPending ? "Joining…" : "Accept & Join Hub"}
                      </Button>
                    )
                  ) : (
                    <Button
                      asChild
                      variant="hero"
                      size="sm"
                      className="rounded-full px-5 text-xs font-semibold shadow-lift shrink-0"
                    >
                      <Link
                        to="/login"
                        search={{ next: `/hubs/${hub.slug}?invite=${inviteTokenParam}` }}
                      >
                        Sign in to Accept
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

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
                      <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 text-gold border border-gold/30 px-2.5 py-0.5 text-xs font-bold">
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
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShareOpen(true)}
                  className="rounded-full h-10 px-4"
                >
                  <Share2 className="size-4" /> Share
                </Button>

                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditOpen(true)}
                    className="rounded-full h-10 px-4 gap-1.5"
                  >
                    <Settings className="size-4" /> Edit Hub
                  </Button>
                )}

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
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled
                      className="rounded-full h-10 px-4"
                    >
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
                  <Button
                    asChild
                    variant="hero"
                    size="sm"
                    className="rounded-full h-10 px-5 shadow-lift"
                  >
                    <Link to="/login" search={{ next: `/hubs/${hub.slug}` }}>
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
            <TabsTrigger value="chat" className="rounded-full px-5 text-sm font-semibold">
              Live Pings
            </TabsTrigger>
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

          {/* TAB 0: LIVE CHAT */}
          <TabsContent value="chat" className="mt-6">
            <HubChat hubId={hub.id} isMember={isMember} isPrivate={isPrivate} />
          </TabsContent>

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
                        <HubFeedItemCard
                          key={item.ping.id}
                          item={item}
                          hubId={hub.id}
                          hubName={hub.name}
                          hubSlug={hub.slug}
                          isStaff={isStaff}
                          currentUserId={user?.id}
                          onModerated={() => {
                            qc.invalidateQueries({ queryKey: ["hub", slug] });
                            qc.invalidateQueries({ queryKey: ["hub-member-feed", hub.id] });
                          }}
                        />
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
                      <HubFeedItemCard
                        key={item.ping.id}
                        item={item}
                        hubId={hub.id}
                        hubName={hub.name}
                        hubSlug={hub.slug}
                        isStaff={isStaff}
                        currentUserId={user?.id}
                        onModerated={() => {
                          qc.invalidateQueries({ queryKey: ["hub", slug] });
                          qc.invalidateQueries({ queryKey: ["hub-member-feed", hub.id] });
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
                        <Link to="/create" search={{ hub: hub.id }}>
                          Post a Ping to Hub
                        </Link>
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* TAB 2: MEMBERS DIRECTORY */}
          <TabsContent value="members" className="mt-6 space-y-4">
            {/* Pending Requests for Staff */}
            {isStaff && (
              <PendingRequestsSection
                hubId={hub.id}
                onProcessed={() => {
                  refetchMembers();
                  qc.invalidateQueries({ queryKey: ["hub", slug] });
                }}
              />
            )}

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
      <HubShareModal
        hub={hub}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        isStaff={isStaff}
      />

      {/* Edit Hub Settings Dialog */}
      {canEdit && <EditHubDialog hub={hub} open={editOpen} onOpenChange={setEditOpen} />}
    </div>
  );
}
