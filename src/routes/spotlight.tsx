import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import {
  ArrowRight,
  Building2,
  Crown,
  Eye,
  Flame,
  Info,
  Lock,
  Plus,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { pageHead } from "@/lib/site";
import { useAuth } from "@/lib/auth";
import { dotSummaryQuery } from "@/lib/economy";
import { isEntitlementActive, mySubscriptionEntitlementQuery } from "@/lib/memberships";
import {
  PING_OFFICIAL_ACCOUNT,
  mySpotlightSubmissionsQuery,
  spotlightPublicationsQuery,
  useNominateForSpotlight,
  useSubmitSpotlightStory,
} from "@/lib/spotlight";
import { checkSpotlightEditorAccess } from "@/lib/admin.functions";
import { isNative } from "@/lib/native";
import { FounderAvatar } from "@/components/ping/Avatar";
import { AccountStatusBadges } from "@/components/badges/AccountStatusBadges";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/spotlight")({
  staticData: { sitemap: true },
  head: () =>
    pageHead({
      title: "Ping Spotlight — Editorial Founder Discovery & Stories",
      description:
        "Ping's native, merit-based editorial programme discovering, documenting, and amplifying exceptional founders building meaningful businesses.",
      path: "/spotlight",
    }),
  component: PingSpotlightHubPage,
});

