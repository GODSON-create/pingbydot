import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { profileSchema } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FounderAvatar } from "@/components/ping/Avatar";
import { useSignOut } from "@/components/layout/SiteHeader";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Ping" },
      { name: "description", content: "Edit your Ping profile and account." },
      { property: "og:title", content: "Settings — Ping" },
      { property: "og:description", content: "Manage your Ping profile." },
    ],
  }),
  component: Settings,
});

function Settings() {
  const { user, profile, refreshProfile } = useAuth();
  const signOut = useSignOut();
  const [f, setF] = useState({ username: "", display_name: "", bio: "", avatar_url: "" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "" });

  useEffect(() => {
    if (profile) setF({ username: profile.username, display_name: profile.display_name, bio: profile.bio, avatar_url: profile.avatar_url ?? "" });
  }, [profile]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = profileSchema.safeParse(f);
    if (!r.success) {
      const x: Record<string, string> = {};
      r.error.issues.forEach((i) => (x[String(i.path[0])] ??= i.message));
      return setErrs(x);
    }
    setErrs({});
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ ...r.data, avatar_url: r.data.avatar_url || null }).eq("id", user!.id);
    setSaving(false);
    if (error) {
      if (error.code === "23505") return setErrs({ username: "That username is taken." });
      return toast.error("Couldn't save your profile.");
    }
    toast.success("Profile saved");
    refreshProfile();
  };

  const changePw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.next.length < 8) return toast.error("Use at least 8 characters.");
    const { error } = await supabase.auth.updateUser({ password: pw.next, current_password: pw.current } as never);
    if (error) return toast.error(error.message);
    setPw({ current: "", next: "" });
    toast.success("Password changed");
  };

  if (!profile) return <div className="mx-auto max-w-2xl px-5 py-16 text-muted-foreground">Loading your profile…</div>;

  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="font-display text-4xl font-extrabold">Settings</h1>
      <form onSubmit={save} className="surface-card mt-8 grid gap-5 rounded-3xl p-6 sm:p-8" noValidate>
        <div className="flex items-center gap-4">
          <FounderAvatar name={f.display_name || f.username} src={f.avatar_url || null} size="lg" />
          <div>
            <p className="font-display text-lg font-bold">Public profile</p>
            <Link to="/@{$username}" params={{ username: profile.username }} className="text-sm text-muted-foreground underline">View @{profile.username}</Link>
          </div>
        </div>
        <div><Label htmlFor="dn">Display name</Label><Input id="dn" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} className="mt-1.5 rounded-xl" />{errs.display_name && <p className="mt-1 text-xs text-destructive">{errs.display_name}</p>}</div>
        <div><Label htmlFor="un">Username</Label><Input id="un" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} className="mt-1.5 rounded-xl" /><p className="mt-1 text-xs text-muted-foreground">Changing it changes your profile link.</p>{errs.username && <p className="mt-1 text-xs text-destructive">{errs.username}</p>}</div>
        <div><Label htmlFor="bio">Short bio</Label><Textarea id="bio" rows={3} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} placeholder="Building a tool for… Previously…" className="mt-1.5 rounded-xl" /><p className="mt-1 text-right text-xs text-muted-foreground">{280 - f.bio.length}</p>{errs.bio && <p className="text-xs text-destructive">{errs.bio}</p>}</div>
        <div><Label htmlFor="av">Profile image link (optional)</Label><Input id="av" placeholder="https://…/me.jpg" value={f.avatar_url} onChange={(e) => setF({ ...f, avatar_url: e.target.value })} className="mt-1.5 rounded-xl" />{errs.avatar_url && <p className="mt-1 text-xs text-destructive">{errs.avatar_url}</p>}</div>
        <Button type="submit" variant="hero" className="justify-self-start" disabled={saving}>{saving ? "Saving…" : "Save profile"}</Button>
      </form>

      {user?.app_metadata?.provider === "email" && (
        <form onSubmit={changePw} className="surface-card mt-6 grid gap-4 rounded-3xl p-6 sm:p-8">
          <p className="font-display text-lg font-bold">Password</p>
          <div><Label htmlFor="cp">Current password</Label><Input id="cp" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} className="mt-1.5 rounded-xl" /></div>
          <div><Label htmlFor="np">New password</Label><Input id="np" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} className="mt-1.5 rounded-xl" /></div>
          <Button type="submit" variant="outline" className="justify-self-start">Change password</Button>
        </form>
      )}

      <div className="surface-card mt-6 flex items-center justify-between rounded-3xl p-6">
        <div><p className="font-semibold">Signed in as</p><p className="text-sm text-muted-foreground">{user?.email}</p></div>
        <Button variant="outline" onClick={signOut}>Log out</Button>
      </div>
    </div>
  );
}
