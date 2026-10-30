import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ADMIN_PAGE_SIZE, adminListSchema, moderationSchema, assertAdminRole } from "./admin-policy";

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
  .inputValidator(adminListSchema)
  .handler(async ({ data, context }) => {
    const { data: allowed, error: roleError } = await context.supabase.rpc("is_ping_admin");
    assertAdminRole(!roleError && allowed === true);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const start = data.page * ADMIN_PAGE_SIZE;
    const search = data.search.replace(/[%_\\]/g, "\\$&");
    if (data.view === "users") {
      let q = supabaseAdmin.from("profiles").select("id,username,display_name,bio,created_at", { count: "exact" });
      if (search) q = q.ilike("username", `%${search}%`);
      const result = await q.order("created_at", { ascending: false }).order("id").range(start, start + ADMIN_PAGE_SIZE - 1);
      if (result.error) throw new Error("Couldn't load users.");
      return { view: "users" as const, rows: result.data ?? [], total: result.count ?? 0 };
    }
    if (data.view === "pings") {
      let q = supabaseAdmin.from("pings").select("id,user_id,content,category,created_at,hidden_at,author:profiles!pings_user_id_fkey(username,display_name)", { count: "exact" });
      if (search) q = q.ilike("content", `%${search}%`);
      const result = await q.order("created_at", { ascending: false }).order("id").range(start, start + ADMIN_PAGE_SIZE - 1);
      if (result.error) throw new Error("Couldn't load Pings.");
      return { view: "pings" as const, rows: result.data ?? [], total: result.count ?? 0 };
    }
    if (data.view === "reports") {
      let q = supabaseAdmin.from("reports").select("id,ping_id,reason,details,created_at,resolved_at", { count: "exact" }).is("resolved_at", null);
      if (search) q = q.ilike("reason", `%${search}%`);
      const result = await q.order("created_at", { ascending: false }).order("id").range(start, start + ADMIN_PAGE_SIZE - 1);
      if (result.error) throw new Error("Couldn't load reports.");
      return { view: "reports" as const, rows: result.data ?? [], total: result.count ?? 0 };
    }
    let q = supabaseAdmin.from("moderation_audit").select("id,actor_id,action,target_id,reason,created_at", { count: "exact" });
    if (search) q = q.ilike("action", `%${search}%`);
    const result = await q.order("created_at", { ascending: false }).order("id").range(start, start + ADMIN_PAGE_SIZE - 1);
    if (result.error) throw new Error("Couldn't load audit history.");
    return { view: "audit" as const, rows: result.data ?? [], total: result.count ?? 0 };
  });

export const moderatePing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(moderationSchema)
  .handler(async ({ data, context }) => {
    const { data: allowed, error: roleError } = await context.supabase.rpc("is_ping_admin");
    assertAdminRole(!roleError && allowed === true);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("admin_moderate", { _actor: context.userId, _target: data.id, _action: data.action, _reason: data.reason });
    if (error) throw new Error("Couldn't complete moderation. No success has been recorded; please retry.");
    return { ok: true };
  });