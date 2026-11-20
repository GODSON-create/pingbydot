import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type NotificationKind =
  | "reply"
  | "mention"
  | "reaction"
  | "like"
  | "comment"
  | "follow"
  | "message"
  | "hub_activity"
  | "opportunity"
  | "application"
  | "event"
  | "system";

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  text: string;
  body?: string | undefined;
  href: string;
  group_key?: string | null | undefined;
  read_at?: string | null | undefined;
  created_at: string;
}

export interface GroupedNotification {
  id: string;
  kind: NotificationKind;
  text: string;
  body?: string | undefined;
  href: string;
  count: number;
  unread: boolean;
  created_at: string;
  memberIds: string[];
}

export interface NotificationPreferences {
  replies: boolean;
  mentions: boolean;
  reactions: boolean;
  follows: boolean;
  messages: boolean;
  hubs: boolean;
  opportunities: boolean;
  spotlight: boolean;
  email_digest: boolean;
  push_enabled: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  replies: true,
  mentions: true,
  reactions: true,
  follows: true,
  messages: true,
  hubs: true,
  opportunities: true,
  spotlight: true,
  email_digest: false,
  push_enabled: false,
};

const LOCAL_PREFS_PREFIX = "ping:notif-prefs:";

function isMissingNotificationSchema(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string; status?: number };
  const msg = (e.message ?? "").toLowerCase();
  return (
    e.code === "PGRST205" ||
    e.code === "PGRST202" ||
    e.code === "42P01" ||
    e.code === "42703" ||
    e.code === "42883" ||
    e.status === 404 ||
    msg.includes("notifications") ||
    msg.includes("notification_preferences") ||
    msg.includes("does not exist")
  );
}

/**
 * Group related notifications (e.g., multiple likes/reactions/replies on the same Ping)
 * so the Notification Centre stays concise and scannable (Phase 2.9).
 */
export function groupNotifications(
  items: NotificationItem[],
  seenAt: string | null,
): GroupedNotification[] {
  const seenMs = seenAt ? new Date(seenAt).getTime() : 0;
  const buckets = new Map<string, GroupedNotification>();

  const sorted = [...items].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  for (const item of sorted) {
    const key = item.group_key || `${item.kind}:${item.href}`;
    const itemMs = new Date(item.created_at).getTime();
    const isUnread = item.read_at ? false : itemMs > seenMs;

    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        id: item.id,
        kind: item.kind,
        text: item.text,
        body: item.body,
        href: item.href,
        count: 1,
        unread: isUnread,
        created_at: item.created_at,
        memberIds: [item.id],
      });
    } else {
      existing.count += 1;
      existing.unread = existing.unread || isUnread;
      existing.memberIds.push(item.id);
    }
  }

  return Array.from(buckets.values()).map((group) => {
    if (group.count <= 1) return group;
    const extra = group.count - 1;
    const suffix = extra === 1 ? " (+1 more)" : ` (+${extra} more)`;
    return { ...group, text: `${group.text}${suffix}` };
  });
}

