import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import {
  BarChart3,
  Bell,
  BellOff,
  Calendar,
  CheckCircle2,
  Hash,
  Lock,
  Megaphone,
  Pin,
  Plus,
  Radio,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { slugify, type Hub } from "@/lib/hubs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PingMark } from "@/components/BrandLogo";
import { cn } from "@/lib/utils";

export interface HubForumItem {
  id: string;
  hub_id: string;
  slug: string;
  name: string;
  description: string;
  forum_type: "general" | "topic" | "restricted" | "announcement";
  access_level: "public" | "members" | "staff_only";
  allow_member_posts: boolean;
  created_at: string;
}

export interface HubBroadcastItem {
  id: string;
  hub_id: string;
  forum_id: string | null;
  author_id: string;
  title: string;
  content: string;
  broadcast_type: "announcement" | "news" | "notice" | "event" | "update" | "alert";
  target_audience: "all_members" | "staff" | "forum_members" | "public";
  is_pinned: boolean;
  is_urgent: boolean;
  media_urls: string[];
  scheduled_for: string | null;
  published_at: string | null;
  delivery_count: number;
  read_count: number;
  created_at: string;
}

const DEFAULT_FORUMS = (hubId: string): HubForumItem[] => [
  {
    id: `default-announcements-${hubId}`,
    hub_id: hubId,
    slug: "announcements",
    name: "Official Announcements",
    description: "Institutional broadcasts, notices, and scheduled updates from administrators.",
    forum_type: "announcement",
    access_level: "public",
    allow_member_posts: false,
    created_at: new Date().toISOString(),
  },
  {
    id: `default-general-${hubId}`,
    hub_id: hubId,
    slug: "general",
    name: "General Discussion",
    description: "Open member coordination, introductions, and community updates.",
    forum_type: "general",
    access_level: "members",
    allow_member_posts: true,
    created_at: new Date().toISOString(),
  },
  {
    id: `default-opportunities-${hubId}`,
    hub_id: hubId,
    slug: "opportunities",
    name: "Opportunities & Needs",
    description: "Subject-specific forum for roles, grants, collaborations, and resource requests.",
    forum_type: "topic",
    access_level: "members",
    allow_member_posts: true,
    created_at: new Date().toISOString(),
  },
];

export function HubForumsAndBroadcasts({
  hub,
  isMember,
  isStaff,
}: {
  hub: Hub;
  isMember: boolean;
  isStaff: boolean;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [selectedForumSlug, setSelectedForumSlug] = useState<string>("all");
  const [broadcastTypeFilter, setBroadcastTypeFilter] = useState<string>("all");
  const [createForumOpen, setCreateForumOpen] = useState(false);
  const [publishBroadcastOpen, setPublishBroadcastOpen] = useState(false);
  const [mutedForums, setMutedForums] = useState<Set<string>>(() => new Set());

  // Forum creation state
  const [forumName, setForumName] = useState("");
  const [forumDesc, setForumDesc] = useState("");
  const [forumType, setForumType] = useState<HubForumItem["forum_type"]>("topic");
  const [forumAccess, setForumAccess] = useState<HubForumItem["access_level"]>("members");

  // Broadcast creation state
  const [bcTitle, setBcTitle] = useState("");
  const [bcContent, setBcContent] = useState("");
  const [bcType, setBcType] = useState<HubBroadcastItem["broadcast_type"]>("announcement");
  const [bcAudience, setBcAudience] = useState<HubBroadcastItem["target_audience"]>("all_members");
  const [bcForumId, setBcForumId] = useState<string>("");
  const [bcPinned, setBcPinned] = useState(false);
  const [bcUrgent, setBcUrgent] = useState(false);
  const [bcScheduledFor, setBcScheduledFor] = useState("");

  // Load Hub Forums (graceful fallback to default forums if migration 0017 is pending)
  const { data: forums = DEFAULT_FORUMS(hub.id) } = useQuery({
    queryKey: ["hub-forums", hub.id],
    queryFn: async (): Promise<HubForumItem[]> => {
      const { data, error } = await supabase
        .from("hub_forums")
        .select(
          "id, hub_id, slug, name, description, forum_type, access_level, allow_member_posts, created_at",
        )
        .eq("hub_id", hub.id)
        .order("created_at", { ascending: true });

      if (error || !data || data.length === 0) {
        return DEFAULT_FORUMS(hub.id);
      }
      return data as unknown as HubForumItem[];
    },
  });

  // Load Hub Institutional Broadcasts
  const { data: broadcasts = [], isLoading: broadcastsLoading } = useQuery({
    queryKey: ["hub-broadcasts", hub.id],
    queryFn: async (): Promise<HubBroadcastItem[]> => {
      const { data, error } = await supabase
        .from("hub_broadcasts")
        .select(
          "id, hub_id, forum_id, author_id, title, content, broadcast_type, target_audience, is_pinned, is_urgent, media_urls, scheduled_for, published_at, delivery_count, read_count, created_at",
        )
        .eq("hub_id", hub.id)
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false });

      if (error || !data) {
        return [];
      }
      return data as unknown as HubBroadcastItem[];
    },
  });

  const createForumMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sign in first.");
      const slug = slugify(forumName) || `forum-${Date.now()}`;
      const { error } = await supabase.from("hub_forums").insert({
        hub_id: hub.id,
        slug,
        name: forumName.trim(),
        description: forumDesc.trim(),
        forum_type: forumType,
        access_level: forumAccess,
        allow_member_posts: forumType !== "announcement",
        created_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub-forums", hub.id] });
      toast.success("Forum created in Hub.");
      setCreateForumOpen(false);
      setForumName("");
      setForumDesc("");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Could not create Forum (migration 0017 may be pending).");
    },
  });

  const publishBroadcastMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sign in first.");
      const realForumId = bcForumId && !bcForumId.startsWith("default-") ? bcForumId : null;
      const { error } = await supabase.from("hub_broadcasts").insert({
        hub_id: hub.id,
        forum_id: realForumId,
        author_id: user.id,
        title: bcTitle.trim(),
        content: bcContent.trim(),
        broadcast_type: bcType,
        target_audience: bcAudience,
        is_pinned: bcPinned,
        is_urgent: bcUrgent,
        scheduled_for: bcScheduledFor ? new Date(bcScheduledFor).toISOString() : null,
        delivery_count: Math.max(1, hub.member_count || 1),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub-broadcasts", hub.id] });
      toast.success(
        bcScheduledFor
          ? "Institutional broadcast scheduled."
          : "Official broadcast published to Hub.",
      );
      setPublishBroadcastOpen(false);
      setBcTitle("");
      setBcContent("");
      setBcPinned(false);
      setBcUrgent(false);
      setBcScheduledFor("");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Could not publish broadcast (migration 0017 may be pending).");
    },
  });

  const deleteBroadcastMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("hub_broadcasts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub-broadcasts", hub.id] });
      toast.success("Broadcast removed.");
    },
  });

  const toggleForumMute = (forumId: string, forumNameLabel: string) => {
    setMutedForums((prev) => {
      const next = new Set(prev);
      if (next.has(forumId)) {
        next.delete(forumId);
        toast.success(`Notifications enabled for ${forumNameLabel}`);
      } else {
        next.add(forumId);
        toast.info(`Muted notifications for ${forumNameLabel}`);
      }
      return next;
    });
  };

  const filteredBroadcasts = broadcasts.filter((b) => {
    if (broadcastTypeFilter !== "all" && b.broadcast_type !== broadcastTypeFilter) return false;
    if (selectedForumSlug !== "all") {
      const matchingForum = forums.find((f) => f.slug === selectedForumSlug);
      if (
        matchingForum &&
        !matchingForum.id.startsWith("default-") &&
        b.forum_id &&
        b.forum_id !== matchingForum.id
      ) {
        return false;
      }
    }
    return true;
  });

  return (
    <div className="space-y-8">
      {/* 1. FORUMS DIRECTORY WITHIN HUB */}
      <section aria-labelledby="hub-forums-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2
              id="hub-forums-heading"
              className="font-display text-xl font-bold flex items-center gap-2"
            >
              <Hash className="size-5 text-primary" />
              Forums ({forums.length})
            </h2>
            <p className="text-xs text-muted-foreground">
              Subject-based communication spaces for general discussions, departments, and
              announcement-only channels.
            </p>
          </div>
          {isStaff && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCreateForumOpen(true)}
              className="rounded-full gap-1.5"
            >
              <Plus className="size-4" /> New Forum
            </Button>
          )}
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {forums.map((forum) => {
            const isSelected = selectedForumSlug === forum.slug;
            const isMuted = mutedForums.has(forum.id);
            return (
              <article
                key={forum.id}
                className={cn(
                  "surface-card flex flex-col justify-between rounded-3xl p-5 transition-all",
                  isSelected && "border-primary ring-1 ring-primary/30",
                )}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedForumSlug(isSelected ? "all" : forum.slug)}
                      className="text-left group"
                    >
                      <span className="font-display text-base font-bold text-foreground group-hover:text-primary transition-colors flex items-center gap-1.5">
                        {forum.forum_type === "announcement" ? (
                          <Megaphone className="size-4 text-gold shrink-0" />
                        ) : forum.forum_type === "restricted" ? (
                          <Lock className="size-4 text-primary shrink-0" />
                        ) : (
                          <Hash className="size-4 text-primary shrink-0" />
                        )}
                        {forum.name}
                      </span>
                    </button>

                    {(isMember || isStaff) && (
                      <button
                        type="button"
                        onClick={() => toggleForumMute(forum.id, forum.name)}
                        aria-label={
                          isMuted
                            ? `Enable notifications for ${forum.name}`
                            : `Mute notifications for ${forum.name}`
                        }
                        title={isMuted ? "Notifications muted" : "Notifications active"}
                        className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        {isMuted ? (
                          <BellOff className="size-3.5" />
                        ) : (
                          <Bell className="size-3.5 text-primary" />
                        )}
                      </button>
                    )}
                  </div>

                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {forum.description}
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-[11px]">
                  <span className="rounded-full bg-secondary px-2.5 py-0.5 font-semibold capitalize text-secondary-foreground">
                    {forum.forum_type === "announcement"
                      ? "Announcement-only"
                      : forum.forum_type === "restricted"
                        ? "Restricted"
                        : forum.forum_type === "topic"
                          ? "Topic Forum"
                          : "General"}
                  </span>
                  <span className="text-muted-foreground">
                    {forum.allow_member_posts ? "Members can post" : "Admin/Publisher only"}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* 2. INSTITUTIONAL BROADCASTS (INCORPORATED INTO HUB) */}
      <section aria-labelledby="hub-broadcasts-heading" className="pt-2 border-t border-border/60">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-gold/15 text-gold border border-gold/30 px-2.5 py-0.5 text-[11px] font-bold">
              <Radio className="size-3" />
              Institutional Publishing Capability
            </div>
            <h2
              id="hub-broadcasts-heading"
              className="mt-2 font-display text-xl font-bold flex items-center gap-2"
            >
              <PingMark variant="gold" size="xs" />
              Official Hub Broadcasts
              {hub.verified && (
                <CheckCircle2
                  className="size-4 text-gold"
                  aria-label="Verified institutional Hub"
                />
              )}
            </h2>
            <p className="text-xs text-muted-foreground">
              Verified announcements, notices, events, and scheduled communications distinct from
              ordinary member discussions.
            </p>
          </div>

          {isStaff && (
            <Button
              type="button"
              variant="hero"
              size="sm"
              onClick={() => setPublishBroadcastOpen(true)}
              className="rounded-full gap-1.5 self-start sm:self-auto"
            >
              <Megaphone className="size-4" /> Publish Broadcast
            </Button>
          )}
        </div>

        {/* Broadcast Type Filter Pills */}
        <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          {(
            [
              { value: "all", label: "All Broadcasts" },
              { value: "announcement", label: "Announcements" },
              { value: "news", label: "News & Updates" },
              { value: "notice", label: "Notices" },
              { value: "event", label: "Events" },
              { value: "alert", label: "Urgent Alerts" },
            ] as const
          ).map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setBroadcastTypeFilter(f.value)}
              className={cn(
                "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
                broadcastTypeFilter === f.value
                  ? "bg-foreground text-background"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-4">
          {broadcastsLoading ? (
            <div className="h-36 rounded-3xl bg-muted/40 animate-pulse" />
          ) : filteredBroadcasts.length === 0 ? (
            <div className="surface-card rounded-3xl p-8 text-center border border-border/60">
              <Megaphone className="mx-auto size-9 text-muted-foreground/40" />
              <p className="mt-3 font-display text-base font-bold text-foreground">
                No institutional broadcasts published yet
              </p>
              <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
                Authorized Hub administrators can publish official announcements, scheduled notices,
                and pinned communications with readership analytics.
              </p>
              {isStaff && (
                <Button
                  type="button"
                  variant="hero"
                  size="sm"
                  onClick={() => setPublishBroadcastOpen(true)}
                  className="mt-4 rounded-full"
                >
                  Publish first broadcast
                </Button>
              )}
            </div>
          ) : (
            filteredBroadcasts.map((b) => {
              const readPct =
                b.delivery_count > 0
                  ? Math.min(100, Math.round((b.read_count / b.delivery_count) * 100))
                  : 0;
              return (
                <article
                  key={b.id}
                  className={cn(
                    "surface-card relative rounded-3xl p-6 border transition-all",
                    b.is_urgent
                      ? "border-destructive/50 bg-destructive/5"
                      : b.is_pinned
                        ? "border-gold/50 ring-1 ring-gold/20"
                        : "border-border/80",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 text-gold border border-gold/30 px-2.5 py-0.5 font-bold">
                        <ShieldCheck className="size-3.5" />
                        Official Broadcast
                      </span>
                      {b.is_pinned && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary px-2.5 py-0.5 font-semibold">
                          <Pin className="size-3" /> Pinned
                        </span>
                      )}
                      {b.is_urgent && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 text-destructive px-2.5 py-0.5 font-bold">
                          Urgent
                        </span>
                      )}
                      <span className="rounded-full bg-secondary px-2.5 py-0.5 font-semibold capitalize text-secondary-foreground">
                        {b.broadcast_type}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="size-3.5" />
                        {formatDistanceToNowStrict(new Date(b.created_at))} ago
                      </span>
                      {isStaff && (
                        <button
                          type="button"
                          onClick={() => deleteBroadcastMutation.mutate(b.id)}
                          aria-label="Delete broadcast"
                          className="rounded-lg p-1 hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <h3 className="mt-3 font-display text-lg sm:text-xl font-bold text-foreground">
                    {b.title}
                  </h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                    {b.content}
                  </p>

                  {/* Audience & Readership Analytics Footer */}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="size-3.5 text-primary" />
                      Audience:{" "}
                      <strong className="capitalize text-foreground">
                        {b.target_audience.replace(/_/g, " ")}
                      </strong>
                    </span>
                    <span className="inline-flex items-center gap-2 tabular-nums">
                      <BarChart3 className="size-3.5 text-gold" />
                      <span>
                        Delivered to <strong className="text-foreground">{b.delivery_count}</strong>
                      </span>
                      <span>·</span>
                      <span>
                        Read by <strong className="text-foreground">{b.read_count}</strong> (
                        {readPct}%)
                      </span>
                    </span>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>

      {/* Dialog: Create Forum */}
      <Dialog open={createForumOpen} onOpenChange={setCreateForumOpen}>
        <DialogContent className="max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Create Hub Forum</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Add a dedicated subject, department, or announcement-only Forum inside {hub.name}.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!forumName.trim()) return;
              createForumMutation.mutate();
            }}
            className="mt-3 space-y-4"
          >
            <div>
              <Label htmlFor="forum-name" className="text-xs font-semibold">
                Forum Name
              </Label>
              <Input
                id="forum-name"
                value={forumName}
                onChange={(e) => setForumName(e.target.value)}
                placeholder="e.g. Research Grants, Engineering, Cohort Announcements"
                required
                className="mt-1.5 rounded-xl"
              />
            </div>

            <div>
              <Label htmlFor="forum-type" className="text-xs font-semibold">
                Forum Type & Participation Rules
              </Label>
              <select
                id="forum-type"
                value={forumType}
                onChange={(e) => setForumType(e.target.value as HubForumItem["forum_type"])}
                className="mt-1.5 flex h-10 w-full rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground"
              >
                <option value="general">General Discussion (all members can post)</option>
                <option value="topic">Topic-Specific Conversation</option>
                <option value="restricted">Restricted Participation</option>
                <option value="announcement">
                  Announcement-Only (administrators/publishers only)
                </option>
              </select>
            </div>

            <div>
              <Label htmlFor="forum-access" className="text-xs font-semibold">
                Access Level
              </Label>
              <select
                id="forum-access"
                value={forumAccess}
                onChange={(e) => setForumAccess(e.target.value as HubForumItem["access_level"])}
                className="mt-1.5 flex h-10 w-full rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground"
              >
                <option value="members">Hub Members</option>
                <option value="public">Public Visitors & Members</option>
                <option value="staff_only">Administrators & Moderators Only</option>
              </select>
            </div>

            <div>
              <Label htmlFor="forum-desc" className="text-xs font-semibold">
                Description
              </Label>
              <Textarea
                id="forum-desc"
                value={forumDesc}
                onChange={(e) => setForumDesc(e.target.value)}
                placeholder="What is this Forum for?"
                rows={3}
                className="mt-1.5 rounded-xl resize-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateForumOpen(false)}
                className="rounded-xl"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="hero"
                disabled={createForumMutation.isPending}
                className="rounded-xl"
              >
                {createForumMutation.isPending ? "Creating…" : "Create Forum"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: Publish Institutional Broadcast */}
      <Dialog open={publishBroadcastOpen} onOpenChange={setPublishBroadcastOpen}>
        <DialogContent className="max-w-lg rounded-3xl p-6 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <Megaphone className="size-5 text-gold" />
              Publish Institutional Broadcast
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Dispatch an official communication to {hub.name} members with readership tracking.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!bcTitle.trim() || !bcContent.trim()) return;
              publishBroadcastMutation.mutate();
            }}
            className="mt-3 space-y-4"
          >
            <div>
              <Label htmlFor="bc-title" className="text-xs font-semibold">
                Broadcast Title
              </Label>
              <Input
                id="bc-title"
                value={bcTitle}
                onChange={(e) => setBcTitle(e.target.value)}
                placeholder="e.g. Fall Semester Grant Applications Open"
                required
                className="mt-1.5 rounded-xl"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="bc-type" className="text-xs font-semibold">
                  Communication Type
                </Label>
                <select
                  id="bc-type"
                  value={bcType}
                  onChange={(e) => setBcType(e.target.value as HubBroadcastItem["broadcast_type"])}
                  className="mt-1.5 flex h-10 w-full rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground"
                >
                  <option value="announcement">Official Announcement</option>
                  <option value="news">News & Update</option>
                  <option value="notice">Official Notice</option>
                  <option value="event">Event / Convocation</option>
                  <option value="alert">Urgent Alert</option>
                </select>
              </div>

              <div>
                <Label htmlFor="bc-audience" className="text-xs font-semibold">
                  Target Audience
                </Label>
                <select
                  id="bc-audience"
                  value={bcAudience}
                  onChange={(e) =>
                    setBcAudience(e.target.value as HubBroadcastItem["target_audience"])
                  }
                  className="mt-1.5 flex h-10 w-full rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground"
                >
                  <option value="all_members">All Hub Members</option>
                  <option value="forum_members">Designated Forum Subscribers</option>
                  <option value="staff">Administrators & Moderators</option>
                  <option value="public">Public & Subscribers</option>
                </select>
              </div>
            </div>

            <div>
              <Label htmlFor="bc-forum" className="text-xs font-semibold">
                Designated Forum
              </Label>
              <select
                id="bc-forum"
                value={bcForumId}
                onChange={(e) => setBcForumId(e.target.value)}
                className="mt-1.5 flex h-10 w-full rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground"
              >
                {forums.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.forum_type})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="bc-content" className="text-xs font-semibold">
                Broadcast Message
              </Label>
              <Textarea
                id="bc-content"
                value={bcContent}
                onChange={(e) => setBcContent(e.target.value)}
                placeholder="Write the official institutional announcement or notice…"
                rows={4}
                required
                className="mt-1.5 rounded-xl resize-none"
              />
            </div>

            <div>
              <Label htmlFor="bc-schedule" className="text-xs font-semibold">
                Schedule Broadcast (optional — leave blank to publish immediately)
              </Label>
              <Input
                id="bc-schedule"
                type="datetime-local"
                value={bcScheduledFor}
                onChange={(e) => setBcScheduledFor(e.target.value)}
                className="mt-1.5 rounded-xl"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-secondary/40 px-3.5 py-2.5">
                <span className="text-xs font-semibold">Pin communication</span>
                <Switch checked={bcPinned} onCheckedChange={setBcPinned} />
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-secondary/40 px-3.5 py-2.5">
                <span className="text-xs font-semibold">Mark urgent</span>
                <Switch checked={bcUrgent} onCheckedChange={setBcUrgent} />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPublishBroadcastOpen(false)}
                className="rounded-xl"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="hero"
                disabled={publishBroadcastMutation.isPending}
                className="rounded-xl font-bold"
              >
                {publishBroadcastMutation.isPending
                  ? "Publishing…"
                  : bcScheduledFor
                    ? "Schedule Broadcast"
                    : "Dispatch Broadcast"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
