import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/AuthShell";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Reset your password — Ping" },
      { name: "description", content: "Get a link to reset your Ping password." },
      { property: "og:title", content: "Reset your password — Ping" },
      { property: "og:description", content: "Reset your Ping password." },
    ],
  }),
  component: Forgot,
});

function Forgot() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
    setPending(false);
    if (error) return setErr(error.message);
    setSent(true);
  };
  return (
    <AuthShell title="Forgot your password?" subtitle="We'll email you a link to set a new one.">
      {sent ? (
        <p className="rounded-2xl bg-accent p-4 text-sm">If an account exists for {email}, a reset link is on its way.</p>
      ) : (
        <form onSubmit={submit} className="grid gap-4">
          <div><Label htmlFor="email">Email</Label><Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5 rounded-xl" /></div>
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
          <Button type="submit" variant="hero" disabled={pending}>{pending ? "Sending…" : "Send reset link"}</Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm"><Link to="/login" className="underline">Back to log in</Link></p>
    </AuthShell>
  );
}
