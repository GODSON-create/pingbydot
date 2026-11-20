/**
 * PING Offline-First Action Queue (Phase 5.3)
 *
 * Persists safe, idempotent user actions in `localStorage` when the device is offline
 * or experiences a transient network interruption, then replays them automatically on
 * reconnect (browser `online` event or Capacitor `networkStatusChange`).
 *
 * Safety invariants:
 * - Never queues real-money payment settlements or destructive account deletions.
 * - Every queued item carries a unique `clientMutationId` to prevent duplicates.
 * - Bounded retry cap (`MAX_ATTEMPTS = 3`) prevents infinite background retry loops.
 */

import { useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";

export type OfflineActionKind =
  "ping_draft_publish" | "dm_message" | "business_enquiry_reply" | "hub_event_rsvp";

export interface OfflineQueuedAction {
  id: string;
  clientMutationId: string;
  kind: OfflineActionKind;
  userId: string;
  summary: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  status: "pending" | "syncing" | "failed";
  lastError?: string | null;
  createdAt: string;
}

const STORAGE_KEY = "ping_offline_action_queue_v1";
const MAX_QUEUE_SIZE = 50;
const MAX_ATTEMPTS = 3;

let cachedQueue: OfflineQueuedAction[] = loadFromStorage();
let isFlushing = false;
const listeners = new Set<() => void>();

function loadFromStorage(): OfflineQueuedAction[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OfflineQueuedAction[]) : [];
  } catch {
    return [];
  }
}

function saveToStorage(next: OfflineQueuedAction[]) {
  cachedQueue = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota issues in restricted webviews
    }
  }
  listeners.forEach((fn) => fn());
}

export function getOfflineQueueSnapshot(): OfflineQueuedAction[] {
  return cachedQueue;
}

export function useOfflineQueue(): OfflineQueuedAction[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => cachedQueue,
    () => [],
  );
}

export function enqueueOfflineAction(input: {
  kind: OfflineActionKind;
  userId: string;
  summary: string;
  payload: Record<string, unknown>;
  clientMutationId?: string;
}): OfflineQueuedAction {
  const clientMutationId =
    input.clientMutationId ?? `mut_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const existing = cachedQueue.find((item) => item.clientMutationId === clientMutationId);
  if (existing) return existing;

  const entry: OfflineQueuedAction = {
    id: `oq_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    clientMutationId,
    kind: input.kind,
    userId: input.userId,
    summary: input.summary.slice(0, 140),
    payload: input.payload,
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    status: "pending",
    lastError: null,
    createdAt: new Date().toISOString(),
  };

  saveToStorage([...cachedQueue, entry].slice(-MAX_QUEUE_SIZE));
  return entry;
}

export function removeOfflineAction(id: string): void {
  saveToStorage(cachedQueue.filter((item) => item.id !== id));
}

export function clearOfflineQueue(): void {
  saveToStorage([]);
}

export type OfflineExecutor = (action: OfflineQueuedAction) => Promise<void>;

async function defaultExecuteAction(action: OfflineQueuedAction): Promise<void> {
  if (action.kind === "ping_draft_publish") {
    const p = action.payload;
    const { error } = await supabase.from("pings").insert({
      user_id: action.userId,
      category: String(p["category"] ?? "progress"),
      content: String(p["content"] ?? ""),
      headline: (p["headline"] as string | null) ?? null,
      cta_url: (p["cta_url"] as string | null) ?? null,
      cta_label: (p["cta_label"] as string | null) ?? null,
      image_url: (p["image_url"] as string | null) ?? null,
      visibility: (p["visibility"] as "public" | "hub") ?? "public",
    });
    if (error) throw error;
    return;
  }

  if (action.kind === "dm_message") {
    const p = action.payload;
    const { error } = await supabase.rpc("send_private_message", {
      p_conversation_id: String(p["conversationId"] ?? ""),
      p_content: String(p["content"] ?? ""),
    });
    if (error) throw error;
    return;
  }

  if (action.kind === "business_enquiry_reply") {
    const p = action.payload;
    const { error } = await (supabase as any)
      .from("business_enquiries")
      .update({
        reply_message: String(p["replyMessage"] ?? ""),
        lead_status: String(p["leadStatus"] ?? "in_progress"),
        updated_at: new Date().toISOString(),
      })
      .eq("id", String(p["enquiryId"] ?? ""));
    if (error) throw error;
    return;
  }

  if (action.kind === "hub_event_rsvp") {
    const p = action.payload;
    const { error } = await (supabase as any).from("hub_event_rsvps").upsert(
      {
        event_id: String(p["eventId"] ?? ""),
        user_id: action.userId,
        status: String(p["status"] ?? "going"),
      },
      { onConflict: "event_id,user_id" },
    );
    if (error) throw error;
  }
}

export async function flushOfflineQueue(
  executor: OfflineExecutor = defaultExecuteAction,
): Promise<{ synced: number; failed: number; remaining: number }> {
  if (isFlushing) {
    return { synced: 0, failed: 0, remaining: cachedQueue.length };
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { synced: 0, failed: 0, remaining: cachedQueue.length };
  }

  isFlushing = true;
  let synced = 0;
  let failed = 0;

  try {
    const snapshot = [...cachedQueue];
    for (const item of snapshot) {
      if (item.attempts >= item.maxAttempts) continue;

      saveToStorage(cachedQueue.map((q) => (q.id === item.id ? { ...q, status: "syncing" } : q)));

      try {
        await executor(item);
        saveToStorage(cachedQueue.filter((q) => q.id !== item.id));
        synced++;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Sync failed";
        const nextAttempts = item.attempts + 1;
        saveToStorage(
          cachedQueue.map((q) =>
            q.id === item.id
              ? {
                  ...q,
                  attempts: nextAttempts,
                  status: nextAttempts >= q.maxAttempts ? "failed" : "pending",
                  lastError: message.slice(0, 200),
                }
              : q,
          ),
        );
        failed++;
      }
    }
  } finally {
    isFlushing = false;
  }

  return { synced, failed, remaining: cachedQueue.length };
}

export function resetFailedOfflineActions(): void {
  saveToStorage(
    cachedQueue.map((q) =>
      q.status === "failed" ? { ...q, status: "pending", attempts: 0, lastError: null } : q,
    ),
  );
}
