import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ADMIN_PAGE_SIZE,
  adminListSchema,
  appointAdminSchema,
  assertAdminPermission,
  assertEditorialRole,
  assertPlatformOwner,
  economicReadinessSchema,
  moderateBoostSchema,
  moderationSchema,
  reviewVerificationSchema,
  revokeAdminSchema,
  setUserPermissionSchema,
  spotlightDecisionSchema,
  spotlightPublishSchema,
  updateCourseScheduleSchema,
  upsertMembershipPlanSchema,
  verifySignalSchema,
} from "./admin-policy";
import {
  evaluateAdminRoleMutation,
  hasAdminPermission,
  resolveEffectiveAdminPermissions,
  type AdminPermission,
  type EffectiveAdminAccess,
} from "./admin-rbac";

async function resolveCallerAdminAccess(supabase: any): Promise<EffectiveAdminAccess> {
  try {
    const profileRes = await supabase.rpc("get_my_admin_profile");
    if (
      !profileRes?.error &&
      profileRes?.data &&
      typeof profileRes.data === "object" &&
      "isAdmin" in profileRes.data
    ) {
      const d = profileRes.data as {
        isAdmin?: boolean;
        isPlatformOwner?: boolean;
        roles?: string[];
        permissions?: string[];
      };
      const resolved = resolveEffectiveAdminPermissions(Array.isArray(d.roles) ? d.roles : []);
      const serverPerms = Array.isArray(d.permissions)
        ? (d.permissions as AdminPermission[])
        : resolved.permissions;
      return {
        isAdmin: d.isAdmin === true && (d.isPlatformOwner === true || serverPerms.length > 0),
        isPlatformOwner: d.isPlatformOwner === true,
        roles: resolved.roles,
        permissions: serverPerms,
      };
    }
  } catch {
    // Fall back to legacy is_ping_admin RPC before migration 0035 is applied remotely
  }

  const { data, error } = await supabase.rpc("is_ping_admin");
  if (error) throw new Error("Couldn't verify administrator access.");
  if (data === true) {
    return resolveEffectiveAdminPermissions(["admin"]);
  }
  return {
    isAdmin: false,
    isPlatformOwner: false,
    roles: [],
    permissions: [],
  };
}

const VIEW_PERMISSION_MAP: Record<string, AdminPermission> = {
  users: "people.view",
  verifications: "people.view",
  pings: "content.view",
  reports: "content.view",
  signals: "communities.view",
  hubs: "communities.view",
  plans: "economy.view",
  boosts: "economy.view",
  businesses: "business.view",
  learn: "growth.view",
  early_access: "growth.view",
  system_errors: "system.view_health",
  staff: "admin.view_staff",
  audit: "admin.view_audit",
};

export interface AdminControlCentreMetrics {
  checkedAt: string | null;
  source: "control_centre_v2" | "legacy_admin_metrics";
  accounts: number | null;
  activeCreators30d: number | null;
  newRegistrations24h: number | null;
  newRegistrations7d: number | null;
  newRegistrations30d: number | null;
  onlineNow: number | null;
  dau: number | null;
  wau: number | null;
  mau: number | null;
  pings: number | null;
  hiddenPings: number | null;
  pings24h: number | null;
  likes: number | null;
  repings: number | null;
  moments: number | null;
  clips: number | null;
  shares: number | null;
  referralClicks: number | null;
  hubs: number | null;
  hubMemberships: number | null;
  signals: number | null;
  signalFollowers: number | null;
  messagesSentTotal: number | null;
  messagesSent24h: number | null;
  messageDeliveryFailures: number | null;
  openReports: number | null;
  resolvedReports: number | null;
  dotTransactions: number | null;
  activeSubscriptions: number | null;
  boostCampaignsTotal: number | null;
  boostCampaignsActive: number | null;
  boostDotVolume: number | null;
  businessesTotal: number | null;
  businessEnquiriesTotal: number | null;
  earlyAccessRegistrations: number | null;
  downloadAttributionEvents: number | null;
  openErrors: number | null;
  failedBackgroundJobs: number | null;
  appointedStaffCount: number | null;
  auditEvents30d: number | null;
}

const numOrNull = (val: unknown): number | null =>
  typeof val === "number" && Number.isFinite(val) ? val : null;

export const checkAdminAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return resolveCallerAdminAccess(context.supabase);
  });

