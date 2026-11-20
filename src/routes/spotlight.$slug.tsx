import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clapperboard,
  Eye,
  Flame,
  Share2,
  User,
} from "lucide-react";
import { pageHead } from "@/lib/site";
import {
  PING_OFFICIAL_ACCOUNT,
  recordObservedSpotlightEvent,
  spotlightBySlugQuery,
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
          <span className="inline-flex items-center gap-1.5 font-semibold text-amber-600 dark:text-amber-300">
            <Flame className="size-3.5" /> Published by {PING_OFFICIAL_ACCOUNT.displayName} (@
            {PING_OFFICIAL_ACCOUNT.handle})
          </span>
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

      {/* Video Interview (if attached) */}
      {pub.video_interview_url && (
        <section className="surface-card rounded-3xl overflow-hidden border border-border/70">
          <video
            src={pub.video_interview_url}
            controls
            playsInline
            preload="metadata"
            className="w-full max-h-[60dvh] bg-black"
          />
        </section>
      )}

      {/* Structured Story Body */}
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
        <h2 className="font-display text-xl font-extrabold">Founder Story</h2>
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

      {/* Linked Clips & DOT Tags */}
      {(pub.featured_clip_ids.length > 0 || pub.dot_tags.length > 0) && (
        <section className="surface-card rounded-3xl p-6 border border-border/70 flex flex-wrap items-center justify-between gap-4">
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
          {pub.featured_clip_ids.length > 0 && (
            <Button asChild variant="outline" size="sm" className="rounded-full gap-1.5">
              <Link to="/clips">
                <Clapperboard className="size-3.5 text-primary" /> Watch{" "}
                {pub.featured_clip_ids.length} Featured Clip
                {pub.featured_clip_ids.length === 1 ? "" : "s"}
              </Link>
            </Button>
          )}
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
