import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";
import { Share } from "@capacitor/share";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { toast } from "sonner";

/**
 * Checks if running inside native Android or iOS application wrapper.
 */
export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // 'android' | 'ios' | 'web'

/**
 * Initialize native device integrations on app startup.
 */
export async function initializeNativeApp(navigate?: (path: string) => void) {
  if (!isNative) return;

  try {
    // 1. Status bar styling for Obsidian dark theme foundation
    await StatusBar.setStyle({ style: Style.Dark });
    if (platform === "android") {
      await StatusBar.setBackgroundColor({ color: "#090B0A" });
    }

    // 2. Hide splash screen after initialization
    await SplashScreen.hide();

    // 3. Android hardware back button handler
    if (platform === "android") {
      App.addListener("backButton", ({ canGoBack }) => {
        if (window.location.pathname === "/" || !canGoBack) {
          App.exitApp();
        } else {
          window.history.back();
        }
      });
    }

    // 4. Native deep links listener (e.g. pingbydot://, https://pingbydot.lovable.app/...)
    App.addListener("appUrlOpen", (data) => {
      try {
        const url = new URL(data.url);
        const path = url.pathname + url.search + url.hash;
        if (navigate && path) {
          navigate(path);
        } else {
          window.location.href = path;
        }
      } catch (err) {
        console.warn("Failed to parse incoming deep link:", err);
      }
    });
  } catch (err) {
    console.warn("Native initialization error:", err);
  }
}

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
    } catch (e: any) {
      if (e.message?.includes("canceled")) return false;
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
    } catch (e: any) {
      if (e.name === "AbortError") return false;
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
 * Native Camera & Gallery capture with fallback.
 */
export async function captureNativePhoto(): Promise<string | null> {
  if (!isNative) return null;

  try {
    const photo = await Camera.getPhoto({
      quality: 85,
      allowEditing: false,
      resultType: CameraResultType.Uri,
      source: CameraSource.Prompt, // Prompts: Camera or Photos
    });

    return photo.webPath || null;
  } catch (err: any) {
    if (!err.message?.includes("cancelled")) {
      console.warn("Camera capture error:", err);
    }
    return null;
  }
}
