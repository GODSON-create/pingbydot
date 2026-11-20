import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Award,
  BookOpen,
  CheckCircle2,
  Clock,
  Crown,
  Flame,
  GraduationCap,
  Info,
  Lock,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { dotSummaryQuery, type AccountTier } from "@/lib/economy";
import {
  isEntitlementActive,
  mySubscriptionEntitlementQuery,
  type MembershipSlug,
} from "@/lib/memberships";
import {
  AGGREGATE_LIBRARY_REFERENCE_VALUE_USD,
  BUILDER_PLUS_PRICE_NGN,
  BUILDER_PRO_PRICE_NGN,
  PING_LEARN_COURSES,
  courseReleaseScheduleQuery,
  gradeCourseAssessment,
  myCourseEntitlementsQuery,
  myLearnProgressQuery,
  resolveLearnEntitlements,
  useRecordLessonProgress,
  useSubmitCourseAssessment,
  type LearnCourse,
} from "@/lib/learn";
import { AccountStatusBadges } from "@/components/badges/AccountStatusBadges";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/learn")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Ping Learn — Curriculum & Certificates — Ping by DOT" },
      {
        name: "description",
        content:
          "Develop real execution skills through LEAPFROG and the complete 10-course Ping Learn founder library.",
      },
    ],
  }),
  component: PingLearnPage,
});

function tierToPlanSlug(tier?: AccountTier): MembershipSlug {
  if (tier === "institution") return "business";
  return tier ?? "free";
}

