import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BarChart3, Check, Compass, Hash, Plus, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { feedQuery } from "@/lib/pings";
import {
  computeDotTagAnalytics,
  CURATED_DOT_TAGS,
  followedDotTagsQuery,
  formatDotTag,
  normalizeDotTagSlug,
  useToggleFollowDotTag,
  validateDotTag,
} from "@/lib/dot-tags";
import { pageHead } from "@/lib/site";
import { PingCard } from "@/components/ping/PingCard";
import { EmptyStateCard, LoadingSkeletonStack } from "@/components/ui/state-views";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/tag/$slug")({
  staticData: { sitemap: false },
  head: ({ params }) => {
    const clean = normalizeDotTagSlug(params.slug);
    return pageHead({
      title: `${formatDotTag(clean)} — DOT Tag Discovery | Ping by DOT`,
      description: `Explore Pings, builders, and discussions tagged ${formatDotTag(clean)} on Ping by DOT.`,
      path: `/tag/${encodeURIComponent(clean)}`,
    });
  },
  component: DotTagDiscoveryPage,
});

function DotTagDiscoveryPage() {
  const { slug: rawSlug } = Route.useParams();
  const { user } = useAuth();
  const slug = normalizeDotTagSlug(rawSlug);
  const tagValidation = validateDotTag(slug);

  const { data: feed = [], isLoading } = useQuery(feedQuery(null, 0));
  const { data: followedTags = [] } = useQuery(followedDotTagsQuery(user?.id));
  const toggleFollow = useToggleFollowDotTag(user?.id);

  const isFollowing = followedTags.includes(slug);
  const analytics = computeDotTagAnalytics(slug, feed);
  const curatedMeta = CURATED_DOT_TAGS.find((t) => t.slug === slug);

  const handleToggleFollow = () => {
    if (!user) {
      toast("Sign in to follow DOT Tags", {
        action: { label: "Log in", onClick: () => (window.location.href = "/login") },
      });
      return;
    }
    toggleFollow.mutate(
      { slug, currentlyFollowing: isFollowing },
      {
        onSuccess: (nowFollowing) =>
          toast.success(
            nowFollowing ? `Following ${formatDotTag(slug)}` : `Unfollowed ${formatDotTag(slug)}`,
          ),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Could not update tag"),
      },
    );
  };

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8 pb-24 space-y-6">
      <header className="surface-card rounded-3xl p-6 sm:p-8 border border-border/70 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-full shrink-0">
              <Link to="/explore" aria-label="Back to Explore">
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-0.5 text-[11px] font-bold text-primary">
                <Sparkles className="size-3" /> DOT Tag Discovery
                {curatedMeta ? ` · ${curatedMeta.category}` : ""}
              </span>
              <h1 className="mt-2 font-display text-3xl sm:text-4xl font-extrabold tracking-tight">
                {formatDotTag(slug)}
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Showing native <code>.{slug}</code> Pings plus legacy <code>#{slug}</code> posts for
                seamless discovery.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {tagValidation.valid && (
              <Button
                type="button"
                variant={isFollowing ? "outline" : "hero"}
                size="sm"
                disabled={toggleFollow.isPending}
                onClick={handleToggleFollow}
                className="rounded-full text-xs gap-1.5"
              >
                {isFollowing ? (
                  <>
                    <Check className="size-3.5" /> Following
                  </>
                ) : (
                  <>
                    <Plus className="size-3.5" /> Follow {formatDotTag(slug)}
                  </>
                )}
              </Button>
            )}
            <Button asChild variant="outline" size="sm" className="rounded-full text-xs">
              <Link to="/create" search={{ quote: `${formatDotTag(slug)} ` }}>
                Post in {formatDotTag(slug)}
              </Link>
            </Button>
          </div>
        </div>

        {/* Tag Analytics Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-3 border-t border-border/60 text-xs">
          <div className="rounded-2xl bg-secondary/40 px-3.5 py-2.5">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Hash className="size-3 text-primary" /> Tagged Pings
            </span>
            <p className="font-display text-lg font-extrabold tabular-nums">
              {analytics.postCount}
            </p>
          </div>
          <div className="rounded-2xl bg-secondary/40 px-3.5 py-2.5">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Users className="size-3 text-primary" /> Active Authors
            </span>
            <p className="font-display text-lg font-extrabold tabular-nums">
              {analytics.uniqueAuthors}
            </p>
          </div>
          <div className="rounded-2xl bg-secondary/40 px-3.5 py-2.5">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <BarChart3 className="size-3 text-primary" /> Total Likes
            </span>
            <p className="font-display text-lg font-extrabold tabular-nums">
              {analytics.totalLikes}
            </p>
          </div>
          <div className="rounded-2xl bg-secondary/40 px-3.5 py-2.5">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Compass className="size-3 text-primary" /> Total Replies
            </span>
            <p className="font-display text-lg font-extrabold tabular-nums">
              {analytics.totalReplies}
            </p>
          </div>
        </div>

        {/* Related DOT Tags */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-[11px] font-semibold text-muted-foreground mr-1">
            Explore tags:
          </span>
          {(analytics.relatedTags.length > 0
            ? analytics.relatedTags
            : CURATED_DOT_TAGS.slice(0, 8).map((t) => t.slug)
          )
            .filter((s) => s !== slug)
            .slice(0, 8)
            .map((rel) => (
              <Link
                key={rel}
                to="/tag/$slug"
                params={{ slug: rel }}
                className="rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] font-semibold text-foreground hover:border-primary hover:text-primary transition-colors"
              >
                .{rel}
              </Link>
            ))}
        </div>
      </header>

      {!tagValidation.valid ? (
        <EmptyStateCard
          icon={<Compass className="size-6" />}
          title="Restricted or invalid DOT Tag"
          description={tagValidation.error || "This tag is not available for public discovery."}
          action={
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <Link to="/explore">Browse Explore</Link>
            </Button>
          }
        />
      ) : isLoading ? (
        <LoadingSkeletonStack rows={3} heightClass="h-36" label="Loading DOT Tag feed" />
      ) : analytics.matchingPings.length === 0 ? (
        <EmptyStateCard
          icon={<Sparkles className="size-6" />}
          title={`Be the first to post in ${formatDotTag(slug)}`}
          description={`Include ${formatDotTag(slug)} in your next Ping to anchor this topic feed.`}
          action={
            <Button asChild variant="hero" size="sm" className="rounded-full">
              <Link to="/create" search={{ quote: `${formatDotTag(slug)} ` }}>
                Create a Ping with {formatDotTag(slug)}
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {analytics.matchingPings.map((ping) => (
            <PingCard key={ping.id} ping={ping} />
          ))}
        </div>
      )}
    </div>
  );
}
