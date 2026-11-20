/**
 * PING LEARN — Curriculum, Membership Entitlements, Assessment Integrity & Financial Controls
 *
 * Implements Part A of the Ping Product Addendum:
 * - Builder Plus (₦3,000 reference plan): LEAPFROG ONLY ($2,000 reference value),
 *   then periodic monthly release of additional courses ONLY after real assessment-verified
 *   Leapfrog completion (configurable by admins).
 * - Builder Pro (₦30,000 reference plan): Complete 10-course library ($10,000 aggregate
 *   reference value) + Ping Spotlight consideration eligibility. Upgrading preserves
 *   Leapfrog progress/certificates with zero duplicate enrolments or duplicate charges.
 * - Expiry & Downgrade: Recalculates active course access while permanently retaining
 *   completed lessons, exercise submissions, milestones, and earned certificates.
 * - Financial Separation: Explicitly separates reference value, membership entitlement,
 *   approved educational grant allocation, released credits, redeemed credits, and actual
 *   delivery cost. NEVER awards the $10,000 reference value as unrestricted cash or DOT.
 */

import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MembershipSlug } from "@/lib/memberships";

export type LearnAccessStatus = "active" | "paused_expired" | "completed_retained" | "locked";

export type LearnGrantSource =
  | "builder_plus_entry"
  | "builder_plus_monthly_release"
  | "builder_pro_full_library"
  | "admin_grant";

export interface LearnLesson {
  id: string;
  playNumber: number;
  title: string;
  summary: string;
  estimatedMinutes: number;
  hasExercise: boolean;
  exercisePrompt?: string | undefined;
}

export interface LearnAssessmentQuestion {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
}

export interface LearnCourse {
  slug: string;
  sortOrder: number;
  title: string;
  shortTitle: string;
  subtitle: string;
  description: string;
  isEntryCourse: boolean;
  referenceValueUsd: number;
  approvedGrantAllocationDot: number;
  deliveryCostEstimateUsd: number;
  minAssessmentScore: number;
  lessons: LearnLesson[];
  assessmentQuestions: LearnAssessmentQuestion[];
}

export interface CourseReleaseSchedule {
  requireLeapfrogCompletion: boolean;
  releaseIntervalDays: number;
  coursesPerCycle: number;
  minAssessmentScore: number;
  releaseOrder: string[];
}

export interface CourseEntitlementRecord {
  courseSlug: string;
  accessStatus: LearnAccessStatus;
  grantSource: LearnGrantSource | null;
  unlockedAt: string | null;
  expiresAt: string | null;
  nextReleaseAt: string | null;
  lockReason: string | null;
  // Financial & Grant Control Breakdown (Section 6)
  referenceValueUsd: number;
  approvedGrantDot: number;
  releasedGrantDot: number;
  redeemedGrantDot: number;
  actualDeliveryCostUsd: number;
}

export interface CourseProgressRecord {
  courseSlug: string;
  completedLessonIds: string[];
  submittedExercises: Record<string, string>;
  milestonesCompleted: number;
  assessmentAttempts: number;
  assessmentScore: number | null;
  assessmentPassed: boolean;
  completedAt: string | null;
  certificateCode: string | null;
  certificateIssuedAt: string | null;
}

export const BUILDER_PLUS_PRICE_NGN = 3_000;
export const BUILDER_PRO_PRICE_NGN = 30_000;

export const DEFAULT_COURSE_RELEASE_SCHEDULE: CourseReleaseSchedule = {
  requireLeapfrogCompletion: true,
  releaseIntervalDays: 30,
  coursesPerCycle: 1,
  minAssessmentScore: 70,
  releaseOrder: [
    "brand-builder",
    "be-fundable",
    "content-engine",
    "growth-engine",
    "ai-operator",
    "sales-playbook",
    "money-matters",
    "build-your-team",
    "scale-without-borders",
  ],
};

function makeStandardLessons(coursePrefix: string, titles: string[]): LearnLesson[] {
  return titles.map((title, i) => ({
    id: `${coursePrefix}-l${i + 1}`,
    playNumber: i + 1,
    title,
    summary: `Applied execution playbook covering ${title.toLowerCase()} with field templates and measurable founder outputs.`,
    estimatedMinutes: 18 + (i % 3) * 6,
    hasExercise: i === 0 || i === Math.floor(titles.length / 2) || i === titles.length - 1,
    ...(i === 0 || i === Math.floor(titles.length / 2) || i === titles.length - 1
      ? {
          exercisePrompt: `Document one concrete implementation step for "${title}" applied to your real business or venture (min 15 characters).`,
        }
      : {}),
  }));
}

