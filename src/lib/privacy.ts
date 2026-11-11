import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface UserPrivacyPreferences {
  user_id: string;
  read_receipts_enabled: boolean;
  active_presence_enabled: boolean;
  last_active_enabled: boolean;
}

export function privacyQuery(userId: string | undefined) {
  return {
    queryKey: ["privacy-preferences", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<UserPrivacyPreferences> => {
      if (!userId) {
        return {
          user_id: "",
          read_receipts_enabled: true,
          active_presence_enabled: true,
          last_active_enabled: true,
        };
      }

      const { data, error } = await supabase
        .from("user_privacy_preferences")
        .select("user_id, read_receipts_enabled, active_presence_enabled, last_active_enabled")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        console.warn("Failed to load privacy preferences:", error);
      }

      if (!data) {
        return {
          user_id: userId,
          read_receipts_enabled: true,
          active_presence_enabled: true,
          last_active_enabled: true,
        };
      }

      return data as UserPrivacyPreferences;
    },
  };
}

export function useUserPrivacy(userId: string | undefined) {
  const qc = useQueryClient();
  const query = useQuery(privacyQuery(userId));

  const mutation = useMutation({
    mutationFn: async (updated: Partial<UserPrivacyPreferences>) => {
      if (!userId) throw new Error("Not logged in");

      const { error } = await supabase
        .from("user_privacy_preferences")
        .upsert({
          user_id: userId,
          read_receipts_enabled: updated.read_receipts_enabled ?? query.data?.read_receipts_enabled ?? true,
          active_presence_enabled: updated.active_presence_enabled ?? query.data?.active_presence_enabled ?? true,
          last_active_enabled: updated.last_active_enabled ?? query.data?.last_active_enabled ?? true,
          updated_at: new Date().toISOString(),
        });

      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["privacy-preferences", userId] });
    },
  });

  return {
    preferences: query.data ?? {
      user_id: userId ?? "",
      read_receipts_enabled: true,
      active_presence_enabled: true,
      last_active_enabled: true,
    },
    isLoading: query.isLoading,
    updatePrivacy: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
}
