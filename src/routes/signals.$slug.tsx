import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Radio,
  CheckCircle,
  Globe,
  Bell,
  BellOff,
  Plus,
  BarChart3,
  Share2,
  Calendar,
  Tag,
  ArrowLeft,
  Sparkles,
  Users,
  UserPlus,
  Trash2,
  ShieldCheck,
  Clock,
  Shield,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  signalBySlugQuery,
  signalPostsQuery,
  signalFollowingQuery,
  signalPublisherQuery,
  signalPublishersListQuery,
  useSignalFollow,
  useCreateSignalPost,
  useMarkSignalRead,
  useManageSignalPublisher,
  useRequestSignalVerification,
  signalAnalyticsQuery,
  type SignalPost,
  type SignalPublisherMember,
} from "@/lib/signals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { pageHead } from "@/lib/site";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/signals/$slug")({
  staticData: { sitemap: true },
  head: () =>
    pageHead({
      title: "Signal Channel — Ping",
      description: "Official institutional broadcast feed on Ping.",
      path: "/signals",
    }),
  component: SignalDetailPage,
});

function PostAnalyticsBadge({ postId, isPublisher }: { postId: string; isPublisher: boolean }) {
  const { data: analytics } = useQuery(signalAnalyticsQuery(postId, isPublisher));

  if (!isPublisher || !analytics) return null;

  return (
    <div className="mt-3 flex items-center gap-3 rounded-xl bg-secondary/60 px-3 py-1.5 text-xs text-muted-foreground border border-border/40">
      <BarChart3 className="size-3.5 text-primary" />
      <span>
        Delivered to <strong>{analytics.total_delivered}</strong> subscribers
      </span>
      <span>•</span>
      <span>
        <strong>{analytics.total_read}</strong> opened (
        <strong className="text-primary">{analytics.read_percentage}%</strong>)
      </span>
    </div>
  );
}

function SignalPostCard({
  post,
  isPublisher,
  currentUserId,
}: {
  post: SignalPost;
  isPublisher: boolean;
  currentUserId?: string | undefined;
}) {
  const markRead = useMarkSignalRead();

  useEffect(() => {
    if (currentUserId && !post.has_read) {
      markRead.mutate(post.id);
    }
  }, [post.id, post.has_read, currentUserId, markRead]);

  const dateFormatted = new Date(post.created_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <article className="surface-card relative rounded-3xl p-6 sm:p-7 border border-border/60 shadow-sm transition-all hover:border-border">
      {/* Category and Urgent Badges */}
      <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
        <div className="flex items-center gap-2">
          {post.is_urgent && (
            <span className="rounded-full bg-destructive/15 px-2.5 py-0.5 font-bold text-destructive flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-destructive animate-pulse" />
              URGENT
            </span>
          )}
          <span className="rounded-full bg-secondary px-2.5 py-0.5 font-semibold text-secondary-foreground capitalize">
            {post.category || "Announcement"}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-muted-foreground font-medium">
          <Calendar className="size-3.5" />
          <span>{dateFormatted}</span>
        </div>
      </div>

      {/* Post Content */}
      <h2 className="mt-3 font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
        {post.title}
      </h2>
      <p className="mt-2.5 whitespace-pre-wrap text-sm sm:text-base leading-relaxed text-foreground/90">
        {post.content}
      </p>

      {/* Optional Media Attachment */}
      {post.media_urls && post.media_urls.length > 0 && (
        <div className="mt-4 grid gap-2 overflow-hidden rounded-2xl">
          {post.media_urls.map((url, i) => (
            <img
              key={i}
              src={url}
              alt="Broadcast media attachment"
              className="max-h-96 w-full rounded-2xl object-cover border border-border/40"
              loading="lazy"
            />
          ))}
        </div>
      )}

      {/* Analytics for Authorized Publishers */}
      <PostAnalyticsBadge postId={post.id} isPublisher={isPublisher} />
    </article>
  );
}

