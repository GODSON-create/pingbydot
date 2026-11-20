// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn(async (_fn: string, _args?: Record<string, unknown>) => ({
  data: null as any,
  error: null as any,
}));

const editorState = {
  userId: "editor-1111-4111-8111-111111111111",
  isEditor: false,
  candidateHasPro: true,
};

const serverContextRpcMock = vi.fn(async (fn: string, _args?: Record<string, unknown>) => {
  if (fn === "is_spotlight_editor") return { data: editorState.isEditor, error: null };
  if (fn === "is_ping_admin") return { data: false, error: null };
  if (fn === "editor_decide_spotlight_candidate") return { data: { ok: true }, error: null };
  if (fn === "editor_publish_spotlight") return { data: { id: "pub-101" }, error: null };
  return { data: null, error: null };
});

const supabaseAdminMock = {
  rpc: vi.fn(async (fn: string) => {
    if (fn === "has_active_pro_membership") {
      return { data: editorState.candidateHasPro, error: null };
    }
    return { data: null, error: null };
  }),
  from: vi.fn((table: string) => {
    if (table === "spotlight_candidates") {
      return {
        insert: () => ({
          select: () => ({
            single: async () => ({ data: { id: "cand-new-1" }, error: null }),
          }),
        }),
      };
    }
    if (table === "spotlight_editorial_audit_logs" || table === "spotlight_publications") {
      return {
        insert: async () => ({ data: null, error: null }),
        update: () => ({ eq: async () => ({ data: null, error: null }) }),
      };
    }
    return {
      select: () => ({
        is: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
        eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
        in: async () => ({ data: [], error: null }),
        order: () => ({ limit: async () => ({ data: [], error: null }) }),
      }),
    };
  }),
};

const mockSpotlightPub = {
  id: "pub-solar-1",
  slug: "kora-solar-2026",
  candidate_id: "cand-1",
  founder_id: "founder-a",
  business_id: "biz-kora",
  title: "How Kora Solar Built Cold-Chain Logistics for 400 Farms",
  editorial_intro: "Verified execution in Ogun State cold-chain agriculture.",
  founder_portrait_url: null,
  founder_story:
    "Starting with a single solar cold room, Adaobi built reliable post-harvest storage across 400 smallholder farms.",
  business_description: "Pay-as-you-store solar cold rooms.",
  problem_solved: "40% post-harvest tomato and pepper spoilage.",
  product_solution: "IoT-monitored modular solar cold hubs.",
  evidence_achievements: ["400 smallholder farms served", "92% repeat farmer retention"],
  media_urls: [],
  video_interview_url: null,
  featured_ping_ids: ["ping-feat-1"],
  featured_clip_ids: ["clip-feat-1"],
  featured_moment_ids: [],
  dot_tags: ["agritech", "africa"],
  template_layout: "builder_case_study" as const,
  status: "published" as const,
  published_by_official_account: true,
  distribution_config: {
    home_feed: true,
    explore: true,
    official_account: true,
    notify_eligible: false,
    frequency_cap_days: 7,
  },
  published_at: "2026-06-01T10:00:00Z",
  retracted_at: null,
  correction_note: "",
  founder: {
    id: "founder-a",
    username: "adaobi",
    display_name: "Adaobi Okafor",
    avatar_url: null,
  },
  business: {
    id: "biz-kora",
    name: "Kora Solar",
    slug: "kora-solar",
    verified_status: "verified",
  },
  distribution: [
    {
      channel: "official_account",
      impressions_count: 14,
      views_count: 9,
      clicks_count: 4,
      shares_count: 2,
      notifications_sent: 0,
    },
  ],
};

const mockClipRow = {
  id: "clip-feat-1",
  creator_id: "founder-a",
  video_url: "https://cdn.ping.africa/kora-solar-clip.mp4",
  poster_url: null,
  caption: "Inside our solar cold room build .agritech",
  captions_text: "Day 45 solar cold room check",
  duration_sec: 28,
  visibility: "public",
  dot_tags: ["agritech"],
  source_moment_id: "mom-origin-1",
  linked_ping_id: null,
  processing_status: "ready",
  views_count: 42,
  likes_count: 7,
  replies_count: 2,
  shares_count: 1,
  saves_count: 3,
  hidden_at: null,
  created_at: "2026-05-20T09:00:00Z",
  creator: {
    id: "founder-a",
    username: "adaobi",
    display_name: "Adaobi Okafor",
    avatar_url: null,
  },
};

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    createFileRoute: () => (opts: any) => ({
      ...opts,
      options: opts,
      useParams: () => ({ slug: "kora-solar-2026" }),
    }),
    useNavigate: () => vi.fn(),
    Link: ({ children, to, className, onClick }: any) => (
      <a
        href={typeof to === "string" ? to : "#"}
        className={className}
        onClick={(e) => {
          e.preventDefault();
          onClick?.(e);
        }}
      >
        {children}
      </a>
    ),
  };
});

