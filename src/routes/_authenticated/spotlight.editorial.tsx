import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  FileEdit,
  Flame,
  History,
  Info,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  checkSpotlightEditorAccess,
  decideSpotlightCandidate,
  getSpotlightEditorialWorkspace,
  publishSpotlightFeature,
} from "@/lib/admin.functions";
import {
  DEFAULT_SPOTLIGHT_RUBRIC,
  computeSpotlightMeritScore,
  generateAdvisoryEditorialSummary,
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
  const decideFn = useServerFn(decideSpotlightCandidate);
  const publishFn = useServerFn(publishSpotlightFeature);

  const [tab, setTab] = useState<"candidates" | "publish" | "publications" | "audit">("candidates");
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
  const [pubTitle, setPubTitle] = useState("");
  const [pubIntro, setPubIntro] = useState("");
  const [pubStory, setPubStory] = useState("");
  const [pubProblem, setPubProblem] = useState("");
  const [pubSolution, setPubSolution] = useState("");
  const [pubBizDesc, setPubBizDesc] = useState("");
  const [pubAchievements, setPubAchievements] = useState("");
  const [pubClipIds, setPubClipIds] = useState("");
  const [pubTags, setPubTags] = useState("africa, startups");
  const [pubStatus, setPubStatus] = useState<"draft" | "published" | "corrected" | "retracted">(
    "published",
  );
  const [pubCorrectionNote, setPubCorrectionNote] = useState("");

  const workspace = useQuery({
    queryKey: ["spotlight-editorial-workspace"],
    queryFn: () => workspaceFn(),
    retry: false,
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
          businessId: null,
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
          featuredPingIds: [],
          featuredClipIds: pubClipIds
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          dotTags: pubTags
            .split(",")
            .map((s) => s.trim().replace(/^\./, "").toLowerCase())
            .filter(Boolean),
          videoInterviewUrl: null,
          founderPortraitUrl: null,
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
            Merit-based candidate evaluation, human selection approval, official Ping publication,
            corrections/retractions, and editorial audit trail. Separated from financial admin.
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

      {/* TAB 1: CANDIDATE EVALUATION & HUMAN APPROVAL */}
      {tab === "candidates" && (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-2 space-y-3">
            {candidates.length === 0 ? (
              <div className="surface-card rounded-3xl p-8 text-center text-xs text-muted-foreground">
                No Spotlight candidates in queue yet. Eligible Builder Pro founders can submit
                stories or be discovered from Pings, Clips, and Hubs.
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

      {/* TAB 2: OFFICIAL STORY COMPOSER, CORRECTION & RETRACTION */}
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
              <Label className="text-xs">Founder User ID (UUID)</Label>
              <Input
                required
                value={pubFounderId}
                onChange={(e) => setPubFounderId(e.target.value)}
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
            <div className="space-y-3">
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
              <Label className="text-xs">Publication Status</Label>
              <select
                value={pubStatus}
                onChange={(e) =>
                  setPubStatus(e.target.value as "draft" | "published" | "corrected" | "retracted")
                }
                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs"
              >
                <option value="draft">Draft</option>
                <option value="published">Publish Official Story</option>
                <option value="corrected">Publish with Correction Notice</option>
                <option value="retracted">Retract Story</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Correction / Retraction Note (if applicable)</Label>
              <Input
                value={pubCorrectionNote}
                onChange={(e) => setPubCorrectionNote(e.target.value)}
                className="mt-1 rounded-xl text-xs"
              />
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

      {/* TAB 3: PUBLICATIONS LIST */}
      {tab === "publications" && (
        <div className="surface-card rounded-3xl p-6 border border-border/70 divide-y divide-border/60">
          {publications.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              No Spotlight publications recorded yet.
            </p>
          ) : (
            publications.map((p) => (
              <div key={p.id} className="py-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <Link
                    to="/spotlight/$slug"
                    params={{ slug: p.slug }}
                    className="font-display font-bold text-sm hover:underline"
                  >
                    {p.title}
                  </Link>
                  <p className="text-[11px] text-muted-foreground font-mono">
                    /spotlight/{p.slug} · Status: {p.status}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setPubSlug(p.slug);
                    setPubFounderId(p.founder_id);
                    setPubTitle(p.title);
                    setPubStatus(p.status === "retracted" ? "retracted" : "corrected");
                    setPubCorrectionNote(p.correction_note);
                    setTab("publish");
                  }}
                  className="rounded-full text-xs"
                >
                  Correct / Retract
                </Button>
              </div>
            ))
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