function makeStandardAssessment(shortTitle: string): LearnAssessmentQuestion[] {
  return [
    {
      id: "q1",
      prompt: `What is the primary proof of completion in ${shortTitle}?`,
      options: [
        "Opening lesson slides quickly without taking action",
        "Documented practical execution evidence and passing the completion assessment",
        "Buying extra DOT credits",
      ],
      correctIndex: 1,
    },
    {
      id: "q2",
      prompt: `How should founders measure real progress when applying ${shortTitle}?`,
      options: [
        "Observed customer traction, validated deliverables, and honest unit metrics",
        "Fabricated impressions and vanity counts",
        "Skipping customer discovery completely",
      ],
      correctIndex: 0,
    },
    {
      id: "q3",
      prompt: `What happens to completed lessons and earned certificates if a membership expires?`,
      options: [
        "All completed work is permanently erased",
        "Historical progress, submissions, and certificates remain permanently retained",
        "Certificates are revoked immediately",
      ],
      correctIndex: 1,
    },
  ];
}

export const PING_LEARN_COURSES: readonly LearnCourse[] = [
  {
    slug: "leapfrog",
    sortOrder: 1,
    title: "LEAPFROG — Build a Successful Business in 90 Days Using AI",
    shortTitle: "Leapfrog",
    subtitle:
      "Seven strategic plays to validate, launch, and generate real traction in 90 days using AI.",
    description:
      "Included with Builder Plus (₦3,000) and Builder Pro (₦30,000). Complete all seven strategic plays, practical exercises, and the verified completion assessment to earn your permanent Leapfrog certificate and unlock periodic Builder Plus course releases.",
    isEntryCourse: true,
    referenceValueUsd: 2000,
    approvedGrantAllocationDot: 100,
    deliveryCostEstimateUsd: 45,
    minAssessmentScore: 70,
    lessons: [
      {
        id: "leapfrog-play-1",
        playNumber: 1,
        title: "Play 1: Problem Discovery & Market Selection",
        summary:
          "Identify high-urgency customer problems and size addressable demand using AI research.",
        estimatedMinutes: 25,
        hasExercise: true,
        exercisePrompt:
          "Define the exact problem you are solving, who experiences it weekly, and what evidence proves urgency.",
      },
      {
        id: "leapfrog-play-2",
        playNumber: 2,
        title: "Play 2: Offer Architecture & Value Design",
        summary:
          "Structure a clear, deliverable offer with transparent pricing and measurable outcomes.",
        estimatedMinutes: 25,
        hasExercise: false,
      },
      {
        id: "leapfrog-play-3",
        playNumber: 3,
        title: "Play 3: Rapid AI-Assisted Prototyping",
        summary: "Build a testable minimum viable product or service workflow in under 14 days.",
        estimatedMinutes: 30,
        hasExercise: true,
        exercisePrompt:
          "Describe the minimum deliverable prototype or pilot service you built and how a customer can test it.",
      },
      {
        id: "leapfrog-play-4",
        playNumber: 4,
        title: "Play 4: First 10 Customers & Proof of Willingness to Pay",
        summary:
          "Run structured customer interviews, pilot offers, and ethical closing conversations.",
        estimatedMinutes: 25,
        hasExercise: false,
      },
      {
        id: "leapfrog-play-5",
        playNumber: 5,
        title: "Play 5: Distribution Engine on Ping",
        summary:
          "Publish authentic Pings, Clips, and Hub updates that attract early adopters and partners.",
        estimatedMinutes: 20,
        hasExercise: false,
      },
      {
        id: "leapfrog-play-6",
        playNumber: 6,
        title: "Play 6: AI Operations & Delivery Automation",
        summary:
          "Systematise onboarding, fulfillment, and customer support with human-in-the-loop QA.",
        estimatedMinutes: 25,
        hasExercise: false,
      },
      {
        id: "leapfrog-play-7",
        playNumber: 7,
        title: "Play 7: 90-Day Traction Review & Scale Roadmap",
        summary:
          "Audit unit economics, retention, and documented milestones for your next 90 days.",
        estimatedMinutes: 30,
        hasExercise: true,
        exercisePrompt:
          "Summarize your 90-day traction evidence, customer feedback, and top operational bottleneck.",
      },
    ],
    assessmentQuestions: [
      {
        id: "lf-q1",
        prompt: "In Leapfrog Play 1–3, what must come before scaling marketing spend?",
        options: [
          "Purchasing paid visibility without talking to users",
          "Validating an urgent problem and testing a real deliverable with early customers",
          "Registering ten domain names",
        ],
        correctIndex: 1,
      },
      {
        id: "lf-q2",
        prompt: "How should AI workflows be deployed in Play 6 (AI Operations)?",
        options: [
          "With human supervision, clear quality checks, and documented customer value",
          "Without reviewing outputs sent to paying customers",
          "Only to inflate engagement metrics",
        ],
        correctIndex: 0,
      },
      {
        id: "lf-q3",
        prompt: "What unlocks Builder Plus periodic access to additional Ping Learn courses?",
        options: [
          "Simply opening Lesson 1 and clicking mark complete",
          "Completing all required Leapfrog plays, practical exercises, and passing the completion assessment while maintaining an active qualifying membership",
          "Sending direct messages to other learners",
        ],
        correctIndex: 1,
      },
    ],
  },
  {
    slug: "brand-builder",
    sortOrder: 2,
    title: "Brand Builder",
    shortTitle: "Brand Builder",
    subtitle: "Positioning, visual identity, narrative clarity, and brand trust architecture.",
    description:
      "Craft category positioning, voice guidelines, and proof-driven brand storytelling that differentiates your venture.",
    isEntryCourse: false,
    referenceValueUsd: 1000,
    approvedGrantAllocationDot: 60,
    deliveryCostEstimateUsd: 25,
    minAssessmentScore: 70,
    lessons: makeStandardLessons("bb", [
      "Category Positioning & Differentiation",
      "Customer Narrative & Messaging Hierarchy",
      "Visual Identity Systems",
      "Proof-Led Brand Credibility",
      "Consistent Multi-Channel Presence",
      "Brand Trust Audit",
    ]),
    assessmentQuestions: makeStandardAssessment("Brand Builder"),
  },
  {
    slug: "be-fundable",
    sortOrder: 3,
    title: "Be Fundable",
    shortTitle: "Be Fundable",
    subtitle: "Capital readiness, data rooms, governance, and credible investor storytelling.",
    description:
      "Prepare investor-grade documentation, clean cap tables, milestone narratives, and grant/equity readiness.",
    isEntryCourse: false,
    referenceValueUsd: 1000,
    approvedGrantAllocationDot: 60,
    deliveryCostEstimateUsd: 25,
    minAssessmentScore: 70,
    lessons: makeStandardLessons("bf", [
      "Capital Pathways: Grants, Debt & Equity",
      "Metrics Investors Actually Verify",
      "Data Room & Governance Hygiene",
      "Pitch Narrative Grounded in Evidence",
      "Investor Outreach & Pipeline Discipline",
      "Term Sheets & Dilution Protection",
    ]),
    assessmentQuestions: makeStandardAssessment("Be Fundable"),
  },
  {
    slug: "content-engine",
    sortOrder: 4,
    title: "Content Engine",
    shortTitle: "Content Engine",
    subtitle: "Repeatable creator & founder storytelling across Pings, Clips, and Hubs.",
    description:
      "Design a sustainable publishing cadence that turns lived building milestones into inbound trust and opportunities.",
    isEntryCourse: false,
    referenceValueUsd: 900,
    approvedGrantAllocationDot: 50,
    deliveryCostEstimateUsd: 20,
    minAssessmentScore: 70,
    lessons: makeStandardLessons("ce", [
      "Documenting Real Execution Over Hype",
      "Short-Form Video Storytelling with Ping Clips",
      "Topic & DOT Tag Discovery Architecture",
      "Editorial Repurposing Systems",
      "Audience Feedback & Community Loops",
      "Conversion Without Spam",
    ]),
    assessmentQuestions: makeStandardAssessment("Content Engine"),
  },
  {
    slug: "growth-engine",
    sortOrder: 5,
    title: "Growth Engine",
    shortTitle: "Growth Engine",
    subtitle: "Acquisition loops, retention instrumentation, referrals, and unit economics.",
    description:
      "Engineer compounding customer growth based on observed retention, referrals, and disciplined CAC/LTV.",
    isEntryCourse: false,
    referenceValueUsd: 900,
    approvedGrantAllocationDot: 50,
    deliveryCostEstimateUsd: 20,
    minAssessmentScore: 70,
    lessons: makeStandardLessons("ge", [
      "Retention Before Acquisition",
      "Activation & Time-to-Value",
      "Referral & Network Distribution Loops",
      "Channel Experimentation & Attribution",
      "Pricing & Expansion Mechanics",
      "Honest Growth Telemetry",
    ]),
    assessmentQuestions: makeStandardAssessment("Growth Engine"),
  },
  {
    slug: "ai-operator",
    sortOrder: 6,
    title: "AI Operator",
    shortTitle: "AI Operator",
    subtitle: "Operational AI workflows for research, support, QA, and internal velocity.",
    description:
      "Build durable, privacy-respecting AI workflows that multiply small team capacity safely.",
    isEntryCourse: false,
    referenceValueUsd: 900,
    approvedGrantAllocationDot: 50,
    deliveryCostEstimateUsd: 20,
    minAssessmentScore: 70,
    lessons: makeStandardLessons("aio", [
      "Workflow Auditing & Automation ROI",
      "Prompt Engineering & Structured Outputs",
      "Knowledge Bases & Retrieval Hygiene",
      "Customer Support & Triage Copilots",
      "Privacy, Consent & Human-in-the-Loop Controls",
      "Reliability Monitoring",
    ]),
    assessmentQuestions: makeStandardAssessment("AI Operator"),
  },
  {
    slug: "sales-playbook",
    sortOrder: 7,
    title: "The Sales Playbook",
    shortTitle: "The Sales Playbook",
    subtitle: "Consultative discovery, pipeline management, proposals, and closing.",
    description:
      "Build an ethical, repeatable revenue process from first outreach through signed contracts and renewals.",
    isEntryCourse: false,
    referenceValueUsd: 900,
    approvedGrantAllocationDot: 50,
    deliveryCostEstimateUsd: 20,
    minAssessmentScore: 70,
    lessons: makeStandardLessons("sp", [
      "Ideal Customer Profiling & Qualification",
      "Discovery Calls That Uncover Urgency",
      "Value-Based Proposals & Pricing Defence",
      "Handling Objections Honestly",
      "CRM Pipeline Hygiene & Follow-Up Cadence",
      "Account Expansion & Referrals",
    ]),
    assessmentQuestions: makeStandardAssessment("The Sales Playbook"),
  },
  {
    slug: "money-matters",
    sortOrder: 8,
    title: "Money Matters",
    shortTitle: "Money Matters",
    subtitle: "Cash-flow discipline, gross margins, compliance, and financial resilience.",
    description:
      "Master business financial hygiene, runway planning, invoicing discipline, and sustainable profitability.",
    isEntryCourse: false,
    referenceValueUsd: 800,
    approvedGrantAllocationDot: 40,
    deliveryCostEstimateUsd: 18,
    minAssessmentScore: 70,
    lessons: makeStandardLessons("mm", [
      "Separating Personal & Business Accounts",
      "Gross Margin & Unit Economics",
      "13-Week Cash-Flow Forecasting",
      "Tax, Compliance & Recordkeeping",
      "Working Capital & Pricing Resilience",
    ]),
    assessmentQuestions: makeStandardAssessment("Money Matters"),
  },
  {
    slug: "build-your-team",
    sortOrder: 9,
    title: "Build Your Team",
    shortTitle: "Build Your Team",
    subtitle: "Hiring scorecards, delegation, onboarding, and high-trust execution.",
    description:
      "Recruit, onboard, and lead mission-aligned collaborators while maintaining clear ownership and culture.",
    isEntryCourse: false,
    referenceValueUsd: 800,
    approvedGrantAllocationDot: 40,
    deliveryCostEstimateUsd: 18,
    minAssessmentScore: 70,
    lessons: makeStandardLessons("byt", [
      "Role Scorecards & Work-Sample Hiring",
      "30-60-90 Day Onboarding Plans",
      "Clear Delegation & Decision Ownership",
      "Operating Rhythms & Feedback Culture",
      "Retention & Sustainable Incentives",
    ]),
    assessmentQuestions: makeStandardAssessment("Build Your Team"),
  },
  {
    slug: "scale-without-borders",
    sortOrder: 10,
    title: "Scale Without Borders",
    shortTitle: "Scale Without Borders",
    subtitle: "Cross-border payments, regional distribution, localisation, and expansion.",
    description:
      "Expand responsibly across African and international markets using localised channels and compliant infrastructure.",
    isEntryCourse: false,
    referenceValueUsd: 800,
    approvedGrantAllocationDot: 40,
    deliveryCostEstimateUsd: 18,
    minAssessmentScore: 70,
    lessons: makeStandardLessons("swb", [
      "Market Entry Sequencing & Local Proof",
      "Cross-Border Payments & Multi-Currency Pricing",
      "Localisation & Regulatory Compliance",
      "Distribution Partnerships & Channel Allies",
      "Global Quality Standards from Day One",
    ]),
    assessmentQuestions: makeStandardAssessment("Scale Without Borders"),
  },
] as const;

