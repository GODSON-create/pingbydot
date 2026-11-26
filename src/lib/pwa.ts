/**
 * Ping by DOT — Progressive Web App (PWA) Lifecycle, Installability & Cache Hygiene
 *
 * Manages:
 * - Privacy-safe Service Worker registration (`/sw.js`)
 * - Update detection and user-initiated refresh (`SKIP_WAITING`)
 * - Full cache cleanup on logout (`CLEAR_ALL_CACHES` + browser CacheStorage wipe)
 * - Native `beforeinstallprompt` capture and iOS Safari detection
 */

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt: () => Promise<void>;
}

export type PwaPlatform = "ios" | "android" | "desktop";

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let waitingWorker: ServiceWorker | null = null;
const installListeners = new Set<(available: boolean) => void>();
const updateListeners = new Set<(available: boolean) => void>();
let initialized = false;

export function detectPwaPlatform(userAgent?: string): PwaPlatform {
  const ua = userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  if (
    /iPad|iPhone|iPod/i.test(ua) ||
    (/Macintosh/i.test(ua) && typeof document !== "undefined" && "ontouchend" in document)
  ) {
    return "ios";
  }
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

export function isRunningStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true
  );
}

export function canTriggerInstallPrompt(): boolean {
  return deferredInstallPrompt !== null;
}

export function hasPendingPwaUpdate(): boolean {
  return waitingWorker !== null;
}

export function subscribePwaInstallAvailability(cb: (available: boolean) => void): () => void {
  installListeners.add(cb);
  cb(deferredInstallPrompt !== null);
  return () => {
    installListeners.delete(cb);
  };
}

export function subscribePwaUpdateAvailability(cb: (available: boolean) => void): () => void {
  updateListeners.add(cb);
  cb(waitingWorker !== null);
  return () => {
    updateListeners.delete(cb);
  };
}

function notifyInstallListeners() {
  const ready = deferredInstallPrompt !== null;
  for (const cb of installListeners) cb(ready);
}

function notifyUpdateListeners() {
  const ready = waitingWorker !== null;
  for (const cb of updateListeners) cb(ready);
}

/**
 * Registers `/sw.js` and attaches `beforeinstallprompt` / `appinstalled` listeners.
 * Safe to invoke multiple times; no-ops in SSR or Capacitor native WebView.
 */
export function initializePwaRuntime(options?: { onInstalled?: () => void }): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    notifyInstallListeners();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    notifyInstallListeners();
    options?.onInstalled?.();
  });

  if (!("serviceWorker" in navigator)) return;
  // Skip SW registration in local Capacitor native shell (capacitor:// or http://localhost native)
  if (window.location.protocol === "capacitor:" || window.location.protocol === "file:") return;

  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        if (reg.waiting) {
          waitingWorker = reg.waiting;
          notifyUpdateListeners();
        }
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              waitingWorker = installing;
              notifyUpdateListeners();
            }
          });
        });
      })
      .catch(() => {
        // Degrade silently in private browsing or restricted webviews
      });
  });

  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}

export async function promptPwaInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredInstallPrompt) return "unavailable";
  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = null;
  notifyInstallListeners();
  await promptEvent.prompt();
  const choice = await promptEvent.userChoice;
  return choice.outcome;
}

export function applyPendingPwaUpdate(): boolean {
  if (!waitingWorker) return false;
  waitingWorker.postMessage({ type: "SKIP_WAITING" });
  waitingWorker = null;
  notifyUpdateListeners();
  return true;
}

/**
 * Clears all Service Worker and browser CacheStorage entries on user sign-out
 * so no cached shell/asset artifacts persist across accounts on shared devices.
 */
export async function clearPwaCachesOnLogout(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "CLEAR_ALL_CACHES" });
    }
    if ("caches" in window) {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((k) => window.caches.delete(k)));
    }
  } catch {
    // Best-effort cleanup
  }
}
