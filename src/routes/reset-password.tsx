import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/AuthShell";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password — Ping" },
      { name: "description", content: "Choose a new password for your Ping account." },
      { property: "og:title", content: "Set a new password — Ping" },
      { property: "og:description", content: "Choose a new Ping password." },
    ],
  }),
  component: Reset,
});

function Reset() {
  const navigate = useNavigate();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return setErr("Use at least 8 characters.");
    setPending(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setPending(false);
    if (error) return setErr("This reset link may have expired. Request a new one.");
    toast.success("Password updated");
    navigate({ to: "/explore" });
  };
  return (
    <AuthShell title="Set a new password" subtitle="Pick something you haven't used before.">
      <form onSubmit={submit} className="grid gap-4">
        <div><Label htmlFor="pw">New password</Label><Input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className="mt-1.5 rounded-xl" /></div>
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        <Button type="submit" variant="hero" disabled={pending}>{pending ? "Saving…" : "Save password"}</Button>
      </form>
    </AuthShell>
  );
}
