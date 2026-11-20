import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Compass,
  Crown,
  Eye,
  FileEdit,
  Flame,
  History,
  Info,
  Plus,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  checkSpotlightEditorAccess,
  decideSpotlightCandidate,
  discoverSpotlightCandidates,
  getSpotlightEditorialWorkspace,
  publishSpotlightFeature,
  queueDiscoveredSpotlightCandidate,
} from "@/lib/admin.functions";
import {
  DEFAULT_SPOTLIGHT_RUBRIC,
  computeSpotlightMeritScore,
  generateAdvisoryEditorialSummary,
  type SpotlightTemplateLayout,
} from "@/lib/spotlight";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/spotlight/editorial")({
  staticData: { sitemap: false },
  ssr: false,
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Spotlight Editorial Desk — Ping by DOT" },
    ],
  }),
  component: SpotlightEditorialGate,
});

function SpotlightEditorialGate() {
  const { ready, user } = useAuth();
  const checkFn = useServerFn(checkSpotlightEditorAccess);
  const access = useQuery({
    queryKey: ["spotlight-editor-access", user?.id],
    enabled: ready && Boolean(user),
    queryFn: () => checkFn(),
    retry: false,
  });

  if (!ready || access.isPending) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-16 text-sm text-muted-foreground" role="status">
        Verifying Spotlight editorial permissions…
      </div>
    );
  }

  if (!access.data?.isEditor) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center space-y-3">
        <ShieldCheck className="mx-auto size-10 text-muted-foreground" />
        <h1 className="font-display text-2xl font-bold">Spotlight Editorial Access Required</h1>
        <p className="text-xs text-muted-foreground">
          This workspace is restricted to authorised Ping Spotlight editors (permissions are
          separated from financial administration).
        </p>
        <Button asChild variant="outline" className="rounded-full">
          <Link to="/spotlight">Back to Ping Spotlight</Link>
        </Button>
      </div>
    );
  }

  return <SpotlightEditorialDashboard />;
}

