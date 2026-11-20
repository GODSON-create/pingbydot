import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to, className }: any) => (
      <a href={typeof to === "string" ? to : "#"} className={className}>
        {children}
      </a>
    ),
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  },
}));

import {
  AGGREGATE_LIBRARY_REFERENCE_VALUE_USD,
  BUILDER_PLUS_PRICE_NGN,
  BUILDER_PRO_PRICE_NGN,
  DEFAULT_COURSE_RELEASE_SCHEDULE,
  PING_LEARN_COURSES,
  gradeCourseAssessment,
  resolveLearnEntitlements,
  type CourseProgressRecord,
} from "@/lib/learn";
import {
  PING_OFFICIAL_ACCOUNT,
  computeSpotlightMeritScore,
  evaluateSpotlightNotificationDelivery,
  generateAdvisoryEditorialSummary,
  validateSpotlightSelectionDecision,
} from "@/lib/spotlight";
import { validateMomentToClipConversion } from "@/lib/clips";
import { AccountStatusBadges } from "@/components/badges/AccountStatusBadges";

function renderWithQuery(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/* -------------------------------------------------------------------------- */
/* 1. MIGRATION 0034 & SECURITY BOUNDARIES                                    */
/* -------------------------------------------------------------------------- */
describe("Migration 0034 — Ping Learn, Spotlight & Clips schema & RLS invariants", () => {
  const repoRoot = process.cwd();
  const journalPath = path.join(repoRoot, "drizzle", "migrations", "meta", "_journal.json");
  const migrationPath = path.join(
    repoRoot,
    "drizzle",
    "migrations",
    "0034_ping_learn_spotlight_and_clips.sql",
  );

  it("registers migration 0034 sequentially with zero USING (true) policies and separated editorial permissions", () => {
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const entry34 = journal.entries.find((e) => e.idx === 34);
    expect(entry34?.tag).toBe("0034_ping_learn_spotlight_and_clips");

    const sql = fs.readFileSync(migrationPath, "utf8");
    const uncommented = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(uncommented).not.toMatch(/\bUSING\s*\(\s*true\s*\)/i);

    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.is_spotlight_editor()");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.is_financial_admin()");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.has_active_pro_membership");
    expect(sql).toContain("ALTER TABLE public.course_entitlements ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE public.spotlight_publications ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE public.ping_clips ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE public.clip_media_relationships ENABLE ROW LEVEL SECURITY");
  });
});

