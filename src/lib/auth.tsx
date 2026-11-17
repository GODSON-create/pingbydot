import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/lib/pings";

type AuthCtx = {
  user: User | null;
  ready: boolean;
  profile: Profile | null;
  profileLoading: boolean;
  refreshProfile: () => void;
};
const Ctx = createContext<AuthCtx>({
  user: null,
  ready: false,
  profile: null,
  profileLoading: false,
  refreshProfile: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      setReady(true);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        router.invalidate();
        if (event !== "SIGNED_OUT") qc.invalidateQueries();
      }
    });
    supabase.auth.getSession().then(({ data: s }) => {
      setUser(s.session?.user ?? null);
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, [qc, router]);

  const profileQ = useQuery({
    queryKey: ["my-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      if (data) return data as Profile;

      // Recover cleanly if a newly created OAuth/email user has not synced public.profiles yet
      const { data: ensured, error: ensureErr } = await supabase.rpc("ensure_my_profile");
      if (ensureErr) return null;
      return (ensured as Profile | null) ?? null;
    },
  });

  return (
    <Ctx.Provider
      value={{
        user,
        ready,
        profile: profileQ.data ?? null,
        profileLoading: Boolean(user) && profileQ.isLoading,
        refreshProfile: () => profileQ.refetch(),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