function PingLearnPage() {
  const { user } = useAuth();
  const { data: dotSummary } = useQuery(dotSummaryQuery(user?.id));
  const { data: subEnt } = useQuery(mySubscriptionEntitlementQuery(user?.id));
  const { data: scheduleState } = useQuery(courseReleaseScheduleQuery());
  const { data: progressState } = useQuery(myLearnProgressQuery(user?.id));
  const { data: persistedEntState } = useQuery(myCourseEntitlementsQuery(user?.id));

  const recordLesson = useRecordLessonProgress(user?.id);
  const submitAssessment = useSubmitCourseAssessment(user?.id);

  const [selectedCourse, setSelectedCourse] = useState<LearnCourse | null>(null);
  const [exerciseDrafts, setExerciseDrafts] = useState<Record<string, string>>({});
  const [assessmentAnswers, setAssessmentAnswers] = useState<Record<string, number>>({});
  const [showAssessment, setShowAssessment] = useState(false);

  const activePlan: MembershipSlug = isEntitlementActive(subEnt)
    ? subEnt!.plan_slug
    : tierToPlanSlug(dotSummary?.subscription.tier);

  const subscriptionExpired = Boolean(
    subEnt &&
    (subEnt.status === "expired" ||
      (subEnt.expires_at && new Date(subEnt.expires_at).getTime() <= Date.now())),
  );

  const progressBySlug = useMemo(
    () => progressState?.progressBySlug ?? {},
    [progressState?.progressBySlug],
  );
  const schedule = scheduleState?.schedule;

  const resolved = useMemo(
    () =>
      resolveLearnEntitlements({
        activePlan,
        subscriptionExpired,
        subscriptionExpiresAt: subEnt?.expires_at ?? dotSummary?.subscription.expires_at ?? null,
        progressBySlug,
        previousEntitlements: persistedEntState?.entitlementsBySlug,
        schedule,
      }),
    [
      activePlan,
      subscriptionExpired,
      subEnt?.expires_at,
      dotSummary?.subscription.expires_at,
      progressBySlug,
      persistedEntState?.entitlementsBySlug,
      schedule,
    ],
  );

  const entitlementBySlug = useMemo(
    () => new Map(resolved.entitlements.map((e) => [e.courseSlug, e])),
    [resolved.entitlements],
  );

  const earnedCertificates = useMemo(
    () =>
      PING_LEARN_COURSES.map((course) => ({
        course,
        progress: progressBySlug[course.slug],
      })).filter((row) => Boolean(row.progress?.assessmentPassed && row.progress?.certificateCode)),
    [progressBySlug],
  );

  const openCourseWorkspace = (course: LearnCourse) => {
    const ent = entitlementBySlug.get(course.slug);
    if (!ent || (ent.accessStatus !== "active" && ent.accessStatus !== "completed_retained")) {
      toast.info(ent?.lockReason || "Upgrade your membership to unlock this course.");
      return;
    }
    setSelectedCourse(course);
    setShowAssessment(false);
    setAssessmentAnswers({});
    setExerciseDrafts(progressBySlug[course.slug]?.submittedExercises ?? {});
  };

  const handleCompleteLesson = async (
    course: LearnCourse,
    lessonId: string,
    hasExercise: boolean,
  ) => {
    const draft = (exerciseDrafts[lessonId] ?? "").trim();
    if (hasExercise && draft.length < 15) {
      toast.error("Please submit a practical exercise response (at least 15 characters).");
      return;
    }
    try {
      await recordLesson.mutateAsync({
        courseSlug: course.slug,
        lessonId,
        exerciseSubmission: hasExercise ? draft : undefined,
      });
      toast.success(hasExercise ? "Lesson & practical exercise saved" : "Lesson marked completed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save lesson progress.");
    }
  };

  const handleSubmitAssessment = async (course: LearnCourse) => {
    const grade = gradeCourseAssessment({
      course,
      progress: progressBySlug[course.slug],
      answers: assessmentAnswers,
    });
    if (!grade.eligibleForAssessment) {
      toast.error(grade.missingRequirements.join(" · "));
      return;
    }
    try {
      const res = await submitAssessment.mutateAsync({ course, score: grade.score });
      if (res.passed) {
        toast.success(
          `Congratulations! Passed (${grade.score}%) — Permanent certificate ${res.certificateCode ?? ""} issued${
            res.grantDotReleased > 0 ? ` (+${res.grantDotReleased} DOT milestone grant)` : ""
          }.`,
        );
        setShowAssessment(false);
      } else {
        toast.error(
          `Score ${grade.score}% — minimum passing score is ${course.minAssessmentScore}%. Review lessons and retry.`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Assessment submission failed.");
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 pb-24 space-y-8">
      {/* Header & Active Entitlement Summary */}
      <header className="surface-card rounded-3xl p-6 sm:p-8 border border-border/70 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-bold text-primary">
                <GraduationCap className="size-3.5" /> Ping Learn
              </span>
              <AccountStatusBadges
                membershipTier={activePlan === "business" ? "business" : activePlan}
                userId={user?.id}
                completedCoursesCount={resolved.completedCount}
                compact
              />
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight">
              Learner Dashboard &amp; Founder Curriculum
            </h1>
            <p className="text-sm text-muted-foreground">
              Membership determines access. Merit determines recognition. Execution determines
              achievement.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm" className="rounded-full gap-1.5">
              <Link to="/spotlight">
                <Flame className="size-3.5 text-amber-500" /> Ping Spotlight
              </Link>
            </Button>
            <Button asChild variant="hero" size="sm" className="rounded-full gap-1.5">
              <Link to="/upgrades">
                <Crown className="size-3.5" />
                {activePlan === "pro" ? "Manage Builder Pro" : "Upgrade Plan"}
              </Link>
            </Button>
          </div>
        </div>

        {/* Plan Entitlement Strip (Builder Plus ₦3,000 vs Builder Pro ₦30,000) */}
        <div className="grid gap-3 md:grid-cols-3 pt-4 border-t border-border/60 text-xs">
          <div className="rounded-2xl border border-border/70 bg-secondary/35 p-4 space-y-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Active Learning Entitlement
            </p>
            <p className="font-display text-lg font-extrabold text-foreground capitalize">
              {activePlan === "pro"
                ? `Builder Pro (₦${BUILDER_PRO_PRICE_NGN.toLocaleString()})`
                : activePlan === "plus"
                  ? `Builder Plus (₦${BUILDER_PLUS_PRICE_NGN.toLocaleString()})`
                  : "Free Member"}
            </p>
            <p className="text-muted-foreground leading-relaxed">
              {activePlan === "pro"
                ? "Complete 10-course library unlocked immediately + Ping Spotlight consideration eligibility."
                : activePlan === "plus"
                  ? "LEAPFROG entry unlocked. Complete Leapfrog's lessons, exercises & assessment to unlock 1 additional course every 30 days."
                  : "Upgrade to Builder Plus (₦3,000) for Leapfrog or Builder Pro (₦30,000) for all 10 courses."}
            </p>
          </div>

          <div className="rounded-2xl border border-border/70 bg-secondary/35 p-4 space-y-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Curriculum Progress
            </p>
            <p className="font-display text-lg font-extrabold text-foreground tabular-nums">
              {resolved.unlockedCount} / {PING_LEARN_COURSES.length} Unlocked ·{" "}
              {resolved.completedCount} Certified
            </p>
            <p className="text-muted-foreground leading-relaxed">
              Completed lessons, practical submissions, milestones, and earned certificates are
              retained permanently — even if your subscription expires or downgrades.
            </p>
          </div>

          <div className="rounded-2xl border border-border/70 bg-secondary/35 p-4 space-y-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Ping Spotlight Eligibility
            </p>
            <p className="font-display text-lg font-extrabold text-foreground">
              {resolved.spotlightEligible ? "Eligible for Consideration" : "Builder Pro Required"}
            </p>
            <p className="text-muted-foreground leading-relaxed">
              {resolved.spotlightEligible
                ? "Active Builder Pro qualifies you for editorial review (merit selection is never guaranteed or sold)."
                : "Upgrade to Builder Pro to enter merit-based editorial consideration for Ping Spotlight."}
            </p>
          </div>
        </div>
      </header>

      {/* Financial & Educational Grant Controls Transparency Card (Section 6) */}
      <section
        aria-labelledby="learn-financial-controls-heading"
        className="surface-card rounded-3xl p-5 sm:p-6 border border-border/70 space-y-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2
              id="learn-financial-controls-heading"
              className="font-display text-base font-bold flex items-center gap-2"
            >
              <Info className="size-4 text-primary" /> Course Reference Value &amp; Educational
              Grant Controls
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Published course reference values ($2,000 Leapfrog / $
              {AGGREGATE_LIBRARY_REFERENCE_VALUE_USD.toLocaleString()} aggregate 10-course library)
              are NOT unrestricted cash or DOT awards. Milestone grant credits release strictly upon
              verified completion via DOT&apos;s authoritative ledger.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
          <div className="rounded-2xl bg-secondary/40 p-3">
            <span className="text-[10px] text-muted-foreground block">Library Ref Value</span>
            <strong className="font-display text-sm tabular-nums">
              ${resolved.financialSummary.totalReferenceValueUsd.toLocaleString()}
            </strong>
          </div>
          <div className="rounded-2xl bg-secondary/40 p-3">
            <span className="text-[10px] text-muted-foreground block">Entitled Ref Value</span>
            <strong className="font-display text-sm tabular-nums text-primary">
              ${resolved.financialSummary.entitledReferenceValueUsd.toLocaleString()}
            </strong>
          </div>
          <div className="rounded-2xl bg-secondary/40 p-3">
            <span className="text-[10px] text-muted-foreground block">Approved Grant</span>
            <strong className="font-display text-sm tabular-nums">
              {resolved.financialSummary.approvedGrantDotTotal} DOT
            </strong>
          </div>
          <div className="rounded-2xl bg-secondary/40 p-3">
            <span className="text-[10px] text-muted-foreground block">Released Credits</span>
            <strong className="font-display text-sm tabular-nums text-emerald-500">
              {resolved.financialSummary.releasedGrantDotTotal} DOT
            </strong>
          </div>
          <div className="rounded-2xl bg-secondary/40 p-3">
            <span className="text-[10px] text-muted-foreground block">Redeemed Credits</span>
            <strong className="font-display text-sm tabular-nums">
              {resolved.financialSummary.redeemedGrantDotTotal} DOT
            </strong>
          </div>
          <div className="rounded-2xl bg-secondary/40 p-3">
            <span className="text-[10px] text-muted-foreground block">Est. Delivery Cost</span>
            <strong className="font-display text-sm tabular-nums">
              ${resolved.financialSummary.estimatedDeliveryCostUsd}
            </strong>
          </div>
        </div>
      </section>

      {/* Ten-Course Catalogue */}
      <section aria-labelledby="learn-courses-heading" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2
              id="learn-courses-heading"
              className="font-display text-2xl font-extrabold tracking-tight"
            >
              10-Course Founder Curriculum
            </h2>
            <p className="text-xs text-muted-foreground">
              Builder Plus starts with LEAPFROG only, unlocking 1 additional course per{" "}
              {schedule?.releaseIntervalDays ?? 30}-day cycle after assessment completion. Builder
              Pro unlocks all 10 immediately.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {PING_LEARN_COURSES.map((course) => {
            const ent = entitlementBySlug.get(course.slug);
            const prog = progressBySlug[course.slug];
            const status = ent?.accessStatus ?? "locked";
            const completedLessonsCount = prog?.completedLessonIds.length ?? 0;
            const pct = Math.round((completedLessonsCount / course.lessons.length) * 100);
            const isOpenable = status === "active" || status === "completed_retained";

            return (
              <article
                key={course.slug}
                data-testid={`learn-course-${course.slug}`}
                className={cn(
                  "surface-card rounded-3xl p-5 border flex flex-col justify-between gap-4 transition-all",
                  course.isEntryCourse && "border-primary/45 ring-1 ring-primary/15",
                  status === "completed_retained" && "border-emerald-500/45",
                  status === "locked" && "opacity-90",
                )}
              >
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
                      <BookOpen className="size-3.5 text-primary" /> Course {course.sortOrder} of 10
                      {course.isEntryCourse && (
                        <span className="rounded-full bg-primary/15 text-primary px-2 py-0.5 text-[10px]">
                          Builder Plus Entry
                        </span>
                      )}
                    </span>

                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                        status === "completed_retained"
                          ? "bg-emerald-500/15 text-emerald-500 border border-emerald-500/30"
                          : status === "active"
                            ? "bg-primary/15 text-primary border border-primary/30"
                            : status === "paused_expired"
                              ? "bg-amber-500/15 text-amber-500 border border-amber-500/30"
                              : "bg-secondary text-muted-foreground",
                      )}
                    >
                      {status === "completed_retained" ? (
                        <>
                          <Award className="size-3" /> Certified · Retained
                        </>
                      ) : status === "active" ? (
                        <>
                          <Sparkles className="size-3" /> Unlocked
                        </>
                      ) : status === "paused_expired" ? (
                        <>
                          <Clock className="size-3" /> Paused · Renew
                        </>
                      ) : (
                        <>
                          <Lock className="size-3" /> Locked
                        </>
                      )}
                    </span>
                  </div>

                  <div>
                    <h3 className="font-display text-lg font-extrabold text-foreground">
                      {course.title}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                      {course.subtitle}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                    <span>Ref Value: ${course.referenceValueUsd.toLocaleString()}</span>
                    <span>·</span>
                    <span>{course.lessons.length} Lessons</span>
                    <span>·</span>
                    <span>Pass ≥ {course.minAssessmentScore}%</span>
                    <span>·</span>
                    <span>Grant: {course.approvedGrantAllocationDot} DOT</span>
                  </div>

                  {/* Progress bar if started or completed */}
                  {(completedLessonsCount > 0 || prog?.assessmentPassed) && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">
                          {completedLessonsCount}/{course.lessons.length} lessons completed
                        </span>
                        <span className="font-bold tabular-nums">{pct}%</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {ent?.lockReason && (
                    <p className="rounded-xl border border-border/60 bg-secondary/35 px-3 py-2 text-[11px] text-muted-foreground leading-relaxed">
                      {ent.lockReason}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 pt-3 border-t border-border/60">
                  {isOpenable ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={status === "completed_retained" ? "outline" : "hero"}
                      onClick={() => openCourseWorkspace(course)}
                      className="rounded-full text-xs font-bold"
                    >
                      {status === "completed_retained"
                        ? "Review Course & Certificate"
                        : completedLessonsCount > 0
                          ? "Continue Learning"
                          : "Start Course"}
                    </Button>
                  ) : (
                    <Button asChild size="sm" variant="outline" className="rounded-full text-xs">
                      <Link to="/upgrades">
                        {course.isEntryCourse
                          ? "Unlock with Builder Plus"
                          : "Unlock with Builder Pro"}
                      </Link>
                    </Button>
                  )}

                  {prog?.certificateCode && (
                    <span className="font-mono text-[10px] text-emerald-500">
                      {prog.certificateCode}
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Permanent Certificates & Learning History */}
      <section
        aria-labelledby="learn-certificates-heading"
        className="surface-card rounded-3xl p-6 border border-border/70 space-y-4"
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2
              id="learn-certificates-heading"
              className="font-display text-lg font-extrabold flex items-center gap-2"
            >
              <Award className="size-4 text-emerald-500" /> Permanent Certificates &amp; Learning
              History
            </h2>
            <p className="text-xs text-muted-foreground">
              Earned certificates and completed submissions remain permanently in your record even
              after subscription changes.
            </p>
          </div>
          <span className="text-xs font-bold tabular-nums">{earnedCertificates.length} earned</span>
        </div>

        {earnedCertificates.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border/75 bg-secondary/20 px-4 py-6 text-center text-xs text-muted-foreground">
            No certificates earned yet. Complete all lessons, practical exercises, and the verified
            assessment in LEAPFROG to earn your first permanent certificate.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {earnedCertificates.map(({ course, progress }) => (
              <div
                key={course.slug}
                className="rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-4 flex items-start justify-between gap-3"
              >
                <div>
                  <p className="font-display text-sm font-bold text-foreground">{course.title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Score: {progress?.assessmentScore}% · Issued{" "}
                    {progress?.certificateIssuedAt
                      ? format(new Date(progress.certificateIssuedAt), "MMM d, yyyy")
                      : "Verified"}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-emerald-600 dark:text-emerald-300">
                    {progress?.certificateCode}
                  </p>
                </div>
                <CheckCircle2 className="size-5 text-emerald-500 shrink-0" />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Interactive Course Workspace & Assessment Dialog */}
      <Dialog open={Boolean(selectedCourse)} onOpenChange={(o) => !o && setSelectedCourse(null)}>
        <DialogContent className="sm:max-w-2xl rounded-3xl p-6 max-h-[88dvh] overflow-y-auto">
          {selectedCourse &&
            (() => {
              const prog = progressBySlug[selectedCourse.slug];
              const completedSet = new Set(prog?.completedLessonIds ?? []);
              const exerciseMap = prog?.submittedExercises ?? {};
              const reqCheck = gradeCourseAssessment({
                course: selectedCourse,
                progress: prog,
                answers: assessmentAnswers,
              });

              return (
                <>
                  <DialogHeader>
                    <DialogTitle className="font-display text-xl">
                      {selectedCourse.title}
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                      {selectedCourse.description}
                    </DialogDescription>
                  </DialogHeader>

                  <div className="flex items-center gap-2 mt-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={!showAssessment ? "default" : "outline"}
                      onClick={() => setShowAssessment(false)}
                      className="rounded-full text-xs"
                    >
                      Curriculum ({completedSet.size}/{selectedCourse.lessons.length})
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={showAssessment ? "default" : "outline"}
                      onClick={() => setShowAssessment(true)}
                      className="rounded-full text-xs"
                    >
                      Completion Assessment
                    </Button>
                  </div>

                  {!showAssessment ? (
                    <div className="mt-4 space-y-3">
                      {selectedCourse.lessons.map((lesson) => {
                        const done = completedSet.has(lesson.id);
                        const savedEx = exerciseMap[lesson.id];
                        return (
                          <div
                            key={lesson.id}
                            className="rounded-2xl border border-border/70 bg-secondary/30 p-4 space-y-2.5"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-xs font-bold text-foreground">{lesson.title}</p>
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                  {lesson.summary} · {lesson.estimatedMinutes} min
                                </p>
                              </div>
                              {done && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-500 shrink-0">
                                  <CheckCircle2 className="size-3" /> Done
                                </span>
                              )}
                            </div>

                            {lesson.hasExercise && (
                              <div className="space-y-1.5 pt-1">
                                <Label className="text-[11px] font-semibold text-primary">
                                  Practical Exercise: {lesson.exercisePrompt}
                                </Label>
                                <Textarea
                                  rows={2}
                                  value={exerciseDrafts[lesson.id] ?? savedEx ?? ""}
                                  onChange={(e) =>
                                    setExerciseDrafts((prev) => ({
                                      ...prev,
                                      [lesson.id]: e.target.value,
                                    }))
                                  }
                                  placeholder="Write your concrete execution output (minimum 15 characters)…"
                                  className="rounded-xl text-xs bg-card"
                                />
                              </div>
                            )}

                            <div className="flex justify-end">
                              <Button
                                type="button"
                                size="sm"
                                variant={done ? "outline" : "hero"}
                                disabled={recordLesson.isPending}
                                onClick={() =>
                                  void handleCompleteLesson(
                                    selectedCourse,
                                    lesson.id,
                                    lesson.hasExercise,
                                  )
                                }
                                className="rounded-full text-xs h-8"
                              >
                                {lesson.hasExercise
                                  ? savedEx
                                    ? "Update Exercise"
                                    : "Submit Exercise & Complete"
                                  : done
                                    ? "Completed"
                                    : "Mark Lesson Complete"}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-4 space-y-4">
                      {!reqCheck.eligibleForAssessment ? (
                        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs space-y-1">
                          <p className="font-bold text-foreground">
                            Complete Curriculum Requirements First
                          </p>
                          <p className="text-muted-foreground">
                            Members cannot unlock additional courses by skipping lessons or
                            exercises:
                          </p>
                          <ul className="list-disc pl-4 text-amber-700 dark:text-amber-300">
                            {reqCheck.missingRequirements.map((m) => (
                              <li key={m}>{m}</li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <>
                          {selectedCourse.assessmentQuestions.map((q, qIdx) => (
                            <div
                              key={q.id}
                              className="rounded-2xl border border-border/70 bg-secondary/30 p-4 space-y-2"
                            >
                              <p className="text-xs font-bold">
                                {qIdx + 1}. {q.prompt}
                              </p>
                              <div className="space-y-1.5">
                                {q.options.map((opt, optIdx) => {
                                  const picked = assessmentAnswers[q.id] === optIdx;
                                  return (
                                    <button
                                      key={opt}
                                      type="button"
                                      onClick={() =>
                                        setAssessmentAnswers((prev) => ({
                                          ...prev,
                                          [q.id]: optIdx,
                                        }))
                                      }
                                      className={cn(
                                        "w-full rounded-xl border px-3 py-2 text-left text-xs transition-colors",
                                        picked
                                          ? "border-primary bg-primary/15 text-foreground font-semibold"
                                          : "border-border bg-card text-muted-foreground hover:text-foreground",
                                      )}
                                    >
                                      {opt}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                          <div className="flex justify-end">
                            <Button
                              type="button"
                              variant="hero"
                              size="sm"
                              disabled={
                                submitAssessment.isPending ||
                                Object.keys(assessmentAnswers).length <
                                  selectedCourse.assessmentQuestions.length
                              }
                              onClick={() => void handleSubmitAssessment(selectedCourse)}
                              className="rounded-full font-bold"
                            >
                              {submitAssessment.isPending
                                ? "Grading Assessment…"
                                : "Submit Verified Assessment"}
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </>
              );
            })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
