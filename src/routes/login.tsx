import { createFileRoute, Link, useNavigate, type SearchSchemaInput } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell, GoogleButton, OrDivider } from "@/components/AuthShell";
import { useAuth } from "@/lib/auth";
import { authDestination } from "@/lib/auth-return";
import { sanitizeErrorMessage } from "@/lib/error-diagnostics";
import { markWelcomeSeen, needsOnboarding } from "@/lib/pathways";

export const Route = createFileRoute("/login")({
  staticData: { sitemap: false },
  validateSearch: (search: SearchSchemaInput & { next?: unknown }) => ({
    next:
      typeof search.next === "string" && search.next.trim() ? authDestination(search.next) : "/",
  }),
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Log in — Ping" },
      { name: "description", content: "Log in to Ping to connect, discover, and share." },
      { property: "og:title", content: "Log in — Ping" },
      { property: "og:description", content: "Log in to Ping." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const { ready, user, profile, profileLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Handle OAuth redirect tokens (including token-only hash responses) or errors cleanly
  useEffect(() => {
    if (typeof window === "undefined") return;
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));

    const oauthError =
      hashParams.get("error_description") ||
      hashParams.get("error") ||
      searchParams.get("error_description") ||
      searchParams.get("error");
    if (oauthError) {
      setErr(sanitizeErrorMessage(oauthError));
    }

    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    if (accessToken && refreshToken) {
      void supabase.auth
        .setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ error }) => {
          if (error) {
            setErr(sanitizeErrorMessage(error.message));
          } else {
            window.history.replaceState(
              window.history.state,
              "",
              `${window.location.pathname}${window.location.search}`,
            );
          }
        });
    }
  }, []);

  useEffect(() => {
    if (!ready || !user || profileLoading) return;
    markWelcomeSeen();
    if (needsOnboarding(profile)) {
      navigate({ to: "/onboarding", search: { next }, replace: true });
    } else {
      navigate({ to: next, replace: true });
    }
  }, [ready, user, profile, profileLoading, next, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setPending(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error)
        return setErr(
          error.message.includes("confirm")
            ? "Please verify your email first — check your inbox."
            : "Couldn't log in. Check your email and password, then try again.",
        );
      markWelcomeSeen();
    } catch {
      setErr("Couldn't connect. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Pick up where you left off.">
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
        <Button type="submit" variant="hero" size="lg" disabled={pending}>
          {pending ? "Logging in…" : "Log in"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link to="/signup" className="font-semibold text-foreground underline">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