export const AGGREGATE_LIBRARY_REFERENCE_VALUE_USD = PING_LEARN_COURSES.reduce(
  (sum, c) => sum + c.referenceValueUsd,
  0,
);

/**
 * Pure deterministic Ping Learn Entitlement Resolver (Sections 1–4 & 6).
 *
 * Guarantees:
 * - Builder Plus -> LEAPFROG ONLY by default (never auto-grants all 10 courses).
 * - Builder Plus periodic unlock -> requires `assessmentPassed === true` on Leapfrog
 *   and follows `schedule.releaseIntervalDays` & `schedule.coursesPerCycle`.
 * - Builder Pro -> immediately unlocks all 10 courses; upgrading from Builder Plus
 *   preserves existing Leapfrog progress & certificates with ZERO duplicate enrolments.
 * - Expiry / Downgrade -> retains completed courses permanently (`completed_retained`),
 *   pauses incomplete courses (`paused_expired`), never erases completed work.
 */
export function resolveLearnEntitlements(input: {
  activePlan: MembershipSlug;
  subscriptionExpired?: boolean | undefined;
  subscriptionExpiresAt?: string | null | undefined;
  progressBySlug: Record<string, CourseProgressRecord>;
  previousEntitlements?:
    | Record<
        string,
        { grantSource: LearnGrantSource; releasedGrantDot?: number; redeemedGrantDot?: number }
      >
    | undefined;
  schedule?: CourseReleaseSchedule | undefined;
  nowMs?: number | undefined;
}): {
  entitlements: CourseEntitlementRecord[];
  spotlightEligible: boolean;
  unlockedCount: number;
  completedCount: number;
  financialSummary: {
    totalReferenceValueUsd: number;
    entitledReferenceValueUsd: number;
    approvedGrantDotTotal: number;
    releasedGrantDotTotal: number;
    redeemedGrantDotTotal: number;
    estimatedDeliveryCostUsd: number;
  };
} {
  const nowMs = input.nowMs ?? Date.now();
  const schedule = input.schedule ?? DEFAULT_COURSE_RELEASE_SCHEDULE;
  const effectivePlan: MembershipSlug = input.subscriptionExpired ? "free" : input.activePlan;

  const leapfrogProgress = input.progressBySlug["leapfrog"];
  const leapfrogVerifiedComplete = Boolean(
    leapfrogProgress?.assessmentPassed && leapfrogProgress.completedAt,
  );

  // Compute Builder Plus periodic additional unlocks after real Leapfrog completion
  let plusPeriodicUnlockedSlugs = new Set<string>();
  let nextReleaseAt: string | null = null;
  if (effectivePlan === "plus" && leapfrogVerifiedComplete && leapfrogProgress?.completedAt) {
    const completedMs = new Date(leapfrogProgress.completedAt).getTime();
    const intervalMs = Math.max(7, schedule.releaseIntervalDays) * 86_400_000;
    const elapsedCycles = Math.max(0, Math.floor((nowMs - completedMs) / intervalMs));
    // 1st additional release unlocked after Leapfrog completion, then +1 per monthly interval
    const eligibleExtraCount = (1 + elapsedCycles) * Math.max(1, schedule.coursesPerCycle);
    plusPeriodicUnlockedSlugs = new Set(schedule.releaseOrder.slice(0, eligibleExtraCount));
    if (eligibleExtraCount < schedule.releaseOrder.length) {
      nextReleaseAt = new Date(completedMs + (elapsedCycles + 1) * intervalMs).toISOString();
    }
  }

  const entitlements: CourseEntitlementRecord[] = PING_LEARN_COURSES.map((course) => {
    const progress = input.progressBySlug[course.slug];
    const isCompleted = Boolean(progress?.assessmentPassed && progress.completedAt);
    const prev = input.previousEntitlements?.[course.slug];

    let accessStatus: LearnAccessStatus = "locked";
    let grantSource: LearnGrantSource | null = prev?.grantSource ?? null;
    let lockReason: string | null = null;

    if (effectivePlan === "pro") {
      accessStatus = isCompleted ? "completed_retained" : "active";
      // Preserve existing Leapfrog grant source on Plus -> Pro upgrade (zero duplicate enrolment!)
      grantSource = prev?.grantSource ?? "builder_pro_full_library";
    } else if (effectivePlan === "plus") {
      if (course.isEntryCourse) {
        accessStatus = isCompleted ? "completed_retained" : "active";
        grantSource = prev?.grantSource ?? "builder_plus_entry";
      } else if (plusPeriodicUnlockedSlugs.has(course.slug)) {
        accessStatus = isCompleted ? "completed_retained" : "active";
        grantSource = prev?.grantSource ?? "builder_plus_monthly_release";
      } else if (isCompleted) {
        accessStatus = "completed_retained";
        grantSource = prev?.grantSource ?? "builder_pro_full_library";
      } else if (prev) {
        accessStatus = "paused_expired";
        lockReason =
          "Paused after downgrade from Builder Pro. Completed work is preserved; renew Pro or unlock via monthly Builder Plus progression.";
      } else if (!leapfrogVerifiedComplete) {
        accessStatus = "locked";
        lockReason =
          "Builder Plus includes Leapfrog first. Complete all Leapfrog lessons, exercises, and the verified assessment to unlock periodic monthly courses — or upgrade to Builder Pro for immediate 10-course access.";
      } else {
        accessStatus = "locked";
        lockReason = `Scheduled for a future Builder Plus release cycle (${schedule.coursesPerCycle} course every ${schedule.releaseIntervalDays} days) — or upgrade to Builder Pro for immediate access.`;
      }
    } else {
      // Free / Expired membership: permanently retain completed courses, pause previously unlocked incomplete ones
      if (isCompleted) {
        accessStatus = "completed_retained";
      } else if (prev) {
        accessStatus = "paused_expired";
        lockReason =
          "Membership expired. Your historical lessons, submissions, and certificates are permanently preserved — renew Builder Plus or Builder Pro to resume.";
      } else {
        accessStatus = "locked";
        lockReason = course.isEntryCourse
          ? "Requires Builder Plus (₦3,000) or Builder Pro (₦30,000)."
          : "Requires Builder Pro (₦30,000) or Builder Plus progression after Leapfrog completion.";
      }
    }

    const releasedDot = isCompleted
      ? course.approvedGrantAllocationDot
      : (prev?.releasedGrantDot ?? 0);

    return {
      courseSlug: course.slug,
      accessStatus,
      grantSource,
      unlockedAt:
        accessStatus === "active" || accessStatus === "completed_retained"
          ? (progress?.completedAt ?? new Date(nowMs).toISOString())
          : null,
      expiresAt: accessStatus === "active" ? (input.subscriptionExpiresAt ?? null) : null,
      nextReleaseAt:
        effectivePlan === "plus" && accessStatus === "locked" && leapfrogVerifiedComplete
          ? nextReleaseAt
          : null,
      lockReason,
      referenceValueUsd: course.referenceValueUsd,
      approvedGrantDot:
        accessStatus === "active" || accessStatus === "completed_retained"
          ? course.approvedGrantAllocationDot
          : 0,
      releasedGrantDot: releasedDot,
      redeemedGrantDot: prev?.redeemedGrantDot ?? 0,
      actualDeliveryCostUsd:
        accessStatus === "active" || accessStatus === "completed_retained"
          ? course.deliveryCostEstimateUsd
          : 0,
    };
  });

  const unlocked = entitlements.filter(
    (e) => e.accessStatus === "active" || e.accessStatus === "completed_retained",
  );
  const completed = entitlements.filter((e) => e.accessStatus === "completed_retained");

  return {
    entitlements,
    spotlightEligible: effectivePlan === "pro",
    unlockedCount: unlocked.length,
    completedCount: completed.length,
    financialSummary: {
      totalReferenceValueUsd: AGGREGATE_LIBRARY_REFERENCE_VALUE_USD,
      entitledReferenceValueUsd: unlocked.reduce((s, e) => s + e.referenceValueUsd, 0),
      approvedGrantDotTotal: unlocked.reduce((s, e) => s + e.approvedGrantDot, 0),
      releasedGrantDotTotal: entitlements.reduce((s, e) => s + e.releasedGrantDot, 0),
      redeemedGrantDotTotal: entitlements.reduce((s, e) => s + e.redeemedGrantDot, 0),
      estimatedDeliveryCostUsd: unlocked.reduce((s, e) => s + e.actualDeliveryCostUsd, 0),
    },
  };
}

