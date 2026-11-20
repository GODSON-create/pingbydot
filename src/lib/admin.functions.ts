import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ADMIN_PAGE_SIZE,
  adminListSchema,
  economicReadinessSchema,
  moderationSchema,
  reviewVerificationSchema,
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