function PingSpotlightHubPage() {
  const { user, ready } = useAuth();
  const { data: dotSummary } = useQuery(dotSummaryQuery(user?.id));
  const { data: subEnt } = useQuery(mySubscriptionEntitlementQuery(user?.id));
  const { data: pubsState, isLoading } = useQuery(spotlightPublicationsQuery());
  const { data: mySubmissions = [] } = useQuery(mySpotlightSubmissionsQuery(user?.id));

  const checkEditorFn = useServerFn(checkSpotlightEditorAccess);
  const { data: editorAccess } = useQuery({
    queryKey: ["spotlight-editor-access", user?.id],
    enabled: ready && Boolean(user) && !isNative,
    queryFn: () => checkEditorFn(),
    retry: false,
  });

  const submitStory = useSubmitSpotlightStory();
  const nominateFounder = useNominateForSpotlight();

  const [submitOpen, setSubmitOpen] = useState(false);
  const [nominateOpen, setNominateOpen] = useState(false);

  // Submission state
  const [headline, setHeadline] = useState("");
  const [storyPitch, setStoryPitch] = useState("");
  const [problemStatement, setProblemStatement] = useState("");
  const [tractionEvidence, setTractionEvidence] = useState("");
  const [evidenceLink, setEvidenceLink] = useState("");

  // Nomination state
  const [nomineeUserId, setNomineeUserId] = useState("");
  const [nominationReason, setNominationReason] = useState("");

  const hasActivePro = Boolean(
    (isEntitlementActive(subEnt) && subEnt?.plan_slug === "pro") ||
    dotSummary?.subscription.tier === "pro",
  );

  const publications = pubsState?.publications ?? [];

  const handleSubmitStory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasActivePro) {
      toast.error("Active Builder Pro membership is required to submit for Ping Spotlight.");
      return;
    }
    try {
      await submitStory.mutateAsync({
        headline,
        storyPitch,
        problemStatement,
        tractionEvidence,
        evidenceUrls: evidenceLink.trim() ? [evidenceLink.trim()] : [],
      });
      toast.success(
        "Private Spotlight submission received for human editorial review. Eligibility never guarantees selection.",
      );
      setSubmitOpen(false);
      setHeadline("");
      setStoryPitch("");
      setProblemStatement("");
      setTractionEvidence("");
      setEvidenceLink("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit Spotlight story.");
    }
  };

  const handleNominate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await nominateFounder.mutateAsync({
        founderId: nomineeUserId.trim(),
        reason: nominationReason.trim(),
      });
      toast.success("Founder nomination recorded for editorial discovery review.");
      setNominateOpen(false);
      setNomineeUserId("");
      setNominationReason("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit nomination.");
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 pb-24 space-y-8">
      {/* Official Ping Spotlight Hero */}
      <header className="surface-card rounded-3xl p-6 sm:p-8 border border-amber-500/35 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 border border-amber-500/35 px-3 py-1 text-xs font-bold text-amber-600 dark:text-amber-300">
                <Flame className="size-3.5" /> Ping Spotlight · Official Editorial Programme
              </span>
              <span className="text-xs text-muted-foreground font-mono">
                @{PING_OFFICIAL_ACCOUNT.handle}
              </span>
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight">
              Discovering Founders Building Meaningful Businesses
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Continuing the founder-storytelling tradition natively inside Ping. Every Spotlight
              story is discovered through authentic activity, evaluated on merit by human editors,
              and amplified through Ping&apos;s official distribution channel.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {editorAccess?.isEditor && (
              <Button asChild variant="outline" size="sm" className="rounded-full gap-1.5">
                <Link to="/spotlight/editorial">
                  <ShieldCheck className="size-3.5 text-primary" /> Editorial Desk
                </Link>
              </Button>
            )}
            {user && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setNominateOpen(true)}
                className="rounded-full gap-1.5"
              >
                <UserPlus className="size-3.5" /> Nominate Founder
              </Button>
            )}
            <Button
              type="button"
              variant="hero"
              size="sm"
              onClick={() => {
                if (!user) {
                  toast.info("Sign in with an active Builder Pro membership to submit your story.");
                  return;
                }
                setSubmitOpen(true);
              }}
              className="rounded-full gap-1.5"
            >
              <Plus className="size-4" /> Submit Story
            </Button>
          </div>
        </div>

        {/* Merit & Anti-Pay-to-Play Integrity Banner */}
        <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-secondary/40 p-4 text-xs text-muted-foreground">
          <Info className="size-4 shrink-0 text-primary mt-0.5" />
          <p>
            <strong className="text-foreground">Editorial Merit Only — Never Purchasable:</strong>{" "}
            Ping Spotlight is not a paid ad product. An active{" "}
            <strong className="text-foreground">Builder Pro</strong> membership establishes
            consideration eligibility only and never guarantees selection. Final stories require
            documented human editorial approval.
          </p>
        </div>
      </header>

      {/* Published Official Spotlight Stories */}
      <section aria-labelledby="spotlight-stories-heading" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2
              id="spotlight-stories-heading"
              className="font-display text-2xl font-extrabold tracking-tight"
            >
              Published Spotlight Features
            </h2>
            <p className="text-xs text-muted-foreground">
              Curated founder stories distributed via {PING_OFFICIAL_ACCOUNT.displayName} (@
              {PING_OFFICIAL_ACCOUNT.handle}).
            </p>
          </div>
          <Link
            to="/clips"
            className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1"
          >
            Watch Founder Clips <ArrowRight className="size-3.5" />
          </Link>
        </div>

        {isLoading ? (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-72 animate-pulse rounded-3xl bg-secondary/50" />
            ))}
          </div>
        ) : publications.length === 0 ? (
          <div className="surface-card rounded-3xl p-10 text-center border border-border/70 space-y-3">
            <Flame className="mx-auto size-10 text-amber-500/70" />
            <h3 className="font-display text-lg font-bold">
              Editorial Discovery Open — First Cohort In Review
            </h3>
            <p className="text-xs text-muted-foreground max-w-lg mx-auto leading-relaxed">
              Editors actively discover builders through public Pings, Moments, Ping Clips, Hubs,
              Business Storefronts, and community nominations. Active Builder Pro members may also
              submit their execution story privately for consideration.
            </p>
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              <Button asChild variant="outline" size="sm" className="rounded-full">
                <Link to="/learn">Explore Ping Learn</Link>
              </Button>
              <Button asChild variant="hero" size="sm" className="rounded-full">
                <Link to="/upgrades">View Builder Pro Eligibility</Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {publications.map((pub) => {
              const observedViews = (pub.distribution ?? []).reduce(
                (s, d) => s + (d.views_count ?? 0),
                0,
              );
              const founderName =
                pub.founder?.display_name || pub.founder?.username || "Featured Founder";
              return (
                <Link
                  key={pub.id}
                  to="/spotlight/$slug"
                  params={{ slug: pub.slug }}
                  className="surface-card lift rounded-3xl overflow-hidden border border-border/70 flex flex-col justify-between"
                >
                  <div>
                    {pub.founder_portrait_url ? (
                      <img
                        src={pub.founder_portrait_url}
                        alt={founderName}
                        className="h-44 w-full object-cover"
                      />
                    ) : (
                      <div className="h-32 w-full bg-secondary/50 flex items-center justify-center">
                        <FounderAvatar name={founderName} src={pub.founder?.avatar_url} size="xl" />
                      </div>
                    )}
                    <div className="p-5 space-y-2.5">
                      <AccountStatusBadges isSpotlightHonoree compact />
                      <h3 className="font-display text-lg font-extrabold leading-snug text-foreground">
                        {pub.title}
                      </h3>
                      <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                        {pub.editorial_intro || pub.founder_story}
                      </p>
                    </div>
                  </div>
                  <div className="px-5 py-3 border-t border-border/60 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="truncate font-semibold text-foreground">
                      {founderName}
                      {pub.business?.name ? ` · ${pub.business.name}` : ""}
                    </span>
                    <span className="inline-flex items-center gap-1 shrink-0 tabular-nums">
                      <Eye className="size-3" /> {observedViews}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Member's Private Submissions Status (Owner-only visibility) */}
      {user && mySubmissions.length > 0 && (
        <section className="surface-card rounded-3xl p-6 border border-border/70 space-y-3">
          <h2 className="font-display text-base font-bold flex items-center gap-2">
            <Lock className="size-4 text-primary" /> Your Private Spotlight Submissions
          </h2>
          <div className="space-y-2">
            {mySubmissions.map((sub) => (
              <div
                key={sub.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-secondary/25 px-4 py-3 text-xs"
              >
                <div>
                  <p className="font-bold text-foreground">{sub.headline}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Submitted {format(new Date(sub.created_at), "MMM d, yyyy")} · Private to you and
                    Spotlight Editors
                  </p>
                </div>
                <span className="rounded-full bg-primary/15 text-primary px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                  {sub.status.replace("_", " ")}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Submit Story Dialog (Strictly Builder Pro Gated!) */}
      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogContent className="sm:max-w-lg rounded-3xl p-6 max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <Sparkles className="size-5 text-amber-500" /> Submit Your Story for Ping Spotlight
            </DialogTitle>
            <DialogDescription className="text-xs">
              Private editorial consideration for active Builder Pro founders. Selection is
              determined strictly on merit by human editors.
            </DialogDescription>
          </DialogHeader>

          {!hasActivePro ? (
            <div className="mt-3 rounded-2xl border border-gold/40 bg-gold/10 p-5 space-y-3 text-xs">
              <div className="flex items-center gap-2 font-bold text-foreground">
                <Crown className="size-4 text-gold" /> Active Builder Pro Required for Eligibility
              </div>
              <p className="text-muted-foreground leading-relaxed">
                Only members with an active <strong>Builder Pro (₦30,000)</strong> membership can
                enter the Ping Spotlight consideration workflow. Pro unlocks eligibility only — it
                never guarantees editorial selection.
              </p>
              <Button asChild variant="hero" size="sm" className="rounded-full">
                <Link to="/upgrades" onClick={() => setSubmitOpen(false)}>
                  View Builder Pro Membership
                </Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmitStory} className="mt-2 space-y-3">
              <div>
                <Label htmlFor="spot-headline" className="text-xs">
                  Story Headline
                </Label>
                <Input
                  id="spot-headline"
                  required
                  minLength={3}
                  maxLength={160}
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  placeholder="e.g. Bringing clean cold-chain logistics to 400 smallholder farms"
                  className="mt-1 rounded-xl text-xs"
                />
              </div>
              <div>
                <Label htmlFor="spot-problem" className="text-xs">
                  Problem Being Solved
                </Label>
                <Textarea
                  id="spot-problem"
                  rows={2}
                  value={problemStatement}
                  onChange={(e) => setProblemStatement(e.target.value)}
                  placeholder="What real economic or human problem are you solving?"
                  className="mt-1 rounded-xl text-xs"
                />
              </div>
              <div>
                <Label htmlFor="spot-pitch" className="text-xs">
                  Founder &amp; Business Story
                </Label>
                <Textarea
                  id="spot-pitch"
                  required
                  minLength={10}
                  rows={4}
                  value={storyPitch}
                  onChange={(e) => setStoryPitch(e.target.value)}
                  placeholder="Share your journey, product, and what makes your execution authentic…"
                  className="mt-1 rounded-xl text-xs"
                />
              </div>
              <div>
                <Label htmlFor="spot-traction" className="text-xs">
                  Evidence of Execution &amp; Traction
                </Label>
                <Textarea
                  id="spot-traction"
                  rows={2}
                  value={tractionEvidence}
                  onChange={(e) => setTractionEvidence(e.target.value)}
                  placeholder="Customers served, milestones shipped, pilots, verified revenue, or community impact…"
                  className="mt-1 rounded-xl text-xs"
                />
              </div>
              <div>
                <Label htmlFor="spot-link" className="text-xs">
                  Supporting Link (optional)
                </Label>
                <Input
                  id="spot-link"
                  type="url"
                  value={evidenceLink}
                  onChange={(e) => setEvidenceLink(e.target.value)}
                  placeholder="https://…"
                  className="mt-1 rounded-xl text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSubmitOpen(false)}
                  className="rounded-full"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="hero"
                  size="sm"
                  disabled={submitStory.isPending}
                  className="rounded-full font-bold"
                >
                  {submitStory.isPending ? "Submitting…" : "Submit for Editorial Review"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Nominate Founder Dialog */}
      <Dialog open={nominateOpen} onOpenChange={setNominateOpen}>
        <DialogContent className="sm:max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-lg flex items-center gap-2">
              <Building2 className="size-4 text-primary" /> Nominate an Exceptional Founder
            </DialogTitle>
            <DialogDescription className="text-xs">
              Recommend an active Builder Pro founder whose execution on Ping deserves editorial
              consideration.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleNominate} className="mt-2 space-y-3">
            <div>
              <Label htmlFor="nom-id" className="text-xs">
                Founder Account ID (UUID)
              </Label>
              <Input
                id="nom-id"
                required
                value={nomineeUserId}
                onChange={(e) => setNomineeUserId(e.target.value)}
                placeholder="Paste founder's profile UUID…"
                className="mt-1 rounded-xl text-xs font-mono"
              />
            </div>
            <div>
              <Label htmlFor="nom-reason" className="text-xs">
                Why should Ping Spotlight consider this founder?
              </Label>
              <Textarea
                id="nom-reason"
                required
                minLength={10}
                rows={3}
                value={nominationReason}
                onChange={(e) => setNominationReason(e.target.value)}
                placeholder="Highlight their execution proof, originality, and impact…"
                className="mt-1 rounded-xl text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setNominateOpen(false)}
                className="rounded-full"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="hero"
                size="sm"
                disabled={nominateFounder.isPending}
                className="rounded-full"
              >
                {nominateFounder.isPending ? "Submitting…" : "Submit Nomination"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
