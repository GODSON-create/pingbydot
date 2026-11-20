import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  HelpCircle,
  Lock,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FALLBACK_EARLY_ACCESS_MANIFEST,
  fetchEarlyAccessManifest,
  parseDownloadReferral,
  recordDownloadAttribution,
  submitEarlyAccessRegistration,
} from "@/lib/distribution";
import {
  detectPwaPlatform,
  initializePwaRuntime,
  isRunningStandalonePwa,
  promptPwaInstall,
  subscribePwaInstallAvailability,
} from "@/lib/pwa";

export const Route = createFileRoute("/download")({
  staticData: { sitemap: true },
  head: () => ({
    meta: [
      { title: "Download Ping — Early Access & App Installation" },
      {
        name: "description",
        content:
          "Official Ping by DOT download centre. Install the Ping Progressive Web App on Android, iPhone, or desktop, inspect verified signed Android APK release status, and register for iOS TestFlight early access.",
      },
      { property: "og:title", content: "Download Ping — Official Early-Access Centre" },
      {
        property: "og:description",
        content:
          "Install Ping on Android, iPhone, and desktop from the single official Ping download centre.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: DownloadCentrePage,
});

function DownloadCentrePage() {
  const { searchStr } = useLocation();
  const referral = useMemo(() => parseDownloadReferral(searchStr), [searchStr]);
  const [installPromptReady, setInstallPromptReady] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [detectedPlatform, setDetectedPlatform] = useState<"ios" | "android" | "desktop">(
    "desktop",
  );

  // Early-access registration state
  const [email, setEmail] = useState("");
  const [platform, setPlatform] = useState<"android" | "ios" | "pwa" | "desktop">("android");
  const [deviceModel, setDeviceModel] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [registrationMsg, setRegistrationMsg] = useState<string | null>(null);

  const manifestQuery = useQuery({
    queryKey: ["early-access-manifest"],
    queryFn: fetchEarlyAccessManifest,
    initialData: FALLBACK_EARLY_ACCESS_MANIFEST,
    staleTime: 60_000,
  });

  const manifest = manifestQuery.data ?? FALLBACK_EARLY_ACCESS_MANIFEST;

  useEffect(() => {
    const plat = detectPwaPlatform();
    setDetectedPlatform(plat);
    setPlatform(plat === "ios" ? "ios" : plat === "android" ? "android" : "pwa");
    setStandalone(isRunningStandalonePwa());

    initializePwaRuntime({
      onInstalled: () => {
        setStandalone(true);
        void recordDownloadAttribution({
          eventKind: "pwa_installed",
          platform: "pwa",
          referral,
          appVersion: manifest.version,
        });
      },
    });
    const unsub = subscribePwaInstallAvailability(setInstallPromptReady);

    void recordDownloadAttribution({
      eventKind: "page_view",
      platform: plat,
      referral,
      appVersion: manifest.version,
    });

    return unsub;
  }, [referral, manifest.version]);

  const handleInstallPwa = async () => {
    void recordDownloadAttribution({
      eventKind: "pwa_install_prompt",
      platform: "pwa",
      referral,
      appVersion: manifest.version,
    });

    const outcome = await promptPwaInstall();
    if (outcome === "accepted") {
      toast.success("Ping is being installed to your home screen.");
    } else if (outcome === "dismissed") {
      toast.info("Install dismissed. You can install Ping anytime from your browser menu.");
    } else if (detectedPlatform === "ios") {
      toast.info("On iPhone/iPad Safari, tap Share → Add to Home Screen.");
    } else {
      toast.info("Open your browser menu and select 'Install app' or 'Add to Home screen'.");
    }
  };

  const handleCopySha256 = async () => {
    if (!manifest.android.sha256) return;
    try {
      await navigator.clipboard.writeText(manifest.android.sha256);
      toast.success("SHA-256 checksum copied.");
    } catch {
      toast.error("Could not copy checksum.");
    }
  };

  const handleEarlyAccessSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setRegistrationMsg(null);
    try {
      const result = await submitEarlyAccessRegistration({
        email,
        platform,
        deviceModel,
        notes,
        referral,
      });
      setRegistrationMsg(result.message);
      setEmail("");
      setDeviceModel("");
      setNotes("");
      toast.success("Early-access request recorded.");
    } catch (err: any) {
      toast.error(err?.message || "Could not submit early-access registration.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-10 space-y-10">
      {/* Hero */}
      <header className="surface-card rounded-3xl border border-border/80 p-6 sm:p-10 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Sparkles className="size-3.5" /> Official Ping Download Centre · v{manifest.version}
          </span>
          {referral.referralSource !== "direct" && (
            <span className="rounded-full border border-border bg-secondary px-3 py-1 text-[11px] font-medium text-muted-foreground">
              Referred from:{" "}
              <strong className="text-foreground">
                {referral.sourceSite || referral.referralSource}
              </strong>
            </span>
          )}
        </div>

        <div className="space-y-3 max-w-2xl">
          <h1 className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight">
            Install Ping on any device.
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
            This is the single canonical early-access installation hub for Ping by DOT. Install the
            Progressive Web App instantly on Android, iPhone, or desktop, inspect verified Android
            APK release status, or join iOS TestFlight.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          {standalone ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-4 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="size-4" /> Ping is already installed on this device
            </span>
          ) : (
            <Button
              type="button"
              variant="hero"
              className="rounded-full gap-2"
              onClick={handleInstallPwa}
            >
              <Download className="size-4" />
              {installPromptReady ? "Install Ping App Now (PWA)" : "Install Ping Web App (PWA)"}
            </Button>
          )}
          <Button asChild variant="outline" className="rounded-full">
            <a href="#early-access-signup">Register for Early Access</a>
          </Button>
          <Button asChild variant="ghost" className="rounded-full">
            <Link to="/explore">Open Ping in Browser →</Link>
          </Button>
        </div>
      </header>

      {/* Three Platform Cards */}
      <section aria-label="Platform installation options" className="grid gap-5 md:grid-cols-3">
        {/* 1. Progressive Web App (Available Today) */}
        <article className="surface-card rounded-2xl border border-emerald-500/40 p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-bold">
                <Smartphone className="size-4 text-primary" /> Progressive Web App
              </span>
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                Available Now
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {manifest.pwa.statusMessage}
            </p>
            <ul className="text-xs text-muted-foreground space-y-1.5 list-disc pl-4">
              <li>Works on Android Chrome, iPhone Safari, and Desktop Chrome/Edge.</li>
              <li>Privacy-safe caching: private messages &amp; auth tokens are never cached.</li>
              <li>Automatic update prompt when new Ping versions ship.</li>
            </ul>
          </div>
          <Button
            type="button"
            variant="hero"
            size="sm"
            className="w-full rounded-full"
            onClick={handleInstallPwa}
          >
            {installPromptReady ? "Install Now" : "How to Install PWA"}
          </Button>
        </article>

        {/* 2. Android Signed Release APK */}
        <article className="surface-card rounded-2xl border border-border p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-bold">
                <ShieldCheck className="size-4 text-primary" /> Android Release APK
              </span>
              <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                {manifest.android.status === "available"
                  ? "Signed Release"
                  : "Pending Signed Build"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {manifest.android.statusMessage}
            </p>
            <div className="rounded-xl bg-secondary/60 p-3 text-[11px] space-y-1">
              <p>
                <strong>Package ID:</strong> <span className="font-mono">{manifest.appId}</span>
              </p>
              <p>
                <strong>Target Version:</strong> {manifest.android.versionName} (Android 7.0+ / SDK{" "}
                {manifest.android.minSdk}+)
              </p>
              <p>
                <strong>SHA-256 Checksum:</strong>{" "}
                {manifest.android.sha256 ? (
                  <span className="font-mono break-all">{manifest.android.sha256}</span>
                ) : (
                  <span className="text-muted-foreground">
                    Published upon signed release build (never fabricated)
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="space-y-2">
            {manifest.android.status === "available" && manifest.android.downloadUrl ? (
              <>
                <Button asChild size="sm" className="w-full rounded-full">
                  <a
                    href={manifest.android.downloadUrl}
                    download
                    onClick={() =>
                      void recordDownloadAttribution({
                        eventKind: "apk_download_click",
                        platform: "android",
                        referral,
                        appVersion: manifest.android.versionName,
                      })
                    }
                  >
                    <Download className="size-3.5 mr-1.5" /> Download Signed APK
                  </a>
                </Button>
                {manifest.android.sha256 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-full rounded-full"
                    onClick={handleCopySha256}
                  >
                    <Copy className="size-3.5 mr-1.5" /> Copy SHA-256 Checksum
                  </Button>
                )}
              </>
            ) : (
              <Button asChild size="sm" variant="outline" className="w-full rounded-full">
                <a href="#early-access-signup">Notify Me When Signed APK Ships</a>
              </Button>
            )}
          </div>
        </article>

        {/* 3. iPhone / iOS TestFlight */}
        <article className="surface-card rounded-2xl border border-border p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-bold">
                <Lock className="size-4 text-primary" /> iOS TestFlight
              </span>
              <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                {manifest.ios.status === "available" ? "Open Beta" : "Pending Apple Signing"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {manifest.ios.statusMessage}
            </p>
            <div className="rounded-xl bg-secondary/60 p-3 text-[11px] space-y-1">
              <p>
                <strong>Bundle ID:</strong>{" "}
                <span className="font-mono">{manifest.ios.bundleId}</span>
              </p>
              <p>
                <strong>Recommended Today:</strong> Safari → Share → Add to Home Screen
              </p>
            </div>
          </div>
          {manifest.ios.status === "available" && manifest.ios.testFlightUrl ? (
            <Button asChild size="sm" className="w-full rounded-full">
              <a
                href={manifest.ios.testFlightUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() =>
                  void recordDownloadAttribution({
                    eventKind: "testflight_click",
                    platform: "ios",
                    referral,
                    appVersion: manifest.version,
                  })
                }
              >
                Open TestFlight <ExternalLink className="size-3.5 ml-1.5" />
              </a>
            </Button>
          ) : (
            <Button asChild size="sm" variant="outline" className="w-full rounded-full">
              <a
                href="#early-access-signup"
                onClick={() =>
                  void recordDownloadAttribution({
                    eventKind: "ios_guide_open",
                    platform: "ios",
                    referral,
                    appVersion: manifest.version,
                  })
                }
              >
                Join iOS TestFlight Waitlist
              </a>
            </Button>
          )}
        </article>
      </section>

      {/* Step-by-step installation guides */}
      <section aria-label="Step-by-step installation guides" className="grid gap-5 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-6 space-y-3">
          <h2 className="font-display text-lg font-bold">Android Installation Guide</h2>
          <ol className="text-xs text-muted-foreground space-y-2 list-decimal pl-4 leading-relaxed">
            <li>
              <strong>Instant PWA (Recommended today):</strong> Open this page in{" "}
              <strong>Google Chrome</strong>, tap <strong>Install Ping App Now</strong> (or Chrome
              menu ⋮ → <em>Install app</em>), and confirm. Ping appears on your home screen with
              full-screen launch.
            </li>
            <li>
              <strong>Signed Release APK (Once published):</strong> Download exclusively from this
              official page, verify the SHA-256 checksum matches, allow installs from your browser
              when prompted by Android, and never install unofficial or debug APK files.
            </li>
          </ol>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 space-y-3">
          <h2 className="font-display text-lg font-bold">iPhone &amp; iPad Installation Guide</h2>
          <ol className="text-xs text-muted-foreground space-y-2 list-decimal pl-4 leading-relaxed">
            <li>
              Open this page in <strong>Safari</strong> on iPhone or iPad.
            </li>
            <li>
              Tap the <Share2 className="inline size-3.5 mx-0.5" /> <strong>Share</strong> icon in
              Safari&apos;s toolbar.
            </li>
            <li>
              Scroll down and tap <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>{" "}
              in the top-right corner. Ping opens as a standalone full-screen app.
            </li>
            <li>
              Register below with platform <strong>iOS</strong> to receive a TestFlight invite once
              Apple Developer signing and review complete.
            </li>
          </ol>
        </div>
      </section>

      {/* Release notes + Early-Access Registration */}
      <section className="grid gap-6 md:grid-cols-2 items-start">
        <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">Release Notes · v{manifest.version}</h2>
            <span className="text-xs text-muted-foreground">{manifest.releasedAt}</span>
          </div>
          <ul className="text-xs text-muted-foreground space-y-2 list-disc pl-4 leading-relaxed">
            {manifest.releaseNotes.map((note, idx) => (
              <li key={idx}>{note}</li>
            ))}
          </ul>
          <div className="pt-3 border-t border-border/60 flex items-start gap-2 text-xs text-muted-foreground">
            <HelpCircle className="size-4 shrink-0 text-primary mt-0.5" />
            <p>
              Spotted an installation issue or bug? Include your device model in the early-access
              form or email{" "}
              <a
                href={`mailto:${manifest.support.helpEmail}`}
                className="underline text-foreground"
              >
                {manifest.support.helpEmail}
              </a>
              .
            </p>
          </div>
        </div>

        <form
          id="early-access-signup"
          onSubmit={handleEarlyAccessSubmit}
          className="rounded-2xl border border-border bg-card p-6 space-y-4"
        >
          <div>
            <h2 className="font-display text-lg font-bold">Early-Access Registration</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Get notified for signed Android APK releases, iOS TestFlight invites, or report a
              device compatibility note.
            </p>
          </div>

          <div>
            <Label htmlFor="ea-email" className="text-xs">
              Email Address
            </Label>
            <Input
              id="ea-email"
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ea-platform" className="text-xs">
                Primary Device
              </Label>
              <select
                id="ea-platform"
                value={platform}
                onChange={(e) =>
                  setPlatform(e.target.value as "android" | "ios" | "pwa" | "desktop")
                }
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-xs"
              >
                <option value="android">Android</option>
                <option value="ios">iPhone / iPad (iOS)</option>
                <option value="pwa">Web / PWA</option>
                <option value="desktop">Desktop</option>
              </select>
            </div>
            <div>
              <Label htmlFor="ea-device" className="text-xs">
                Device Model (Optional)
              </Label>
              <Input
                id="ea-device"
                placeholder="e.g., Samsung A55, iPhone 15"
                maxLength={120}
                value={deviceModel}
                onChange={(e) => setDeviceModel(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="ea-notes" className="text-xs">
              Feedback or Bug Report (Optional)
            </Label>
            <Input
              id="ea-notes"
              placeholder="Any device feedback or early-access note…"
              maxLength={400}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1"
            />
          </div>

          {registrationMsg && (
            <p
              role="status"
              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300"
            >
              {registrationMsg}
            </p>
          )}

          <Button
            type="submit"
            variant="hero"
            disabled={submitting}
            className="w-full rounded-full"
          >
            {submitting ? "Submitting…" : "Register for Ping Early Access"}
          </Button>
        </form>
      </section>
    </div>
  );
}
