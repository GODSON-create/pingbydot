import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  signalBySlugQuery,
  signalPostsQuery,
  signalFollowingQuery,
  signalPublisherQuery,
  useSignalFollow,
  useCreateSignalPost,
  useMarkSignalRead,
  signalAnalyticsQuery,
  type SignalPost,
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
    <article className="surface-card rounded-3xl p-5 sm:p-6 transition-all border border-border/60">
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-block size-2 rounded-full",
                post.has_read ? "bg-primary" : "bg-foreground",
              )}
              title={post.has_read ? "Read" : "Unread"}
            />
            <h3 className="font-display text-lg font-bold text-foreground">{post.title}</h3>
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="size-3" />
            {dateFormatted}
          </p>
        </div>
      </header>

      <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
        {post.content}
      </div>

      {post.media_urls && post.media_urls.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-border/50">
          <img
            src={post.media_urls[0]}
            alt="Signal broadcast attachment"
            className="w-full max-h-96 object-cover"
          />
        </div>
      )}

      {post.category && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md bg-secondary/80 px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
            <Tag className="size-2.5 text-muted-foreground" />
            {post.category}
          </span>
        </div>
      )}

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
  const [tags, setTags] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const createPost = useCreateSignalPost(signalId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      toast.error("Title and content are required.");
      return;
    }

    try {
      const tagList = tags
        .split(",")
        .map((t) => t.trim().replace(/^#/, ""))
        .filter(Boolean);

      await createPost.mutateAsync({
        title: title.trim(),
        content: content.trim(),
        ...(tags.trim() ? { category: tags.trim() } : {}),
        ...(mediaUrl.trim() ? { media_urls: [mediaUrl.trim()] } : {}),
      });

      toast.success("Broadcast broadcasted to all subscribers!");
      setTitle("");
      setContent("");
      setTags("");
      setMediaUrl("");
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to send broadcast.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl rounded-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Publish Official Broadcast</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            This message will be dispatched directly to all subscribers of this institutional Signal.
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
            <Label className="text-xs font-semibold">Tags (comma-separated)</Label>
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="admissions, grant, release"
              className="mt-1 rounded-xl"
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

function SignalDetailPage() {
  const { slug } = Route.useParams();
  const { user } = useAuth();
  const [broadcastDialogOpen, setBroadcastDialogOpen] = useState(false);

  const { data: signal, isLoading: signalLoading } = useQuery(signalBySlugQuery(slug));
  const { data: isFollowing = false } = useQuery(
    signalFollowingQuery(signal?.id ?? "", user?.id),
  );
  const { data: publisherData } = useQuery(
    signalPublisherQuery(signal?.id ?? "", user?.id),
  );
  const isPublisher = publisherData?.isPublisher ?? false;

  const { data: posts = [], isLoading: postsLoading } = useQuery(
    signalPostsQuery(signal?.id ?? "", user?.id),
  );

  const followMutation = useSignalFollow(signal?.id ?? "", user?.id);

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
                {signal.verified && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-bold text-primary">
                    <CheckCircle className="size-3.5" />
                    Verified Institution
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
          <div className="mt-6 pt-6 border-t border-border/60 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-primary">
              <Sparkles className="size-4" />
              <span>You have Publisher privileges on this Signal channel</span>
            </div>
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
    </div>
  );
}
