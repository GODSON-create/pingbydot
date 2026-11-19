import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { getAuthRedirectUri, isNative, openNativeAuthBrowser } from "@/lib/native";
import { trackEvent } from "@/lib/telemetry";
import { Button } from "@/components/ui/button";
import { PingMark } from "@/components/BrandLogo";

export function AuthShell({
  title,
  subtitle,
  children,
  sticker,
  showWelcomeLink = true,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  sticker?: string;
  showWelcomeLink?: boolean;
}) {
  return (
    <div className="bg-hero relative overflow-hidden px-4 py-7 pb-24 sm:px-5 sm:py-16">
      <div className="surface-card relative mx-auto max-w-md rounded-[2rem] p-6 sm:p-9">
        {sticker && (
          <span className="sticker absolute -top-3 right-6 rotate-3 bg-lime text-lime-foreground">
            {sticker}
          </span>
        )}
        <div className="mb-5 flex items-center gap-3">
          <PingMark variant="lime" size="lg" alt="PING Official Lime Mark" />
          <div>
            <span className="font-display text-lg font-extrabold tracking-tight text-foreground">
              Ping
            </span>
            <span className="ml-1.5 text-[10px] font-bold uppercase tracking-widest text-primary">
              BY DOT
            </span>
            <p className="text-xs text-muted-foreground">
              Social · Communication · Discovery · Economy
            </p>
          </div>
        </div>
        <h1 className="font-display text-2xl sm:text-3xl font-extrabold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
        <div className="mt-7">{children}</div>
        <p className="mt-5 text-center text-[11px] leading-relaxed text-muted-foreground">
          By continuing, you agree to Ping&apos;s{" "}
          <Link to="/terms" className="underline hover:text-foreground">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link to="/privacy" className="underline hover:text-foreground">
            Privacy Policy
          </Link>
          .
        </p>
        {showWelcomeLink && (
          <div className="mt-4 border-t border-border/50 pt-4 text-center">
            <Link
              to="/welcome"
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              See the 3-slide Ping welcome tour &rarr;
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export function GoogleButton({
  label,
  next = "/",
  variant = "hero",
}: {
  label: string;
  next?: string;
  variant?: "hero" | "outline";
}) {
  const [pending, setPending] = useState(false);

  const launchExternalOrBrowser = (url: string) => {
    void openNativeAuthBrowser(url);
  };

  return (
    <Button
      type="button"
      variant={variant}
      size="lg"
      disabled={pending}
      className="w-full"
      onClick={async () => {
        if (pending) return;
        setPending(true);
        trackEvent("auth_started", { method: "google" });

        const redirectUri = getAuthRedirectUri(next);
        const isLovableHost = /(?:^|\.)lovable\.(?:app|dev)$|(?:^|\.)lovableproject\.com$/i.test(
          window.location.hostname,
        );
        let isInIframe = false;
        try {
          isInIframe = window.self !== window.top;
        } catch {
          isInIframe = true;
        }

        try {
          let canUseLovableBroker = !isNative && isInIframe && isLovableHost;
          if (!isNative && !isInIframe && isLovableHost) {
            try {
              const probe = await fetch(
                `/~oauth/initiate?provider=google&redirect_uri=${encodeURIComponent(redirectUri)}`,
                { method: "GET", redirect: "manual" },
              );
              // Only treat a real 3xx / opaque redirect as an active Lovable OAuth broker.
              canUseLovableBroker =
                probe.type === "opaqueredirect" || (probe.status >= 300 && probe.status < 400);
            } catch {
              canUseLovableBroker = false;
            }
          }

          if (canUseLovableBroker) {
            const r = await lovable.auth.signInWithOAuth("google", {
              redirect_uri: redirectUri,
            });
            if (r.error) {
              trackEvent("auth_failed", { method: "google" });
              toast.error(
                r.error.message || "Google sign-in didn't work. Try email & password instead.",
              );
              setPending(false);
            }
            return;
          }

          const { data, error } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: {
              redirectTo: redirectUri,
              skipBrowserRedirect: true,
            },
          });

          if (error) {
            trackEvent("auth_failed", { method: "google" });
            const msg = error.message || "";
            if (/missing oauth secret|unsupported provider/i.test(msg)) {
              toast.error(
                "Google OAuth credentials are not configured on Supabase Auth yet. Enable Google provider secrets in Supabase or use email & password.",
              );
            } else {
              toast.error(msg || "Google sign-in didn't work. Try again.");
            }
            setPending(false);
            return;
          }

          if (data?.url) {
            try {
              const authProbe = await fetch(data.url, {
                method: "GET",
                redirect: "manual",
              });
              if (
                authProbe.type === "opaqueredirect" ||
                (authProbe.status >= 300 && authProbe.status < 400)
              ) {
                launchExternalOrBrowser(data.url);
                if (isNative) setPending(false);
                return;
              }
              if (authProbe.status >= 400) {
                trackEvent("auth_failed", { method: "google" });
                let serverMsg = "";
                try {
                  const payload = (await authProbe.json()) as {
                    msg?: string;
                    error_description?: string;
                    message?: string;
                  };
                  serverMsg = payload.msg || payload.error_description || payload.message || "";
                } catch {
                  serverMsg = "";
                }
                if (/missing oauth secret|unsupported provider/i.test(serverMsg)) {
                  toast.error(
                    "Google OAuth credentials are not configured on Supabase Auth yet. Enable Google provider secrets in Supabase or use email & password.",
                  );
                } else {
                  toast.error(
                    serverMsg || "Google sign-in is unavailable right now. Try email & password.",
                  );
                }
                setPending(false);
                return;
              }
            } catch {
              if (typeof navigator !== "undefined" && !navigator.onLine) {
                trackEvent("auth_failed", { method: "google" });
                toast.error("You appear to be offline. Reconnect and try again.");
                setPending(false);
                return;
              }
              launchExternalOrBrowser(data.url);
              if (isNative) setPending(false);
              return;
            }
          }

          trackEvent("auth_failed", { method: "google" });
          toast.error("Could not start Google sign-in. Try email & password instead.");
          setPending(false);
        } catch {
          trackEvent("auth_failed", { method: "google" });
          toast.error("Couldn't connect to Google sign-in. Try again.");
          setPending(false);
        }
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden>
        <path
          fill="currentColor"
          d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3ZM12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Zm-5.6-8a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9L6.4 14ZM12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.8 9.4 6 12 6Z"
        />
      </svg>
      {pending ? "Connecting to Google…" : label}
    </Button>
  );
}

export function OrDivider() {
  return (
    <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
    </div>
  );
}
