import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { extractAuthCallbackParams } from "@/lib/auth-return";
import { sanitizeErrorMessage } from "@/lib/error-diagnostics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/AuthShell";

export const Route = createFileRoute("/reset-password")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Set a new password — Ping" },
      { name: "description", content: "Choose a new password for your Ping account." },
      { property: "og:title", content: "Set a new password — Ping" },
      { property: "og:description", content: "Choose a new Ping password." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Reset,
});

function Reset() {
  const navigate = useNavigate();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;
    const { code, accessToken, refreshToken, error } = extractAuthCallbackParams(
      window.location.search,
      window.location.hash,
    );

    const resolveSession = async () => {
      if (error) {
        if (active) {
          setErr(sanitizeErrorMessage(error));
          setVerifying(false);
        }
        return;
      }
      try {
        if (accessToken && refreshToken) {
          const { error: sessionErr } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionErr && active) setErr("This reset link may have expired. Request a new one.");
        } else if (code) {
          const { data: existing } = await supabase.auth.getSession();
          if (!existing.session) {
            const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
            if (exchangeErr && active) {
              setErr("This reset link may have expired. Request a new one.");
            }
          }
        }
        const { data } = await supabase.auth.getSession();
        if (active) {
          setHasSession(Boolean(data.session));
        }
      } finally {
        if (active) setVerifying(false);
      }
    };

    void resolveSession();
    return () => {
      active = false;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (pw.length < 8) return setErr("Use at least 8 characters.");
    setPending(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) return setErr("This reset link may have expired. Request a new one.");
      toast.success("Password updated");
      navigate({ to: "/", replace: true });
    } catch {
      setErr("Couldn't connect. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthShell
      title="Set a new password"
      subtitle="Pick something you haven't used before."
      showWelcomeLink={false}
    >
      {verifying ? (
        <p role="status" className="text-sm text-muted-foreground">
          Checking your reset link…
        </p>
      ) : !hasSession ? (
        <div className="space-y-4">
          <p
            role="alert"
            className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {err || "This reset link is missing or expired. Request a fresh password reset email."}
          </p>
          <Button asChild variant="hero" className="w-full">
            <Link to="/forgot-password">Request a new reset link</Link>
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            <Link to="/login" className="underline">
              Back to log in
            </Link>
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-4">
          <div>
            <Label htmlFor="pw">New password</Label>
            <Input
              id="pw"
              type="password"
              autoComplete="new-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              className="mt-1.5 rounded-xl"
            />
          </div>
          {err && (
            <p role="alert" className="text-sm text-destructive">
              {err}
            </p>
          )}
          <Button type="submit" variant="hero" disabled={pending}>
            {pending ? "Saving…" : "Save password"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