export async function fetchUnifiedNotifications(userId: string): Promise<NotificationItem[]> {
  const items: NotificationItem[] = [];

  // 1. Try reading central notifications table (0029)
  const { data: centralRows, error: centralErr } = await (supabase as any)
    .from("notifications")
    .select("id, kind, title, body, href, group_key, read_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (!centralErr && Array.isArray(centralRows)) {
    for (const row of centralRows) {
      items.push({
        id: row.id,
        kind: row.kind as NotificationKind,
        text: row.title,
        body: row.body || undefined,
        href: row.href || "/",
        group_key: row.group_key,
        read_at: row.read_at,
        created_at: row.created_at,
      });
    }
  } else if (centralErr && !isMissingNotificationSchema(centralErr)) {
    throw centralErr;
  }

  // 2. Also synthesize live network activity from pings/comments/follows/likes so existing accounts always see notifications
  const { data: myPings, error: pingsError } = await supabase
    .from("pings")
    .select("id, content")
    .eq("user_id", userId)
    .is("hidden_at", null)
    .order("created_at", { ascending: false })
    .limit(20);
  if (pingsError) throw pingsError;

  const pingIds = (myPings ?? []).map((p) => p.id);
  const pingExcerpt = new Map((myPings ?? []).map((p) => [p.id, p.content.slice(0, 48)]));

  const [commentsRes, followsRes, likesRes] = await Promise.all([
    pingIds.length > 0
      ? supabase
          .from("comments")
          .select(
            "id, ping_id, user_id, content, created_at, author:profiles!comments_user_id_fkey(username, display_name)",
          )
          .in("ping_id", pingIds)
          .neq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(12)
      : Promise.resolve({ data: [] as any[], error: null }),
    supabase
      .from("follows")
      .select(
        "follower_id, created_at, follower:profiles!follows_follower_id_fkey(username, display_name)",
      )
      .eq("following_id", userId)
      .order("created_at", { ascending: false })
      .limit(12),
    pingIds.length > 0
      ? supabase
          .from("likes")
          .select(
            "ping_id, user_id, created_at, actor:profiles!likes_user_id_fkey(username, display_name)",
          )
          .in("ping_id", pingIds)
          .neq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(12)
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);

  if (commentsRes.error) throw commentsRes.error;
  if (followsRes.error) throw followsRes.error;
  if (likesRes.error) throw likesRes.error;

  for (const c of (commentsRes.data ?? []) as any[]) {
    const actor = c.author?.display_name || `@${c.author?.username || "member"}`;
    items.push({
      id: `comment-${c.id}`,
      kind: "comment",
      text: `${actor} replied to "${pingExcerpt.get(c.ping_id) ?? "your Ping"}…"`,
      href: `/p/${c.ping_id}`,
      group_key: `comment:/p/${c.ping_id}`,
      created_at: c.created_at,
    });
  }
  for (const f of (followsRes.data ?? []) as any[]) {
    const actor = f.follower?.display_name || `@${f.follower?.username || "member"}`;
    const uname = f.follower?.username;
    items.push({
      id: `follow-${f.follower_id}-${f.created_at}`,
      kind: "follow",
      text: `${actor} started following you`,
      href: uname ? `/@${uname}` : "/explore",
      group_key: `follow:${f.follower_id}`,
      created_at: f.created_at,
    });
  }
  for (const l of (likesRes.data ?? []) as any[]) {
    const actor = l.actor?.display_name || `@${l.actor?.username || "member"}`;
    items.push({
      id: `like-${l.ping_id}-${l.user_id}-${l.created_at}`,
      kind: "like",
      text: `${actor} liked "${pingExcerpt.get(l.ping_id) ?? "your Ping"}…"`,
      href: `/p/${l.ping_id}`,
      group_key: `like:/p/${l.ping_id}`,
      created_at: l.created_at,
    });
  }

  return items
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 30);
}

export async function markCentralNotificationsRead(): Promise<void> {
  const { error } = await (supabase as any).rpc("mark_notifications_read", {
    p_notification_ids: null,
  });
  if (error && !isMissingNotificationSchema(error)) {
    throw error;
  }
}

export function notificationPreferencesQuery(userId?: string) {
  return {
    queryKey: ["notification-preferences", userId],
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: async (): Promise<NotificationPreferences> => {
      if (!userId) return DEFAULT_NOTIFICATION_PREFERENCES;
      const { data, error } = await (supabase as any)
        .from("user_privacy_preferences")
        .select("notification_preferences")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        if (!isMissingNotificationSchema(error)) throw error;
        if (typeof window !== "undefined") {
          try {
            const raw = window.localStorage.getItem(`${LOCAL_PREFS_PREFIX}${userId}`);
            if (raw) {
              return {
                ...DEFAULT_NOTIFICATION_PREFERENCES,
                ...(JSON.parse(raw) as Partial<NotificationPreferences>),
              };
            }
          } catch {
            // ignore
          }
        }
        return DEFAULT_NOTIFICATION_PREFERENCES;
      }

      return {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        ...((data?.notification_preferences ?? {}) as Partial<NotificationPreferences>),
      };
    },
  };
}

export function useUpdateNotificationPreferences(userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: NotificationPreferences) => {
      if (!userId) throw new Error("Sign in to update notification preferences.");
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(`${LOCAL_PREFS_PREFIX}${userId}`, JSON.stringify(next));
        } catch {
          // ignore
        }
      }
      const { error } = await (supabase as any).from("user_privacy_preferences").upsert(
        {
          user_id: userId,
          notification_preferences: next,
        },
        { onConflict: "user_id" },
      );
      if (error && !isMissingNotificationSchema(error)) {
        throw error;
      }
      return next;
    },
    onSuccess: (next) => {
      qc.setQueryData(["notification-preferences", userId], next);
    },
  });
}
