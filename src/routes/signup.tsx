import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { MailCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell, GoogleButton, OrDivider } from "@/components/AuthShell";
import { usernameSchema } from "@/lib/validation";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Sign up — Ping" },
      { name: "description", content: "Create your Ping account and share your first Ping." },
      { property: "og:title", content: "Sign up — Ping" },
      { property: "og:description", content: "Create your Ping account and start building in public." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Signup,
});

function Signup() {
  const navigate = useNavigate();
  const [f, setF] = useState({ name: "", username: "", email: "", password: "" });
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const u = usernameSchema.safeParse(f.username);
    if (!f.name.trim()) return setErr("Add your name.");
    if (!u.success) return setErr("Username: " + u.error.issues[0].message);
    if (f.password.length < 8) return setErr("Use at least 8 characters for your password.");
    setPending(true);
    try {
    const { data: taken, error: lookupError } = await supabase.from("profiles").select("id").eq("username", u.data).maybeSingle();
    if (lookupError) return setErr("Couldn't check that username. Try again.");
    if (taken) {
      setPending(false);
      return setErr("That username is taken. Try another.");
    }
    const { data, error } = await supabase.auth.signUp({
      email: f.email.trim(),
      password: f.password,
      options: { emailRedirectTo: window.location.origin + "/login?next=%2Fcreate", data: { username: u.data, display_name: f.name.trim() } },
    });
    setPending(false);
    if (error) return setErr(error.message);
    if (data.session) { navigate({ to: "/create" }); return; }
    setSent(true);
    } catch { setErr("Couldn't connect. Please try again."); }
    finally { setPending(false); }
  };

  if (sent)
    return (
      <AuthShell title="Check your inbox" subtitle={`We sent a confirmation link to ${f.email}.`}>
        <div className="flex flex-col items-center text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-lime animate-float-a"><MailCheck className="size-7" /></div>
          <p className="mt-5 text-sm text-muted-foreground">Click the link to verify your email, then you can publish your first Ping. Can't find it? Check spam.</p>
          <Button asChild variant="outline" className="mt-6"><Link to="/login">Back to log in</Link></Button>
        </div>
      </AuthShell>
    );

  return (
    <AuthShell title="Start building in public" subtitle="Free, and your first Ping takes a minute." sticker="hi there 👋">
      <GoogleButton label="Continue with Google" />
      <OrDivider />
      <form onSubmit={submit} className="grid gap-4">
        <div><Label htmlFor="name">Your name</Label><Input id="name" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="mt-1.5 rounded-xl" /></div>
        <div>
          <Label htmlFor="username">Username</Label>
          <div className="mt-1.5 flex items-center rounded-xl border border-input bg-card pl-3 focus-within:ring-2 focus-within:ring-ring">
            <span className="text-muted-foreground">@</span>
            <input id="username" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} className="h-9 w-full bg-transparent px-1 text-sm outline-none" />
          </div>
        </div>
        <div><Label htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className="mt-1.5 rounded-xl" /></div>
        <div><Label htmlFor="password">Password</Label><Input id="password" type="password" autoComplete="new-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className="mt-1.5 rounded-xl" /></div>
        {err && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>}
        <Button type="submit" variant="hero" size="lg" disabled={pending}>{pending ? "Creating…" : "Create account"}</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">Already on Ping? <Link to="/login" className="font-semibold text-foreground underline">Log in</Link></p>
    </AuthShell>
  );
}
