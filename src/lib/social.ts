import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/lib/pings";

export type PingReactionKey = "like" | "fire" | "insightful" | "celebrate" | "support";

export interface PingReactionOption {
  key: PingReactionKey;
  emoji: string;
  label: string;
}

export const PING_REACTIONS: readonly PingReactionOption[] = [
  { key: "like", emoji: "❤️", label: "Appreciate" },
  { key: "fire", emoji: "🔥", label: "Momentum" },
  { key: "insightful", emoji: "💡", label: "Insightful" },
  { key: "celebrate", emoji: "🚀", label: "Celebrate" },
  { key: "support", emoji: "🙌", label: "Support" },
] as const;

export interface PingPollOption {
  id: string;
  label: string;
  position: number;
  votes: number;
}

export interface PingPoll {
  id: string;
  ping_id: string;
  question: string;
  expires_at: string | null;
  options: PingPollOption[];
  total_votes: number;
  viewer_option_id: string | null;
}

export interface PingReactionSummary {
  counts: Record<PingReactionKey, number>;
  viewerReactions: PingReactionKey[];
  total: number;
}

export type RichTextToken =
  | { type: "text"; value: string }
  | { type: "mention"; value: string; username: string }
  | { type: "hashtag"; value: string; tag: string };

const HASHTAG_RE = /(?:^|[\s(])#([a-zA-Z0-9_]{2,40})\b/g;
const MENTION_RE = /(?:^|[\s(])@([a-zA-Z0-9_]{2,32})\b/g;
const RICH_TOKEN_RE = /(@[a-zA-Z0-9_]{2,32}|#[a-zA-Z0-9_]{2,40})/g;

export function extractHashtags(text: string): string[] {
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(HASHTAG_RE.source, "g");
  while ((match = re.exec(text)) !== null) {
    if (match[1]) found.add(match[1].toLowerCase());
  }
  return Array.from(found).slice(0, 12);
}

export function extractMentions(text: string): string[] {
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(MENTION_RE.source, "g");
  while ((match = re.exec(text)) !== null) {
    if (match[1]) found.add(match[1].toLowerCase());
  }
  return Array.from(found).slice(0, 12);
}

export function tokenizeRichText(text: string): RichTextToken[] {
  if (!text) return [];
  const parts = text.split(RICH_TOKEN_RE);
  const tokens: RichTextToken[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("@") && /^@[a-zA-Z0-9_]{2,32}$/.test(part)) {
      tokens.push({ type: "mention", value: part, username: part.slice(1).toLowerCase() });
    } else if (part.startsWith("#") && /^#[a-zA-Z0-9_]{2,40}$/.test(part)) {
      tokens.push({ type: "hashtag", value: part, tag: part.slice(1).toLowerCase() });
    } else {
      tokens.push({ type: "text", value: part });
    }
  }
  return tokens;
}

function isMissingPhase2Relation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string; status?: number };
  const msg = (e.message ?? "").toLowerCase();
  return (
    e.code === "PGRST205" ||
    e.code === "PGRST202" ||
    e.code === "42P01" ||
    e.code === "42883" ||
    e.code === "42703" ||
    e.status === 404 ||
    msg.includes("could not find the table") ||
    msg.includes("could not find the function") ||
    msg.includes("does not exist")
  );
}

function readLocalJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalJson<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage quota errors
  }
}

function emptyCounts(): Record<PingReactionKey, number> {
  return { like: 0, fire: 0, insightful: 0, celebrate: 0, support: 0 };
}

/* -------------------------------------------------------------------------- */
/*                               PING REACTIONS                               */
/* -------------------------------------------------------------------------- */

const LOCAL_REACTIONS_KEY = "ping:local-reactions:v1";

export function pingReactionsQuery(pingId: string, viewerId?: string) {
  return {
    queryKey: ["ping-reactions", pingId, viewerId ?? "anon"],
    staleTime: 30_000,
    queryFn: async (): Promise<PingReactionSummary> => {
      const { data, error } = await (supabase as any)
        .from("ping_reactions")
        .select("reaction, user_id")
        .eq("ping_id", pingId);

      if (error) {
        if (!isMissingPhase2Relation(error)) throw error;
        const local = readLocalJson<Record<string, Record<string, PingReactionKey[]>>>(
          LOCAL_REACTIONS_KEY,
          {},
        );
        const perPing = local[pingId] ?? {};
        const counts = emptyCounts();
        const viewerReactions: PingReactionKey[] = [];
        let total = 0;
        for (const [uid, keys] of Object.entries(perPing)) {
          for (const k of keys) {
            if (k in counts) {
              counts[k] += 1;
              total += 1;
              if (viewerId && uid === viewerId) viewerReactions.push(k);
            }
          }
        }
        return { counts, viewerReactions, total };
      }

      const counts = emptyCounts();
      const viewerReactions: PingReactionKey[] = [];
      let total = 0;
      for (const row of (data ?? []) as Array<{ reaction: PingReactionKey; user_id: string }>) {
        if (row.reaction in counts) {
          counts[row.reaction] += 1;
          total += 1;
          if (viewerId && row.user_id === viewerId) viewerReactions.push(row.reaction);
        }
      }
      return { counts, viewerReactions, total };
    },
  };
}

