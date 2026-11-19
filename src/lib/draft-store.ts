import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const DRAFTS_STORAGE_KEY = "ping_chat_drafts_v1";
const memoryDrafts = new Map<string, string>();
let storageHydrated = false;

function hydrateDraftsFromStorage() {
  if (storageHydrated || typeof window === "undefined") return;
  storageHydrated = true;
  try {
    const raw = window.sessionStorage.getItem(DRAFTS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v.length > 0) {
        memoryDrafts.set(k, v);
      }
    }
  } catch {
    // Ignore storage quota / parse errors
  }
}

function persistDraftsToStorage() {
  if (typeof window === "undefined") return;
  try {
    const obj: Record<string, string> = {};
    let count = 0;
    for (const [k, v] of memoryDrafts.entries()) {
      if (v) {
        obj[k] = v;
        count++;
        if (count >= 40) break;
      }
    }
    window.sessionStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // Ignore storage errors
  }
}

export function getChatDraft(scopeKey: string): string {
  hydrateDraftsFromStorage();
  return memoryDrafts.get(scopeKey) ?? "";
}

export function setChatDraftValue(scopeKey: string, value: string): void {
  hydrateDraftsFromStorage();
  if (!value) {
    memoryDrafts.delete(scopeKey);
  } else {
    memoryDrafts.set(scopeKey, value);
  }
  persistDraftsToStorage();
}

export function useChatDraft(scopeKey: string | null | undefined) {
  const key = scopeKey ? `draft:${scopeKey}` : "";
  const [draft, setDraftState] = useState<string>(() => (key ? getChatDraft(key) : ""));

  useEffect(() => {
    setDraftState(key ? getChatDraft(key) : "");
  }, [key]);

  const setDraft = useCallback(
    (next: string | ((prev: string) => string)) => {
      setDraftState((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        if (key) setChatDraftValue(key, resolved);
        return resolved;
      });
    },
    [key],
  );

  const clearDraft = useCallback(() => {
    if (key) setChatDraftValue(key, "");
    setDraftState("");
  }, [key]);

  return [draft, setDraft, clearDraft] as const;
}

// Tracks whether mobile is inside an active full-screen chat / thread workspace
// so the persistent global BottomNav & SiteHeader yield cleanly without overlap.
let focusedThreadCount = 0;
const focusListeners = new Set<() => void>();

function notifyFocusListeners() {
  for (const fn of focusListeners) fn();
}

export function setFocusedWorkspaceActive(active: boolean): () => void {
  if (!active) return () => {};
  focusedThreadCount += 1;
  notifyFocusListeners();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    focusedThreadCount = Math.max(0, focusedThreadCount - 1);
    notifyFocusListeners();
  };
}

export function useFocusedWorkspace(): boolean {
  return useSyncExternalStore(
    (cb) => {
      focusListeners.add(cb);
      return () => focusListeners.delete(cb);
    },
    () => focusedThreadCount > 0,
    () => false,
  );
}

/* -------------------------------------------------------------------------- */
/*                      PING COMPOSER DRAFT PERSISTENCE                       */
/* -------------------------------------------------------------------------- */

const PING_DRAFT_STORAGE_KEY = "ping_composer_draft_v1";

export interface StoredPingComposerDraft {
  category?: string;
  headline?: string;
  content?: string;
  needsInput?: string;
  offersInput?: string;
  desiredOutcome?: string;
  mediaUrl?: string;
  cta_url?: string;
  cta_label?: string;
  hub_id?: string | null;
  hub_intent?: string | null;
  savedAt?: number;
}

export function getPingComposerDraft(scopeKey = "new"): StoredPingComposerDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`${PING_DRAFT_STORAGE_KEY}:${scopeKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPingComposerDraft;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function savePingComposerDraft(draft: StoredPingComposerDraft, scopeKey = "new"): void {
  if (typeof window === "undefined") return;
  try {
    const hasMeaningfulContent = Boolean(
      draft.content?.trim() ||
      draft.headline?.trim() ||
      draft.needsInput?.trim() ||
      draft.offersInput?.trim() ||
      draft.desiredOutcome?.trim() ||
      draft.mediaUrl?.trim() ||
      draft.cta_url?.trim(),
    );
    const key = `${PING_DRAFT_STORAGE_KEY}:${scopeKey}`;
    if (!hasMeaningfulContent) {
      window.sessionStorage.removeItem(key);
      return;
    }
    window.sessionStorage.setItem(key, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearPingComposerDraft(scopeKey = "new"): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(`${PING_DRAFT_STORAGE_KEY}:${scopeKey}`);
  } catch {
    // Ignore storage errors
  }
}