function SpotlightEditorialDashboard() {
  const qc = useQueryClient();
  const workspaceFn = useServerFn(getSpotlightEditorialWorkspace);
  const discoverFn = useServerFn(discoverSpotlightCandidates);
  const queueDiscoveryFn = useServerFn(queueDiscoveredSpotlightCandidate);
  const decideFn = useServerFn(decideSpotlightCandidate);
  const publishFn = useServerFn(publishSpotlightFeature);

  const [tab, setTab] = useState<"discover" | "candidates" | "publish" | "publications" | "audit">(
    "candidates",
  );
  const [discoverFilter, setDiscoverFilter] = useState<
    "all" | "ping" | "clip" | "business" | "hub"
  >("all");
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, number>>(() =>
    Object.fromEntries(DEFAULT_SPOTLIGHT_RUBRIC.map((d) => [d.key, 7])),
  );
  const [decisionStatus, setDecisionStatus] = useState<
    "under_review" | "shortlisted" | "selected" | "declined"
  >("shortlisted");
  const [selectionReason, setSelectionReason] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [advisoryBrief, setAdvisoryBrief] = useState<string | null>(null);

  // Publication Composer state
  const [pubSlug, setPubSlug] = useState("");
  const [pubFounderId, setPubFounderId] = useState("");
  const [pubBusinessId, setPubBusinessId] = useState("");
  const [pubTitle, setPubTitle] = useState("");
  const [pubIntro, setPubIntro] = useState("");
  const [pubStory, setPubStory] = useState("");
  const [pubProblem, setPubProblem] = useState("");
  const [pubSolution, setPubSolution] = useState("");
  const [pubBizDesc, setPubBizDesc] = useState("");
  const [pubAchievements, setPubAchievements] = useState("");
  const [pubPingIds, setPubPingIds] = useState("");
  const [pubClipIds, setPubClipIds] = useState("");
  const [pubVideoUrl, setPubVideoUrl] = useState("");
  const [pubPortraitUrl, setPubPortraitUrl] = useState("");
  const [pubTags, setPubTags] = useState("africa, startups");
  const [pubLayout, setPubLayout] = useState<SpotlightTemplateLayout>("editorial_feature");
  const [pubStatus, setPubStatus] = useState<
    "draft" | "scheduled" | "published" | "corrected" | "retracted"
  >("published");
  const [pubScheduledFor, setPubScheduledFor] = useState("");
  const [pubCorrectionNote, setPubCorrectionNote] = useState("");
  const [distHome, setDistHome] = useState(true);
  const [distExplore, setDistExplore] = useState(true);
  const [distOfficial, setDistOfficial] = useState(true);
  const [distNotify, setDistNotify] = useState(false);
  const [distCapDays, setDistCapDays] = useState(7);

  const workspace = useQuery({
    queryKey: ["spotlight-editorial-workspace"],
    queryFn: () => workspaceFn(),
    retry: false,
  });

  const discovery = useQuery({
    queryKey: ["spotlight-editorial-discovery"],
    enabled: tab === "discover",
    queryFn: () => discoverFn(),
    retry: false,
  });

  const queueDiscoveryMutation = useMutation({
    mutationFn: (item: {
      founderId: string;
      sourceType: "ping" | "clip" | "business" | "hub";
      sourceRefId: string;
      businessId: string | null;
      title: string;
      excerpt: string;
    }) =>
      queueDiscoveryFn({
        data: {
          founderId: item.founderId,
          sourceType: item.sourceType,
          sourceRefId: item.sourceRefId,
          businessId: item.businessId,
          headline: item.title.length >= 3 ? item.title : "Discovered Founder Story",
          storyPitch:
            item.excerpt.length >= 10
              ? item.excerpt
              : `Discovered organically via Ping ${item.sourceType}.`,
        },
      }),
    onSuccess: async () => {
      toast.success("Builder queued into Spotlight candidate review.");
      await qc.invalidateQueries({ queryKey: ["spotlight-editorial-workspace"] });
      setTab("candidates");
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Could not queue discovered builder."),
  });

  const decideMutation = useMutation({
    mutationFn: () => {
      if (!selectedCandidateId) throw new Error("Select a candidate first.");
      return decideFn({
        data: {
          candidateId: selectedCandidateId,
          status: decisionStatus,
          selectionReason,
          scores,
          weightedTotal: computeSpotlightMeritScore(scores),
          internalNotes,
        },
      });
    },
    onSuccess: async () => {
      toast.success("Human editorial evaluation & decision recorded.");
      setSelectionReason("");
      setInternalNotes("");
      await qc.invalidateQueries({ queryKey: ["spotlight-editorial-workspace"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Could not record editorial decision."),
  });

  const publishMutation = useMutation({
    mutationFn: () =>
      publishFn({
        data: {
          slug: pubSlug.trim().toLowerCase(),
          candidateId: selectedCandidateId,
          founderId: pubFounderId.trim(),
          businessId: pubBusinessId.trim() || null,
          title: pubTitle.trim(),
          editorialIntro: pubIntro.trim(),
          founderStory: pubStory.trim(),
          businessDescription: pubBizDesc.trim(),
          problemSolved: pubProblem.trim(),
          productSolution: pubSolution.trim(),
          evidenceAchievements: pubAchievements
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          mediaUrls: [],
          featuredPingIds: pubPingIds
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          featuredClipIds: pubClipIds
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          featuredMomentIds: [],
          dotTags: pubTags
            .split(",")
            .map((s) => s.trim().replace(/^\./, "").toLowerCase())
            .filter(Boolean),
          templateLayout: pubLayout,
          distributionConfig: {
            home_feed: distHome,
            explore: distExplore,
            official_account: distOfficial,
            notify_eligible: distNotify,
            frequency_cap_days: distCapDays,
          },
          scheduledFor:
            pubStatus === "scheduled" && pubScheduledFor
              ? new Date(pubScheduledFor).toISOString()
              : null,
          videoInterviewUrl: pubVideoUrl.trim() || null,
          founderPortraitUrl: pubPortraitUrl.trim() || null,
          status: pubStatus,
          correctionNote: pubCorrectionNote.trim(),
        },
      }),
    onSuccess: async () => {
      toast.success(`Spotlight feature "${pubTitle}" saved (${pubStatus}).`);
      await qc.invalidateQueries({ queryKey: ["spotlight-editorial-workspace"] });
      await qc.invalidateQueries({ queryKey: ["spotlight-publications"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Could not publish Spotlight story."),
  });

  const candidates = workspace.data?.candidates ?? [];
  const publications = workspace.data?.publications ?? [];
  const auditLogs = workspace.data?.auditLogs ?? [];
  const discoveredItems = (discovery.data?.items ?? []).filter(
    (item) => discoverFilter === "all" || item.sourceType === discoverFilter,
  );
  const weightedScore = computeSpotlightMeritScore(scores);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 pb-24 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button asChild variant="outline" size="sm" className="rounded-full gap-1.5 mb-2">
            <Link to="/spotlight">
              <ArrowLeft className="size-3.5" /> Public Spotlight Hub
            </Link>
          </Button>
          <h1 className="font-display text-3xl font-extrabold tracking-tight flex items-center gap-2">
            <Flame className="size-7 text-amber-500" /> Ping Spotlight Editorial Desk
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Organic Ping discovery, 8-dimension merit scoring, mandatory human selection approval,
            official @ping publication, distribution controls, corrections/retractions, and audit
            history. Separated from financial admin.
          </p>
        </div>
      </div>

      {workspace.data?.unmigrated && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-gold/40 bg-gold/10 p-4 text-xs">
          <Info className="size-4 text-gold shrink-0 mt-0.5" />
          <p>
            Spotlight editorial tables require database migration <code>0034</code> on the connected
            environment before live candidate rows and publications persist.
          </p>
        </div>
      )}

      {/* Editorial Navigation Tabs */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Editorial desk views">
        {(
          [
            { id: "discover", label: "Discover Activity", icon: Compass },
            { id: "candidates", label: `Candidates (${candidates.length})`, icon: ClipboardCheck },
            { id: "publish", label: "Story Composer", icon: FileEdit },
            { id: "publications", label: `Published (${publications.length})`, icon: CheckCircle2 },
            { id: "audit", label: "Editorial Audit", icon: History },
          ] as const
        ).map((t) => {
          const Icon = t.icon;
          return (
            <Button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              variant={tab === t.id ? "default" : "outline"}
              size="sm"
              onClick={() => setTab(t.id)}
              className="rounded-full text-xs gap-1.5"
            >
              <Icon className="size-3.5" /> {t.label}
            </Button>
          );
        })}
      </div>

      {/* TAB 0: ORGANIC EDITORIAL DISCOVERY (Pings, Clips, Businesses, Hubs) */}
      {tab === "discover" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {(["all", "ping", "clip", "business", "hub"] as const).map((f) => (
                <Button
                  key={f}
                  type="button"
                  size="sm"
                  variant={discoverFilter === f ? "default" : "outline"}
                  onClick={() => setDiscoverFilter(f)}
                  className="rounded-full text-xs capitalize"
                >
                  {f === "all" ? "All Activity" : `${f}s`}
                </Button>
              ))}
            </div>
            <span className="text-[11px] text-muted-foreground">
              Only builders with active Builder Pro membership can enter the eligible review queue.
            </span>
          </div>

          {discovery.isPending ? (
            <p className="py-8 text-xs text-muted-foreground" role="status">
              Scanning recent public Ping activity…
            </p>
          ) : discoveredItems.length === 0 ? (
            <div className="surface-card rounded-3xl p-8 text-center text-xs text-muted-foreground">
              No recent public activity matched this filter.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {discoveredItems.map((item) => (
                <article
                  key={`${item.sourceType}-${item.sourceRefId}`}
                  className="surface-card rounded-2xl p-4 border border-border/70 flex flex-col justify-between gap-3"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-foreground truncate">
                        {item.founderLabel}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase">
                          {item.sourceType}
                        </span>
                        {item.hasActivePro ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 border border-gold/40 px-2 py-0.5 text-[10px] font-bold text-gold">
                            <Crown className="size-3" /> Pro Eligible
                          </span>
                        ) : (
                          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                            Not Pro
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-xs font-semibold text-foreground line-clamp-1">
                      {item.title}
                    </p>
                    <p className="text-[11px] text-muted-foreground line-clamp-2">{item.excerpt}</p>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/50">
                    <span className="text-[10px] text-muted-foreground">
                      {format(new Date(item.createdAt), "MMM d, yyyy")}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant={item.hasActivePro ? "hero" : "outline"}
                      disabled={!item.hasActivePro || queueDiscoveryMutation.isPending}
                      onClick={() => queueDiscoveryMutation.mutate(item)}
                      className="h-7 rounded-full text-[11px] gap-1"
                    >
                      <Plus className="size-3" />
                      {item.hasActivePro ? "Queue for Review" : "Pro Required"}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 1: CANDIDATE EVALUATION & HUMAN APPROVAL */}
      {tab === "candidates" && (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-2 space-y-3">
            {candidates.length === 0 ? (
              <div className="surface-card rounded-3xl p-8 text-center text-xs text-muted-foreground">
                No Spotlight candidates in queue yet. Use <strong>Discover Activity</strong> or let
                eligible Builder Pro founders submit stories.
              </div>
            ) : (
              candidates.map((c) => {
                const selected = selectedCandidateId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setSelectedCandidateId(c.id);
                      setAdvisoryBrief(null);
                      setPubFounderId(c.founder_id);
                      setPubBusinessId(c.business_id ?? "");
                      setPubTitle(c.headline);
                      setPubProblem(c.problem_statement);
                      setPubStory(c.story_pitch);
                    }}
                    className={cn(
                      "w-full text-left surface-card rounded-2xl p-4 border transition-all space-y-1.5",
                      selected ? "border-primary ring-1 ring-primary/30" : "border-border/70",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-foreground truncate">
                        {c.founder?.display_name || `@${c.founder?.username || "founder"}`}
                      </span>
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase">
                        {c.status}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-foreground line-clamp-1">
                      {c.headline}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Source: {c.source_type.replace("_", " ")} ·{" "}
                      {c.pro_verified_at ? "Pro Verified" : "Pro Check Pending"}
                    </p>
                  </button>
                );
              })
            )}
          </div>

          <div className="lg:col-span-3 surface-card rounded-3xl p-6 border border-border/70 space-y-5">
            {(() => {
              const active = candidates.find((c) => c.id === selectedCandidateId);
              if (!active) {
                return (
                  <p className="text-xs text-muted-foreground py-8 text-center">
                    Select a candidate on the left to review evidence, run advisory summarisation,
                    score on the 8-dimension merit rubric, and record a human editorial decision.
                  </p>
                );
              }
              return (
                <>
                  <div className="space-y-2 border-b border-border/60 pb-4">
                    <h2 className="font-display text-lg font-extrabold">{active.headline}</h2>
                    <p className="text-xs text-foreground/90 whitespace-pre-line">
                      {active.story_pitch}
                    </p>
                    {active.traction_evidence && (
                      <p className="text-xs text-muted-foreground">
                        <strong>Traction Evidence:</strong> {active.traction_evidence}
                      </p>
                    )}
                    <div className="pt-2 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="rounded-full text-xs gap-1.5"
                        onClick={() => setAdvisoryBrief(generateAdvisoryEditorialSummary(active))}
                      >
                        <Sparkles className="size-3.5 text-primary" /> Generate AI Advisory Summary
                        (Non-Decisional)
                      </Button>
                    </div>
                    {advisoryBrief && (
                      <p className="rounded-xl border border-primary/25 bg-primary/10 p-3 text-[11px] text-foreground">
                        {advisoryBrief}
                      </p>
                    )}
                  </div>

                  {/* Configurable 8-Dimension Merit Scoring Rubric */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Merit Evaluation Rubric (1–10)
                      </h3>
                      <span className="font-display text-base font-extrabold text-primary tabular-nums">
                        {weightedScore} / 100
                      </span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {DEFAULT_SPOTLIGHT_RUBRIC.map((dim) => (
                        <label
                          key={dim.key}
                          className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-secondary/25 px-3 py-2 text-[11px]"
                        >
                          <span className="truncate">
                            {dim.label} ({dim.weight}%)
                          </span>
                          <Input
                            type="number"
                            min={0}
                            max={10}
                            value={scores[dim.key] ?? 7}
                            onChange={(e) =>
                              setScores((prev) => ({
                                ...prev,
                                [dim.key]: Math.max(0, Math.min(10, Number(e.target.value) || 0)),
                              }))
                            }
                            className="h-7 w-14 text-center text-xs"
                          />
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3 pt-2 border-t border-border/60">
                    <div className="flex flex-wrap gap-2">
                      {(["under_review", "shortlisted", "selected", "declined"] as const).map(
                        (st) => (
                          <Button
                            key={st}
                            type="button"
                            size="sm"
                            variant={decisionStatus === st ? "default" : "outline"}
                            onClick={() => setDecisionStatus(st)}
                            className="rounded-full text-xs capitalize"
                          >
                            {st.replace("_", " ")}
                          </Button>
                        ),
                      )}
                    </div>
                    <div>
                      <Label className="text-xs">
                        Documented Human Editorial Reason (required, min 8 chars)
                      </Label>
                      <Textarea
                        rows={2}
                        value={selectionReason}
                        onChange={(e) => setSelectionReason(e.target.value)}
                        placeholder="State the merit basis for this human editorial decision…"
                        className="mt-1 rounded-xl text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Private Internal Notes</Label>
                      <Input
                        value={internalNotes}
                        onChange={(e) => setInternalNotes(e.target.value)}
                        className="mt-1 rounded-xl text-xs"
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="hero"
                        size="sm"
                        disabled={decideMutation.isPending || selectionReason.trim().length < 8}
                        onClick={() => decideMutation.mutate()}
                        className="rounded-full font-bold"
                      >
                        {decideMutation.isPending
                          ? "Recording Decision…"
                          : "Confirm Human Editorial Decision"}
                      </Button>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* TAB 2: OFFICIAL STORY COMPOSER, LAYOUTS, DISTRIBUTION, SCHEDULING, CORRECTION & RETRACTION */}
      {tab === "publish" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            publishMutation.mutate();
          }}
          className="surface-card rounded-3xl p-6 border border-border/70 space-y-4"
        >
          <h2 className="font-display text-lg font-extrabold">
            Official Ping Spotlight Story Composer
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Story URL Slug</Label>
              <Input
                required
                value={pubSlug}
                onChange={(e) => setPubSlug(e.target.value)}
                placeholder="kora-solar-lagos-2026"
                className="mt-1 rounded-xl text-xs font-mono"
              />
            </div>
            <div>
              <Label className="text-xs">Editorial Template Layout</Label>
              <select
                value={pubLayout}
                onChange={(e) => setPubLayout(e.target.value as SpotlightTemplateLayout)}
                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs"
              >
                <option value="editorial_feature">Editorial Feature (Standard)</option>
                <option value="video_interview">Video Interview Showcase</option>
                <option value="builder_case_study">Builder Execution Case Study</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Founder User ID (UUID)</Label>
              <Input
                required
                value={pubFounderId}
                onChange={(e) => setPubFounderId(e.target.value)}
                className="mt-1 rounded-xl text-xs font-mono"
              />
            </div>
            <div>
              <Label className="text-xs">Business Profile ID (Optional UUID)</Label>
              <Input
                value={pubBusinessId}
                onChange={(e) => setPubBusinessId(e.target.value)}
                className="mt-1 rounded-xl text-xs font-mono"
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Feature Headline</Label>
              <Input
                required
                value={pubTitle}
                onChange={(e) => setPubTitle(e.target.value)}
                className="mt-1 rounded-xl text-xs"
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Editorial Introduction</Label>
              <Textarea
                rows={2}
                value={pubIntro}
                onChange={(e) => setPubIntro(e.target.value)}
                className="mt-1 rounded-xl text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">Problem Solved</Label>
              <Textarea
                rows={2}
                value={pubProblem}
                onChange={(e) => setPubProblem(e.target.value)}
                className="mt-1 rounded-xl text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">Product / Solution</Label>
              <Textarea
                rows={2}
                value={pubSolution}
                onChange={(e) => setPubSolution(e.target.value)}
                className="mt-1 rounded-xl text-xs"
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Founder Story (min 20 chars)</Label>
              <Textarea
                required
                minLength={20}
                rows={5}
                value={pubStory}
                onChange={(e) => setPubStory(e.target.value)}
                className="mt-1 rounded-xl text-xs"
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Business Description</Label>
              <Textarea
                rows={2}
                value={pubBizDesc}
                onChange={(e) => setPubBizDesc(e.target.value)}
                className="mt-1 rounded-xl text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">Evidence &amp; Achievements (one per line)</Label>
              <Textarea
                rows={3}
                value={pubAchievements}
                onChange={(e) => setPubAchievements(e.target.value)}
                className="mt-1 rounded-xl text-xs"
              />
            </div>
            <div className="space-y-2.5">
              <div>
                <Label className="text-xs">Featured Ping IDs (comma-separated UUIDs)</Label>
                <Input
                  value={pubPingIds}
                  onChange={(e) => setPubPingIds(e.target.value)}
                  className="mt-1 rounded-xl text-xs font-mono"
                />
              </div>
              <div>
                <Label className="text-xs">Featured Clip IDs (comma-separated UUIDs)</Label>
                <Input
                  value={pubClipIds}
                  onChange={(e) => setPubClipIds(e.target.value)}
                  className="mt-1 rounded-xl text-xs font-mono"
                />
              </div>
              <div>
                <Label className="text-xs">DOT Tags (comma-separated)</Label>
                <Input
                  value={pubTags}
                  onChange={(e) => setPubTags(e.target.value)}
                  className="mt-1 rounded-xl text-xs"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Founder Portrait URL (optional)</Label>
              <Input
                type="url"
                value={pubPortraitUrl}
                onChange={(e) => setPubPortraitUrl(e.target.value)}
                placeholder="https://…"
                className="mt-1 rounded-xl text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">Video Interview URL (optional)</Label>
              <Input
                type="url"
                value={pubVideoUrl}
                onChange={(e) => setPubVideoUrl(e.target.value)}
                placeholder="https://…"
                className="mt-1 rounded-xl text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">Publication Status</Label>
              <select
                value={pubStatus}
                onChange={(e) =>
                  setPubStatus(
                    e.target.value as
                      "draft" | "scheduled" | "published" | "corrected" | "retracted",
                  )
                }
                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs"
              >
                <option value="draft">Draft</option>
                <option value="scheduled">Schedule Publication</option>
                <option value="published">Publish Official Story</option>
                <option value="corrected">Publish with Correction Notice</option>
                <option value="retracted">Retract Story</option>
              </select>
            </div>
            {pubStatus === "scheduled" ? (
              <div>
                <Label className="text-xs">Scheduled Publish Time</Label>
                <Input
                  type="datetime-local"
                  value={pubScheduledFor}
                  onChange={(e) => setPubScheduledFor(e.target.value)}
                  className="mt-1 rounded-xl text-xs"
                />
              </div>
            ) : (
              <div>
                <Label className="text-xs">Correction / Retraction Note (if applicable)</Label>
                <Input
                  value={pubCorrectionNote}
                  onChange={(e) => setPubCorrectionNote(e.target.value)}
                  className="mt-1 rounded-xl text-xs"
                />
              </div>
            )}
          </div>

          {/* Distribution & Frequency Cap Rules */}
          <div className="rounded-2xl border border-border/70 bg-secondary/25 p-4 space-y-2.5 text-xs">
            <p className="font-bold text-foreground">
              Distribution Rules &amp; Notification Frequency Cap
            </p>
            <div className="flex flex-wrap gap-4">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={distOfficial}
                  onChange={(e) => setDistOfficial(e.target.checked)}
                />
                Official @ping Channel
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={distHome}
                  onChange={(e) => setDistHome(e.target.checked)}
                />
                Home Feed Placement
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={distExplore}
                  onChange={(e) => setDistExplore(e.target.checked)}
                />
                Explore Discovery
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={distNotify}
                  onChange={(e) => setDistNotify(e.target.checked)}
                />
                Notify Opted-In Users (capped)
              </label>
              <label className="inline-flex items-center gap-1.5">
                Cap (days):
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={distCapDays}
                  onChange={(e) =>
                    setDistCapDays(Math.max(1, Math.min(30, Number(e.target.value) || 7)))
                  }
                  className="h-7 w-16 text-xs"
                />
              </label>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              variant="hero"
              size="sm"
              disabled={publishMutation.isPending}
              className="rounded-full font-bold"
            >
              {publishMutation.isPending ? "Saving Feature…" : "Save Official Spotlight Feature"}
            </Button>
          </div>
        </form>
      )}

      {/* TAB 3: PUBLICATIONS LIST & OBSERVED DISTRIBUTION ANALYTICS */}
      {tab === "publications" && (
        <div className="surface-card rounded-3xl p-6 border border-border/70 divide-y divide-border/60">
          {publications.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              No Spotlight publications recorded yet.
            </p>
          ) : (
            publications.map((p) => {
              const dist = p.distribution ?? [];
              const totalImp = dist.reduce((s, d) => s + (d.impressions_count ?? 0), 0);
              const totalViews = dist.reduce((s, d) => s + (d.views_count ?? 0), 0);
              const totalClicks = dist.reduce((s, d) => s + (d.clicks_count ?? 0), 0);
              const totalShares = dist.reduce((s, d) => s + (d.shares_count ?? 0), 0);
              return (
                <div key={p.id} className="py-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <Link
                      to="/spotlight/$slug"
                      params={{ slug: p.slug }}
                      className="font-display font-bold text-sm hover:underline"
                    >
                      {p.title}
                    </Link>
                    <p className="text-[11px] text-muted-foreground font-mono">
                      /spotlight/{p.slug} · {p.template_layout} · Status: {p.status}
                    </p>
                    <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5 tabular-nums">
                      <Eye className="size-3 text-primary" /> Observed: {totalImp} imp ·{" "}
                      {totalViews} views · {totalClicks} clicks · {totalShares} shares
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPubSlug(p.slug);
                      setPubFounderId(p.founder_id);
                      setPubBusinessId(p.business_id ?? "");
                      setPubTitle(p.title);
                      setPubLayout(p.template_layout ?? "editorial_feature");
                      setPubStatus(p.status === "retracted" ? "retracted" : "corrected");
                      setPubCorrectionNote(p.correction_note);
                      setTab("publish");
                    }}
                    className="rounded-full text-xs"
                  >
                    Correct / Retract
                  </Button>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB 4: EDITORIAL AUDIT LOG */}
      {tab === "audit" && (
        <div className="surface-card rounded-3xl p-6 border border-border/70 divide-y divide-border/60 text-xs">
          {auditLogs.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No editorial audit entries recorded yet.
            </p>
          ) : (
            auditLogs.map((log) => (
              <div key={log.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-bold uppercase text-primary">{log.action}</span> ·{" "}
                  <span className="text-foreground">{log.reason || log.target_type}</span>
                </div>
                <span className="text-muted-foreground tabular-nums">
                  {format(new Date(log.created_at), "MMM d, yyyy HH:mm")}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