export function useTogglePingReaction(pingId: string, userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (reaction: PingReactionKey) => {
      if (!userId) throw new Error("Sign in to react to Pings.");
      const { error } = await (supabase as any).rpc("toggle_ping_reaction", {
        _ping_id: pingId,
        _reaction: reaction,
      });
      if (error) {
        if (!isMissingPhase2Relation(error)) throw error;
        const local = readLocalJson<Record<string, Record<string, PingReactionKey[]>>>(
          LOCAL_REACTIONS_KEY,
          {},
        );
        const perPing = local[pingId] ?? {};
        const mine = new Set<PingReactionKey>(perPing[userId] ?? []);
        if (mine.has(reaction)) mine.delete(reaction);
        else mine.add(reaction);
        local[pingId] = { ...perPing, [userId]: Array.from(mine) };
        writeLocalJson(LOCAL_REACTIONS_KEY, local);
      }
      return reaction;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ping-reactions", pingId] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/*                                 PING POLLS                                 */
/* -------------------------------------------------------------------------- */

const LOCAL_POLLS_KEY = "ping:local-polls:v1";

interface LocalPollRecord {
  id: string;
  ping_id: string;
  question: string;
  expires_at: string | null;
  options: Array<{ id: string; label: string; position: number }>;
  votes: Record<string, string>; // userId -> optionId
}

export async function createPingPoll(params: {
  pingId: string;
  userId: string;
  question: string;
  options: string[];
  expiresAt?: string | null;
}): Promise<PingPoll | null> {
  const cleanOptions = params.options
    .map((o) => o.trim())
    .filter(Boolean)
    .slice(0, 4);
  if (!params.question.trim() || cleanOptions.length < 2) return null;

  const { data: pollRow, error: pollErr } = await (supabase as any)
    .from("ping_polls")
    .insert({
      ping_id: params.pingId,
      question: params.question.trim(),
      expires_at: params.expiresAt ?? null,
      created_by: params.userId,
    })
    .select("id, ping_id, question, expires_at")
    .single();

  if (pollErr) {
    if (!isMissingPhase2Relation(pollErr)) throw pollErr;
    const localPolls = readLocalJson<Record<string, LocalPollRecord>>(LOCAL_POLLS_KEY, {});
    const pollId = `local-poll-${params.pingId}`;
    const record: LocalPollRecord = {
      id: pollId,
      ping_id: params.pingId,
      question: params.question.trim(),
      expires_at: params.expiresAt ?? null,
      options: cleanOptions.map((label, idx) => ({
        id: `${pollId}-opt-${idx}`,
        label,
        position: idx,
      })),
      votes: {},
    };
    localPolls[params.pingId] = record;
    writeLocalJson(LOCAL_POLLS_KEY, localPolls);
    return {
      id: record.id,
      ping_id: record.ping_id,
      question: record.question,
      expires_at: record.expires_at,
      options: record.options.map((o) => ({ ...o, votes: 0 })),
      total_votes: 0,
      viewer_option_id: null,
    };
  }

  const optionPayload = cleanOptions.map((label, position) => ({
    poll_id: pollRow.id,
    label,
    position,
  }));
  const { data: optRows, error: optErr } = await (supabase as any)
    .from("ping_poll_options")
    .insert(optionPayload)
    .select("id, label, position");
  if (optErr) throw optErr;

  return {
    id: pollRow.id,
    ping_id: pollRow.ping_id,
    question: pollRow.question,
    expires_at: pollRow.expires_at,
    options: (optRows ?? []).map((o: any) => ({
      id: o.id,
      label: o.label,
      position: o.position,
      votes: 0,
    })),
    total_votes: 0,
    viewer_option_id: null,
  };
}

export function pingPollQuery(pingId: string, viewerId?: string) {
  return {
    queryKey: ["ping-poll", pingId, viewerId ?? "anon"],
    staleTime: 30_000,
    queryFn: async (): Promise<PingPoll | null> => {
      const { data: poll, error } = await (supabase as any)
        .from("ping_polls")
        .select("id, ping_id, question, expires_at")
        .eq("ping_id", pingId)
        .maybeSingle();

      if (error) {
        if (!isMissingPhase2Relation(error)) throw error;
        const localPolls = readLocalJson<Record<string, LocalPollRecord>>(LOCAL_POLLS_KEY, {});
        const rec = localPolls[pingId];
        if (!rec) return null;
        const tally = new Map<string, number>();
        for (const optId of Object.values(rec.votes)) {
          tally.set(optId, (tally.get(optId) ?? 0) + 1);
        }
        const total = Object.keys(rec.votes).length;
        return {
          id: rec.id,
          ping_id: rec.ping_id,
          question: rec.question,
          expires_at: rec.expires_at,
          options: rec.options.map((o) => ({ ...o, votes: tally.get(o.id) ?? 0 })),
          total_votes: total,
          viewer_option_id: viewerId ? (rec.votes[viewerId] ?? null) : null,
        };
      }

      if (!poll) return null;

      const [{ data: opts }, { data: votes }] = await Promise.all([
        (supabase as any)
          .from("ping_poll_options")
          .select("id, label, position")
          .eq("poll_id", poll.id)
          .order("position", { ascending: true }),
        (supabase as any)
          .from("ping_poll_votes")
          .select("option_id, user_id")
          .eq("poll_id", poll.id),
      ]);

      const tally = new Map<string, number>();
      let viewerOptionId: string | null = null;
      for (const v of (votes ?? []) as Array<{ option_id: string; user_id: string }>) {
        tally.set(v.option_id, (tally.get(v.option_id) ?? 0) + 1);
        if (viewerId && v.user_id === viewerId) viewerOptionId = v.option_id;
      }

      return {
        id: poll.id,
        ping_id: poll.ping_id,
        question: poll.question,
        expires_at: poll.expires_at,
        options: ((opts ?? []) as Array<{ id: string; label: string; position: number }>).map(
          (o) => ({
            ...o,
            votes: tally.get(o.id) ?? 0,
          }),
        ),
        total_votes: (votes ?? []).length,
        viewer_option_id: viewerOptionId,
      };
    },
  };
}

export function useVotePingPoll(pingId: string, userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ pollId, optionId }: { pollId: string; optionId: string }) => {
      if (!userId) throw new Error("Sign in to vote in polls.");
      const { error } = await (supabase as any).rpc("vote_ping_poll", {
        _poll_id: pollId,
        _option_id: optionId,
      });
      if (error) {
        if (!isMissingPhase2Relation(error)) throw error;
        const localPolls = readLocalJson<Record<string, LocalPollRecord>>(LOCAL_POLLS_KEY, {});
        const rec = localPolls[pingId];
        if (rec) {
          rec.votes[userId] = optionId;
          localPolls[pingId] = rec;
          writeLocalJson(LOCAL_POLLS_KEY, localPolls);
        }
      }
      return optionId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ping-poll", pingId] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/*                     SAVED ACCOUNTS & FOLLOWED TOPICS                       */
/* -------------------------------------------------------------------------- */

const LOCAL_SAVED_ACCOUNTS_PREFIX = "ping:saved-accounts:";
const LOCAL_TOPICS_PREFIX = "ping:followed-topics:";

export function savedAccountsQuery(userId?: string) {
  return {
    queryKey: ["saved-accounts", userId],
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: async (): Promise<Set<string>> => {
      if (!userId) return new Set();
      const { data, error } = await (supabase as any)
        .from("user_saved_accounts")
        .select("target_user_id")
        .eq("user_id", userId);
      if (error) {
        if (!isMissingPhase2Relation(error)) throw error;
        return new Set(readLocalJson<string[]>(`${LOCAL_SAVED_ACCOUNTS_PREFIX}${userId}`, []));
      }
      return new Set(
        ((data ?? []) as Array<{ target_user_id: string }>).map((r) => r.target_user_id),
      );
    },
  };
}

export function useToggleSaveAccount(userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      targetUserId,
      currentlySaved,
    }: {
      targetUserId: string;
      currentlySaved: boolean;
    }) => {
      if (!userId) throw new Error("Sign in to save accounts.");
      if (currentlySaved) {
        const { error } = await (supabase as any)
          .from("user_saved_accounts")
          .delete()
          .eq("user_id", userId)
          .eq("target_user_id", targetUserId);
        if (error) {
          if (!isMissingPhase2Relation(error)) throw error;
          const next = readLocalJson<string[]>(
            `${LOCAL_SAVED_ACCOUNTS_PREFIX}${userId}`,
            [],
          ).filter((id) => id !== targetUserId);
          writeLocalJson(`${LOCAL_SAVED_ACCOUNTS_PREFIX}${userId}`, next);
        }
        return false;
      }
      const { error } = await (supabase as any)
        .from("user_saved_accounts")
        .insert({ user_id: userId, target_user_id: targetUserId });
      if (error && error.code !== "23505") {
        if (!isMissingPhase2Relation(error)) throw error;
        const curr = new Set(
          readLocalJson<string[]>(`${LOCAL_SAVED_ACCOUNTS_PREFIX}${userId}`, []),
        );
        curr.add(targetUserId);
        writeLocalJson(`${LOCAL_SAVED_ACCOUNTS_PREFIX}${userId}`, Array.from(curr));
      }
      return true;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-accounts", userId] });
    },
  });
}

