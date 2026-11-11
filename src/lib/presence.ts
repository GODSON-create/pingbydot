import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useUserPrivacy } from "@/lib/privacy";

export interface ActivePresenceMember {
  user_id: string;
  username?: string;
  display_name?: string;
  avatar_url?: string | null;
  active_at: number;
}

export function useHubPresence(hubId: string | undefined) {
  const { user } = useAuth();
  const { preferences } = useUserPrivacy(user?.id);
  const [activeMembers, setActiveMembers] = useState<Record<string, ActivePresenceMember>>({});
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const canBroadcastPresence = Boolean(user && preferences.active_presence_enabled);

  const updatePresenceState = useCallback((state: Record<string, any[]>) => {
    const active: Record<string, ActivePresenceMember> = {};
    for (const key of Object.keys(state)) {
      const presences = state[key];
      if (presences && presences.length > 0) {
        const latest = presences[presences.length - 1];
        if (latest && latest.user_id) {
          active[latest.user_id] = latest as unknown as ActivePresenceMember;
        }
      }
    }
    setActiveMembers(active);
  }, []);

  useEffect(() => {
    if (!hubId || !user) {
      setActiveMembers({});
      return;
    }

    const channelName = `hub-presence:${hubId}`;
    const channel = supabase.channel(channelName, {
      config: {
        presence: {
          key: user.id,
        },
      },
    });

    channelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        updatePresenceState(state);
      })
      .on("presence", { event: "join" }, ({ key, newPresences }) => {
        if (newPresences && newPresences.length > 0) {
          const latest = newPresences[newPresences.length - 1];
          setActiveMembers((prev) => ({
            ...prev,
            [key]: latest as unknown as ActivePresenceMember,
          }));
        }
      })
      .on("presence", { event: "leave" }, ({ key }) => {
        setActiveMembers((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      });

    const trackPresence = async () => {
      if (canBroadcastPresence && document.visibilityState === "visible") {
        try {
          await channel.track({
            user_id: user.id,
            active_at: Date.now(),
          });
        } catch (err) {
          console.warn("Failed to track presence:", err);
        }
      }
    };

    const untrackPresence = async () => {
      try {
        await channel.untrack();
      } catch (err) {
        console.warn("Failed to untrack presence:", err);
      }
    };

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await trackPresence();
      }
    });

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        trackPresence();
      } else {
        untrackPresence();
      }
    };

    const handleWindowBlur = () => {
      untrackPresence();
    };

    const handleWindowFocus = () => {
      trackPresence();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("beforeunload", untrackPresence);

    // Heartbeat every 25 seconds
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        trackPresence();
      }
    }, 25000);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("beforeunload", untrackPresence);
      channel.unsubscribe();
    };
  }, [hubId, user, canBroadcastPresence, updatePresenceState]);

  const isUserActivelyReading = useCallback(
    (userId: string) => {
      return Boolean(activeMembers[userId]);
    },
    [activeMembers]
  );

  return {
    activeMembers,
    activeCount: Object.keys(activeMembers).length,
    isUserActivelyReading,
  };
}