/* -------------------------------------------------------------------------- */
/* 2. PART A — COURSE ENTITLEMENTS (CRITERIA 1–8)                             */
/* -------------------------------------------------------------------------- */
describe("Ping Learn Entitlements — Builder Plus (₦3,000) & Builder Pro (₦30,000)", () => {
  it("Criterion 1 & 2: Builder Plus receives LEAPFROG ONLY and does NOT automatically receive all 10 courses", () => {
    expect(BUILDER_PLUS_PRICE_NGN).toBe(3000);
    expect(BUILDER_PRO_PRICE_NGN).toBe(30000);
    expect(PING_LEARN_COURSES).toHaveLength(10);
    expect(AGGREGATE_LIBRARY_REFERENCE_VALUE_USD).toBe(10000);

    const res = resolveLearnEntitlements({
      activePlan: "plus",
      progressBySlug: {},
    });

    expect(res.unlockedCount).toBe(1);
    expect(res.spotlightEligible).toBe(false);
    const leapfrog = res.entitlements.find((e) => e.courseSlug === "leapfrog")!;
    expect(leapfrog.accessStatus).toBe("active");
    expect(leapfrog.referenceValueUsd).toBe(2000);
    expect(
      res.entitlements
        .filter((e) => e.courseSlug !== "leapfrog")
        .every((e) => e.accessStatus === "locked"),
    ).toBe(true);
  });

  it("Criterion 3 & 4: Assessment prevents skipping lessons; verified Leapfrog completion unlocks periodic monthly courses", () => {
    const leapfrog = PING_LEARN_COURSES[0]!;

    // Merely opening 1 lesson without exercises fails assessment gate
    const gamedAttempt = gradeCourseAssessment({
      course: leapfrog,
      progress: {
        courseSlug: "leapfrog",
        completedLessonIds: ["leapfrog-play-1"],
        submittedExercises: {},
        milestonesCompleted: 1,
        assessmentAttempts: 0,
        assessmentScore: null,
        assessmentPassed: false,
        completedAt: null,
        certificateCode: null,
        certificateIssuedAt: null,
      },
      answers: { "lf-q1": 1, "lf-q2": 0, "lf-q3": 1 },
    });
    expect(gamedAttempt.eligibleForAssessment).toBe(false);
    expect(gamedAttempt.passed).toBe(false);

    // Completing all 7 plays + 3 required exercises passes assessment
    const validProgress: CourseProgressRecord = {
      courseSlug: "leapfrog",
      completedLessonIds: leapfrog.lessons.map((l) => l.id),
      submittedExercises: {
        "leapfrog-play-1": "Interviewed 12 Lagos clinics and verified weekly inventory loss.",
        "leapfrog-play-3": "Shipped WhatsApp + Ping intake prototype tested by 4 pilot teams.",
        "leapfrog-play-7": "Reached 8 paying customers with 92% retention at day 90.",
      },
      milestonesCompleted: 7,
      assessmentAttempts: 1,
      assessmentScore: 100,
      assessmentPassed: true,
      completedAt: "2026-01-01T00:00:00Z",
      certificateCode: "PING-CERT-LEAPFR-001",
      certificateIssuedAt: "2026-01-01T00:00:00Z",
    };

    const validGrade = gradeCourseAssessment({
      course: leapfrog,
      progress: validProgress,
      answers: { "lf-q1": 1, "lf-q2": 0, "lf-q3": 1 },
    });
    expect(validGrade.eligibleForAssessment).toBe(true);
    expect(validGrade.passed).toBe(true);

    // Day 0 after completion -> Leapfrog + 1st additional course (brand-builder)
    const day0 = resolveLearnEntitlements({
      activePlan: "plus",
      progressBySlug: { leapfrog: validProgress },
      schedule: DEFAULT_COURSE_RELEASE_SCHEDULE,
      nowMs: Date.parse("2026-01-02T00:00:00Z"),
    });
    expect(day0.unlockedCount).toBe(2);
    expect(day0.entitlements.find((e) => e.courseSlug === "brand-builder")?.accessStatus).toBe(
      "active",
    );
    expect(day0.entitlements.find((e) => e.courseSlug === "be-fundable")?.accessStatus).toBe(
      "locked",
    );

    // Day 35 after completion (1 monthly cycle elapsed) -> Leapfrog + 2 additional courses
    const day35 = resolveLearnEntitlements({
      activePlan: "plus",
      progressBySlug: { leapfrog: validProgress },
      schedule: DEFAULT_COURSE_RELEASE_SCHEDULE,
      nowMs: Date.parse("2026-02-05T00:00:00Z"),
    });
    expect(day35.unlockedCount).toBe(3);
    expect(day35.entitlements.find((e) => e.courseSlug === "be-fundable")?.accessStatus).toBe(
      "active",
    );
  });

  it("Criterion 5, 6 & 7: Builder Pro unlocks all 10 without duplicating Leapfrog; expiry preserves progress & certificates; never awards $10k cash/DOT", () => {
    const leapfrogDone: CourseProgressRecord = {
      courseSlug: "leapfrog",
      completedLessonIds: PING_LEARN_COURSES[0]!.lessons.map((l) => l.id),
      submittedExercises: {
        "leapfrog-play-1": "Verified customer demand across 15 interviews.",
        "leapfrog-play-3": "Launched live pilot workflow.",
        "leapfrog-play-7": "Documented 90-day paying cohort.",
      },
      milestonesCompleted: 7,
      assessmentAttempts: 1,
      assessmentScore: 95,
      assessmentPassed: true,
      completedAt: "2026-01-15T00:00:00Z",
      certificateCode: "PING-CERT-LEAPFR-777",
      certificateIssuedAt: "2026-01-15T00:00:00Z",
    };

    // Upgrade Plus -> Pro
    const upgraded = resolveLearnEntitlements({
      activePlan: "pro",
      progressBySlug: { leapfrog: leapfrogDone },
      previousEntitlements: {
        leapfrog: { grantSource: "builder_plus_entry", releasedGrantDot: 100 },
      },
    });
    expect(upgraded.entitlements).toHaveLength(10); // zero duplicate enrolments!
    expect(upgraded.unlockedCount).toBe(10);
    expect(upgraded.spotlightEligible).toBe(true);
    const lfUpgraded = upgraded.entitlements.find((e) => e.courseSlug === "leapfrog")!;
    expect(lfUpgraded.grantSource).toBe("builder_plus_entry");
    expect(lfUpgraded.accessStatus).toBe("completed_retained");
    // $10,000 ref value is NEVER issued as unrestricted DOT lump sum
    expect(upgraded.financialSummary.totalReferenceValueUsd).toBe(10000);
    expect(upgraded.financialSummary.releasedGrantDotTotal).toBe(100);

    // Subscription expiry preserves Leapfrog certificate & pauses incomplete courses
    const expired = resolveLearnEntitlements({
      activePlan: "pro",
      subscriptionExpired: true,
      progressBySlug: { leapfrog: leapfrogDone },
      previousEntitlements: {
        leapfrog: { grantSource: "builder_plus_entry", releasedGrantDot: 100 },
        "brand-builder": { grantSource: "builder_pro_full_library", releasedGrantDot: 0 },
      },
    });
    expect(expired.entitlements.find((e) => e.courseSlug === "leapfrog")?.accessStatus).toBe(
      "completed_retained",
    );
    expect(expired.entitlements.find((e) => e.courseSlug === "brand-builder")?.accessStatus).toBe(
      "paused_expired",
    );
    expect(expired.spotlightEligible).toBe(false);
  });

  it("Criterion 8: Renders distinct visual states for Builder Plus, Builder Pro, Identity Verification, Business Verification, Course Completion & Spotlight", () => {
    renderWithQuery(
      <div>
        <AccountStatusBadges membershipTier="plus" />
        <AccountStatusBadges
          membershipTier="pro"
          verificationBadges={{
            identity_verified: true,
            professional_verified: false,
            professional_pathway: null,
          }}
          completedCoursesCount={2}
          isSpotlightHonoree
        />
        <AccountStatusBadges businessVerified businessName="Kora Solar" />
      </div>,
    );

    expect(screen.getByTestId("badge-builder-plus")).toBeTruthy();
    expect(screen.getByTestId("badge-builder-pro")).toBeTruthy();
    expect(screen.getByTestId("badge-course-completion")).toBeTruthy();
    expect(screen.getByTestId("badge-spotlight-honoree")).toBeTruthy();
    expect(screen.getAllByTestId("verification-badge-trigger").length).toBeGreaterThanOrEqual(2);

    // Builder Pro alone without verificationBadges NEVER renders a verification trigger
    const { container } = renderWithQuery(
      <AccountStatusBadges
        membershipTier="pro"
        verificationBadges={{
          identity_verified: false,
          professional_verified: false,
          professional_pathway: null,
        }}
      />,
    );
    expect(container.querySelector('[data-testid="verification-badge-trigger"]')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 3. PART B — PING SPOTLIGHT (CRITERIA 9–17)                                 */
/* -------------------------------------------------------------------------- */
describe("Ping Spotlight — Pro Eligibility, Merit Scoring, Human Approval & Notification Caps", () => {
  it("Criteria 9–13: Blocks non-Pro and AI-only decisions; requires human editor approval + documented merit score", () => {
    // Non-Pro candidate rejected
    expect(
      validateSpotlightSelectionDecision({
        candidateHasActivePro: false,
        actorIsSpotlightEditor: true,
        actorIsAiOnly: false,
        decision: "selected",
        reason: "Strong solar microgrid execution in Ogun State.",
      }).allowed,
    ).toBe(false);

    // AI-only automatic selection strictly forbidden
    expect(
      validateSpotlightSelectionDecision({
        candidateHasActivePro: true,
        actorIsSpotlightEditor: true,
        actorIsAiOnly: true,
        decision: "selected",
        reason: "AI score exceeded 90.",
      }).allowed,
    ).toBe(false);

    // Non-editor blocked
    expect(
      validateSpotlightSelectionDecision({
        candidateHasActivePro: true,
        actorIsSpotlightEditor: false,
        actorIsAiOnly: false,
        decision: "selected",
        reason: "Attempting unauthorized approval.",
      }).allowed,
    ).toBe(false);

    // Valid human editor approval on active Pro founder
    expect(
      validateSpotlightSelectionDecision({
        candidateHasActivePro: true,
        actorIsSpotlightEditor: true,
        actorIsAiOnly: false,
        decision: "selected",
        reason: "Verified 400 smallholder cold-chain installations with strong retention.",
      }).allowed,
    ).toBe(true);

    // Weighted 8-dimension merit rubric calculation
    const merit = computeSpotlightMeritScore({
      story_authenticity: 9,
      execution_evidence: 10,
      innovation_originality: 8,
      business_traction: 9,
      problem_relevance: 10,
      economic_social_impact: 9,
      growth_potential: 8,
      documentation_quality: 8,
    });
    expect(merit).toBeGreaterThanOrEqual(85);
    expect(merit).toBeLessThanOrEqual(100);

    // Advisory summary explicitly labeled non-decisional
    const brief = generateAdvisoryEditorialSummary({
      headline: "Cold-chain solar logistics",
      problem_statement: "Post-harvest crop spoilage",
      traction_evidence: "400 farms served",
      evidence_urls: ["https://kora.example"],
    });
    expect(brief).toMatch(/Non-Decisional/i);
    expect(PING_OFFICIAL_ACCOUNT.handle).toBe("ping");
  });

  it("Criterion 17: Respects user notification opt-out and per-user frequency caps", () => {
    expect(
      evaluateSpotlightNotificationDelivery({
        preferences: { spotlight: false },
      }).send,
    ).toBe(false);

    const nowMs = Date.parse("2026-06-10T12:00:00Z");
    // Sent 2 days ago with 7-day cap -> blocked
    expect(
      evaluateSpotlightNotificationDelivery({
        preferences: { spotlight: true },
        lastSpotlightNotificationAt: "2026-06-08T12:00:00Z",
        frequencyCapDays: 7,
        nowMs,
      }).send,
    ).toBe(false);

    // Sent 10 days ago with 7-day cap -> allowed
    expect(
      evaluateSpotlightNotificationDelivery({
        preferences: { spotlight: true },
        lastSpotlightNotificationAt: "2026-05-31T12:00:00Z",
        frequencyCapDays: 7,
        nowMs,
      }).send,
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. PART C — PING CLIPS & MOMENTS-TO-CLIPS (CRITERIA 18–23)                 */
/* -------------------------------------------------------------------------- */
describe("Ping Clips — Moments-to-Clips Attribution & Privacy Permissions", () => {
  it("Criteria 19, 20 & 23: Enforces creator ownership, video media type, and Close Circle privacy boundaries", () => {
    const publicVideoMoment = {
      id: "mom-1",
      author_id: "creator-a",
      media_type: "video" as const,
      audience: "public" as const,
      media_url: "https://cdn.ping.africa/demo.mp4",
    };

    // Original creator republishing public video Moment -> eligible
    expect(
      validateMomentToClipConversion({
        moment: publicVideoMoment,
        callerUserId: "creator-a",
        targetVisibility: "public",
      }).eligible,
    ).toBe(true);

    // Different user trying to republish someone else's Moment -> blocked
    expect(
      validateMomentToClipConversion({
        moment: publicVideoMoment,
        callerUserId: "other-user-b",
        targetVisibility: "public",
      }).eligible,
    ).toBe(false);

    // Image Moment cannot be converted to video Clip
    expect(
      validateMomentToClipConversion({
        moment: { ...publicVideoMoment, media_type: "image" },
        callerUserId: "creator-a",
        targetVisibility: "public",
      }).eligible,
    ).toBe(false);

    // Close Circle Moment blocked from public republication
    expect(
      validateMomentToClipConversion({
        moment: { ...publicVideoMoment, audience: "close_circle" },
        callerUserId: "creator-a",
        targetVisibility: "public",
      }).eligible,
    ).toBe(false);
  });
});
