import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import {
  BarChart3,
  Bell,
  BellOff,
  Calendar,
  CheckCircle2,
  CornerDownRight,
  Hash,
  Lock,
  Megaphone,
  MessageSquare,
  Pin,
  Plus,
  Radio,
  Send,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ensureClientProfileRow } from "@/lib/ensure-profile";
import { slugify, type Hub } from "@/lib/hubs";
import { FounderAvatar } from "@/components/ping/Avatar";
import { QueryErrorCard } from "@/components/QueryErrorCard";
import { sanitizeUserText } from "@/lib/shield";
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

export interface HubForumPostItem {
  id: string;
  hub_id: string;
  forum_id: string;
  author_id: string;
  parent_id: string | null;
  title: string | null;
  content: string;
  is_pinned: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  author?: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

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

  // Forum discussion thread & reply state
  const [threadTitle, setThreadTitle] = useState("");
  const [threadContent, setThreadContent] = useState("");
  const [replyingToPostId, setReplyingToPostId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");

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

  // Load real Hub Forums directly from database (no mock defaults)
  const {
    data: forums = [],
    isLoading: forumsLoading,
    isError: isForumsError,
    error: forumsError,
    refetch: refetchForums,
  } = useQuery({
    queryKey: ["hub-forums", hub.id],
    queryFn: async (): Promise<HubForumItem[]> => {
      const { data, error } = await supabase
        .from("hub_forums")
        .select(
          "id, hub_id, slug, name, description, forum_type, access_level, allow_member_posts, created_at",
        )
        .eq("hub_id", hub.id)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as HubForumItem[];
    },
  });

  // Load Forum discussion threads & replies
  const {
    data: forumPosts = [],
    isLoading: forumPostsLoading,
    isError: isForumPostsError,
    error: forumPostsError,
    refetch: refetchForumPosts,
  } = useQuery({
    queryKey: ["hub-forum-posts", hub.id],
    queryFn: async (): Promise<HubForumPostItem[]> => {
      const { data, error } = await supabase
        .from("hub_forum_posts")
        .select(
          `
          id, hub_id, forum_id, author_id, parent_id, title, content, is_pinned, deleted_at, created_at, updated_at,
          author:profiles!hub_forum_posts_author_id_fkey(id, username, display_name, avatar_url)
        `,
        )
        .eq("hub_id", hub.id)
        .is("deleted_at", null)
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(200);

      if (error) {
        if (error.code === "PGRST205" || /could not find the table/i.test(error.message || "")) {
          throw new Error(
            "Hub Forum discussion threads require database migration 0022 to be applied.",
          );
        }
        throw error;
      }
      return (data ?? []) as unknown as HubForumPostItem[];
    },
  });

  // Subscribe to realtime forum thread/reply updates
  useEffect(() => {
    if (!hub.id) return;
    const channel = supabase
      .channel(`hub-forum-posts:${hub.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "hub_forum_posts",
          filter: `hub_id=eq.${hub.id}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["hub-forum-posts", hub.id] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [hub.id, qc]);

  // Load Hub Institutional Broadcasts
  const {
    data: broadcasts = [],
    isLoading: broadcastsLoading,
    isError: isBroadcastsError,
    error: broadcastsError,
    refetch: refetchBroadcasts,
  } = useQuery({
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

      if (error) throw error;
      return (data ?? []) as unknown as HubBroadcastItem[];
    },
  });

  const activeDiscussionForum = useMemo(() => {
    if (selectedForumSlug !== "all") {
      return forums.find((f) => f.slug === selectedForumSlug) ?? null;
    }
    return forums.find((f) => f.allow_member_posts) ?? forums[0] ?? null;
  }, [forums, selectedForumSlug]);

  const createForumPostMutation = useMutation({
    mutationFn: async (payload: {
      forumId: string;
      parentId?: string | null;
      title?: string | null;
      content: string;
    }) => {
      if (!user) throw new Error("Sign in first to post in a Forum.");
      const cleanedContent = sanitizeUserText(payload.content);
      const cleanedTitle = payload.title ? sanitizeUserText(payload.title) : null;
      if (!cleanedContent) throw new Error("Write a message before posting.");

      const insertPayload = {
        hub_id: hub.id,
        forum_id: payload.forumId,
        author_id: user.id,
        parent_id: payload.parentId ?? null,
        title: cleanedTitle || null,
        content: cleanedContent,
      };

      let { error } = await supabase.from("hub_forum_posts").insert(insertPayload);
      if (error && error.code === "23503") {
        const recovered = await ensureClientProfileRow(user);
        if (recovered) {
          const retry = await supabase.from("hub_forum_posts").insert(insertPayload);
          error = retry.error;
        }
      }
      if (error) {
        if (error.code === "PGRST205" || /could not find the table/i.test(error.message || "")) {
          throw new Error("Posting in Hub Forums requires database migration 0022.");
        }
        throw error;
      }
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["hub-forum-posts", hub.id] });
      if (vars.parentId) {
        setReplyDraft("");
        setReplyingToPostId(null);
        toast.success("Reply posted to forum thread.");
      } else {
        setThreadTitle("");
        setThreadContent("");
        toast.success("Discussion topic posted.");
      }
    },
    onError: (err: any) => {
      toast.error(err?.message || "Could not post to forum.");
    },
  });

