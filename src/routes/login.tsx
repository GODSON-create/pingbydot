import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell, GoogleButton, OrDivider } from "@/components/AuthShell";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Log in — Ping" },
      { name: "description", content: "Log in to Ping to share and like Pings." },
      { property: "og:title", content: "Log in — Ping" },
      { property: "og:description", content: "Log in to Ping." },
    ],
  }),
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setPending(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setPending(false);
    if (error) return setErr(error.message.includes("confirm") ? "Please verify your email first — check your inbox." : "That email and password don't match.");
    navigate({ to: "/explore" });
  };

  return (
    <AuthShell title="Welcome back" subtitle="Pick up where you left off.">
      <GoogleButton label="Continue with Google" />
      <OrDivider />
      <form onSubmit={submit} className="grid gap-4">
        <div><Label htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5 rounded-xl" /></div>
        <div>
          <div className="flex items-center justify-between"><Label htmlFor="password">Password</Label><Link to="/forgot-password" className="text-xs text-muted-foreground underline">Forgot?</Link></div>
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5 rounded-xl" />
        </div>
        {err && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>}
        <Button type="submit" variant="hero" size="lg" disabled={pending}>{pending ? "Logging in…" : "Log in"}</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">New here? <Link to="/signup" className="font-semibold text-foreground underline">Create an account</Link></p>
    </AuthShell>
  );
}
