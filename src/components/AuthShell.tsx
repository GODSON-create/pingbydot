import type { ReactNode } from "react";
import { toast } from "sonner";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { authDestination } from "@/lib/auth-return";
import { Button } from "@/components/ui/button";
import { PingMark } from "@/components/BrandLogo";

export function AuthShell({
  title,
  subtitle,
  children,
  sticker,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  sticker?: string;
}) {
  return (
    <div className="bg-hero relative overflow-hidden px-5 py-14 sm:py-20">
      <div className="surface-card relative mx-auto max-w-md rounded-[2rem] p-7 sm:p-9">
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
        <h1 className="font-display text-3xl font-extrabold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
        <div className="mt-7">{children}</div>
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
  return (
    <Button
      type="button"
      variant={variant}
      size="lg"
      className="w-full"
      onClick={async () => {
        const nextPath = authDestination(next);
        const redirectUri = `${window.location.origin}/login?next=${encodeURIComponent(nextPath)}`;
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
          let canUseLovableBroker = isInIframe && isLovableHost;
          if (!isInIframe && isLovableHost) {
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
              toast.error(
                r.error.message || "Google sign-in didn't work. Try email & password instead.",
              );
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
            const msg = error.message || "";
            if (/missing oauth secret|unsupported provider/i.test(msg)) {
              toast.error(
                "Google OAuth credentials are not configured on Supabase Auth yet. Enable Google provider secrets in Supabase or use email & password.",
              );
            } else {
              toast.error(msg || "Google sign-in didn't work. Try again.");
            }
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
                window.location.href = data.url;
                return;
              }
              if (authProbe.status >= 400) {
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
                return;
              }
            } catch {
              if (typeof navigator !== "undefined" && !navigator.onLine) {
                toast.error("You appear to be offline. Reconnect and try again.");
                return;
              }
              window.location.href = data.url;
              return;
            }
          }

          toast.error("Could not start Google sign-in. Try email & password instead.");
        } catch {
          toast.error("Couldn't connect to Google sign-in. Try again.");
        }
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden>
        <path
          fill="currentColor"
          d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3ZM12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Zm-5.6-8a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9L6.4 14ZM12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.8 9.4 6 12 6Z"
        />
      </svg>
      {label}
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
