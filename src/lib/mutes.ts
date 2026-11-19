import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/lib/pings";
import { trackEvent } from "@/lib/telemetry";

export interface MutedUserEntry {
  muted_id: string;
  created_at: string;
  profile?: Pick<Profile, "id" | "username" | "display_name" | "avatar_url"> | null;
}

const LOCAL_MUTES_PREFIX = "ping_muted_accounts_v1:";

function readLocalMutedIds(userId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(`${LOCAL_MUTES_PREFIX}${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeLocalMutedIds(userId: string, ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${LOCAL_MUTES_PREFIX}${userId}`, JSON.stringify(ids));
  } catch {
    // Ignore storage quota errors
  }
}

function isMissingTableOrRpc(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST205" ||
    error.code === "PGRST202" ||
    error.code === "42P01" ||
    error.code === "42883" ||
    /could not find the (table|function)|does not exist/i.test(error.message ?? "")
  );
}

export function mutedUsersQuery(userId?: string) {
  return queryOptions({
    queryKey: ["muted-users", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<MutedUserEntry[]> => {
      if (!userId) return [];
      const { data, error } = await (supabase.from as any)("user_mutes")
        .select(
          "muted_id, created_at, profile:profiles!user_mutes_muted_id_fkey(id, username, display_name, avatar_url)",
        )
        .eq("muter_id", userId)
        .order("created_at", { ascending: false });

      if (error) {
        if (isMissingTableOrRpc(error)) {
          const localIds = readLocalMutedIds(userId);
          if (localIds.length === 0) return [];
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, username, display_name, avatar_url")
            .in("id", localIds);
          const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
          return localIds.map((id) => ({
            muted_id: id,
            created_at: new Date().toISOString(),
            profile: profileMap.get(id) ?? null,
          }));
        }
        throw error;
      }

      const rows = (data ?? []) as MutedUserEntry[];
      writeLocalMutedIds(
        userId,
        rows.map((r) => r.muted_id),
      );
      return rows;
    },
  });
}

export function useMuteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, targetUserId }: { userId: string; targetUserId: string }) => {
      if (userId === targetUserId) throw new Error("You cannot mute your own account.");
      const { error } = await (supabase.from as any)("user_mutes").insert({
        muter_id: userId,
        muted_id: targetUserId,
      });

      if (error && error.code !== "23505") {
        if (!isMissingTableOrRpc(error)) throw error;
      }

      const current = new Set(readLocalMutedIds(userId));
      current.add(targetUserId);
      writeLocalMutedIds(userId, [...current]);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["muted-users", vars.userId] });
    },
  });
}

export function useUnmuteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, targetUserId }: { userId: string; targetUserId: string }) => {
      const { error } = await (supabase.from as any)("user_mutes")
        .delete()
        .eq("muter_id", userId)
        .eq("muted_id", targetUserId);

      if (error && !isMissingTableOrRpc(error)) {
        throw error;
      }

      const next = readLocalMutedIds(userId).filter((id) => id !== targetUserId);
      writeLocalMutedIds(userId, next);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["muted-users", vars.userId] });
    },
  });
}

export interface AccountDataExportPayload {
  exported_at: string;
  schema_version: string;
  user_id: string;
  profile: Record<string, unknown>;
  connections: unknown[];
  pings: unknown[];
  moments: unknown[];
  hub_memberships: unknown[];
  saved_pings: unknown[];
  blocked_users: unknown[];
  muted_users: unknown[];
  privacy_preferences: Record<string, unknown>;
  dot_wallet: Record<string, unknown>;
}

/**
 * Generates an owner-scoped account data export bundle (prefers server RPC from
 * migration 0028 and gracefully falls back to authenticated owner-scoped reads
 * when migration 0028 is pending on the connected database).
 */
export async function buildAccountDataExport(userId: string): Promise<AccountDataExportPayload> {
  const { data: rpcData, error: rpcError } = await (supabase.rpc as any)("export_my_account_data");
  if (!rpcError && rpcData && typeof rpcData === "object") {
    trackEvent("account_data_exported", { source: "rpc" });
    return rpcData as AccountDataExportPayload;
  }

  if (rpcError && !isMissingTableOrRpc(rpcError)) {
    throw rpcError;
  }

  // Fallback owner-scoped reads for pre-0028 environments
  const [
    profileRes,
    connectionsRes,
    pingsRes,
    momentsRes,
    hubsRes,
    savedRes,
    blocksRes,
    privacyRes,
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("profile_connections").select("*").eq("user_id", userId),
    supabase
      .from("pings")
      .select(
        "id, category, content, image_url, cta_url, cta_label, visibility, created_at, updated_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("moments")
      .select("id, media_type, caption, location, audience, created_at, expires_at")
      .eq("author_id", userId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("hub_members")
      .select("hub_id, role, status, joined_at")
      .eq("user_id", userId)
      .limit(200),
    supabase.from("saved_pings").select("ping_id, created_at").eq("user_id", userId).limit(200),
    supabase.from("user_blocks").select("blocked_id, created_at").eq("blocker_id", userId),
    supabase
      .from("user_privacy_preferences")
      .select("read_receipts_enabled, active_presence_enabled, last_active_enabled")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  trackEvent("account_data_exported", { source: "client_fallback" });

  return {
    exported_at: new Date().toISOString(),
    schema_version: "ping_export_v1",
    user_id: userId,
    profile: (profileRes.data ?? {}) as Record<string, unknown>,
    connections: connectionsRes.data ?? [],
    pings: pingsRes.data ?? [],
    moments: momentsRes.data ?? [],
    hub_memberships: hubsRes.data ?? [],
    saved_pings: savedRes.data ?? [],
    blocked_users: blocksRes.data ?? [],
    muted_users: readLocalMutedIds(userId).map((muted_id) => ({ muted_id })),
    privacy_preferences: (privacyRes.data ?? {}) as Record<string, unknown>,
    dot_wallet: {},
  };
}

export function triggerAccountExportDownload(payload: AccountDataExportPayload): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const dateStamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ping-account-export-${dateStamp}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
