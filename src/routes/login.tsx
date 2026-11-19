import { createFileRoute, Link, useNavigate, type SearchSchemaInput } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell, GoogleButton, OrDivider } from "@/components/AuthShell";
import { PingMark } from "@/components/BrandLogo";
import { useAuth } from "@/lib/auth";
import {
  authDestination,
  extractAuthCallbackParams,
  unwrapOnboardingDestination,
} from "@/lib/auth-return";
import { sanitizeErrorMessage } from "@/lib/error-diagnostics";
import { markWelcomeSeen, needsOnboarding } from "@/lib/pathways";
import { trackEvent, trackSessionRestoredOnce } from "@/lib/telemetry";

export const Route = createFileRoute("/login")({
  staticData: { sitemap: false },
  validateSearch: (search: SearchSchemaInput & { next?: unknown; reason?: unknown }) => ({
    next:
      typeof search.next === "string" && search.next.trim() ? authDestination(search.next) : "/",
    reason: search.reason === "expired" ? ("expired" as const) : undefined,
  }),
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Sign in — Ping" },
      { name: "description", content: "Sign in to Ping to connect, communicate, and discover." },
      { property: "og:title", content: "Sign in — Ping" },
      { property: "og:description", content: "Sign in to Ping." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const { next, reason } = Route.useSearch();
  const { ready, user, profile, profileLoading, sessionExpired, clearSessionExpired } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [callbackPending, setCallbackPending] = useState(false);
  const isExpiredNotice = reason === "expired" || sessionExpired;

  // Handle OAuth redirect tokens (both PKCE ?code= and hash #access_token=) or URL errors cleanly
  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;
    const {
      code,
      accessToken,
      refreshToken,
      error: oauthError,
    } = extractAuthCallbackParams(window.location.search, window.location.hash);

    if (oauthError) {
      trackEvent("auth_failed", { method: "oauth_callback" });
      setErr(sanitizeErrorMessage(oauthError));
      return;
    }

    const cleanSearch = () => {
      const cleaned = new URLSearchParams(window.location.search);
      cleaned.delete("code");
      cleaned.delete("state");
      const nextQs = cleaned.toString();
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${nextQs ? `?${nextQs}` : ""}`,
      );
    };

    if (accessToken && refreshToken) {
      setCallbackPending(true);
      void supabase.auth
        .setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ error }) => {
          if (!active) return;
          if (error) {
            trackEvent("auth_failed", { method: "oauth_callback" });
            setErr(sanitizeErrorMessage(error.message));
          } else {
            cleanSearch();
          }
        })
        .finally(() => {
          if (active) setCallbackPending(false);
        });
      return () => {
        active = false;
      };
    }

    if (code) {
      setCallbackPending(true);
      void (async () => {
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          if (!sessionData.session) {
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (!active) return;
            if (error) {
              const { data: retrySession } = await supabase.auth.getSession();
              if (!retrySession.session) {
                trackEvent("auth_failed", { method: "oauth_callback" });
                setErr(sanitizeErrorMessage(error.message));
                return;
              }
            }
          }
          if (active) cleanSearch();
        } catch (callbackErr) {
          if (!active) return;
          trackEvent("auth_failed", { method: "oauth_callback" });
          setErr(sanitizeErrorMessage(callbackErr));
        } finally {
          if (active) setCallbackPending(false);
        }
      })();
    }

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!ready || !user || profileLoading || callbackPending) return;
    markWelcomeSeen();
    const isNew = needsOnboarding(profile);
    const resolvedNext = unwrapOnboardingDestination(next);
    trackSessionRestoredOnce(isNew);
    if (isNew) {
      navigate({ to: "/onboarding", search: { next: resolvedNext }, replace: true });
    } else {
      navigate({ to: resolvedNext, replace: true });
    }
  }, [ready, user, profile, profileLoading, callbackPending, next, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setPending(true);
    trackEvent("auth_started", { method: "email" });
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        trackEvent("auth_failed", { method: "email" });
        return setErr(
          error.message.includes("confirm")
            ? "Please verify your email first — check your inbox."
            : "Couldn't log in. Check your email and password, then try again.",
        );
      }
      markWelcomeSeen();
      clearSessionExpired();
      trackEvent("auth_completed", { method: "email", is_new_user: false });
    } catch {
      trackEvent("auth_failed", { method: "email" });
      setErr("Couldn't connect. Please try again.");
    } finally {
      setPending(false);
    }
  };

  if (!ready || user) {
    return (
      <div className="bg-hero flex min-h-[calc(100dvh-5rem)] items-center justify-center px-4 pb-24">
        <div
          role="status"
          aria-live="polite"
          className="surface-card flex flex-col items-center gap-3 rounded-3xl px-8 py-7 text-center shadow-lift"
        >
          <PingMark variant="lime" size="lg" alt="Ping by DOT" />
          <p className="text-sm font-medium text-muted-foreground">
            {user ? "Opening Ping…" : "Restoring your session…"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <AuthShell
      title="Sign in to Ping"
      subtitle="Continue with Google or use your email and password."
    >
      {isExpiredNotice && !err ? (
        <div
          role="alert"
          className="mb-5 rounded-2xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-foreground"
        >
          Your session expired. Sign in again to continue.
        </div>
      ) : null}
      {callbackPending ? (
        <div
          role="status"
          className="mb-5 rounded-2xl border border-primary/25 bg-primary/10 px-4 py-3 text-center text-sm font-medium text-foreground"
        >
          Completing sign-in…
        </div>
      ) : null}
      <GoogleButton label="Continue with Google" next={next} />
      <OrDivider />
      <form onSubmit={submit} className="grid gap-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5 rounded-xl"
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link to="/forgot-password" className="text-xs text-muted-foreground underline">
              Forgot?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 rounded-xl"
          />
        </div>
        {err && (
          <p
            role="alert"
            className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {err}
          </p>
        )}
        <Button type="submit" variant="outline" size="lg" disabled={pending || callbackPending}>
          {pending ? "Signing in…" : "Log in with Email"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        New to Ping?{" "}
        <Link to="/signup" search={{ next }} className="font-semibold text-foreground underline">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
