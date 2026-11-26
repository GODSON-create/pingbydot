import { supabase } from "@/integrations/supabase/client";

export interface EarlyAccessReleaseManifest {
  version: string;
  releaseChannel: string;
  releasedAt: string;
  appId: string;
  android: {
    status: "available" | "pending_signed_build";
    versionName: string;
    versionCode: number;
    minSdk: number;
    downloadUrl: string | null;
    sha256: string | null;
    debugDistributionBlocked: boolean;
    statusMessage: string;
  };
  pwa: {
    status: "available";
    manifestUrl: string;
    supportedBrowsers: string[];
    statusMessage: string;
  };
  ios: {
    status: "available" | "pending_apple_review";
    testFlightUrl: string | null;
    bundleId: string;
    statusMessage: string;
  };
  releaseNotes: string[];
  support: {
    bugReportPath: string;
    helpEmail: string;
  };
}

export const FALLBACK_EARLY_ACCESS_MANIFEST: EarlyAccessReleaseManifest = {
  version: "1.0.0-ea.1",
  releaseChannel: "early-access",
  releasedAt: "2026-11-20",
  appId: "app.lovable.pingbydot",
  android: {
    status: "pending_signed_build",
    versionName: "1.0.0-ea.1",
    versionCode: 1,
    minSdk: 24,
    downloadUrl: null,
    sha256: null,
    debugDistributionBlocked: true,
    statusMessage:
      "Signed release APK awaits release keystore & Android SDK build pipeline. Debug APKs are intentionally never distributed publicly. Install the Ping Progressive Web App immediately on Android Chrome below.",
  },
  pwa: {
    status: "available",
    manifestUrl: "/manifest.webmanifest",
    supportedBrowsers: ["Android Chrome", "iPhone & iPad Safari", "Desktop Chrome / Edge"],
    statusMessage:
      "Install Ping directly to your home screen with zero app-store wait. Updates automatically and supports offline fallback.",
  },
  ios: {
    status: "pending_apple_review",
    testFlightUrl: null,
    bundleId: "app.lovable.pingbydot",
    statusMessage:
      "Native iOS TestFlight archive requires macOS, Xcode, and Apple Developer signing credentials. iPhone and iPad users can install Ping immediately via Safari Add to Home Screen (PWA) and join the TestFlight waitlist below.",
  },
  releaseNotes: [
    "Unified 5-destination navigation across Home, Explore, Create, Hubs, and Inbox.",
    "Ping Learn entitlements (Builder Plus Leapfrog entry + Builder Pro 10-course library), Ping Spotlight editorial hub, and Ping Clips vertical short-form video.",
    "Progressive Web App installability with offline fallback, update notifications, and privacy-hardened caching.",
    "Appointment-based Platform Owner administration and real database-backed analytics.",
  ],
  support: {
    bugReportPath: "/download#early-access-signup",
    helpEmail: "support@pingbydot.com",
  },
};

export interface DownloadReferralContext {
  referralSource: string;
  sourceSite: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
}

/**
 * Parses inbound attribution parameters when visitors arrive at `/download`
 * from any of the Platform Owner's external websites (e.g. `?ref=site1`,
 * `?site=joinarise.cv`, `?utm_source=...`).
 */
export function parseDownloadReferral(search: string): DownloadReferralContext {
  const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
  const clean = (v: string | null, max = 80) =>
    (v ?? "")
      .trim()
      .replace(/[^a-zA-Z0-9._:/-]/g, "")
      .slice(0, max);

  const sourceSite = clean(params.get("site") || params.get("source"), 120);
  const utmSource = clean(params.get("utm_source"), 80);
  const utmMedium = clean(params.get("utm_medium"), 80);
  const utmCampaign = clean(params.get("utm_campaign"), 80);
  const ref = clean(params.get("ref"), 80);

  return {
    referralSource: ref || utmSource || sourceSite || "direct",
    sourceSite,
    utmSource,
    utmMedium,
    utmCampaign,
  };
}

export async function fetchEarlyAccessManifest(): Promise<EarlyAccessReleaseManifest> {
  if (typeof fetch === "undefined") return FALLBACK_EARLY_ACCESS_MANIFEST;
  try {
    const res = await fetch("/releases/early-access-manifest.json", { cache: "no-store" });
    if (!res.ok) return FALLBACK_EARLY_ACCESS_MANIFEST;
    const json = (await res.json()) as EarlyAccessReleaseManifest;
    // Hard safety guard: never expose a debug APK link even if tampered
    if (json?.android?.downloadUrl?.toLowerCase().includes("debug")) {
      json.android.downloadUrl = null;
      json.android.status = "pending_signed_build";
    }
    return json;
  } catch {
    return FALLBACK_EARLY_ACCESS_MANIFEST;
  }
}

export type DownloadAttributionEventKind =
  | "page_view"
  | "apk_download_click"
  | "pwa_install_prompt"
  | "pwa_installed"
  | "ios_guide_open"
  | "testflight_click"
  | "early_access_submit";

export async function recordDownloadAttribution(params: {
  eventKind: DownloadAttributionEventKind;
  platform: "android" | "ios" | "pwa" | "desktop" | "unknown";
  referral: DownloadReferralContext;
  appVersion: string;
}): Promise<void> {
  try {
    await (supabase as any).rpc("record_download_attribution", {
      p_event_kind: params.eventKind,
      p_platform: params.platform,
      p_referral_source: params.referral.referralSource,
      p_source_site: params.referral.sourceSite,
      p_utm_source: params.referral.utmSource,
      p_utm_campaign: params.referral.utmCampaign,
      p_app_version: params.appVersion,
    });
  } catch {
    // Graceful pre-0035 degradation
  }
}

export async function submitEarlyAccessRegistration(params: {
  email: string;
  platform: "android" | "ios" | "pwa" | "desktop";
  deviceModel: string;
  notes: string;
  referral: DownloadReferralContext;
}): Promise<{ ok: true; persisted: boolean; message: string }> {
  const email = params.email.trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
    throw new Error("Please enter a valid email address.");
  }

  const res = await (supabase as any).rpc("register_early_access", {
    p_email: email,
    p_platform: params.platform,
    p_device_model: params.deviceModel.trim(),
    p_referral_source: params.referral.referralSource,
    p_source_site: params.referral.sourceSite,
    p_utm_source: params.referral.utmSource,
    p_utm_medium: params.referral.utmMedium,
    p_utm_campaign: params.referral.utmCampaign,
    p_notes: params.notes.trim(),
  });

  if (res.error) {
    if (res.error.code === "42883" || res.error.code === "PGRST202") {
      return {
        ok: true,
        persisted: false,
        message:
          "Early-access database storage awaits migration 0035 on the live server. You can install the Ping PWA right now using the button above.",
      };
    }
    throw new Error(res.error.message || "Could not complete early-access registration.");
  }

  return {
    ok: true,
    persisted: true,
    message:
      "You are registered for Ping Early Access! We will notify you as soon as signed builds or TestFlight invites open for your device.",
  };
}
