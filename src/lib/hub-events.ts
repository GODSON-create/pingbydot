import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/lib/pings";

export type HubEventRsvpStatus = "going" | "interested" | "not_going";

export interface HubEvent {
  id: string;
  hub_id: string;
  creator_id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string | null;
  location_label: string;
  meeting_url: string | null;
  status: "scheduled" | "cancelled" | "completed";
  created_at: string;
  creator?: Profile;
  going_count: number;
  interested_count: number;
  viewer_rsvp: HubEventRsvpStatus | null;
}

const LOCAL_HUB_EVENTS_KEY = "ping:local-hub-events:v1";

interface LocalHubEventRecord extends Omit<
  HubEvent,
  "going_count" | "interested_count" | "viewer_rsvp"
> {
  rsvps: Record<string, HubEventRsvpStatus>;
}

function isMissingHubEventsSchema(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string; status?: number };
  const msg = (e.message ?? "").toLowerCase();
  return (
    e.code === "PGRST205" ||
    e.code === "42P01" ||
    e.status === 404 ||
    msg.includes("hub_events") ||
    msg.includes("hub_event_rsvps") ||
    msg.includes("does not exist")
  );
}

function readLocalEvents(): LocalHubEventRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_HUB_EVENTS_KEY);
    return raw ? (JSON.parse(raw) as LocalHubEventRecord[]) : [];
  } catch {
    return [];
  }
}

function writeLocalEvents(events: LocalHubEventRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_HUB_EVENTS_KEY, JSON.stringify(events));
  } catch {
    // ignore storage errors
  }
}

export function hubEventsQuery(hubId?: string, viewerId?: string) {
  return {
    queryKey: ["hub-events", hubId, viewerId ?? "anon"],
    enabled: Boolean(hubId),
    staleTime: 30_000,
    queryFn: async (): Promise<HubEvent[]> => {
      if (!hubId) return [];

      const { data, error } = await (supabase as any)
        .from("hub_events")
        .select(
          `
          id, hub_id, creator_id, title, description, starts_at, ends_at, location_label, meeting_url, status, created_at,
          creator:profiles!hub_events_creator_id_fkey(id, username, display_name, avatar_url, bio, created_at)
        `,
        )
        .eq("hub_id", hubId)
        .order("starts_at", { ascending: true })
        .limit(25);

      if (error) {
        if (!isMissingHubEventsSchema(error)) throw error;
        return readLocalEvents()
          .filter((e) => e.hub_id === hubId)
          .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
          .map((e) => {
            const vals = Object.values(e.rsvps);
            return {
              ...e,
              going_count: vals.filter((v) => v === "going").length,
              interested_count: vals.filter((v) => v === "interested").length,
              viewer_rsvp: viewerId ? (e.rsvps[viewerId] ?? null) : null,
            };
          });
      }

      const eventRows = (data ?? []) as Array<
        Omit<HubEvent, "going_count" | "interested_count" | "viewer_rsvp">
      >;
      if (eventRows.length === 0) return [];

      const eventIds = eventRows.map((e) => e.id);
      const { data: rsvps } = await (supabase as any)
        .from("hub_event_rsvps")
        .select("event_id, user_id, status")
        .in("event_id", eventIds);

      const goingMap = new Map<string, number>();
      const interestedMap = new Map<string, number>();
      const viewerMap = new Map<string, HubEventRsvpStatus>();

      for (const r of (rsvps ?? []) as Array<{
        event_id: string;
        user_id: string;
        status: HubEventRsvpStatus;
      }>) {
        if (r.status === "going") goingMap.set(r.event_id, (goingMap.get(r.event_id) ?? 0) + 1);
        if (r.status === "interested") {
          interestedMap.set(r.event_id, (interestedMap.get(r.event_id) ?? 0) + 1);
        }
        if (viewerId && r.user_id === viewerId) viewerMap.set(r.event_id, r.status);
      }

      return eventRows.map((ev) => ({
        ...ev,
        going_count: goingMap.get(ev.id) ?? 0,
        interested_count: interestedMap.get(ev.id) ?? 0,
        viewer_rsvp: viewerMap.get(ev.id) ?? null,
      }));
    },
  };
}

export function useCreateHubEvent(hubId: string, userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      title: string;
      description: string;
      startsAt: string;
      locationLabel: string;
      meetingUrl?: string | undefined;
    }) => {
      if (!userId) throw new Error("Sign in to schedule a Hub event.");
      const payload = {
        hub_id: hubId,
        creator_id: userId,
        title: input.title.trim(),
        description: input.description.trim(),
        starts_at: new Date(input.startsAt).toISOString(),
        ends_at: null,
        location_label: input.locationLabel.trim() || "Online on Ping",
        meeting_url: input.meetingUrl?.trim() || null,
        status: "scheduled" as const,
      };

      const { data, error } = await (supabase as any)
        .from("hub_events")
        .insert(payload)
        .select("*")
        .single();

      if (error) {
        if (!isMissingHubEventsSchema(error)) throw error;
        const created: LocalHubEventRecord = {
          ...payload,
          id: `local-event-${Date.now()}`,
          created_at: new Date().toISOString(),
          rsvps: { [userId]: "going" },
        };
        writeLocalEvents([...readLocalEvents(), created]);
        return created;
      }

      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub-events", hubId] });
    },
  });
}

export function useRsvpHubEvent(hubId: string, userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ eventId, status }: { eventId: string; status: HubEventRsvpStatus }) => {
      if (!userId) throw new Error("Sign in to RSVP.");
      const { error } = await (supabase as any).from("hub_event_rsvps").upsert(
        {
          event_id: eventId,
          user_id: userId,
          status,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "event_id,user_id" },
      );

      if (error) {
        if (!isMissingHubEventsSchema(error)) throw error;
        const updated = readLocalEvents().map((ev) =>
          ev.id === eventId ? { ...ev, rsvps: { ...ev.rsvps, [userId]: status } } : ev,
        );
        writeLocalEvents(updated);
      }
      return status;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub-events", hubId] });
    },
  });
}
