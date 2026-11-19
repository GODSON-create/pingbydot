import { createFileRoute, Link, useNavigate, type SearchSchemaInput } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MailCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell, GoogleButton, OrDivider } from "@/components/AuthShell";
import { PingMark } from "@/components/BrandLogo";
import { useAuth } from "@/lib/auth";
import { authDestination, unwrapOnboardingDestination } from "@/lib/auth-return";
import { getSignupConfirmationRedirectUri } from "@/lib/native";
import { markWelcomeSeen, needsOnboarding } from "@/lib/pathways";
import { trackEvent, trackSessionRestoredOnce } from "@/lib/telemetry";
import { usernameSchema } from "@/lib/validation";

export const Route = createFileRoute("/signup")({
  staticData: { sitemap: false },
  validateSearch: (search: SearchSchemaInput & { next?: unknown }) => ({
    next:
      typeof search.next === "string" && search.next.trim() ? authDestination(search.next) : "/",
  }),
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Sign up — Ping" },
      {
        name: "description",
        content: "Create your Ping account to connect, communicate, discover, and share.",
      },
      { property: "og:title", content: "Sign up — Ping" },
      {
        property: "og:description",
        content: "Join Ping by DOT — open to everyone.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Signup,
});

function Signup() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const { ready, user, profile, profileLoading } = useAuth();
  const [f, setF] = useState({ name: "", username: "", email: "", password: "" });
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  // Restore existing authenticated sessions straight into Ping (or onboarding if new)
  useEffect(() => {
    if (!ready || !user || profileLoading) return;
    markWelcomeSeen();
    const isNew = needsOnboarding(profile);
    const resolvedNext = unwrapOnboardingDestination(next);
    trackSessionRestoredOnce(isNew);
    if (isNew) {
      navigate({ to: "/onboarding", search: { next: resolvedNext }, replace: true });
    } else {
      navigate({ to: resolvedNext, replace: true });
    }
  }, [ready, user, profile, profileLoading, next, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const u = usernameSchema.safeParse(f.username);
    if (!f.name.trim()) return setErr("Add your name.");
    if (!u.success)
      return setErr("Username: " + (u.error.issues[0]?.message || "Choose a valid username."));
    if (f.password.length < 8) return setErr("Use at least 8 characters for your password.");
    setPending(true);
    trackEvent("auth_started", { method: "email" });
    try {
      const { data: taken, error: lookupError } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", u.data)
        .maybeSingle();
      if (lookupError) {
        trackEvent("auth_failed", { method: "email" });
        return setErr("Couldn't check that username. Try again.");
      }
      if (taken) {
        return setErr("That username is taken. Try another.");
      }
      const { data, error } = await supabase.auth.signUp({
        email: f.email.trim(),
        password: f.password,
        options: {
          emailRedirectTo: getSignupConfirmationRedirectUri(next),
          data: { username: u.data, display_name: f.name.trim() },
        },
      });
      if (error) {
        trackEvent("auth_failed", { method: "email" });
        return setErr(
          /already registered/i.test(error.message)
            ? "An account with this email already exists. Try signing in with Google or logging in."
            : error.message,
        );
      }
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        trackEvent("auth_failed", { method: "email" });
        return setErr(
          "An account with this email already exists. Try signing in with Google or logging in.",
        );
      }
      markWelcomeSeen();
      trackEvent("auth_completed", { method: "email", is_new_user: true });
      if (data.session) {
        const resolvedNext = unwrapOnboardingDestination(next);
        navigate({ to: "/onboarding", search: { next: resolvedNext }, replace: true });
        return;
      }
      setSent(true);
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
            {user ? "Opening Ping…" : "Checking your session…"}
          </p>
        </div>
      </div>
    );
  }

  if (sent)
    return (
      <AuthShell title="Check your inbox" subtitle={`We sent a confirmation link to ${f.email}.`}>
        <div className="flex flex-col items-center text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-lime text-lime-foreground animate-float-a">
            <MailCheck className="size-7" />
          </div>
          <p className="mt-5 text-sm text-muted-foreground">
            Click the link to verify your email, then continue straight into Ping. Can't find it?
            Check spam.
          </p>
          <Button asChild variant="outline" className="mt-6">
            <Link to="/login">Back to log in</Link>
          </Button>
        </div>
      </AuthShell>
    );

  return (
    <AuthShell
      title="Create your Ping account"
      subtitle="Continue with Google or set up your account with email."
    >
      <GoogleButton label="Continue with Google" next={next} />
      <OrDivider />
      <form onSubmit={submit} className="grid gap-4">
        <div>
          <Label htmlFor="name">Your name</Label>
          <Input
            id="name"
            autoComplete="name"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            className="mt-1.5 rounded-xl"
          />
        </div>
        <div>
          <Label htmlFor="username">Username</Label>
          <div className="mt-1.5 flex items-center rounded-xl border border-input bg-card pl-3 focus-within:ring-2 focus-within:ring-ring">
            <span className="text-muted-foreground">@</span>
            <input
              id="username"
              autoComplete="username"
              value={f.username}
              onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })}
              className="h-9 w-full bg-transparent px-1 text-sm outline-none"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
            className="mt-1.5 rounded-xl"
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })}
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
        <Button type="submit" variant="outline" size="lg" disabled={pending}>
          {pending ? "Creating account…" : "Continue with Email"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/login" search={{ next }} className="font-semibold text-foreground underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
