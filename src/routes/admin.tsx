import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ShieldCheck, ChevronLeft, ChevronRight, RefreshCw, EyeOff, Eye, Check } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { checkAdminAccess, getAdminOverview, getAdminList, moderatePing } from "@/lib/admin.functions";
import { ADMIN_PAGE_SIZE, moderationSchema } from "@/lib/admin-policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Administration — Ping by DOT" },
    { name: "description", content: "Secure Ping by DOT administration and moderation." },
    { property: "og:title", content: "Administration — Ping by DOT" },
    { property: "og:description", content: "Secure Ping by DOT administration." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: AdminPage,
});

function AdminPage() {
  const { ready, user } = useAuth();
  const verify = useServerFn(checkAdminAccess);
  const access = useQuery({ queryKey: ["admin-access", user?.id], queryFn: () => verify(), enabled: ready && !!user, retry: false, staleTime: 0 });
  if (!ready || (user && access.isPending)) return <div className="mx-auto max-w-6xl px-5 py-16" role="status">Verifying access…</div>;
  if (!user || !access.data?.isAdmin) return <div className="mx-auto max-w-md px-5 py-20 text-center">
    <ShieldCheck className="mx-auto size-10 text-muted-foreground" />
    <h1 className="mt-4 font-display text-3xl font-bold">Access denied</h1>
    <p className="mt-3 text-muted-foreground">{access.isError ? "Administrator access couldn't be verified. Retry before continuing." : "This page is reserved for verified administrators."}</p>
    {access.isError && <Button className="mt-6" onClick={() => access.refetch()}><RefreshCw /> Retry</Button>}
    <Button asChild variant="outline" className="mt-6"><Link to={user ? "/explore" : "/login"}> {user ? "Back to Explore" : "Log in"}</Link></Button>
  </div>;
  return <AdminDashboard />;
}