export const getAdminOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const access = await resolveCallerAdminAccess(context.supabase);
    assertAdminPermission(hasAdminPermission(access, "overview.view"), "overview.view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("admin_metrics");
    if (error) throw new Error("Dashboard health check failed. Please retry.");
    return data;
  });

export const getAdminControlCentreMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminControlCentreMetrics> => {
    const access = await resolveCallerAdminAccess(context.supabase);
    assertAdminPermission(hasAdminPermission(access, "overview.view"), "overview.view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [v2Res, legacyRes] = await Promise.all([
      (supabaseAdmin as any).rpc("admin_control_centre_metrics"),
      supabaseAdmin.rpc("admin_metrics"),
    ]);

    const legacy =
      !legacyRes.error && legacyRes.data && typeof legacyRes.data === "object"
        ? (legacyRes.data as Partial<AdminControlCentreMetrics>)
        : null;

    if (!v2Res.error && v2Res.data && typeof v2Res.data === "object") {
      const d = v2Res.data as Partial<AdminControlCentreMetrics>;
      return {
        checkedAt: typeof d.checkedAt === "string" ? d.checkedAt : null,
        source: "control_centre_v2",
        accounts: numOrNull(d.accounts),
        activeCreators30d: numOrNull(legacy?.activeCreators30d),
        newRegistrations24h: numOrNull(d.newRegistrations24h),
        newRegistrations7d: numOrNull(d.newRegistrations7d),
        newRegistrations30d: numOrNull(d.newRegistrations30d),
        onlineNow: numOrNull(d.onlineNow),
        dau: numOrNull(d.dau),
        wau: numOrNull(d.wau),
        mau: numOrNull(d.mau),
        pings: numOrNull(d.pings),
        hiddenPings: numOrNull(d.hiddenPings),
        pings24h: numOrNull(d.pings24h),
        likes: numOrNull(legacy?.likes),
        repings: numOrNull(d.repings),
        moments: numOrNull(d.moments),
        clips: numOrNull(d.clips),
        shares: numOrNull(d.shares),
        referralClicks: numOrNull(d.referralClicks),
        hubs: numOrNull(d.hubs),
        hubMemberships: numOrNull(d.hubMemberships),
        signals: numOrNull(d.signals),
        signalFollowers: numOrNull(d.signalFollowers),
        messagesSentTotal: numOrNull(d.messagesSentTotal),
        messagesSent24h: numOrNull(d.messagesSent24h),
        messageDeliveryFailures: numOrNull(d.messageDeliveryFailures),
        openReports: numOrNull(d.openReports),
        resolvedReports: numOrNull(d.resolvedReports),
        dotTransactions: numOrNull(d.dotTransactions),
        activeSubscriptions: numOrNull(d.activeSubscriptions),
        boostCampaignsTotal: numOrNull(d.boostCampaignsTotal),
        boostCampaignsActive: numOrNull(d.boostCampaignsActive),
        boostDotVolume: numOrNull(d.boostDotVolume),
        businessesTotal: numOrNull(d.businessesTotal),
        businessEnquiriesTotal: numOrNull(d.businessEnquiriesTotal),
        earlyAccessRegistrations: numOrNull(d.earlyAccessRegistrations),
        downloadAttributionEvents: numOrNull(d.downloadAttributionEvents),
        openErrors: numOrNull(d.openErrors),
        failedBackgroundJobs: numOrNull(d.failedBackgroundJobs),
        appointedStaffCount: numOrNull(d.appointedStaffCount),
        auditEvents30d: numOrNull(d.auditEvents30d),
      };
    }

    if (!legacy) {
      throw new Error("Dashboard health check failed. Please retry.");
    }

    // Honest partial fallback before migration 0035 is applied remotely — never fabricate numbers
    return {
      checkedAt: typeof legacy.checkedAt === "string" ? legacy.checkedAt : null,
      source: "legacy_admin_metrics",
      accounts: numOrNull(legacy.accounts),
      activeCreators30d: numOrNull(legacy.activeCreators30d),
      newRegistrations24h: null,
      newRegistrations7d: null,
      newRegistrations30d: null,
      onlineNow: null,
      dau: null,
      wau: null,
      mau: null,
      pings: numOrNull(legacy.pings),
      hiddenPings: numOrNull(legacy.hiddenPings),
      pings24h: null,
      likes: numOrNull(legacy.likes),
      repings: null,
      moments: null,
      clips: null,
      shares: null,
      referralClicks: null,
      hubs: null,
      hubMemberships: null,
      signals: null,
      signalFollowers: null,
      messagesSentTotal: null,
      messagesSent24h: null,
      messageDeliveryFailures: null,
      openReports: numOrNull(legacy.openReports),
      resolvedReports: null,
      dotTransactions: null,
      activeSubscriptions: null,
      boostCampaignsTotal: null,
      boostCampaignsActive: null,
      boostDotVolume: null,
      businessesTotal: null,
      businessEnquiriesTotal: null,
      earlyAccessRegistrations: null,
      downloadAttributionEvents: null,
      openErrors: null,
      failedBackgroundJobs: null,
      appointedStaffCount: null,
      auditEvents30d: null,
    };
  });