/**
 * Evaluates whether a learner satisfies ALL real requirements before unlocking
 * course completion, certification, or Builder Plus next-course eligibility.
 * Prevents gaming by opening lessons without submitting exercises or passing assessment.
 */
export function gradeCourseAssessment(input: {
  course: LearnCourse;
  progress: CourseProgressRecord | undefined;
  answers: Record<string, number>;
}): {
  eligibleForAssessment: boolean;
  missingRequirements: string[];
  score: number;
  passed: boolean;
} {
  const missing: string[] = [];
  const completedLessons = new Set(input.progress?.completedLessonIds ?? []);
  const submittedExercises = input.progress?.submittedExercises ?? {};

  const missingLessons = input.course.lessons.filter((l) => !completedLessons.has(l.id));
  if (missingLessons.length > 0) {
    missing.push(`Complete remaining ${missingLessons.length} lesson(s)`);
  }

  const requiredExercises = input.course.lessons.filter((l) => l.hasExercise);
  const missingExercises = requiredExercises.filter(
    (l) => !submittedExercises[l.id] || submittedExercises[l.id]!.trim().length < 15,
  );
  if (missingExercises.length > 0) {
    missing.push(`Submit ${missingExercises.length} practical exercise(s) (min 15 chars each)`);
  }

  if (missing.length > 0) {
    return {
      eligibleForAssessment: false,
      missingRequirements: missing,
      score: 0,
      passed: false,
    };
  }

  const total = input.course.assessmentQuestions.length;
  let correct = 0;
  for (const q of input.course.assessmentQuestions) {
    if (input.answers[q.id] === q.correctIndex) correct += 1;
  }
  const score = total > 0 ? Math.round((correct / total) * 100) : 0;
  return {
    eligibleForAssessment: true,
    missingRequirements: [],
    score,
    passed: score >= input.course.minAssessmentScore,
  };
}

