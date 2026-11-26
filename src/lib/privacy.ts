import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DmPermission = "everyone" | "requests" | "mutual_follows" | "nobody";

export interface UserPrivacyPreferences {
  user_id: string;
  read_receipts_enabled: boolean;
  active_presence_enabled: boolean;
  last_active_enabled: boolean;
  dm_permission: DmPermission;
}

function isMissingColumnError(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
  return (
    code === "42703" ||
    code === "PGRST204" ||
    (message.includes("dm_permission") &&
      (message.includes("column") || message.includes("schema")))
  );
}

const DEFAULT_PREFS = (userId: string): UserPrivacyPreferences => ({
  user_id: userId,
  read_receipts_enabled: true,
  active_presence_enabled: true,
  last_active_enabled: true,
  dm_permission: "requests",
});

export function privacyQuery(userId: string | undefined) {
  return {
    queryKey: ["privacy-preferences", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<UserPrivacyPreferences> => {
      if (!userId) return DEFAULT_PREFS("");

      const { data, error } = await (supabase as any)
        .from("user_privacy_preferences")
        .select(
          "user_id, read_receipts_enabled, active_presence_enabled, last_active_enabled, dm_permission",
        )
        .eq("user_id", userId)
        .maybeSingle();

      if (error && isMissingColumnError(error)) {
        const { data: legacyData, error: legacyError } = await supabase
          .from("user_privacy_preferences")
          .select("user_id, read_receipts_enabled, active_presence_enabled, last_active_enabled")
          .eq("user_id", userId)
          .maybeSingle();

        if (legacyError) {
          console.warn("Failed to load privacy preferences:", legacyError);
        }
        if (!legacyData) return DEFAULT_PREFS(userId);
        return {
          ...(legacyData as Omit<UserPrivacyPreferences, "dm_permission">),
          dm_permission: "requests",
        };
      }

      if (error) {
        console.warn("Failed to load privacy preferences:", error);
      }

      if (!data) return DEFAULT_PREFS(userId);

      return {
        ...DEFAULT_PREFS(userId),
        ...(data as Partial<UserPrivacyPreferences>),
        dm_permission: (data.dm_permission as DmPermission | undefined) ?? "requests",
      };
    },
  };
}

export function useUserPrivacy(userId: string | undefined) {
  const qc = useQueryClient();
  const query = useQuery(privacyQuery(userId));

  const mutation = useMutation({
    mutationFn: async (updated: Partial<UserPrivacyPreferences>) => {
      if (!userId) throw new Error("Not logged in");

      const basePayload = {
        user_id: userId,
        read_receipts_enabled:
          updated.read_receipts_enabled ?? query.data?.read_receipts_enabled ?? true,
        active_presence_enabled:
          updated.active_presence_enabled ?? query.data?.active_presence_enabled ?? true,
        last_active_enabled: updated.last_active_enabled ?? query.data?.last_active_enabled ?? true,
        updated_at: new Date().toISOString(),
      };

      const fullPayload = {
        ...basePayload,
        dm_permission: updated.dm_permission ?? query.data?.dm_permission ?? "requests",
      };

      const { error } = await (supabase as any)
        .from("user_privacy_preferences")
        .upsert(fullPayload);

      if (error) {
        if (isMissingColumnError(error) && updated.dm_permission === undefined) {
          const { error: fallbackErr } = await supabase
            .from("user_privacy_preferences")
            .upsert(basePayload);
          if (fallbackErr) throw fallbackErr;
          return;
        }
        throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["privacy-preferences", userId] });
    },
  });

  return {
    preferences: query.data ?? DEFAULT_PREFS(userId ?? ""),
    isLoading: query.isLoading,
    updatePrivacy: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
}
