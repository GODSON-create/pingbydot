import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/lib/pings";
import { needsOnboarding } from "@/lib/pathways";
import { ensureClientProfileRow } from "@/lib/ensure-profile";
import { captureLandingAttribution, recordFirstMeaningfulSessionOnce } from "@/lib/economic-events";
import { clearSessionRestoredFlag, trackSessionRestoredOnce } from "@/lib/telemetry";
import { clearPwaCachesOnLogout, isRunningStandalonePwa } from "@/lib/pwa";
import { clearPrivateDmSignedUrlCache } from "@/lib/storage";

let intentionalSignOut = false;

export function markIntentionalSignOut(): void {
  intentionalSignOut = true;
}

type AuthCtx = {
  user: User | null;
  ready: boolean;
  profile: Profile | null;
  profileLoading: boolean;
  sessionExpired: boolean;
  clearSessionExpired: () => void;
  refreshProfile: () => void;
};
const Ctx = createContext<AuthCtx>({
  user: null,
  ready: false,
  profile: null,
  profileLoading: false,
  sessionExpired: false,
  clearSessionExpired: () => {},
  refreshProfile: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const wasSignedInRef = useRef(false);
  const qc = useQueryClient();
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    let active = true;
    captureLandingAttribution();

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      setReady(true);

      if (nextUser) {
        wasSignedInRef.current = true;
        setSessionExpired(false);
        intentionalSignOut = false;
      }

      if (event === "SIGNED_OUT") {
        clearSessionRestoredFlag();
        clearPrivateDmSignedUrlCache();
        void clearPwaCachesOnLogout();
        qc.removeQueries({ queryKey: ["my-profile"] });
        if (wasSignedInRef.current && !intentionalSignOut) {
          setSessionExpired(true);
        }
        wasSignedInRef.current = false;
        intentionalSignOut = false;
      }

      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        routerRef.current.invalidate();
        if (event !== "SIGNED_OUT") qc.invalidateQueries();
      }
    });

    const restoreSession = async () => {
      try {
        const { data: s, error } = await supabase.auth.getSession();
        if (!active) return;
        if (error) {
          setSessionExpired(true);
          await supabase.auth.signOut({ scope: "local" }).catch(() => {});
          if (active) {
            setUser(null);
            setReady(true);
          }
          return;
        }

        const session = s.session;
        if (session?.expires_at && session.expires_at * 1000 <= Date.now()) {
          const { data: userData, error: userErr } = await supabase.auth.getUser();
          if (!active) return;
          if (userErr || !userData.user) {
            setSessionExpired(true);
            await supabase.auth.signOut({ scope: "local" }).catch(() => {});
            if (active) {
              setUser(null);
              setReady(true);
            }
            return;
          }
          wasSignedInRef.current = true;
          setUser(userData.user);
          setReady(true);
          return;
        }

        const restoredUser = session?.user ?? null;
        if (restoredUser) {
          wasSignedInRef.current = true;
        }
        setUser(restoredUser);
        setReady(true);
      } catch {
        if (active) {
          setUser(null);
          setReady(true);
        }
      }
    };

    void restoreSession();
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [qc]);

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
      return await ensureClientProfileRow(user);
    },
  });

  useEffect(() => {
    if (ready && user && !profileQ.isLoading && profileQ.data && !needsOnboarding(profileQ.data)) {
      trackSessionRestoredOnce(false);
      recordFirstMeaningfulSessionOnce(user.id);
    }
  }, [ready, user, profileQ.isLoading, profileQ.data]);

  // Lightweight authenticated presence heartbeat for reliable Admin online-now & DAU/WAU/MAU telemetry
  useEffect(() => {
    if (!ready || !user || typeof window === "undefined") return;
    const surface = isRunningStandalonePwa() ? "pwa" : "web";
    const beat = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void Promise.resolve(
        (supabase as any).rpc("record_presence_heartbeat", { p_surface: surface }),
      ).catch(() => {});
    };
    beat();
    const timer = window.setInterval(beat, 120_000);
    return () => window.clearInterval(timer);
  }, [ready, user]);

  return (
    <Ctx.Provider
      value={{
        user,
        ready,
        profile: profileQ.data ?? null,
        profileLoading: Boolean(user) && profileQ.isLoading,
        sessionExpired,
        clearSessionExpired: () => setSessionExpired(false),
        refreshProfile: () => profileQ.refetch(),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
