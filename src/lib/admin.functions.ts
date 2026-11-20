import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ADMIN_PAGE_SIZE,
  adminListSchema,
  assertEditorialRole,
  economicReadinessSchema,
  moderateBoostSchema,
  moderationSchema,
  reviewVerificationSchema,
  spotlightDecisionSchema,
  spotlightPublishSchema,
  updateCourseScheduleSchema,
  upsertMembershipPlanSchema,
  verifySignalSchema,
  assertAdminRole,
} from "./admin-policy";

export const checkAdminAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("is_ping_admin");
    if (error) throw new Error("Couldn't verify administrator access.");
    return { isAdmin: data === true };
  });

export const getAdminOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: allowed, error: roleError } = await context.supabase.rpc("is_ping_admin");
    assertAdminRole(!roleError && allowed === true);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("admin_metrics");
    if (error) throw new Error("Dashboard health check failed. Please retry.");
    return data;
  });

export const getAdminList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(adminListSchema)
  .handler(async ({ data, context }) => {
    const { data: allowed, error: roleError } = await context.supabase.rpc("is_ping_admin");
    assertAdminRole(!roleError && allowed === true);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const start = data.page * ADMIN_PAGE_SIZE;
    const search = data.search.replace(/[%_\\]/g, "\\$&");
    if (data.view === "users") {
      let q = supabaseAdmin
        .from("profiles")
        .select("id,username,display_name,bio,created_at", { count: "exact" });
      if (search) q = q.ilike("username", `%${search}%`);
      const result = await q
        .order("created_at", { ascending: false })
        .order("id")
        .range(start, start + ADMIN_PAGE_SIZE - 1);
      if (result.error) throw new Error("Couldn't load users.");
      return { view: "users" as const, rows: result.data ?? [], total: result.count ?? 0 };
    }
    if (data.view === "pings") {
      let q = supabaseAdmin
        .from("pings")
        .select(
          "id,user_id,content,category,created_at,hidden_at,author:profiles!pings_user_id_fkey(username,display_name)",
          { count: "exact" },
        );
      if (search) q = q.ilike("content", `%${search}%`);
      const result = await q
        .order("created_at", { ascending: false })
        .order("id")
        .range(start, start + ADMIN_PAGE_SIZE - 1);
      if (result.error) throw new Error("Couldn't load Pings.");
      return { view: "pings" as const, rows: result.data ?? [], total: result.count ?? 0 };
    }
    if (data.view === "reports") {
      let q = supabaseAdmin
        .from("reports")
        .select("id,ping_id,reason,details,created_at,resolved_at", { count: "exact" })
        .is("resolved_at", null);
      if (search) q = q.ilike("reason", `%${search}%`);
      const result = await q
        .order("created_at", { ascending: false })
        .order("id")
        .range(start, start + ADMIN_PAGE_SIZE - 1);
      if (result.error) throw new Error("Couldn't load reports.");
      return { view: "reports" as const, rows: result.data ?? [], total: result.count ?? 0 };
    }
    if (data.view === "signals") {
      let q = supabaseAdmin
        .from("signals")
        .select(
          "id,name,slug,institution_type,verified,verification_status,follower_count,created_at",
          { count: "exact" },
        );
      if (search) q = q.or(`name.ilike.%${search}%,verification_status.ilike.%${search}%`);
      const result = await q
        .order("verification_status", { ascending: false })
        .order("created_at", { ascending: false })
        .range(start, start + ADMIN_PAGE_SIZE - 1);
      if (result.error) {
        const code = result.error.code;
        if (code === "42P01" || code === "PGRST205") {
          return {
            view: "signals" as const,
            rows: [],
            total: 0,
            unmigrated: true,
          };
        }
        throw new Error("Couldn't load Signals.");
      }
      return {
        view: "signals" as const,
        rows: result.data ?? [],
        total: result.count ?? 0,
        unmigrated: false,
      };
    }
    if (data.view === "verifications") {
      let q = supabaseAdmin
        .from("account_verifications")
        .select(
          "id,user_id,verification_domain,pathway_type,status,organization_name,evidence_url,submission_note,reviewer_note,created_at,updated_at,profile:profiles!account_verifications_user_id_fkey(username,display_name)",
          { count: "exact" },
        );
      if (search) {
        q = q.or(
          `organization_name.ilike.%${search}%,pathway_type.ilike.%${search}%,status.ilike.%${search}%`,
        );
      }
      const result = await q
        .order("updated_at", { ascending: false })
        .range(start, start + ADMIN_PAGE_SIZE - 1);
      if (result.error) {
        const code = result.error.code;
        if (code === "42P01" || code === "PGRST205") {
          return {
            view: "verifications" as const,
            rows: [],
            total: 0,
            unmigrated: true,
          };
        }
        throw new Error("Couldn't load account verifications.");
      }
      return {
        view: "verifications" as const,
        rows: (result.data ?? []) as unknown as Array<{
          id: string;
          user_id: string;
          verification_domain: string;
          pathway_type: string;
          status: string;
          organization_name: string;
          evidence_url: string | null;
          submission_note: string;
          reviewer_note: string;
          created_at: string;
          updated_at: string;
          profile: { username: string; display_name: string } | null;
        }>,
        total: result.count ?? 0,
        unmigrated: false,
      };
    }
    if (data.view === "plans") {
      const result = await (supabaseAdmin as any)
        .from("membership_plans")
        .select(
          "slug,name,badge,tagline,dot_price,duration_days,benefits,perks,is_active,sort_order",
          {
            count: "exact",
          },
        )
        .order("sort_order", { ascending: true });
      if (result.error) {
        const code = result.error.code;
        if (code === "42P01" || code === "PGRST205") {
          return { view: "plans" as const, rows: [], total: 0, unmigrated: true };
        }
        throw new Error("Couldn't load membership plans.");
      }
      return {
        view: "plans" as const,
        rows: (result.data ?? []) as Array<{
          slug: "free" | "plus" | "pro" | "business";
          name: string;
          badge: string;
          tagline: string;
          dot_price: number;
          duration_days: number;
          benefits: Record<string, string | number | boolean | null>;
          perks: string[];
          is_active: boolean;
          sort_order: number;
        }>,
        total: Number(result.count ?? 0),
        unmigrated: false,
      };
    }
    if (data.view === "boosts") {
      let q = (supabaseAdmin as any)
        .from("boost_campaigns")
        .select(
          "id,user_id,content_type,content_id,status,duration_hours,audience,dot_cost,reach_count,impressions_count,clicks_count,engagement_count,receipt_number,moderation_note,starts_at,ends_at,created_at",
          { count: "exact" },
        );
      if (search) q = q.or(`status.ilike.%${search}%,content_type.ilike.%${search}%`);
      const result = await q
        .order("created_at", { ascending: false })
        .range(start, start + ADMIN_PAGE_SIZE - 1);
      if (result.error) {
        const code = result.error.code;
        if (code === "42P01" || code === "PGRST205") {
          return { view: "boosts" as const, rows: [], total: 0, unmigrated: true };
        }
        throw new Error("Couldn't load boost campaigns.");
      }
      return {
        view: "boosts" as const,
        rows: (result.data ?? []) as Array<{
          id: string;
          user_id: string;
          content_type: "ping" | "moment";
          content_id: string;
          status: string;
          duration_hours: number;
          audience: string;
          dot_cost: number;
          reach_count: number;
          impressions_count: number;
          clicks_count: number;
          engagement_count: number;
          receipt_number: string;
          moderation_note: string;
          starts_at: string;
          ends_at: string;
          created_at: string;
        }>,
        total: Number(result.count ?? 0),
        unmigrated: false,
      };
    }
    if (data.view === "learn") {
      const result = await (supabaseAdmin as any)
        .from("course_release_schedules")
        .select(
          "id,require_leapfrog_completion,release_interval_days,courses_per_cycle,min_assessment_score,release_order,updated_at",
          { count: "exact" },
        )
        .eq("id", "default");
      if (result.error) {
        const code = result.error.code;
        if (code === "42P01" || code === "PGRST205") {
          return { view: "learn" as const, rows: [], total: 0, unmigrated: true };
        }
        throw new Error("Couldn't load Ping Learn release schedule.");
      }
      return {
        view: "learn" as const,
        rows: (result.data ?? []) as Array<{
          id: string;
          require_leapfrog_completion: boolean;
          release_interval_days: number;
          courses_per_cycle: number;
          min_assessment_score: number;
          release_order: string[];
          updated_at: string;
        }>,
        total: Number(result.count ?? 0),
        unmigrated: false,
      };
    }
    let q = supabaseAdmin
      .from("moderation_audit")
      .select("id,actor_id,action,target_id,reason,created_at", { count: "exact" });
    if (search) q = q.ilike("action", `%${search}%`);
    const result = await q
      .order("created_at", { ascending: false })
      .order("id")
      .range(start, start + ADMIN_PAGE_SIZE - 1);
    if (result.error) throw new Error("Couldn't load audit history.");
    return { view: "audit" as const, rows: result.data ?? [], total: result.count ?? 0 };
  });

