import { useSyncExternalStore } from "react";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";
import { Share } from "@capacitor/share";
import { Keyboard } from "@capacitor/keyboard";
import { Network } from "@capacitor/network";
import {
  PushNotifications,
  type ActionPerformed,
  type PushNotificationSchema,
  type Token,
} from "@capacitor/push-notifications";
import { toast } from "sonner";
import { buildAuthRedirectUri, buildSignupConfirmationRedirect } from "@/lib/auth-return";
import {
  capturePhotoWithCamera,
  captureVideoWithCamera,
  pickMediaFromGallery,
} from "@/lib/media-picker";
import { SITE_ORIGIN } from "@/lib/site";

/**
 * Checks if running inside native Android or iOS application wrapper.
 */
export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // 'android' | 'ios' | 'web'

export const NATIVE_APP_SCHEME = "pingbydot://";
const PUSH_TOKEN_KEY = "ping_native_push_token_v1";

/* -------------------------------------------------------------------------- */
/*                                 DEEP LINKS                                 */
/* -------------------------------------------------------------------------- */

/**
 * Normalizes both HTTPS App Links (`https://host/login?code=...`) and custom-scheme
 * deep links (`pingbydot://login?code=...`) into an internal app route path.
 */
export function normalizeDeepLinkPath(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return `${url.pathname || "/"}${url.search}${url.hash}`;
    }
    const routeSegment = [url.host, url.pathname.replace(/^\/+/, "")].filter(Boolean).join("/");
    const normalizedPath = routeSegment ? `/${routeSegment}` : "/";
    return `${normalizedPath}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function getAuthRedirectUri(nextPath: string): string {
  if (isNative) {
    return buildAuthRedirectUri(nextPath, NATIVE_APP_SCHEME);
  }
  const origin = typeof window !== "undefined" ? window.location.origin : SITE_ORIGIN;
  return buildAuthRedirectUri(nextPath, origin);
}

export function getSignupConfirmationRedirectUri(nextPath: string): string {
  if (isNative) {
    return buildSignupConfirmationRedirect(nextPath, SITE_ORIGIN);
  }
  const origin = typeof window !== "undefined" ? window.location.origin : SITE_ORIGIN;
  return buildSignupConfirmationRedirect(nextPath, origin);
}

export async function openNativeAuthBrowser(url: string): Promise<void> {
  if (isNative) {
    await Browser.open({ url, presentationStyle: "popover" });
    return;
  }
  if (typeof window !== "undefined") {
    window.location.href = url;
  }
}

export async function closeNativeAuthBrowser(): Promise<void> {
  if (!isNative) return;
  try {
    await Browser.close();
  } catch {
    // Ignore when in-app browser was already closed by the user/OS
  }
}

/* -------------------------------------------------------------------------- */
/*                            KEYBOARD REACTIVE STORE                         */
/* -------------------------------------------------------------------------- */

let keyboardOpen = false;
const keyboardListeners = new Set<() => void>();

function setKeyboardOpen(next: boolean) {
  if (keyboardOpen === next) return;
  keyboardOpen = next;
  if (typeof document !== "undefined") {
    document.body.classList.toggle("native-keyboard-open", next);
  }
  keyboardListeners.forEach((fn) => fn());
  if (next && typeof document !== "undefined") {
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      setTimeout(() => {
        active.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }, 60);
    }
  }
}

export function useKeyboardOpen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      keyboardListeners.add(cb);
      return () => keyboardListeners.delete(cb);
    },
    () => keyboardOpen,
    () => false,
  );
}

/* -------------------------------------------------------------------------- */
/*                            NETWORK REACTIVE STORE                          */
/* -------------------------------------------------------------------------- */

export interface NetworkSnapshot {
  connected: boolean;
  connectionType: string;
}

let networkSnapshot: NetworkSnapshot = {
  connected: typeof navigator === "undefined" ? true : navigator.onLine !== false,
  connectionType: "unknown",
};
const networkListeners = new Set<() => void>();

function updateNetworkSnapshot(next: NetworkSnapshot) {
  if (
    networkSnapshot.connected === next.connected &&
    networkSnapshot.connectionType === next.connectionType
  ) {
    return;
  }
  networkSnapshot = next;
  networkListeners.forEach((fn) => fn());
}

export function useNetworkStatus(): NetworkSnapshot {
  return useSyncExternalStore(
    (cb) => {
      networkListeners.add(cb);
      return () => networkListeners.delete(cb);
    },
    () => networkSnapshot,
    () => networkSnapshot,
  );
}

/* -------------------------------------------------------------------------- */
/*                       NATIVE STARTUP & LIFECYCLE                           */
/* -------------------------------------------------------------------------- */

let nativeInitialized = false;
let webConnectivityBound = false;
let latestNavigate: ((path: string) => void) | undefined;
let latestOnHardwareBack: (() => boolean) | undefined;
const nativeHandles: PluginListenerHandle[] = [];

/**
 * Initialize native device integrations on app startup.
 * Safe to call repeatedly across renders; installs listeners once while keeping
 * callback references fresh so hardware back / deep-link handlers never go stale.
 */
export async function initializeNativeApp(
  navigate?: (path: string) => void,
  onHardwareBack?: () => boolean,
): Promise<void> {
  latestNavigate = navigate;
  latestOnHardwareBack = onHardwareBack;

  if (typeof window !== "undefined" && !webConnectivityBound) {
    webConnectivityBound = true;
    const syncWebConnectivity = () =>
      updateNetworkSnapshot({
        connected: navigator.onLine !== false,
        connectionType: navigator.onLine === false ? "none" : networkSnapshot.connectionType,
      });
    window.addEventListener("online", syncWebConnectivity);
    window.addEventListener("offline", syncWebConnectivity);
  }

  if (!isNative || nativeInitialized) return;
  nativeInitialized = true;

  try {
    // 1. Status bar styling for Obsidian dark theme foundation with safe-area padding
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
    if (platform === "android") {
      await StatusBar.setBackgroundColor({ color: "#090B0A" });
    }

    // 2. Network monitoring
    const status = await Network.getStatus().catch(() => null);
    if (status) {
      updateNetworkSnapshot({
        connected: status.connected,
        connectionType: status.connectionType,
      });
    }
    nativeHandles.push(
      await Network.addListener("networkStatusChange", (next) => {
        updateNetworkSnapshot({
          connected: next.connected,
          connectionType: next.connectionType,
        });
      }),
    );

    // 3. Soft keyboard visibility & active input scroll adjustment
    nativeHandles.push(
      await Keyboard.addListener("keyboardWillShow", () => setKeyboardOpen(true)),
      await Keyboard.addListener("keyboardDidShow", () => setKeyboardOpen(true)),
      await Keyboard.addListener("keyboardWillHide", () => setKeyboardOpen(false)),
      await Keyboard.addListener("keyboardDidHide", () => setKeyboardOpen(false)),
    );

    // 4. Hide splash screen after initialization
    await SplashScreen.hide().catch(() => {});

    // 5. Android hardware back button handler (always invokes latest callback ref)
    if (platform === "android") {
      nativeHandles.push(
        await App.addListener("backButton", ({ canGoBack }) => {
          if (latestOnHardwareBack?.()) return;
          if (typeof document !== "undefined") {
            const openDialog = document.querySelector("[role='dialog'][data-state='open']");
            if (openDialog) {
              document.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
              );
              return;
            }
          }
          if (window.location.pathname === "/" && !canGoBack) {
            App.exitApp();
          } else if (canGoBack || window.location.pathname !== "/") {
            if (canGoBack) {
              window.history.back();
            } else if (latestNavigate) {
              latestNavigate("/");
            } else {
              window.location.href = "/";
            }
          } else {
            App.exitApp();
          }
        }),
      );
    }

    // 6. Native deep links & OAuth callback listener
    nativeHandles.push(
      await App.addListener("appUrlOpen", (data) => {
        const path = normalizeDeepLinkPath(data.url);
        if (!path) {
          console.warn("Failed to parse incoming deep link:", data.url);
          return;
        }
        if (path.startsWith("/login") || path.startsWith("/signup")) {
          void closeNativeAuthBrowser();
        }
        if (latestNavigate) {
          latestNavigate(path);
        } else {
          window.location.href = path;
        }
      }),
    );

    // 7. Refresh network status on foreground resume
    nativeHandles.push(
      await App.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) return;
        void Network.getStatus()
          .then((next) =>
            updateNetworkSnapshot({
              connected: next.connected,
              connectionType: next.connectionType,
            }),
          )
          .catch(() => {});
      }),
    );
  } catch (err) {
    console.warn("Native initialization error:", err);
  }
}

/* -------------------------------------------------------------------------- */
/*                          SHARE, CAMERA & PHOTOS                            */
/* -------------------------------------------------------------------------- */

/**
 * Native Share Sheet integration with automatic fallback.
 */
export async function nativeShare({
  title,
  text,
  url,
}: {
  title?: string;
  text?: string;
  url?: string;
}): Promise<boolean> {
  const shareUrl = url || window.location.href;

  if (isNative) {
    try {
      await Share.share({
        title: title || "Ping by DOT",
        text: text || "Check this out on Ping by DOT",
        url: shareUrl,
        dialogTitle: "Share via",
      });
      return true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("canceled")) return false;
    }
  }

  // Web Share API fallback
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({
        title: title || "Ping by DOT",
        text: text || "Check this out on Ping by DOT",
        url: shareUrl,
      });
      return true;
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return false;
    }
  }

  // Clipboard copy fallback
  try {
    await navigator.clipboard.writeText(shareUrl);
    toast.success("Link copied to clipboard!");
    return true;
  } catch {
    toast.error("Couldn't copy link.");
    return false;
  }
}

/**
 * Captures a photo via `@capacitor/camera` v8 (`takePhoto` / `chooseFromGallery`)
 * and converts it into a standard File compatible with Ping's upload pipelines.
 * Never relies on deprecated `Camera.getPhoto()`.
 */
export async function captureNativeMediaFile(
  mode: "prompt" | "camera" | "photos" = "prompt",
): Promise<File | null> {
  if (!Capacitor.isNativePlatform()) return null;
  if (mode === "camera") {
    const out = await capturePhotoWithCamera();
    return out.files[0] ?? null;
  }
  const out = await pickMediaFromGallery({ mediaType: "photo", multiple: false });
  return out.files[0] ?? null;
}

/**
 * On web, clicks the hidden file input; on native Android/iOS, opens the native gallery
 * via `Camera.chooseFromGallery()` and passes the resulting File to `onFile`.
 */
export async function pickOrCaptureImage(
  fileInput: HTMLInputElement | null,
  onFile: (file: File) => void | Promise<void>,
): Promise<void> {
  const outcome = await pickMediaFromGallery({
    mediaType: "photo",
    multiple: false,
    webFallbackInput: fileInput,
  });
  const first = outcome.files[0];
  if (first) {
    await onFile(first);
  }
}

/**
 * Captures a photo directly via Capacitor Camera `takePhoto()` on native Android/iOS,
 * or opens camera-mode photo capture on web/mobile browsers.
 */
export async function takePhoto(): Promise<File | null> {
  const out = await capturePhotoWithCamera();
  return out.files[0] ?? null;
}

/**
 * Launches native `Camera.recordVideo()` on Android/iOS or browser video capture
 * (`capture="camcorder"`) for Moments, Chat & Hub uploads.
 */
export async function recordVideo(): Promise<File | null> {
  const out = await captureVideoWithCamera();
  return out.files[0] ?? null;
}

/**
 * Opens the native photo/video gallery via Capacitor Camera `chooseFromGallery()` on
 * Android/iOS (supporting photo, video, and combined selection), or OS file picker on Web/PWA.
 */
export async function chooseFromGallery(accept = "image/*,video/*"): Promise<File | null> {
  const wantsPhoto = accept.includes("image");
  const wantsVideo = accept.includes("video");
  const mediaType =
    wantsPhoto && wantsVideo ? "all" : wantsVideo ? "video" : wantsPhoto ? "photo" : "all";
  const out = await pickMediaFromGallery({
    mediaType,
    multiple: false,
    accept,
  });
  return out.files[0] ?? null;
}

/**
 * Opens multi-select photo/video gallery (`Camera.chooseFromGallery({ allowMultipleSelection: true })`
 * on native Android/iOS; `<input type="file" multiple>` on Web/PWA).
 */
export async function chooseMultipleFromGallery(
  mediaType: "photo" | "video" | "all" = "all",
  limit = 10,
): Promise<File[]> {
  const out = await pickMediaFromGallery({ mediaType, multiple: true, limit });
  return out.files;
}

/* -------------------------------------------------------------------------- */
/*                       PUSH NOTIFICATIONS (OPT-IN)                          */
/* -------------------------------------------------------------------------- */

export type PushRegistrationResult =
  | { status: "granted"; token: string | null }
  | { status: "denied" }
  | { status: "unavailable"; reason: string };

let pushListenersBound = false;

function bindPushListeners(navigate?: (path: string) => void): void {
  if (!isNative || pushListenersBound) return;
  pushListenersBound = true;

  void PushNotifications.addListener("registration", (token: Token) => {
    try {
      window.localStorage.setItem(PUSH_TOKEN_KEY, token.value);
    } catch {
      // Ignore storage errors
    }
  });

  void PushNotifications.addListener("registrationError", (err) => {
    console.warn("Native push registration unavailable:", err);
  });

  void PushNotifications.addListener(
    "pushNotificationReceived",
    (notification: PushNotificationSchema) => {
      if (notification.title || notification.body) {
        toast(notification.title || "New activity on Ping", {
          description: notification.body,
        });
      }
    },
  );

  void PushNotifications.addListener(
    "pushNotificationActionPerformed",
    (action: ActionPerformed) => {
      const rawUrl =
        (action.notification.data?.["url"] as string | undefined) ||
        (action.notification.data?.["href"] as string | undefined);
      if (!rawUrl) return;
      const route = normalizeDeepLinkPath(rawUrl);
      if (!route) return;
      if (navigate) {
        navigate(route);
      } else if (typeof window !== "undefined") {
        window.location.href = route;
      }
    },
  );
}

export function readStoredPushToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(PUSH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function getNativePushState(): Promise<"granted" | "denied" | "prompt" | "web"> {
  if (!isNative) return "web";
  try {
    const status = await PushNotifications.checkPermissions();
    if (status.receive === "granted") return "granted";
    if (status.receive === "denied") return "denied";
    return "prompt";
  } catch {
    return "prompt";
  }
}

/**
 * Requests push permissions and registers the device ONLY when triggered by user interaction.
 */
export async function enablePushNotifications(
  navigate?: (path: string) => void,
): Promise<PushRegistrationResult> {
  if (!isNative) {
    return { status: "unavailable", reason: "Push alerts require the Ping mobile app." };
  }

  try {
    let status = await PushNotifications.checkPermissions();
    if (status.receive !== "granted") {
      status = await PushNotifications.requestPermissions();
    }
    if (status.receive !== "granted") {
      return { status: "denied" };
    }

    bindPushListeners(navigate);
    await PushNotifications.register();
    return { status: "granted", token: readStoredPushToken() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Push setup unavailable cleanly.";
    return { status: "unavailable", reason: msg };
  }
}

export interface NativeRuntimeDiagnostics {
  isNative: boolean;
  platform: string;
  bundleId: string;
  customScheme: string;
  connected: boolean;
  connectionType: string;
  pushTokenStored: boolean;
  storeReleaseNotes: string;
}

/**
 * Returns sanitized native wrapper & connectivity diagnostics for Settings / Developer QA.
 */
export function getNativeRuntimeDiagnostics(): NativeRuntimeDiagnostics {
  return {
    isNative,
    platform,
    bundleId: "app.lovable.pingbydot",
    customScheme: NATIVE_APP_SCHEME,
    connected: networkSnapshot.connected,
    connectionType: networkSnapshot.connectionType,
    pushTokenStored: Boolean(readStoredPushToken()),
    storeReleaseNotes:
      "Capacitor 8 Android & iOS projects configured; Play Store upload requires Android signing keystore + SHA-256 assetlinks, and App Store release requires macOS/Xcode + Apple Team ID.",
  };
}