  const deleteForumPostMutation = useMutation({
    mutationFn: async (postId: string) => {
      const { error } = await supabase
        .from("hub_forum_posts")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", postId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub-forum-posts", hub.id] });
      toast.success("Forum post removed.");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Could not delete forum post.");
    },
  });

  const togglePinForumPostMutation = useMutation({
    mutationFn: async ({ postId, pinned }: { postId: string; pinned: boolean }) => {
      const { error } = await supabase
        .from("hub_forum_posts")
        .update({ is_pinned: pinned })
        .eq("id", postId);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["hub-forum-posts", hub.id] });
      toast.success(vars.pinned ? "Thread pinned." : "Thread unpinned.");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Could not update thread pin.");
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
      toast.error(err?.message || "Could not create Forum.");
    },
  });

  const publishBroadcastMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sign in first.");
      const realForumId = bcForumId || null;
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
      toast.error(err?.message || "Could not publish broadcast.");
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
      if (matchingForum && b.forum_id && b.forum_id !== matchingForum.id) {
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

        {forumsLoading ? (
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 rounded-3xl bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : isForumsError ? (
          <QueryErrorCard
            compact
            title="Couldn't load Forums"
            description="Unable to load Forums for this Hub right now."
            error={forumsError}
            onRetry={() => void refetchForums()}
          />
        ) : forums.length === 0 ? (
          <div className="surface-card rounded-3xl p-8 text-center border border-border/60">
            <Hash className="mx-auto size-8 text-muted-foreground/40" />
            <p className="mt-3 font-display text-base font-bold text-foreground">
              No Forums created in this Hub yet
            </p>
            <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
              Create topic or announcement Forums so members can coordinate by subject.
            </p>
            {isStaff && (
              <Button
                type="button"
                variant="hero"
                size="sm"
                onClick={() => setCreateForumOpen(true)}
                className="mt-4 rounded-full gap-1.5"
              >
                <Plus className="size-4" /> Create first Forum
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {forums.map((forum) => {
              const isSelected = selectedForumSlug === forum.slug;
              const isMuted = mutedForums.has(forum.id);
              const threadCount = forumPosts.filter(
                (p) => p.forum_id === forum.id && !p.parent_id,
              ).length;
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
                      {threadCount} {threadCount === 1 ? "topic" : "topics"} ·{" "}
                      {forum.allow_member_posts ? "Members can post" : "Staff only"}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* 1B. REAL FORUM DISCUSSIONS & REPLIES */}
      {forums.length > 0 && activeDiscussionForum && (
        <section
          aria-labelledby="forum-discussions-heading"
          className="surface-card rounded-3xl p-5 sm:p-6 border border-border/80 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3
                id="forum-discussions-heading"
                className="font-display text-lg font-bold flex items-center gap-2"
              >
                <MessageSquare className="size-4 text-primary" />
                {selectedForumSlug === "all"
                  ? `Discussions · ${activeDiscussionForum.name}`
                  : `${activeDiscussionForum.name} · Threads`}
              </h3>
              <p className="text-xs text-muted-foreground">
                Start focused discussion topics and reply inside this Hub Forum.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {forums.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSelectedForumSlug(f.slug)}
                  className={cn(
                    "rounded-full px-3 py-1 text-[11px] font-semibold transition-colors",
                    activeDiscussionForum.id === f.id
                      ? "bg-foreground text-background"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                  )}
                >
                  #{f.name}
                </button>
              ))}
            </div>
          </div>

          {/* Start a Forum Thread */}
          {(() => {
            const canPostInForum =
              Boolean(user) &&
              (isStaff ||
                (activeDiscussionForum.allow_member_posts &&
                  (isMember || activeDiscussionForum.access_level === "public")));
            if (!canPostInForum) {
              return (
                <p className="rounded-2xl border border-border/60 bg-secondary/40 px-4 py-3 text-xs text-muted-foreground">
                  {!user
                    ? "Sign in and join this Hub to start topics and reply in Forums."
                    : !activeDiscussionForum.allow_member_posts
                      ? "This Forum is announcement-only; only Hub staff can start new threads here."
                      : "Join this Hub to post topics and replies in member Forums."}
                </p>
              );
            }
            return (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  createForumPostMutation.mutate({
                    forumId: activeDiscussionForum.id,
                    title: threadTitle,
                    content: threadContent,
                  });
                }}
                className="rounded-2xl border border-border/70 bg-secondary/35 p-4 space-y-2.5"
              >
                <Input
                  value={threadTitle}
                  onChange={(e) => setThreadTitle(e.target.value)}
                  placeholder={`Topic title in #${activeDiscussionForum.name}…`}
                  maxLength={140}
                  required
                  className="rounded-xl bg-card text-sm font-semibold"
                />
                <Textarea
                  value={threadContent}
                  onChange={(e) => setThreadContent(e.target.value)}
                  placeholder="Share context, questions, or updates for members in this Forum…"
                  rows={3}
                  required
                  className="rounded-xl bg-card text-sm resize-none"
                />
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    variant="hero"
                    size="sm"
                    disabled={
                      createForumPostMutation.isPending ||
                      !threadTitle.trim() ||
                      !threadContent.trim()
                    }
                    className="rounded-xl gap-1.5"
                  >
                    <Send className="size-3.5" />
                    {createForumPostMutation.isPending ? "Posting…" : "Post Topic"}
                  </Button>
                </div>
              </form>
            );
          })()}

          {/* Forum Threads & Nested Replies */}
          {forumPostsLoading ? (
            <div className="h-24 rounded-2xl bg-muted/40 animate-pulse" />
          ) : isForumPostsError ? (
            <QueryErrorCard
              compact
              title="Couldn't load Forum discussions"
              error={forumPostsError}
              onRetry={() => void refetchForumPosts()}
            />
          ) : (
            (() => {
              const scopedPosts = forumPosts.filter((p) => p.forum_id === activeDiscussionForum.id);
              const topThreads = scopedPosts.filter((p) => !p.parent_id);
              const repliesByParent = new Map<string, HubForumPostItem[]>();
              for (const p of scopedPosts) {
                if (p.parent_id) {
                  const arr = repliesByParent.get(p.parent_id) ?? [];
                  arr.push(p);
                  repliesByParent.set(p.parent_id, arr);
                }
              }

              if (topThreads.length === 0) {
                return (
                  <p className="text-center text-xs text-muted-foreground py-4">
                    No discussion topics in #{activeDiscussionForum.name} yet. Start the first
                    thread above.
                  </p>
                );
              }

              const canReply =
                Boolean(user) &&
                (isStaff ||
                  (activeDiscussionForum.allow_member_posts &&
                    (isMember || activeDiscussionForum.access_level === "public")));

              return (
                <div className="space-y-3">
                  {topThreads.map((thread) => {
                    const authorName =
                      thread.author?.display_name || thread.author?.username || "Member";
                    const threadReplies = repliesByParent.get(thread.id) ?? [];
                    const canManage =
                      isStaff || (Boolean(user?.id) && thread.author_id === user?.id);

                    return (
                      <article
                        key={thread.id}
                        className={cn(
                          "rounded-2xl border bg-card/80 p-4 space-y-3",
                          thread.is_pinned
                            ? "border-gold/50 ring-1 ring-gold/20"
                            : "border-border/70",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <FounderAvatar
                              name={authorName}
                              src={thread.author?.avatar_url}
                              size="sm"
                            />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-xs font-bold text-foreground truncate">
                                  {authorName}
                                </span>
                                {thread.author?.username && (
                                  <span className="text-[11px] text-muted-foreground">
                                    @{thread.author.username}
                                  </span>
                                )}
                                {thread.is_pinned && (
                                  <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
                                    <Pin className="size-2.5" /> Pinned
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground">
                                {formatDistanceToNowStrict(new Date(thread.created_at))} ago
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {isStaff && (
                              <button
                                type="button"
                                onClick={() =>
                                  togglePinForumPostMutation.mutate({
                                    postId: thread.id,
                                    pinned: !thread.is_pinned,
                                  })
                                }
                                title={thread.is_pinned ? "Unpin thread" : "Pin thread"}
                                className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                              >
                                <Pin className="size-3.5" />
                              </button>
                            )}
                            {canManage && (
                              <button
                                type="button"
                                onClick={() => deleteForumPostMutation.mutate(thread.id)}
                                aria-label="Delete thread"
                                className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        {thread.title && (
                          <h4 className="font-display text-sm sm:text-base font-bold text-foreground">
                            {thread.title}
                          </h4>
                        )}
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                          {thread.content}
                        </p>

                        <div className="flex items-center gap-3 text-xs">
                          {canReply && (
                            <button
                              type="button"
                              onClick={() => {
                                setReplyingToPostId(
                                  replyingToPostId === thread.id ? null : thread.id,
                                );
                                setReplyDraft("");
                              }}
                              className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                            >
                              <CornerDownRight className="size-3.5" />
                              {replyingToPostId === thread.id ? "Cancel Reply" : "Reply"}
                            </button>
                          )}
                          <span className="text-muted-foreground">
                            {threadReplies.length}{" "}
                            {threadReplies.length === 1 ? "reply" : "replies"}
                          </span>
                        </div>

                        {replyingToPostId === thread.id && (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              createForumPostMutation.mutate({
                                forumId: activeDiscussionForum.id,
                                parentId: thread.id,
                                content: replyDraft,
                              });
                            }}
                            className="flex flex-col sm:flex-row gap-2 pt-1"
                          >
                            <Input
                              value={replyDraft}
                              onChange={(e) => setReplyDraft(e.target.value)}
                              placeholder="Write a reply…"
                              className="rounded-xl bg-background text-xs flex-1"
                            />
                            <Button
                              type="submit"
                              size="sm"
                              disabled={createForumPostMutation.isPending || !replyDraft.trim()}
                              className="rounded-xl text-xs"
                            >
                              Post Reply
                            </Button>
                          </form>
                        )}

                        {threadReplies.length > 0 && (
                          <div className="ml-3 sm:ml-6 space-y-2 border-l-2 border-border/70 pl-3 sm:pl-4 pt-1">
                            {threadReplies.map((reply) => {
                              const replyAuthor =
                                reply.author?.display_name || reply.author?.username || "Member";
                              const canDeleteReply =
                                isStaff || (Boolean(user?.id) && reply.author_id === user?.id);
                              return (
                                <div
                                  key={reply.id}
                                  className="rounded-xl bg-secondary/45 px-3 py-2 text-xs space-y-1"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-semibold text-foreground">
                                      {replyAuthor}{" "}
                                      <span className="font-normal text-muted-foreground">
                                        · {formatDistanceToNowStrict(new Date(reply.created_at))}{" "}
                                        ago
                                      </span>
                                    </span>
                                    {canDeleteReply && (
                                      <button
                                        type="button"
                                        onClick={() => deleteForumPostMutation.mutate(reply.id)}
                                        aria-label="Delete reply"
                                        className="rounded p-1 text-muted-foreground hover:text-destructive"
                                      >
                                        <Trash2 className="size-3" />
                                      </button>
                                    )}
                                  </div>
                                  <p className="whitespace-pre-wrap text-foreground/90">
                                    {reply.content}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              );
            })()
          )}
        </section>
      )}

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
          ) : isBroadcastsError ? (
            <QueryErrorCard
              compact
              title="Couldn't load Broadcasts"
              description="Unable to load official Broadcasts for this Hub."
              error={broadcastsError}
              onRetry={() => void refetchBroadcasts()}
            />
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
