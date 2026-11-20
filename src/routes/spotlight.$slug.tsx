import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Building2,
  CheckCircle2,
  Clapperboard,
  Eye,
  Flame,
  MessageSquare,
  Share2,
  Sparkles,
  User,
  Users,
} from "lucide-react";
import { pageHead } from "@/lib/site";
import {
  PING_OFFICIAL_ACCOUNT,
  recordObservedSpotlightEvent,
  spotlightBySlugQuery,
  spotlightLinkedResourcesQuery,
} from "@/lib/spotlight";
import { FounderAvatar } from "@/components/ping/Avatar";
import { AccountStatusBadges } from "@/components/badges/AccountStatusBadges";
import { UniversalShareDialog } from "@/components/sharing/UniversalShareDialog";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/spotlight/$slug")({
  staticData: { sitemap: true },
  head: () =>
    pageHead({
      title: "Ping Spotlight Story — Ping by DOT",
      description: "Editorially selected founder feature on Ping Spotlight.",
      path: "/spotlight",
    }),
  component: SpotlightStoryPage,
});

function SpotlightStoryPage() {
  const { slug } = Route.useParams();
  const { data: pub, isLoading } = useQuery(spotlightBySlugQuery(slug));
  const { data: linked } = useQuery(spotlightLinkedResourcesQuery(pub));
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    if (pub?.id && (pub.status === "published" || pub.status === "corrected")) {
      void recordObservedSpotlightEvent(pub.id, "official_account", "view");
    }
  }, [pub?.id, pub?.status]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-12">
        <div className="h-64 animate-pulse rounded-3xl bg-secondary/50" />
      </div>
    );
  }

  if (!pub || pub.status === "retracted") {
    return (
      <div className="mx-auto max-w-xl px-5 py-20 text-center space-y-3">
        <Flame className="mx-auto size-10 text-muted-foreground/50" />
        <h1 className="font-display text-2xl font-bold">
          {pub?.status === "retracted"
            ? "Spotlight story retracted by editors"
            : "Spotlight story not found"}
        </h1>
        {pub?.correction_note && (
          <p className="text-xs text-muted-foreground">{pub.correction_note}</p>
        )}
        <Button asChild variant="outline" className="rounded-full">
          <Link to="/spotlight">Back to Ping Spotlight</Link>
        </Button>
      </div>
    );
  }

  const founderName = pub.founder?.display_name || pub.founder?.username || "Featured Founder";
  const observedViews = (pub.distribution ?? []).reduce((s, d) => s + (d.views_count ?? 0), 0);
  const observedShares = (pub.distribution ?? []).reduce((s, d) => s + (d.shares_count ?? 0), 0);
  const observedImpressions = (pub.distribution ?? []).reduce(
    (s, d) => s + (d.impressions_count ?? 0),
    0,
  );
  const layoutBadge =
    pub.template_layout === "video_interview"
      ? "Video Interview Feature"
      : pub.template_layout === "builder_case_study"
        ? "Builder Case Study"
        : "Editorial Feature";

  const linkedPings = linked?.pings ?? [];
  const linkedClips = linked?.clips ?? [];
  const linkedHubs = linked?.hubs ?? [];

  return (
    <article className="mx-auto max-w-4xl px-4 sm:px-6 py-8 pb-24 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="outline" size="sm" className="rounded-full gap-1.5">
          <Link to="/spotlight">
            <ArrowLeft className="size-3.5" /> Ping Spotlight
          </Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setShareOpen(true);
            void recordObservedSpotlightEvent(pub.id, "official_account", "share");
          }}
          className="rounded-full gap-1.5"
        >
          <Share2 className="size-3.5" /> Share Story
        </Button>
      </div>

      {pub.status === "corrected" && pub.correction_note && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs">
          <AlertTriangle className="size-4 shrink-0 text-amber-500 mt-0.5" />
          <div>
            <p className="font-bold text-foreground">Editorial Correction Notice</p>
            <p className="text-muted-foreground mt-0.5">{pub.correction_note}</p>
          </div>
        </div>
      )}

      {/* Editorial Feature Header */}
      <header className="surface-card rounded-3xl p-6 sm:p-9 border border-border/70 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 font-semibold text-amber-600 dark:text-amber-300">
              <Flame className="size-3.5" /> Published by {PING_OFFICIAL_ACCOUNT.displayName} (@
              {PING_OFFICIAL_ACCOUNT.handle})
            </span>
            <span className="rounded-full border border-border bg-secondary/60 px-2.5 py-0.5 text-[10px] font-semibold">
              {layoutBadge}
            </span>
          </div>
          <span className="tabular-nums">
            {pub.published_at ? format(new Date(pub.published_at), "MMMM d, yyyy") : "Draft"} ·{" "}
            <Eye className="inline size-3.5 mb-0.5" /> {observedViews} observed views ·{" "}
            {observedShares} shares
          </span>
        </div>

        <h1 className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight leading-tight">
          {pub.title}
        </h1>

        {pub.editorial_intro && (
          <p className="text-base text-muted-foreground leading-relaxed">{pub.editorial_intro}</p>
        )}

        {/* Founder & Business Attribution Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-border/60">
          <div className="flex items-center gap-3">
            <FounderAvatar
              name={founderName}
              src={pub.founder_portrait_url || pub.founder?.avatar_url}
              size="lg"
            />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                {pub.founder?.username ? (
                  <Link
                    to="/@{$username}"
                    params={{ username: pub.founder.username }}
                    className="font-display font-bold text-base text-foreground hover:underline"
                  >
                    {founderName}
                  </Link>
                ) : (
                  <span className="font-display font-bold text-base">{founderName}</span>
                )}
                <AccountStatusBadges
                  userId={pub.founder_id}
                  isSpotlightHonoree
                  businessVerified={pub.business?.verified_status === "verified"}
                  businessName={pub.business?.name}
                  compact
                />
              </div>
              {pub.founder?.username && (
                <p className="text-xs text-muted-foreground">@{pub.founder.username}</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {pub.founder?.username && (
              <Button asChild size="sm" variant="outline" className="rounded-full text-xs gap-1.5">
                <Link to="/@{$username}" params={{ username: pub.founder.username }}>
                  <User className="size-3.5" /> Founder Profile
                </Link>
              </Button>
            )}
            {pub.business?.slug && (
              <Button asChild size="sm" variant="hero" className="rounded-full text-xs gap-1.5">
                <Link to="/b/$slug" params={{ slug: pub.business.slug }}>
                  <Building2 className="size-3.5" /> {pub.business.name}
                </Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Video Interview (prominent hero in video_interview layout or attached media) */}
      {pub.video_interview_url && (
        <section
          aria-label="Spotlight Video Interview"
          className="surface-card rounded-3xl overflow-hidden border border-border/70"
        >
          <video
            src={pub.video_interview_url}
            controls
            playsInline
            preload="metadata"
            className="w-full max-h-[60dvh] bg-black"
          />
        </section>
      )}

      {/* Supporting Editorial Photography */}
      {pub.media_urls && pub.media_urls.length > 0 && (
        <section aria-label="Spotlight Gallery" className="grid gap-3 sm:grid-cols-2">
          {pub.media_urls.map((imgUrl, idx) => (
            <img
              key={`${imgUrl}-${idx}`}
              src={imgUrl}
              alt={`${pub.title} visual ${idx + 1}`}
              className="w-full h-56 object-cover rounded-2xl border border-border/70"
            />
          ))}
        </section>
      )}

      {/* Structured Story Body (Case-Study prioritizes Problem/Solution & Evidence upfront) */}
      <div className="grid gap-5 md:grid-cols-2">
        {pub.problem_solved && (
          <section className="surface-card rounded-3xl p-6 border border-border/70 space-y-2">
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-primary">
              The Problem
            </h2>
            <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-line">
              {pub.problem_solved}
            </p>
          </section>
        )}
        {pub.product_solution && (
          <section className="surface-card rounded-3xl p-6 border border-border/70 space-y-2">
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-primary">
              The Solution
            </h2>
            <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-line">
              {pub.product_solution}
            </p>
          </section>
        )}
      </div>

      <section className="surface-card rounded-3xl p-6 sm:p-8 border border-border/70 space-y-4">
        <h2 className="font-display text-xl font-extrabold">
          {pub.template_layout === "builder_case_study" ? "Execution Case Study" : "Founder Story"}
        </h2>
        <p className="text-sm sm:text-base leading-relaxed text-foreground/95 whitespace-pre-line">
          {pub.founder_story}
        </p>

        {pub.business_description && (
          <div className="pt-4 border-t border-border/60 space-y-1.5">
            <h3 className="font-display text-base font-bold">About the Business</h3>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
              {pub.business_description}
            </p>
          </div>
        )}

        {pub.evidence_achievements.length > 0 && (
          <div className="pt-4 border-t border-border/60 space-y-2">
            <h3 className="font-display text-base font-bold">
              Documented Evidence &amp; Milestones
            </h3>
            <ul className="space-y-1.5 text-sm">
              {pub.evidence_achievements.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Featured Clips with Preserved Original Creator Attribution (Section 17) */}
      {(linkedClips.length > 0 || pub.featured_clip_ids.length > 0) && (
        <section
          aria-labelledby="spotlight-clips-heading"
          className="surface-card rounded-3xl p-6 border border-border/70 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2
              id="spotlight-clips-heading"
              className="font-display text-lg font-extrabold flex items-center gap-2"
            >
              <Clapperboard className="size-5 text-primary" /> Featured Founder Clips
            </h2>
            <Button asChild variant="outline" size="sm" className="rounded-full text-xs">
              <Link to="/clips">Explore All Ping Clips</Link>
            </Button>
          </div>

          {linkedClips.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {linkedClips.map((clip) => (
                <div
                  key={clip.id}
                  data-testid={`spotlight-featured-clip-${clip.id}`}
                  className="rounded-2xl overflow-hidden border border-border/70 bg-secondary/20 flex flex-col"
                >
                  <video
                    src={clip.video_url}
                    poster={clip.poster_url ?? undefined}
                    controls
                    playsInline
                    preload="metadata"
                    className="w-full aspect-[9/16] max-h-72 bg-black object-cover"
                  />
                  <div className="p-3.5 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-foreground">
                        {clip.creator?.display_name || `@${clip.creator?.username || "creator"}`}
                      </span>
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {clip.views_count} views
                      </span>
                    </div>
                    {clip.source_moment_id && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary">
                        <Sparkles className="size-3" /> Originally shared as a Moment
                      </span>
                    )}
                    {clip.caption && (
                      <p className="text-muted-foreground line-clamp-2">{clip.caption}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {pub.featured_clip_ids.length} linked Clip
              {pub.featured_clip_ids.length === 1 ? "" : "s"} attached —{" "}
              <Link to="/clips" className="text-primary underline">
                open Ping Clips feed
              </Link>
              .
            </p>
          )}
        </section>
      )}

      {/* Featured Original Pings (Section 11 & 17) */}
      {linkedPings.length > 0 && (
        <section
          aria-labelledby="spotlight-pings-heading"
          className="surface-card rounded-3xl p-6 border border-border/70 space-y-3"
        >
          <h2
            id="spotlight-pings-heading"
            className="font-display text-lg font-extrabold flex items-center gap-2"
          >
            <MessageSquare className="size-5 text-primary" /> Original Published Pings
          </h2>
          <div className="space-y-2.5">
            {linkedPings.map((ping) => (
              <Link
                key={ping.id}
                to="/p/$id"
                params={{ id: ping.id }}
                className="block rounded-2xl border border-border/60 bg-secondary/25 p-4 hover:bg-secondary/45 transition-colors space-y-1.5"
              >
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {ping.author?.display_name || `@${ping.author?.username || "founder"}`}
                  </span>
                  <span>{format(new Date(ping.created_at), "MMM d, yyyy")}</span>
                </div>
                <p className="text-xs text-foreground/90 leading-relaxed line-clamp-3">
                  {ping.content}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Related Hubs & DOT Tags (Section 17) */}
      {(linkedHubs.length > 0 || pub.dot_tags.length > 0) && (
        <section className="surface-card rounded-3xl p-6 border border-border/70 space-y-4">
          {linkedHubs.length > 0 && (
            <div className="space-y-2">
              <h2 className="font-display text-sm font-bold flex items-center gap-1.5">
                <Users className="size-4 text-primary" /> Related Community Hubs
              </h2>
              <div className="flex flex-wrap gap-2">
                {linkedHubs.map((hub) => (
                  <Link
                    key={hub.id}
                    to="/hubs/$slug"
                    params={{ slug: hub.slug }}
                    className="rounded-full border border-border bg-secondary/40 px-3 py-1 text-xs font-semibold hover:bg-secondary"
                  >
                    {hub.name}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {pub.dot_tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {pub.dot_tags.map((slugTag) => (
                <Link
                  key={slugTag}
                  to="/tag/$slug"
                  params={{ slug: slugTag }}
                  className="rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs font-semibold text-primary hover:bg-secondary"
                >
                  .{slugTag}
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Observed Distribution Analytics (Actual Events Only — Never Fabricated) */}
      {pub.distribution && pub.distribution.length > 0 && (
        <section
          aria-label="Observed Spotlight distribution metrics"
          className="rounded-2xl border border-border/60 bg-card/60 p-4 text-xs space-y-2"
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold flex items-center gap-1.5 text-foreground">
              <BarChart3 className="size-3.5 text-primary" /> Observed Distribution Telemetry
            </span>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {observedImpressions} impressions · {observedViews} views · {observedShares} shares
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {pub.distribution.map((row) => (
              <span
                key={row.channel}
                className="rounded-lg border border-border/60 bg-secondary/40 px-2.5 py-1 text-[11px] tabular-nums"
              >
                <strong>{row.channel.replace("_", " ")}</strong>: {row.impressions_count} imp ·{" "}
                {row.views_count} views · {row.clicks_count} clicks · {row.shares_count} shares
              </span>
            ))}
          </div>
        </section>
      )}

      <UniversalShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        payload={{
          targetType: "ping",
          targetId: pub.id,
          title: `Ping Spotlight: ${pub.title}`,
          description: pub.editorial_intro || pub.founder_story.slice(0, 160),
          path: `/spotlight/${pub.slug}`,
        }}
      />
    </article>
  );
}