export const moderatePing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(moderationSchema)
  .handler(async ({ data, context }) => {
    const { data: allowed, error: roleError } = await context.supabase.rpc("is_ping_admin");
    assertAdminRole(!roleError && allowed === true);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("admin_moderate", {
      _actor: context.userId,
      _target: data.id,
      _action: data.action,
      _reason: data.reason,
    });
    if (error)
      throw new Error("Couldn't complete moderation. No success has been recorded; please retry.");
    return { ok: true };
  });

export const verifySignal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(verifySignalSchema)
  .handler(async ({ data, context }) => {
    const { data: allowed, error: roleError } = await context.supabase.rpc("is_ping_admin");
    assertAdminRole(!roleError && allowed === true);
    const { error } = await context.supabase.rpc("verify_signal", {
      _signal: data.id,
      _status: data.status,
    });
    if (error) {
      throw new Error(error.message || "Couldn't update signal verification status.");
    }
    return { ok: true };
  });

export const reviewVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(reviewVerificationSchema)
  .handler(async ({ data, context }) => {
    const { data: allowed, error: roleError } = await context.supabase.rpc("is_ping_admin");
    assertAdminRole(!roleError && allowed === true);
    // Execute with caller JWT so Postgres enforces auth.uid() != verification owner (no self-approval)
    if (data.expiresAt) {
      const v2 = await (context.supabase as any).rpc("review_verification_request_v2", {
        _verification_id: data.id,
        _status: data.status,
        _reviewer_note: data.reviewerNote,
        _expires_at: data.expiresAt,
      });
      if (!v2.error) return { ok: true };
      if (v2.error.code !== "42883" && v2.error.code !== "PGRST202") {
        throw new Error(v2.error.message || "Couldn't update account verification status.");
      }
    }
    const { error } = await context.supabase.rpc("review_verification_request", {
      _verification_id: data.id,
      _status: data.status,
      _reviewer_note: data.reviewerNote,
    });
    if (error) {
      throw new Error(error.message || "Couldn't update account verification status.");
    }
    return { ok: true };
  });