export function followedTopicsQuery(userId?: string) {
  return {
    queryKey: ["followed-topics", userId],
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: async (): Promise<string[]> => {
      if (!userId) return [];
      const { data, error } = await (supabase as any)
        .from("user_topic_follows")
        .select("topic_slug")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) {
        if (!isMissingPhase2Relation(error)) throw error;
        return readLocalJson<string[]>(`${LOCAL_TOPICS_PREFIX}${userId}`, []);
      }
      return ((data ?? []) as Array<{ topic_slug: string }>).map((r) => r.topic_slug);
    },
  };
}

export function useToggleFollowTopic(userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      topicSlug,
      currentlyFollowing,
    }: {
      topicSlug: string;
      currentlyFollowing: boolean;
    }) => {
      if (!userId) throw new Error("Sign in to follow topics.");
      const normalized = topicSlug.trim().toLowerCase().replace(/^#/, "");
      if (!normalized) return currentlyFollowing;

      if (currentlyFollowing) {
        const { error } = await (supabase as any)
          .from("user_topic_follows")
          .delete()
          .eq("user_id", userId)
          .eq("topic_slug", normalized);
        if (error) {
          if (!isMissingPhase2Relation(error)) throw error;
          const next = readLocalJson<string[]>(`${LOCAL_TOPICS_PREFIX}${userId}`, []).filter(
            (t) => t !== normalized,
          );
          writeLocalJson(`${LOCAL_TOPICS_PREFIX}${userId}`, next);
        }
        return false;
      }

      const { error } = await (supabase as any)
        .from("user_topic_follows")
        .insert({ user_id: userId, topic_slug: normalized });
      if (error && error.code !== "23505") {
        if (!isMissingPhase2Relation(error)) throw error;
        const curr = new Set(readLocalJson<string[]>(`${LOCAL_TOPICS_PREFIX}${userId}`, []));
        curr.add(normalized);
        writeLocalJson(`${LOCAL_TOPICS_PREFIX}${userId}`, Array.from(curr));
      }
      return true;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["followed-topics", userId] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/*                             MUTUAL CONNECTIONS                             */
/* -------------------------------------------------------------------------- */

export function mutualConnectionsQuery(currentUserId?: string, targetUserId?: string) {
  return {
    queryKey: ["mutual-connections", currentUserId, targetUserId],
    enabled: Boolean(currentUserId && targetUserId && currentUserId !== targetUserId),
    staleTime: 60_000,
    queryFn: async (): Promise<{
      isMutualFollow: boolean;
      sharedConnections: Profile[];
    }> => {
      if (!currentUserId || !targetUserId || currentUserId === targetUserId) {
        return { isMutualFollow: false, sharedConnections: [] };
      }

      const [myFollowingRes, targetFollowersRes, targetFollowsMeRes] = await Promise.all([
        supabase.from("follows").select("following_id").eq("follower_id", currentUserId).limit(200),
        supabase.from("follows").select("follower_id").eq("following_id", targetUserId).limit(200),
        supabase
          .from("follows")
          .select("follower_id")
          .eq("follower_id", targetUserId)
          .eq("following_id", currentUserId)
          .maybeSingle(),
      ]);

      const myFollowing = new Set((myFollowingRes.data ?? []).map((r) => r.following_id));
      const iFollowTarget = myFollowing.has(targetUserId);
      const targetFollowsMe = Boolean(targetFollowsMeRes.data);

      const sharedIds = (targetFollowersRes.data ?? [])
        .map((r) => r.follower_id)
        .filter((id) => id !== currentUserId && id !== targetUserId && myFollowing.has(id))
        .slice(0, 6);

      if (sharedIds.length === 0) {
        return { isMutualFollow: iFollowTarget && targetFollowsMe, sharedConnections: [] };
      }

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url, bio, created_at")
        .in("id", sharedIds);

      return {
        isMutualFollow: iFollowTarget && targetFollowsMe,
        sharedConnections: (profiles ?? []) as Profile[],
      };
    },
  };
}