export const getAdminList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(adminListSchema)
  .handler(async ({ data, context }) => {
    const access = await resolveCallerAdminAccess(context.supabase);
    const requiredPerm = VIEW_PERMISSION_MAP[data.view] ?? "overview.view";
    assertAdminPermission(hasAdminPermission(access, requiredPerm), requiredPerm);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const start = data.page * ADMIN_PAGE_SIZE;
    const search = data.search.replace(/[%_\\]/g, "\\$&");

    if (data.view === "users") {
      let q = supabaseAdmin
        .from("profiles")
        .select("id,username,display_name,bio,created_at", { count: "exact" });
      if (search) q = q.or(`username.ilike.%${search}%,display_name.ilike.%${search}%`);
      const result = await q
        .order("created_at", { ascending: false })
        .order("id")
        .range(start, start + ADMIN_PAGE_SIZE - 1);
      if (result.error) throw new Error("Couldn't load users.");
      return { view: "users" as const, rows: result.data ?? [], total: Number(result.count ?? 0) };
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
      return { view: "pings" as const, rows: result.data ?? [], total: Number(result.count ?? 0) };
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
      return {
        view: "reports" as const,
        rows: result.data ?? [],
        total: Number(result.count ?? 0),
      };
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
          return { view: "signals" as const, rows: [], total: 0, unmigrated: true };
        }
        throw new Error("Couldn't load Signals.");
      }
      return {
        view: "signals" as const,
        rows: result.data ?? [],
        total: Number(result.count ?? 0),
        unmigrated: false,
      };
    }

    if (data.view === "hubs") {
      let q = (supabaseAdmin as any)
        .from("hubs")
        .select("id,name,slug,category,is_private,member_count,created_at", { count: "exact" });
      if (search) q = q.or(`name.ilike.%${search}%,category.ilike.%${search}%`);
      const result = await q
        .order("created_at", { ascending: false })
        .range(start, start + ADMIN_PAGE_SIZE - 1);
      if (result.error) {
        const code = result.error.code;
        if (code === "42P01" || code === "PGRST205") {
          return { view: "hubs" as const, rows: [], total: 0, unmigrated: true };
        }
        throw new Error("Couldn't load Hubs.");
      }
      return {
        view: "hubs" as const,
        rows: (result.data ?? []) as Array<{
          id: string;
          name: string;
          slug: string;
          category: string | null;
          is_private: boolean;
          member_count: number | null;
          created_at: string;
        }>,
        total: Number(result.count ?? 0),
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
          return { view: "verifications" as const, rows: [], total: 0, unmigrated: true };
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
        total: Number(result.count ?? 0),
        unmigrated: false,
      };
    }

    if (data.view === "plans") {
      const result = await (supabaseAdmin as any)
        .from("membership_plans")
        .select(
          "slug,name,badge,tagline,dot_price,duration_days,benefits,perks,is_active,sort_order",
          { count: "exact" },
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

    if (data.view === "businesses") {
      let q = (supabaseAdmin as any)
        .from("business_profiles")
        .select("id,name,slug,category,location,verification_status,owner_id,created_at", {
          count: "exact",
        });
      if (search) q = q.or(`name.ilike.%${search}%,category.ilike.%${search}%`);
      const result = await q
        .order("created_at", { ascending: false })
        .range(start, start + ADMIN_PAGE_SIZE - 1);
      if (result.error) {
        const code = result.error.code;
        if (code === "42P01" || code === "PGRST205") {
          return { view: "businesses" as const, rows: [], total: 0, unmigrated: true };
        }
        throw new Error("Couldn't load businesses.");
      }
      return {
        view: "businesses" as const,
        rows: (result.data ?? []) as Array<{
          id: string;
          name: string;
          slug: string;
          category: string;
          location: string | null;
          verification_status: string;
          owner_id: string;
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

    if (data.view === "early_access") {
      let q = (supabaseAdmin as any)
        .from("early_access_registrations")
        .select(
          "id,email,platform,device_model,referral_source,source_site,utm_source,status,created_at",
          { count: "exact" },
        );
      if (search) {
        q = q.or(
          `platform.ilike.%${search}%,referral_source.ilike.%${search}%,source_site.ilike.%${search}%,status.ilike.%${search}%`,
        );
      }
      const result = await q
        .order("created_at", { ascending: false })
        .range(start, start + ADMIN_PAGE_SIZE - 1);
      if (result.error) {
        const code = result.error.code;
        if (code === "42P01" || code === "PGRST205") {
          return { view: "early_access" as const, rows: [], total: 0, unmigrated: true };
        }
        throw new Error("Couldn't load early-access registrations.");
      }
      // Redact full local-part of email for privacy outside owner view
      const safeRows = ((result.data ?? []) as Array<any>).map((row) => {
        const emailStr = String(row.email ?? "");
        const [local, domain] = emailStr.split("@");
        const maskedEmail =
          access.isPlatformOwner || !domain
            ? emailStr
            : `${(local ?? "").slice(0, 2)}***@${domain}`;
        return {
          id: String(row.id),
          email: maskedEmail,
          platform: String(row.platform),
          device_model: String(row.device_model ?? ""),
          referral_source: String(row.referral_source ?? "direct"),
          source_site: String(row.source_site ?? ""),
          utm_source: String(row.utm_source ?? ""),
          status: String(row.status ?? "registered"),
          created_at: String(row.created_at),
        };
      });
      return {
        view: "early_access" as const,
        rows: safeRows,
        total: Number(result.count ?? 0),
        unmigrated: false,
      };
    }

    if (data.view === "system_errors") {
      let q = (supabaseAdmin as any)
        .from("system_error_logs")
        .select("id,source,severity,category,message,status,created_at", { count: "exact" });
      if (search) {
        q = q.or(`category.ilike.%${search}%,message.ilike.%${search}%,severity.ilike.%${search}%`);
      }
      const result = await q
        .order("created_at", { ascending: false })
        .range(start, start + ADMIN_PAGE_SIZE - 1);
      if (result.error) {
        const code = result.error.code;
        if (code === "42P01" || code === "PGRST205") {
          return { view: "system_errors" as const, rows: [], total: 0, unmigrated: true };
        }
        throw new Error("Couldn't load system error logs.");
      }
      return {
        view: "system_errors" as const,
        rows: (result.data ?? []) as Array<{
          id: string;
          source: string;
          severity: string;
          category: string;
          message: string;
          status: string;
          created_at: string;
        }>,
        total: Number(result.count ?? 0),
        unmigrated: false,
      };
    }

    if (data.view === "staff") {
      const rolesRes = await supabaseAdmin
        .from("user_roles")
        .select("id,user_id,role,created_at", { count: "exact" })
        .order("created_at", { ascending: false });
      if (rolesRes.error) throw new Error("Couldn't load administrator roster.");

      const rowsRaw = rolesRes.data ?? [];
      const userIds = Array.from(new Set(rowsRaw.map((r) => r.user_id)));

      const [profilesRes, overridesRes] = await Promise.all([
        userIds.length > 0
          ? supabaseAdmin.from("profiles").select("id,username,display_name").in("id", userIds)
          : Promise.resolve({
              data: [] as Array<{ id: string; username: string; display_name: string }>,
              error: null,
            }),
        userIds.length > 0
          ? (supabaseAdmin as any)
              .from("admin_user_permissions")
              .select("user_id,permission,effect,reason,updated_at")
              .in("user_id", userIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      const profileMap = new Map<string, { username: string; display_name: string }>();
      for (const p of profilesRes.data ?? []) {
        profileMap.set(p.id, { username: p.username, display_name: p.display_name });
      }

      const overridesByUser = new Map<
        string,
        Array<{ permission: string; effect: "grant" | "revoke"; reason: string }>
      >();
      if (!overridesRes.error && Array.isArray(overridesRes.data)) {
        for (const o of overridesRes.data as Array<any>) {
          const list = overridesByUser.get(o.user_id) ?? [];
          list.push({
            permission: String(o.permission),
            effect: o.effect === "revoke" ? "revoke" : "grant",
            reason: String(o.reason ?? ""),
          });
          overridesByUser.set(o.user_id, list);
        }
      }

      const grouped = new Map<
        string,
        {
          user_id: string;
          username: string;
          display_name: string;
          roles: string[];
          overrides: Array<{ permission: string; effect: "grant" | "revoke"; reason: string }>;
          since: string;
        }
      >();

      for (const r of rowsRaw) {
        const prof = profileMap.get(r.user_id);
        const existing = grouped.get(r.user_id);
        if (existing) {
          if (!existing.roles.includes(r.role)) existing.roles.push(r.role);
        } else {
          grouped.set(r.user_id, {
            user_id: r.user_id,
            username: prof?.username ?? "unknown",
            display_name: prof?.display_name ?? r.user_id.slice(0, 8),
            roles: [r.role],
            overrides: overridesByUser.get(r.user_id) ?? [],
            since: r.created_at,
          });
        }
      }

      const allStaff = Array.from(grouped.values()).filter((s) =>
        search
          ? s.username.toLowerCase().includes(search.toLowerCase()) ||
            s.display_name.toLowerCase().includes(search.toLowerCase()) ||
            s.roles.some((r) => r.toLowerCase().includes(search.toLowerCase()))
          : true,
      );

      return {
        view: "staff" as const,
        rows: allStaff.slice(start, start + ADMIN_PAGE_SIZE),
        total: allStaff.length,
        unmigrated: Boolean(
          overridesRes.error &&
          (overridesRes.error.code === "42P01" || overridesRes.error.code === "PGRST205"),
        ),
      };
    }

    let q = supabaseAdmin
      .from("moderation_audit")
      .select("id,actor_id,action,target_id,reason,created_at", { count: "exact" });
    if (search) q = q.or(`action.ilike.%${search}%,reason.ilike.%${search}%`);
    const result = await q
      .order("created_at", { ascending: false })
      .order("id")
      .range(start, start + ADMIN_PAGE_SIZE - 1);
    if (result.error) throw new Error("Couldn't load audit history.");
    return { view: "audit" as const, rows: result.data ?? [], total: Number(result.count ?? 0) };
  });

export const moderatePing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(moderationSchema)
  .handler(async ({ data, context }) => {
    const access = await resolveCallerAdminAccess(context.supabase);
    assertAdminPermission(hasAdminPermission(access, "content.moderate"), "content.moderate");
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
    const access = await resolveCallerAdminAccess(context.supabase);
    assertAdminPermission(hasAdminPermission(access, "communities.manage"), "communities.manage");
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
    const access = await resolveCallerAdminAccess(context.supabase);
    assertAdminPermission(hasAdminPermission(access, "people.verify"), "people.verify");
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
    const access = await resolveCallerAdminAccess(context.supabase);
    assertAdminPermission(
      hasAdminPermission(access, "economy.manage_plans"),
      "economy.manage_plans",
    );
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
    const access = await resolveCallerAdminAccess(context.supabase);
    assertAdminPermission(
      hasAdminPermission(access, "economy.moderate_boosts"),
      "economy.moderate_boosts",
    );
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
    const access = await resolveCallerAdminAccess(context.supabase);
    assertAdminPermission(hasAdminPermission(access, "economy.view"), "economy.view");
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
    const access = await resolveCallerAdminAccess(context.supabase);
    assertAdminPermission(
      hasAdminPermission(access, "learn.manage_schedule"),
      "learn.manage_schedule",
    );
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
 * Platform Owner Governance: Appoint an Administrator with a specific role.
 * Strictly blocks self-escalation, blocks Platform Owner creation via UI/RPC,
 * and rejects ordinary administrators unless explicitly granted `admin.appoint_admins`.
 */
export const appointAdminRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(appointAdminSchema)
  .handler(async ({ data, context }) => {
    const access = await resolveCallerAdminAccess(context.supabase);
    const decision = evaluateAdminRoleMutation({
      action: "appoint",
      actorId: context.userId,
      actorAccess: access,
      targetUserId: data.targetUserId,
      targetRole: data.role === "spotlight_editor" ? undefined : data.role,
    });
    if (!decision.allowed) {
      throw new Error(decision.reason || "Access denied");
    }

    const { error } = await (context.supabase as any).rpc("owner_appoint_admin", {
      p_target_user_id: data.targetUserId,
      p_role: data.role,
      p_reason: data.reason,
    });
    if (error) throw new Error(error.message || "Couldn't appoint administrator.");
    return { ok: true };
  });

/**
 * Platform Owner Governance: Revoke an Administrator's role or full admin access.
 */
export const revokeAdminRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(revokeAdminSchema)
  .handler(async ({ data, context }) => {
    const access = await resolveCallerAdminAccess(context.supabase);
    assertPlatformOwner(access.isPlatformOwner);
    const decision = evaluateAdminRoleMutation({
      action: "revoke",
      actorId: context.userId,
      actorAccess: access,
      targetUserId: data.targetUserId,
    });
    if (!decision.allowed) {
      throw new Error(decision.reason || "Access denied");
    }

    const { error } = await (context.supabase as any).rpc("owner_revoke_admin", {
      p_target_user_id: data.targetUserId,
      p_role: data.role ?? null,
      p_reason: data.reason,
    });
    if (error) throw new Error(error.message || "Couldn't revoke administrator access.");
    return { ok: true };
  });

/**
 * Platform Owner Governance: Assign or revoke an individual permission override.
 */
export const setAdminUserPermission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(setUserPermissionSchema)
  .handler(async ({ data, context }) => {
    const access = await resolveCallerAdminAccess(context.supabase);
    assertPlatformOwner(access.isPlatformOwner);
    const decision = evaluateAdminRoleMutation({
      action: "set_permission",
      actorId: context.userId,
      actorAccess: access,
      targetUserId: data.targetUserId,
    });
    if (!decision.allowed) {
      throw new Error(decision.reason || "Access denied");
    }

    const { error } = await (context.supabase as any).rpc("owner_set_user_permission", {
      p_target_user_id: data.targetUserId,
      p_permission: data.permission,
      p_effect: data.effect,
      p_reason: data.reason,
    });
    if (error) throw new Error(error.message || "Couldn't update individual permission.");
    return { ok: true };
  });

/**
 * Real referral & multi-site download attribution summary for Growth module.
 */
export const getGrowthAttributionBreakdown = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const access = await resolveCallerAdminAccess(context.supabase);
    assertAdminPermission(hasAdminPermission(access, "growth.view"), "growth.view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await (supabaseAdmin as any)
      .from("download_attribution_events")
      .select("event_kind,platform,referral_source,source_site,created_at")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") {
        return {
          unmigrated: true,
          bySource: [] as Array<{
            source: string;
            pageViews: number;
            installs: number;
            signups: number;
          }>,
          totalEvents: 0,
        };
      }
      throw new Error("Couldn't load download attribution metrics.");
    }

    const bucket = new Map<
      string,
      { source: string; pageViews: number; installs: number; signups: number }
    >();
    const rows = (data ?? []) as Array<{
      event_kind: string;
      referral_source: string;
      source_site: string;
    }>;

    for (const r of rows) {
      const key = r.source_site || r.referral_source || "direct";
      const cur = bucket.get(key) ?? { source: key, pageViews: 0, installs: 0, signups: 0 };
      if (r.event_kind === "page_view") cur.pageViews += 1;
      if (
        r.event_kind === "apk_download_click" ||
        r.event_kind === "pwa_installed" ||
        r.event_kind === "testflight_click"
      ) {
        cur.installs += 1;
      }
      if (r.event_kind === "early_access_submit") cur.signups += 1;
      bucket.set(key, cur);
    }

    return {
      unmigrated: false,
      bySource: Array.from(bucket.values()).sort((a, b) => b.pageViews - a.pageViews),
      totalEvents: rows.length,
    };
  });

/**
 * Separated Spotlight Editorial Permission Check (Addendum Section 13 & 20).
 * Grants access to users holding `spotlight_editor`, `admin`, or `platform_owner`
 * without exposing financial administration tools to editorial staff.
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