export const upsertMembershipPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(upsertMembershipPlanSchema)
  .handler(async ({ data, context }) => {
    const { data: allowed, error: roleError } = await context.supabase.rpc("is_ping_admin");
    assertAdminRole(!roleError && allowed === true);
    const { error } = await (context.supabase as any).rpc("admin_upsert_membership_plan", {
      p_slug: data.slug,
      p_name: data.name,
      p_badge: data.badge,
      p_tagline: data.tagline,
      p_dot_price: data.dotPrice,
      p_duration_days: data.durationDays,
      p_benefits: data.benefits ?? null,
      p_perks: data.perks ?? null,
      p_is_active: data.isActive,
    });
    if (error) throw new Error(error.message || "Couldn't update membership plan.");
    return { ok: true };
  });

export const moderateBoostCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(moderateBoostSchema)
  .handler(async ({ data, context }) => {
    const { data: allowed, error: roleError } = await context.supabase.rpc("is_ping_admin");
    assertAdminRole(!roleError && allowed === true);
    const { error } = await (context.supabase as any).rpc("admin_moderate_boost_campaign", {
      p_campaign_id: data.campaignId,
      p_decision: data.decision,
      p_reason: data.reason,
      p_refund_amount: data.refundAmount,
    });
    if (error) throw new Error(error.message || "Couldn't moderate boost campaign.");
    return { ok: true };
  });

export const getAdminEconomicReadiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(economicReadinessSchema)
  .handler(async ({ data, context }) => {
    const { data: allowed, error: roleError } = await context.supabase.rpc("is_ping_admin");
    assertAdminRole(!roleError && allowed === true);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: summary, error } = await supabaseAdmin.rpc("admin_economic_readiness", {
      _days: data.days,
    });
    if (error) throw new Error("Couldn't inspect economic measurement readiness.");
    return summary;
  });

export const updateCourseReleaseSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(updateCourseScheduleSchema)
  .handler(async ({ data, context }) => {
    const { data: allowed, error: roleError } = await context.supabase.rpc("is_ping_admin");
    assertAdminRole(!roleError && allowed === true);
    const { error } = await (context.supabase as any).rpc("admin_update_course_release_schedule", {
      p_require_leapfrog: data.requireLeapfrogCompletion,
      p_interval_days: data.releaseIntervalDays,
      p_courses_per_cycle: data.coursesPerCycle,
      p_min_score: data.minAssessmentScore,
      p_release_order: data.releaseOrder,
    });
    if (error) throw new Error(error.message || "Couldn't update Ping Learn release schedule.");
    return { ok: true };
  });

/**
 * Separated Spotlight Editorial Permission Check (Addendum Section 13 & 20).
 * Grants access to users holding `spotlight_editor` or `admin` role without
 * exposing financial administration tools to editorial staff.
 */
export const checkSpotlightEditorAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const v2 = await (context.supabase as any).rpc("is_spotlight_editor");
    if (!v2.error) return { isEditor: v2.data === true };
    const { data, error } = await context.supabase.rpc("is_ping_admin");
    if (error) throw new Error("Couldn't verify editorial permissions.");
    return { isEditor: data === true };
  });