function NewBroadcastDialog({
  signalId,
  open,
  onOpenChange,
}: {
  signalId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("announcement");
  const [tags, setTags] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [isUrgent, setIsUrgent] = useState(false);

  const createPost = useCreateSignalPost(signalId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim() || !content.trim()) {
      toast.error("Please fill in both a title and message content.");
      return;
    }

    createPost.mutate(
      {
        title: title.trim(),
        content: content.trim(),
        category,
        ...(mediaUrl.trim() ? { media_urls: [mediaUrl.trim()] } : {}),
      },
      {
        onSuccess: () => {
          toast.success("Broadcast dispatched successfully!");
          onOpenChange(false);
          setTitle("");
          setContent("");
          setTags("");
          setMediaUrl("");
          setIsUrgent(false);
        },
        onError: (err: any) => {
          toast.error(err.message || "Failed to dispatch broadcast.");
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-3xl p-6 sm:p-8">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Publish Official Broadcast</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            This message will be dispatched directly to all subscribers of this institutional
            Signal.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <Label className="text-xs font-semibold">Broadcast Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Batch W26 Applications Open / Security Advisory"
              className="mt-1 rounded-xl"
              required
            />
          </div>

          <div>
            <Label className="text-xs font-semibold">Category</Label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 flex h-10 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="announcement">Announcement</option>
              <option value="alert">Alert / Advisory</option>
              <option value="update">Platform Update</option>
              <option value="opportunity">Opportunity / Grant</option>
              <option value="event">Event / Demo Day</option>
            </select>
          </div>

          <div>
            <Label className="text-xs font-semibold">Message Content</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write the full announcement or bulletin…"
              rows={5}
              className="mt-1 rounded-xl resize-none"
              required
            />
          </div>

          <div>
            <Label className="text-xs font-semibold">Optional Attachment Image URL</Label>
            <Input
              value={mediaUrl}
              onChange={(e) => setMediaUrl(e.target.value)}
              placeholder="https://…/image.png"
              className="mt-1 rounded-xl"
            />
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
              disabled={createPost.isPending}
              className="rounded-xl"
            >
              {createPost.isPending ? "Broadcasting…" : "Dispatch Broadcast"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ManagePublishersDialog({
  signalId,
  creatorId,
  open,
  onOpenChange,
}: {
  signalId: string;
  creatorId?: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: publishers = [], isLoading } = useQuery(signalPublishersListQuery(signalId));
  const manageMutation = useManageSignalPublisher(signalId);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<"admin" | "publisher">("publisher");

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    const cleanUser = username.trim().replace(/^@/, "");
    manageMutation.mutate(
      { username: cleanUser, action: "add", role },
      {
        onSuccess: () => {
          toast.success(`Assigned @${cleanUser} as ${role}!`);
          setUsername("");
        },
        onError: (err: any) => {
          toast.error(err.message || "Failed to assign publisher.");
        },
      },
    );
  };

  const handleRemove = (pub: SignalPublisherMember) => {
    const handle = pub.profile?.username || "user";
    manageMutation.mutate(
      { username: handle, action: "remove" },
      {
        onSuccess: () => {
          toast.success(`Removed @${handle} from publishers.`);
        },
        onError: (err: any) => {
          toast.error(err.message || "Failed to remove publisher.");
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl p-6">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <Users className="size-5 text-primary" /> Manage Authorized Publishers
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Only authorized publishers can dispatch official institutional broadcasts on this Signal
            channel.
          </DialogDescription>
        </DialogHeader>

        {/* Add Publisher Form */}
        <form
          onSubmit={handleAdd}
          className="mt-4 space-y-3 rounded-2xl bg-secondary/40 p-4 border border-border/50"
        >
          <Label className="text-xs font-semibold">Add Publisher by Username</Label>
          <div className="flex gap-2">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="@username"
              className="rounded-xl h-9 text-xs"
              required
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "admin" | "publisher")}
              className="rounded-xl border border-border bg-card px-2.5 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="publisher">Publisher</option>
              <option value="admin">Admin</option>
            </select>
            <Button
              type="submit"
              variant="hero"
              size="sm"
              disabled={manageMutation.isPending}
              className="rounded-xl h-9 px-3 text-xs shrink-0"
            >
              {manageMutation.isPending ? "Adding…" : "Add"}
            </Button>
          </div>
        </form>

        {/* Publishers List */}
        <div className="mt-4 space-y-2 max-h-60 overflow-y-auto">
          {isLoading ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              Loading publishers…
            </div>
          ) : publishers.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              No publishers found.
            </div>
          ) : (
            publishers.map((pub) => {
              const isCreator = pub.user_id === creatorId;
              const profile = pub.profile;
              const displayName = profile?.display_name || profile?.username || "Builder";
              const handle = profile?.username;

              return (
                <div
                  key={pub.user_id}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-card p-3 border border-border/60"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {profile?.avatar_url ? (
                      <img
                        src={profile.avatar_url}
                        alt={displayName}
                        className="size-8 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-xs shrink-0">
                        {displayName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-xs truncate">{displayName}</p>
                      <p className="text-[11px] text-muted-foreground truncate">@{handle}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                        pub.role === "admin"
                          ? "bg-primary/15 text-primary"
                          : "bg-secondary text-secondary-foreground",
                      )}
                    >
                      {pub.role}
                    </span>
                    {!isCreator && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleRemove(pub)}
                        disabled={manageMutation.isPending}
                        title="Remove publisher"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RequestVerificationDialog({
  signalId,
  open,
  onOpenChange,
}: {
  signalId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [officialEmail, setOfficialEmail] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const [notes, setNotes] = useState("");
  const verifyMutation = useRequestSignalVerification(signalId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    verifyMutation.mutate(
      {
        official_email: officialEmail.trim(),
        documentation_url: docUrl.trim() || null,
        notes: notes.trim() || null,
        submitted_at: new Date().toISOString(),
      },
      {
        onSuccess: () => {
          toast.success("Verification request submitted for official review!");
          onOpenChange(false);
        },
        onError: (err: any) => {
          toast.error(err.message || "Failed to submit verification request.");
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl p-6">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" /> Request Official Verification
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Verify this channel as the official broadcast source for your institution. Verified
            channels get verified badges and priority discovery.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <Label className="text-xs font-semibold">Institutional / Domain Email</Label>
            <Input
              type="email"
              value={officialEmail}
              onChange={(e) => setOfficialEmail(e.target.value)}
              placeholder="press@institution.edu or contact@company.com"
              className="mt-1 rounded-xl"
              required
            />
          </div>

          <div>
            <Label className="text-xs font-semibold">Official Website or Verification Link</Label>
            <Input
              type="url"
              value={docUrl}
              onChange={(e) => setDocUrl(e.target.value)}
              placeholder="https://institution.edu/social-channels"
              className="mt-1 rounded-xl"
            />
          </div>

          <div>
            <Label className="text-xs font-semibold">Additional Details or Accreditations</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Provide any institutional registration or accreditation details…"
              rows={3}
              className="mt-1 rounded-xl resize-none text-xs"
            />
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
              disabled={verifyMutation.isPending}
              className="rounded-xl"
            >
              {verifyMutation.isPending ? "Submitting…" : "Submit Request"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SignalDetailPage() {
  const { slug } = Route.useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [broadcastDialogOpen, setBroadcastDialogOpen] = useState(false);
  const [publishersDialogOpen, setPublishersDialogOpen] = useState(false);
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);

  const { data: signal, isLoading: signalLoading } = useQuery(signalBySlugQuery(slug));
  const { data: isFollowing = false } = useQuery(signalFollowingQuery(signal?.id ?? "", user?.id));
  const { data: publisherData } = useQuery(signalPublisherQuery(signal?.id ?? "", user?.id));
  const isPublisher = publisherData?.isPublisher ?? false;
  const isSignalAdmin = publisherData?.role === "admin" || signal?.created_by === user?.id;

  const { data: posts = [], isLoading: postsLoading } = useQuery(
    signalPostsQuery(signal?.id ?? "", user?.id),
  );

  const followMutation = useSignalFollow(signal?.id ?? "", user?.id);

  // Real-time subscription for broadcasts
  useEffect(() => {
    if (!signal?.id) return;

    const channel = supabase
      .channel(`signal-broadcasts:${signal.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "signal_posts",
          filter: `signal_id=eq.${signal.id}`,
        },
        (payload) => {
          qc.invalidateQueries({ queryKey: ["signal-posts", signal.id] });
          qc.invalidateQueries({ queryKey: ["signal", slug] });
          const newPost = payload.new as { title?: string };
          toast.info(
            newPost?.title
              ? `New official broadcast: ${newPost.title}`
              : "New official broadcast received!",
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [signal?.id, slug, qc]);

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      toast.success("Signal link copied to clipboard!");
    }
  };

  const handleFollowToggle = () => {
    if (!user) {
      toast.error("Please log in to subscribe to this Signal.");
      return;
    }
    followMutation.mutate();
  };

  if (signalLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center text-muted-foreground">
        Loading Signal channel…
      </div>
    );
  }

  if (!signal) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <Radio className="mx-auto size-12 text-muted-foreground/60" />
        <h1 className="mt-4 font-display text-2xl font-bold">Signal Channel Not Found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The signal channel @{slug} does not exist or may have been unlisted.
        </p>
        <Button asChild variant="hero" className="mt-6 rounded-2xl">
          <Link to="/signals">Explore All Signals</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <Link
        to="/signals"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-3.5" />
        Back to Signals
      </Link>

      {/* Signal Channel Identity Header */}
      <header className="surface-card mt-4 rounded-3xl p-6 sm:p-8 border border-border/60">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            {signal.avatar_url ? (
              <img
                src={signal.avatar_url}
                alt={signal.name}
                className="size-16 rounded-2xl object-cover border border-border/50 shrink-0"
              />
            ) : (
              <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary shrink-0">
                <Radio className="size-8" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-display text-2xl font-extrabold sm:text-3xl text-foreground">
                  {signal.name}
                </h1>
                {signal.verified ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-gold/15 text-gold border border-gold/30 px-2.5 py-0.5 text-xs font-bold">
                    <CheckCircle className="size-3.5" />
                    Verified Institution
                  </span>
                ) : signal.verification_status === "pending" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-bold text-amber-500">
                    <Clock className="size-3.5" />
                    Verification Pending Review
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    <Shield className="size-3.5" />
                    Unverified
                  </span>
                )}
              </div>

              {signal.description && (
                <p className="mt-2 text-sm text-muted-foreground max-w-2xl leading-relaxed">
                  {signal.description}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
                <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 font-semibold capitalize text-secondary-foreground">
                  {signal.institution_type}
                </span>
                <span className="font-medium text-muted-foreground">
                  <strong>{signal.follower_count.toLocaleString()}</strong> subscribers
                </span>
                {signal.website_url && (
                  <a
                    href={signal.website_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                  >
                    <Globe className="size-3.5" />
                    Website
                  </a>
                )}
                {!signal.verified && signal.verification_status !== "pending" && isSignalAdmin && (
                  <button
                    type="button"
                    onClick={() => setVerifyDialogOpen(true)}
                    className="inline-flex items-center gap-1 text-primary hover:underline font-semibold"
                  >
                    <ShieldCheck className="size-3.5" />
                    Request Verification
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleShare}
              className="rounded-xl gap-1.5"
              title="Share Signal"
            >
              <Share2 className="size-4" />
              Share
            </Button>

            <Button
              variant={isFollowing ? "outline" : "hero"}
              size="sm"
              onClick={handleFollowToggle}
              disabled={followMutation.isPending}
              className="rounded-xl gap-1.5"
            >
              {isFollowing ? (
                <>
                  <BellOff className="size-4" />
                  Subscribed
                </>
              ) : (
                <>
                  <Bell className="size-4" />
                  Subscribe
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Publisher controls banner */}
        {isPublisher && (
          <div className="mt-6 pt-6 border-t border-border/60 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-primary">
              <Sparkles className="size-4" />
              <span>
                You have {publisherData?.role === "admin" ? "Admin" : "Publisher"} privileges on
                this Signal channel
              </span>
            </div>
            <div className="flex items-center gap-2">
              {isSignalAdmin && (
                <Button
                  onClick={() => setPublishersDialogOpen(true)}
                  variant="outline"
                  size="sm"
                  className="rounded-xl gap-1.5"
                >
                  <Users className="size-4" />
                  Publishers
                </Button>
              )}
              <Button
                onClick={() => setBroadcastDialogOpen(true)}
                variant="hero"
                size="sm"
                className="rounded-xl gap-1.5"
              >
                <Plus className="size-4" />
                New Broadcast
              </Button>
            </div>
          </div>
        )}
      </header>

      {/* Broadcast Feed */}
      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold flex items-center gap-2">
            <Radio className="size-5 text-primary" />
            Official Broadcasts
          </h2>
          <span className="text-xs text-muted-foreground">
            {posts.length} {posts.length === 1 ? "bulletin" : "bulletins"}
          </span>
        </div>

        <div className="mt-4 space-y-4">
          {postsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-40 rounded-3xl bg-muted/40 animate-pulse" />
              ))}
            </div>
          ) : posts.length === 0 ? (
            <div className="surface-card rounded-3xl p-10 text-center border border-border/60">
              <Radio className="mx-auto size-10 text-muted-foreground/40" />
              <p className="mt-3 font-display font-semibold text-foreground">
                No broadcasts published yet
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Stay tuned for official updates and announcements from {signal.name}.
              </p>
              {isPublisher && (
                <Button
                  onClick={() => setBroadcastDialogOpen(true)}
                  variant="hero"
                  size="sm"
                  className="mt-4 rounded-xl"
                >
                  Publish first broadcast
                </Button>
              )}
            </div>
          ) : (
            posts.map((post) => (
              <SignalPostCard
                key={post.id}
                post={post}
                isPublisher={isPublisher}
                currentUserId={user?.id}
              />
            ))
          )}
        </div>
      </section>

      {/* Composer Dialog */}
      {isPublisher && (
        <NewBroadcastDialog
          signalId={signal.id}
          open={broadcastDialogOpen}
          onOpenChange={setBroadcastDialogOpen}
        />
      )}

      {/* Manage Publishers Dialog */}
      {isSignalAdmin && (
        <ManagePublishersDialog
          signalId={signal.id}
          creatorId={signal.created_by}
          open={publishersDialogOpen}
          onOpenChange={setPublishersDialogOpen}
        />
      )}

      {/* Request Verification Dialog */}
      <RequestVerificationDialog
        signalId={signal.id}
        open={verifyDialogOpen}
        onOpenChange={setVerifyDialogOpen}
      />
    </div>
  );
}