vi.mock("@tanstack/react-start", () => {
  const buildValidator = (schema?: any) => ({
    ...createChain(),
    handler: (fn: (ctx: any) => unknown) => (input?: any) => {
      const parsed = schema
        ? schema.parse(input?.data ?? input ?? {})
        : (input?.data ?? input ?? {});
      return fn({
        data: parsed,
        context: {
          userId: editorState.userId,
          supabase: {
            rpc: (fnName: string, params?: Record<string, unknown>) =>
              serverContextRpcMock(fnName, params),
          },
        },
      });
    },
  });
  const createChain = (): any => ({
    validator: buildValidator,
    inputValidator: buildValidator,
    middleware: () => createChain(),
    handler: (fn: (ctx: any) => unknown) => (input?: any) =>
      fn({
        data: input?.data ?? input ?? {},
        context: {
          userId: editorState.userId,
          supabase: {
            rpc: (fnName: string, params?: Record<string, unknown>) =>
              serverContextRpcMock(fnName, params),
          },
        },
      }),
  });
  return {
    createServerFn: () => createChain(),
    createMiddleware: () => ({ server: (fn: unknown) => fn }),
    useServerFn: (fn: unknown) => fn,
  };
});

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: supabaseAdminMock,
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    ready: true,
    user: { id: "viewer-user-999" },
    profile: {
      id: "viewer-user-999",
      username: "viewer",
      display_name: "Viewer User",
      avatar_url: null,
    },
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "spotlight_publications") {
        return {
          select: () => ({
            in: () => ({
              order: () => ({
                limit: async () => ({ data: [mockSpotlightPub], error: null }),
              }),
            }),
            eq: () => ({
              maybeSingle: async () => ({ data: mockSpotlightPub, error: null }),
            }),
          }),
        };
      }
      if (table === "ping_clips") {
        return {
          select: () => ({
            is: () => ({
              order: () => ({
                limit: async () => ({ data: [mockClipRow], error: null }),
              }),
              contains: () => ({
                order: () => ({
                  limit: async () => ({ data: [mockClipRow], error: null }),
                }),
              }),
            }),
            in: () => ({
              is: async () => ({ data: [mockClipRow], error: null }),
            }),
          }),
        };
      }
      if (table === "pings") {
        return {
          select: () => ({
            in: () => ({
              is: async () => ({
                data: [
                  {
                    id: "ping-feat-1",
                    content: "Commissioned our 4th solar cold room in Abeokuta!",
                    created_at: "2026-05-18T10:00:00Z",
                    author: { username: "adaobi", display_name: "Adaobi Okafor" },
                  },
                ],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "hub_members") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: async () => ({
                  data: [
                    {
                      hub: {
                        id: "hub-agri",
                        name: "AgriTech Builders",
                        slug: "agritech-builders",
                        category: "AgriTech",
                        is_private: false,
                      },
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
            order: () => ({ limit: async () => ({ data: [], error: null }) }),
          }),
        }),
        insert: async () => ({ data: null, error: null }),
        delete: () => ({ eq: () => ({ eq: async () => ({ data: null, error: null }) }) }),
      };
    },
    rpc: (fn: string, args?: Record<string, unknown>) => rpcMock(fn, args),
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
import {
  decideSpotlightCandidate,
  publishSpotlightFeature,
  queueDiscoveredSpotlightCandidate,
} from "@/lib/admin.functions";
import { AccountStatusBadges } from "@/components/badges/AccountStatusBadges";
import { SpotlightFeedStrip } from "@/components/spotlight/SpotlightFeedStrip";
import { Route as SpotlightStoryRoute } from "@/routes/spotlight.$slug";
import { Route as ClipsRoute } from "@/routes/clips";

function renderWithQuery(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  editorState.isEditor = false;
  editorState.candidateHasPro = true;
});

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
  it("Criteria 1 & 2: Builder Plus receives LEAPFROG ONLY ($2,000 ref) and does NOT automatically receive all 10 courses", () => {
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

  it("Criteria 3 & 4: Assessment prevents skipping lessons; verified Leapfrog completion unlocks periodic monthly courses", () => {
    const leapfrog = PING_LEARN_COURSES[0]!;

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

  it("Criteria 5, 6 & 7: Builder Pro unlocks all 10 without duplicating Leapfrog; expiry preserves progress & certificates; never awards $10k cash/DOT", () => {
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

    const upgraded = resolveLearnEntitlements({
      activePlan: "pro",
      progressBySlug: { leapfrog: leapfrogDone },
      previousEntitlements: {
        leapfrog: { grantSource: "builder_plus_entry", releasedGrantDot: 100 },
      },
    });
    expect(upgraded.entitlements).toHaveLength(10);
    expect(upgraded.unlockedCount).toBe(10);
    expect(upgraded.spotlightEligible).toBe(true);
    const lfUpgraded = upgraded.entitlements.find((e) => e.courseSlug === "leapfrog")!;
    expect(lfUpgraded.grantSource).toBe("builder_plus_entry");
    expect(lfUpgraded.accessStatus).toBe("completed_retained");
    expect(upgraded.financialSummary.totalReferenceValueUsd).toBe(10000);
    expect(upgraded.financialSummary.releasedGrantDotTotal).toBe(100);

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
/* 3. PART B — PING SPOTLIGHT (CRITERIA 9–17 & 22)                            */
/* -------------------------------------------------------------------------- */
describe("Ping Spotlight — Pro Eligibility, Merit Scoring, Human Approval, Distribution & Clips Integration", () => {
  const FOUNDER_UUID = "44444444-4444-4444-8444-444444444444";
  const CANDIDATE_UUID = "55555555-5555-4555-8555-555555555555";

  it("Criteria 9–13: Blocks non-Pro, non-editors, and AI-only decisions; allows human editor discovery & merit approval", async () => {
    expect(
      validateSpotlightSelectionDecision({
        candidateHasActivePro: false,
        actorIsSpotlightEditor: true,
        actorIsAiOnly: false,
        decision: "selected",
        reason: "Strong solar microgrid execution in Ogun State.",
      }).allowed,
    ).toBe(false);

    expect(
      validateSpotlightSelectionDecision({
        candidateHasActivePro: true,
        actorIsSpotlightEditor: true,
        actorIsAiOnly: true,
        decision: "selected",
        reason: "AI score exceeded 90.",
      }).allowed,
    ).toBe(false);

    expect(
      validateSpotlightSelectionDecision({
        candidateHasActivePro: true,
        actorIsSpotlightEditor: false,
        actorIsAiOnly: false,
        decision: "selected",
        reason: "Attempting unauthorized approval.",
      }).allowed,
    ).toBe(false);

    expect(
      validateSpotlightSelectionDecision({
        candidateHasActivePro: true,
        actorIsSpotlightEditor: true,
        actorIsAiOnly: false,
        decision: "selected",
        reason: "Verified 400 smallholder cold-chain installations with strong retention.",
      }).allowed,
    ).toBe(true);

    // Server-side enforcement: non-editor rejected from discovery queue & decision
    editorState.isEditor = false;
    await expect(
      decideSpotlightCandidate({
        data: {
          candidateId: CANDIDATE_UUID,
          status: "selected",
          selectionReason: "Unauthorized attempt",
          internalNotes: "",
        },
      }),
    ).rejects.toThrow(/Spotlight editorial role required/i);

    // Server-side enforcement: authorised editor blocked from queuing non-Pro founder
    editorState.isEditor = true;
    editorState.candidateHasPro = false;
    await expect(
      queueDiscoveredSpotlightCandidate({
        data: {
          founderId: FOUNDER_UUID,
          sourceType: "ping",
          headline: "Non-Pro Builder",
          storyPitch: "Testing Pro gating during organic discovery.",
        },
      }),
    ).rejects.toThrow(/active Builder Pro membership/i);

    // Authorised editor queues eligible Pro founder & publishes official feature
    editorState.candidateHasPro = true;
    await expect(
      queueDiscoveredSpotlightCandidate({
        data: {
          founderId: FOUNDER_UUID,
          sourceType: "clip",
          headline: "Kora Solar Field Clip",
          storyPitch: "Discovered via organic Clip showcasing 400 cold-chain farms.",
        },
      }),
    ).resolves.toEqual({ ok: true, candidateId: "cand-new-1" });

    await expect(
      publishSpotlightFeature({
        data: {
          slug: "kora-solar-2026",
          founderId: FOUNDER_UUID,
          title: "Kora Solar Cold-Chain Case Study",
          editorialIntro: "Verified execution in Ogun State.",
          founderStory:
            "Starting with one modular solar unit, Kora Solar scaled to 400 farms across Ogun State.",
          businessDescription: "Modular solar cold storage.",
          problemSolved: "Post-harvest crop loss.",
          productSolution: "Pay-as-you-store solar rooms.",
          evidenceAchievements: ["400 farms served"],
          mediaUrls: [],
          featuredPingIds: [],
          featuredClipIds: [],
          featuredMomentIds: [],
          dotTags: ["agritech"],
          templateLayout: "builder_case_study",
          status: "published",
          correctionNote: "",
        },
      }),
    ).resolves.toEqual({ ok: true });

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

    const brief = generateAdvisoryEditorialSummary({
      headline: "Cold-chain solar logistics",
      problem_statement: "Post-harvest crop spoilage",
      traction_evidence: "400 farms served",
      evidence_urls: ["https://kora.example"],
    });
    expect(brief).toMatch(/Non-Decisional/i);
    expect(PING_OFFICIAL_ACCOUNT.handle).toBe("ping");
  });

  it("Criteria 14, 15, 16 & 22: Published Spotlight story renders founder, business, official @ping, featured Clips/Pings/Hubs & real distribution telemetry", async () => {
    const StoryPage = SpotlightStoryRoute.options.component as React.ComponentType;
    renderWithQuery(<StoryPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/How Kora Solar Built Cold-Chain Logistics for 400 Farms/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/Published by Ping Official \(@ping\)/i)).toBeInTheDocument();
    expect(screen.getByText("Adaobi Okafor")).toBeInTheDocument();
    expect(screen.getByText("Kora Solar")).toBeInTheDocument();
    expect(screen.getByText(/Builder Case Study/i)).toBeInTheDocument();
    expect(screen.getByText(/Observed Distribution Telemetry/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("spotlight-featured-clip-clip-feat-1")).toBeInTheDocument();
      expect(screen.getByText(/Commissioned our 4th solar cold room/i)).toBeInTheDocument();
      expect(screen.getByText("AgriTech Builders")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith("record_spotlight_event", {
        p_publication_id: "pub-solar-1",
        p_channel: "official_account",
        p_event_type: "view",
      });
    });

    // Live Home distribution strip records actual impression & click events
    renderWithQuery(<SpotlightFeedStrip channel="home_feed" />);
    await waitFor(() => {
      expect(screen.getByTestId("spotlight-strip-home_feed")).toBeInTheDocument();
      expect(rpcMock).toHaveBeenCalledWith("record_spotlight_event", {
        p_publication_id: "pub-solar-1",
        p_channel: "home_feed",
        p_event_type: "impression",
      });
    });
  });

  it("Criterion 17: Respects user notification opt-out and per-user frequency caps", () => {
    expect(
      evaluateSpotlightNotificationDelivery({
        preferences: { spotlight: false },
      }).send,
    ).toBe(false);

    const nowMs = Date.parse("2026-06-10T12:00:00Z");
    expect(
      evaluateSpotlightNotificationDelivery({
        preferences: { spotlight: true },
        lastSpotlightNotificationAt: "2026-06-08T12:00:00Z",
        frequencyCapDays: 7,
        nowMs,
      }).send,
    ).toBe(false);

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
describe("Ping Clips — Vertical Feed Discovery, Follow/Connect, Moments-to-Clips Attribution & Privacy", () => {
  it("Criteria 18 & 21: Renders vertical Ping Clips feed with DOT Tag discovery, Follow/Connect, captions, and Publish Clip trigger", async () => {
    const ClipsPage = ClipsRoute.options.component as React.ComponentType;
    renderWithQuery(<ClipsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("clip-card-clip-feat-1")).toBeInTheDocument();
    });
    expect(screen.getByText(/Republished from Moment/i)).toBeInTheDocument();
    expect(screen.getByText(/Day 45 solar cold room check/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Follow/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Connect/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Publish Clip/i })).toBeInTheDocument();

    // Open Publish Clip modal to verify direct publishing flow
    fireEvent.click(screen.getByRole("button", { name: /Publish Clip/i }));
    await waitFor(() => {
      expect(screen.getByText(/Publish a Ping Clip/i)).toBeInTheDocument();
    });
  });

  it("Criteria 19, 20 & 23: Enforces creator ownership, video media type, and Close Circle privacy boundaries", () => {
    const publicVideoMoment = {
      id: "mom-1",
      author_id: "creator-a",
      media_type: "video" as const,
      audience: "public" as const,
      media_url: "https://cdn.ping.africa/demo.mp4",
    };

    expect(
      validateMomentToClipConversion({
        moment: publicVideoMoment,
        callerUserId: "creator-a",
        targetVisibility: "public",
      }).eligible,
    ).toBe(true);

    expect(
      validateMomentToClipConversion({
        moment: publicVideoMoment,
        callerUserId: "other-user-b",
        targetVisibility: "public",
      }).eligible,
    ).toBe(false);

    expect(
      validateMomentToClipConversion({
        moment: { ...publicVideoMoment, media_type: "image" },
        callerUserId: "creator-a",
        targetVisibility: "public",
      }).eligible,
    ).toBe(false);

    expect(
      validateMomentToClipConversion({
        moment: { ...publicVideoMoment, audience: "close_circle" },
        callerUserId: "creator-a",
        targetVisibility: "public",
      }).eligible,
    ).toBe(false);
  });
});