export const getSpotlightEditorialWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const check = await (context.supabase as any).rpc("is_spotlight_editor");
    const isEditor = !check.error
      ? check.data === true
      : (await context.supabase.rpc("is_ping_admin")).data === true;
    assertEditorialRole(isEditor);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [candRes, pubRes, auditRes] = await Promise.all([
      (supabaseAdmin as any)
        .from("spotlight_candidates")
        .select(
          "id,founder_id,business_id,source_type,headline,story_pitch,problem_statement,traction_evidence,evidence_urls,status,pro_verified_at,selection_reason,created_at,updated_at,founder:profiles!spotlight_candidates_founder_id_fkey(username,display_name,avatar_url)",
        )
        .order("updated_at", { ascending: false })
        .limit(50),
      (supabaseAdmin as any)
        .from("spotlight_publications")
        .select(
          "id,slug,founder_id,business_id,title,status,published_at,correction_note,updated_at",
        )
        .order("updated_at", { ascending: false })
        .limit(30),
      (supabaseAdmin as any)
        .from("spotlight_editorial_audit_logs")
        .select("id,actor_id,action,target_type,target_id,reason,created_at")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

    const missing =
      candRes.error?.code === "42P01" ||
      candRes.error?.code === "PGRST205" ||
      pubRes.error?.code === "42P01" ||
      pubRes.error?.code === "PGRST205";

    if (missing) {
      return { unmigrated: true, candidates: [], publications: [], auditLogs: [] };
    }

    return {
      unmigrated: false,
      candidates: (candRes.data ?? []) as Array<{
        id: string;
        founder_id: string;
        business_id: string | null;
        source_type: string;
        headline: string;
        story_pitch: string;
        problem_statement: string;
        traction_evidence: string;
        evidence_urls: string[];
        status: string;
        pro_verified_at: string | null;
        selection_reason: string;
        created_at: string;
        updated_at: string;
        founder: { username: string; display_name: string; avatar_url: string | null } | null;
      }>,
      publications: (pubRes.data ?? []) as Array<{
        id: string;
        slug: string;
        founder_id: string;
        business_id: string | null;
        title: string;
        status: string;
        published_at: string | null;
        correction_note: string;
        updated_at: string;
      }>,
      auditLogs: (auditRes.data ?? []) as Array<{
        id: string;
        actor_id: string;
        action: string;
        target_type: string;
        target_id: string | null;
        reason: string;
        created_at: string;
      }>,
    };
  });

export const decideSpotlightCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(spotlightDecisionSchema)
  .handler(async ({ data, context }) => {
    const check = await (context.supabase as any).rpc("is_spotlight_editor");
    const isEditor = !check.error
      ? check.data === true
      : (await context.supabase.rpc("is_ping_admin")).data === true;
    assertEditorialRole(isEditor);

    const { error } = await (context.supabase as any).rpc("editor_decide_spotlight_candidate", {
      p_candidate_id: data.candidateId,
      p_status: data.status,
      p_selection_reason: data.selectionReason,
      p_scores: data.scores ?? null,
      p_weighted_total: data.weightedTotal ?? null,
      p_internal_notes: data.internalNotes,
    });
    if (error) throw new Error(error.message || "Couldn't record Spotlight editorial decision.");
    return { ok: true };
  });

export const publishSpotlightFeature = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(spotlightPublishSchema)
  .handler(async ({ data, context }) => {
    const check = await (context.supabase as any).rpc("is_spotlight_editor");
    const isEditor = !check.error
      ? check.data === true
      : (await context.supabase.rpc("is_ping_admin")).data === true;
    assertEditorialRole(isEditor);

    const { error } = await (context.supabase as any).rpc("editor_publish_spotlight", {
      p_slug: data.slug,
      p_candidate_id: data.candidateId ?? null,
      p_founder_id: data.founderId,
      p_business_id: data.businessId ?? null,
      p_title: data.title,
      p_editorial_intro: data.editorialIntro,
      p_founder_story: data.founderStory,
      p_business_description: data.businessDescription,
      p_problem_solved: data.problemSolved,
      p_product_solution: data.productSolution,
      p_evidence_achievements: data.evidenceAchievements,
      p_featured_ping_ids: data.featuredPingIds,
      p_featured_clip_ids: data.featuredClipIds,
      p_dot_tags: data.dotTags,
      p_video_interview_url: data.videoInterviewUrl ?? null,
      p_founder_portrait_url: data.founderPortraitUrl ?? null,
      p_status: data.status,
      p_correction_note: data.correctionNote,
    });
    if (error) throw new Error(error.message || "Couldn't publish Spotlight feature.");
    return { ok: true };
  });