const LOCAL_PROGRESS_PREFIX = "ping:learn:progress:";

function readLocalProgress(userId: string): Record<string, CourseProgressRecord> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(`${LOCAL_PROGRESS_PREFIX}${userId}`);
    return raw ? (JSON.parse(raw) as Record<string, CourseProgressRecord>) : {};
  } catch {
    return {};
  }
}

function writeLocalProgress(userId: string, map: Record<string, CourseProgressRecord>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${LOCAL_PROGRESS_PREFIX}${userId}`, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
}

function isMissingLearnSchema(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? "").toLowerCase();
  const code = String((err as { code?: string })?.code ?? "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "42883" ||
    code === "PGRST202" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

export function courseReleaseScheduleQuery() {
  return queryOptions({
    queryKey: ["learn-release-schedule"],
    staleTime: 120_000,
    queryFn: async (): Promise<{ migrated: boolean; schedule: CourseReleaseSchedule }> => {
      const { data, error } = await (supabase as any)
        .from("course_release_schedules")
        .select("*")
        .eq("id", "default")
        .maybeSingle();

      if (error) {
        if (!isMissingLearnSchema(error)) throw error;
        return { migrated: false, schedule: DEFAULT_COURSE_RELEASE_SCHEDULE };
      }
      if (!data) return { migrated: true, schedule: DEFAULT_COURSE_RELEASE_SCHEDULE };
      return {
        migrated: true,
        schedule: {
          requireLeapfrogCompletion: Boolean(data.require_leapfrog_completion),
          releaseIntervalDays: Number(data.release_interval_days) || 30,
          coursesPerCycle: Number(data.courses_per_cycle) || 1,
          minAssessmentScore: Number(data.min_assessment_score) || 70,
          releaseOrder: Array.isArray(data.release_order)
            ? data.release_order
            : DEFAULT_COURSE_RELEASE_SCHEDULE.releaseOrder,
        },
      };
    },
  });
}

export function myLearnProgressQuery(userId?: string) {
  return queryOptions({
    queryKey: ["my-learn-progress", userId],
    enabled: Boolean(userId),
    staleTime: 15_000,
    queryFn: async (): Promise<{
      migrated: boolean;
      progressBySlug: Record<string, CourseProgressRecord>;
    }> => {
      if (!userId) return { migrated: true, progressBySlug: {} };
      const { data, error } = await (supabase as any)
        .from("learn_course_progress")
        .select("*")
        .eq("user_id", userId);

      if (error) {
        if (!isMissingLearnSchema(error)) throw error;
        return { migrated: false, progressBySlug: readLocalProgress(userId) };
      }

      const map: Record<string, CourseProgressRecord> = {};
      for (const row of (data ?? []) as any[]) {
        map[row.course_slug] = {
          courseSlug: row.course_slug,
          completedLessonIds: Array.isArray(row.completed_lesson_ids)
            ? row.completed_lesson_ids
            : [],
          submittedExercises: (row.submitted_exercises ?? {}) as Record<string, string>,
          milestonesCompleted: Number(row.milestones_completed ?? 0),
          assessmentAttempts: Number(row.assessment_attempts ?? 0),
          assessmentScore: row.assessment_score ?? null,
          assessmentPassed: Boolean(row.assessment_passed),
          completedAt: row.completed_at ?? null,
          certificateCode: row.certificate_code ?? null,
          certificateIssuedAt: row.certificate_issued_at ?? null,
        };
      }
      return { migrated: true, progressBySlug: map };
    },
  });
}

export function useRecordLessonProgress(userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      courseSlug: string;
      lessonId: string;
      exerciseSubmission?: string | undefined;
    }) => {
      if (!userId) throw new Error("Sign in to record learning progress.");
      const { data, error } = await (supabase as any).rpc("submit_learn_lesson_progress", {
        p_course_slug: input.courseSlug,
        p_lesson_id: input.lessonId,
        p_exercise_submission: input.exerciseSubmission ?? null,
      });

      if (error) {
        if (!isMissingLearnSchema(error)) throw error;
        const current = readLocalProgress(userId);
        const existing: CourseProgressRecord = current[input.courseSlug] ?? {
          courseSlug: input.courseSlug,
          completedLessonIds: [],
          submittedExercises: {},
          milestonesCompleted: 0,
          assessmentAttempts: 0,
          assessmentScore: null,
          assessmentPassed: false,
          completedAt: null,
          certificateCode: null,
          certificateIssuedAt: null,
        };
        const lessons = existing.completedLessonIds.includes(input.lessonId)
          ? existing.completedLessonIds
          : [...existing.completedLessonIds, input.lessonId];
        const exercises =
          input.exerciseSubmission && input.exerciseSubmission.trim().length >= 15
            ? { ...existing.submittedExercises, [input.lessonId]: input.exerciseSubmission.trim() }
            : existing.submittedExercises;
        const next: CourseProgressRecord = {
          ...existing,
          completedLessonIds: lessons,
          submittedExercises: exercises,
          milestonesCompleted: lessons.length,
        };
        current[input.courseSlug] = next;
        writeLocalProgress(userId, current);
        return next;
      }
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["my-learn-progress", userId] });
    },
  });
}

export function useSubmitCourseAssessment(userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { course: LearnCourse; score: number }) => {
      if (!userId) throw new Error("Sign in to complete course assessment.");
      const { data, error } = await (supabase as any).rpc("submit_learn_assessment", {
        p_course_slug: input.course.slug,
        p_score: input.score,
      });

      if (error) {
        if (!isMissingLearnSchema(error)) throw error;
        const current = readLocalProgress(userId);
        const existing: CourseProgressRecord = current[input.course.slug] ?? {
          courseSlug: input.course.slug,
          completedLessonIds: [],
          submittedExercises: {},
          milestonesCompleted: 0,
          assessmentAttempts: 0,
          assessmentScore: null,
          assessmentPassed: false,
          completedAt: null,
          certificateCode: null,
          certificateIssuedAt: null,
        };
        const passed = input.score >= input.course.minAssessmentScore;
        const nowIso = new Date().toISOString();
        const certCode =
          existing.certificateCode ??
          `PING-CERT-${input.course.slug.slice(0, 6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
        current[input.course.slug] = {
          ...existing,
          assessmentAttempts: existing.assessmentAttempts + 1,
          assessmentScore: Math.max(existing.assessmentScore ?? 0, input.score),
          assessmentPassed: existing.assessmentPassed || passed,
          completedAt: passed && !existing.completedAt ? nowIso : existing.completedAt,
          certificateCode: passed ? certCode : existing.certificateCode,
          certificateIssuedAt:
            passed && !existing.certificateIssuedAt ? nowIso : existing.certificateIssuedAt,
        };
        writeLocalProgress(userId, current);
        return {
          passed,
          certificateCode: passed ? certCode : null,
          grantDotReleased: passed ? input.course.approvedGrantAllocationDot : 0,
        };
      }

      return {
        passed: Boolean(data?.passed),
        certificateCode: (data?.progress?.certificate_code as string | null) ?? null,
        grantDotReleased: Number(data?.grant_dot_released ?? 0),
      };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["my-learn-progress", userId] });
      void qc.invalidateQueries({ queryKey: ["dot-summary", userId] });
    },
  });
}