function AdminDashboard() {
  const qc = useQueryClient();
  const overviewFn = useServerFn(getAdminOverview);
  const listFn = useServerFn(getAdminList);
  const moderateFn = useServerFn(moderatePing);
  const [view, setView] = useState<"pings" | "users" | "reports" | "audit">("pings");
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [draftSearch, setDraftSearch] = useState("");
  const [pending, setPending] = useState<{ id: string; action: "hide" | "restore" | "resolve_report" } | null>(null);
  const [reason, setReason] = useState("");
  const overview = useQuery({ queryKey: ["admin-overview"], queryFn: () => overviewFn(), retry: false });
  const list = useQuery({ queryKey: ["admin-list", view, page, search], queryFn: () => listFn({ data: { view, page, search } }), retry: false });
  const mutation = useMutation({ mutationFn: (data: { id: string; action: "hide" | "restore" | "resolve_report"; reason: string }) => moderateFn({ data }),
    onSuccess: async () => { setPending(null); setReason(""); await qc.invalidateQueries(); toast.success("Moderation recorded"); },
    onError: () => toast.error("Couldn't complete moderation. Please retry."),
  });
  const metric = (key: string) => {
    const data = overview.data;
    return data && typeof data === "object" && !Array.isArray(data) && typeof data[key] === "number" ? String(data[key]) : "Unavailable";
  };
  const choose = (id: string, action: "hide" | "restore" | "resolve_report") => { setReason(""); setPending({ id, action }); };
  return <div className="mx-auto max-w-6xl px-5 py-12">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><span className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground"><ShieldCheck className="size-4" /> Ping by DOT</span><h1 className="mt-2 font-display text-4xl font-bold">Administration</h1></div><Button variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["admin-overview"] })}><RefreshCw /> Refresh health</Button></div>
    <section aria-label="Platform totals" className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-6">
      {[["Accounts", "accounts"], ["Active creators · 30d", "activeCreators30d"], ["Pings", "pings"], ["Hidden Pings", "hiddenPings"], ["Likes", "likes"], ["Open reports", "openReports"]].map(([label, key]) => <div className="rounded-lg border bg-card p-4" key={key}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 font-display text-2xl font-bold">{metric(key ?? "")}</p></div>)}
    </section>
    <p className="mt-3 text-sm text-muted-foreground">Active creators = unique accounts that published a Ping in the last 30 days; not sign-ins or readers.</p>
    <section className="my-8 border-y py-5" aria-label="Health and unavailable metrics"><h2 className="font-semibold">Health &amp; reporting</h2><p className="mt-2 text-sm text-muted-foreground">{overview.isError ? "Database health check failed. Refresh to retry." : overview.isSuccess ? "Database counts readable at last refresh." : "Checking database…"} Shares, ARISE referrals, reader activity and centralized error totals: unavailable — not tracked.</p><p className="mt-2 text-xs text-muted-foreground">Recent Pings and moderation history appear below. No account emails or sign-in secrets are exposed.</p></section>
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Administration views">{(["pings", "users", "reports", "audit"] as const).map((v) => <Button key={v} role="tab" aria-selected={view === v} variant={view === v ? "default" : "outline"} onClick={() => { setView(v); setPage(0); setSearch(""); setDraftSearch(""); }}>{v === "audit" ? "Audit trail" : v === "reports" ? "Moderation queue" : v === "users" ? "Users" : "Pings"}</Button>)}</div>
    <form className="mt-5 flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(draftSearch); setPage(0); }}><Input aria-label={`Search ${view}`} placeholder={view === "users" ? "Search username" : view === "pings" ? "Search Ping text" : view === "reports" ? "Search report reason" : "Search audit action"} value={draftSearch} maxLength={100} onChange={(e) => setDraftSearch(e.target.value)} /><Button type="submit">Search</Button></form>
    {list.isPending && <p className="py-8" role="status">Loading…</p>}
    {list.isError && <div className="py-8" role="alert">Couldn't load this view. <Button variant="outline" onClick={() => list.refetch()}>Retry</Button></div>}
    <div className="mt-5 divide-y border-y">
      {list.data?.view === "pings" && list.data.rows.map((p) => <article key={p.id} className="py-5"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{p.author?.username ? `@${p.author.username}` : "Founder"} · {p.category} · {new Date(p.created_at).toLocaleString()} · {p.hidden_at ? "Hidden" : "Public"}</p><div className="flex gap-2"><Button asChild variant="outline" size="sm"><Link to="/p/$id" params={{ id: p.id }}>Open</Link></Button><Button size="sm" variant="outline" onClick={() => choose(p.id, p.hidden_at ? "restore" : "hide")}>{p.hidden_at ? <Eye /> : <EyeOff />}{p.hidden_at ? "Restore" : "Hide"}</Button></div></div><p className="mt-3 whitespace-pre-wrap break-words">{p.content}</p></article>)}
      {list.data?.view === "users" && list.data.rows.map((u) => <article key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-5"><div><h3 className="font-semibold">{u.display_name || u.username}</h3><p className="text-sm text-muted-foreground">@{u.username} · Joined {new Date(u.created_at).toLocaleDateString()}</p><p className="mt-2 break-words text-sm">{u.bio}</p></div><Button asChild variant="outline"><Link to="/@{$username}" params={{ username: u.username }}>Public profile</Link></Button></article>)}
      {list.data?.view === "reports" && list.data.rows.map((r) => <article key={r.id} className="py-5"><h3 className="font-semibold">{r.reason}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm">{r.details}</p><p className="mt-2 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</p><div className="mt-3 flex flex-wrap gap-2"><Button asChild variant="outline"><Link to="/p/$id" params={{ id: r.ping_id }}>Review Ping</Link></Button><Button variant="outline" onClick={() => choose(r.ping_id, "hide")}><EyeOff /> Hide Ping</Button><Button variant="outline" onClick={() => choose(r.id, "resolve_report")}><Check /> Resolve report</Button></div></article>)}
      {list.data?.view === "audit" && list.data.rows.map((a) => <article key={a.id} className="py-5"><h3 className="font-semibold">{a.action.replaceAll("_", " ")}</h3><p className="mt-2 break-words text-sm">{a.reason}</p><p className="mt-2 break-all text-xs text-muted-foreground">Target {a.target_id} · Actor {a.actor_id || "Trusted manual administrator"} · {new Date(a.created_at).toLocaleString()}</p></article>)}
      {list.data?.rows.length === 0 && <p className="py-10 text-muted-foreground">No matching entries.</p>}
    </div>
    <div className="mt-5 flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Page {page + 1} · {list.data?.total ?? 0} entries</p><div className="flex gap-2"><Button variant="outline" size="icon" aria-label="Previous page" disabled={page === 0 || list.isFetching} onClick={() => setPage(page - 1)}><ChevronLeft /></Button><Button variant="outline" size="icon" aria-label="Next page" disabled={!list.data || (page + 1) * ADMIN_PAGE_SIZE >= list.data.total || list.isFetching} onClick={() => setPage(page + 1)}><ChevronRight /></Button></div></div>
    <Dialog open={pending !== null} onOpenChange={(open) => { if (!open && !mutation.isPending) setPending(null); }}><DialogContent><DialogHeader><DialogTitle>Confirm {pending?.action.replaceAll("_", " ")}</DialogTitle><DialogDescription>Hiding removes a Ping from public discovery and share previews. Content is preserved and can be restored. Every action records your reason.</DialogDescription></DialogHeader><Label htmlFor="moderation-reason">Reason</Label><Input id="moderation-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /><div className="flex justify-end gap-2"><Button variant="outline" disabled={mutation.isPending} onClick={() => setPending(null)}>Cancel</Button><Button disabled={mutation.isPending || !pending || !moderationSchema.safeParse({ ...pending, reason }).success} onClick={() => { if (pending) mutation.mutate({ ...pending, reason }); }}>{mutation.isPending ? "Saving…" : "Confirm"}</Button></div></DialogContent></Dialog>
  </div>;
}