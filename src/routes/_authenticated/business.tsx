import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Briefcase,
  Building2,
  Clock,
  Download,
  ExternalLink,
  Inbox,
  Info,
  Megaphone,
  Plus,
  Send,
  ShieldCheck,
  Store,
  Users,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  buildLeadsCsv,
  businessAdCampaignsQuery,
  businessEnquiriesQuery,
  businessOfferingsQuery,
  businessSavedRepliesQuery,
  businessTeamQuery,
  computeAvgResponseMinutes,
  getBusinessIntegrationReadiness,
  myBusinessesQuery,
  useAddBusinessTeamMember,
  useCreateAdCampaignDraft,
  useCreateBusinessOffering,
  useCreateSavedReply,
  useUpdateBusinessEnquiry,
  type BusinessRole,
  type LeadStatus,
} from "@/lib/business";
import { REVENUE_ARCHITECTURE_ENGINES } from "@/lib/payments/paystack";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/business")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Business Suite — Ping by DOT" },
    ],
  }),
  component: BusinessWorkspacePage,
});

const LEAD_STATUSES: LeadStatus[] = ["new", "qualified", "in_progress", "won", "lost", "closed"];

function BusinessWorkspacePage() {
  const { user } = useAuth();
  const { data: myBusinesses = [], isLoading } = useQuery(myBusinessesQuery(user?.id));
  const [selectedBizId, setSelectedBizId] = useState<string | null>(null);
  const activeBiz = myBusinesses.find((b) => b.id === selectedBizId) ?? myBusinesses[0] ?? null;

  const [section, setSection] = useState<"inbox" | "catalogue" | "team" | "ads" | "integrations">(
    "inbox",
  );

  const { data: enquiries = [] } = useQuery(businessEnquiriesQuery(activeBiz?.id));
  const { data: savedReplies = [] } = useQuery(businessSavedRepliesQuery(activeBiz?.id));
  const { data: offerings = [] } = useQuery(businessOfferingsQuery(activeBiz?.id));
  const { data: team = [] } = useQuery(businessTeamQuery(activeBiz?.id));
  const { data: campaigns = [] } = useQuery(businessAdCampaignsQuery(activeBiz?.id));

  const updateEnquiry = useUpdateBusinessEnquiry(activeBiz?.id ?? "");
  const createSavedReply = useCreateSavedReply(activeBiz?.id ?? "", user?.id);
  const createOffering = useCreateBusinessOffering(activeBiz?.id ?? "");
  const addTeamMember = useAddBusinessTeamMember(activeBiz?.id ?? "", user?.id);
  const createAdDraft = useCreateAdCampaignDraft(activeBiz?.id ?? "", user?.id);

  // Inbox state
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "all">("all");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [srTitle, setSrTitle] = useState("");
  const [srShortcut, setSrShortcut] = useState("");
  const [srBody, setSrBody] = useState("");

  // Catalogue state
  const [offKind, setOffKind] = useState<"product" | "service">("service");
  const [offTitle, setOffTitle] = useState("");
  const [offPrice, setOffPrice] = useState("");
  const [offDesc, setOffDesc] = useState("");
  const [offBookable, setOffBookable] = useState(true);

  // Team state
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteRole, setInviteRole] = useState<Exclude<BusinessRole, "owner">>("agent");

  // Ad draft state
  const [adPlacement, setAdPlacement] = useState<
    "sponsored_ping" | "sponsored_signal" | "sponsored_hub"
  >("sponsored_ping");
  const [adTitle, setAdTitle] = useState("");
  const [adBudgetUsd, setAdBudgetUsd] = useState("50");
  const [adRegions, setAdRegions] = useState("GLOBAL");

  const integrationReadiness = getBusinessIntegrationReadiness();

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-12">
        <div className="h-40 animate-pulse rounded-3xl bg-secondary/60" />
      </div>
    );
  }

  if (!activeBiz) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16 text-center space-y-4">
        <Building2 className="mx-auto size-12 text-primary/70" />
        <h1 className="font-display text-2xl font-extrabold">Launch Your Ping Business Suite</h1>
        <p className="text-sm text-muted-foreground">
          Create a dedicated business storefront with a multi-agent Business Inbox, lead CRM,
          product &amp; service catalogue, and team roles — without sharing personal account
          passwords.
        </p>
        <Button asChild variant="hero" className="rounded-full">
          <Link to="/businesses">
            <Plus className="size-4" /> Create Business Page
          </Link>
        </Button>
      </div>
    );
  }

  const avgResponseMins = computeAvgResponseMinutes(enquiries);
  const visibleEnquiries =
    statusFilter === "all" ? enquiries : enquiries.filter((e) => e.lead_status === statusFilter);

  const handleExportCsv = () => {
    const csv = buildLeadsCsv(visibleEnquiries);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeBiz.slug}-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${visibleEnquiries.length} authorised lead records`);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 pb-24 space-y-6">
      {/* Header */}
      <header className="surface-card rounded-3xl p-6 border border-border/70 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
              <Briefcase className="size-3.5" /> Multi-Agent Business Workspace
            </span>
            <h1 className="mt-2 font-display text-2xl sm:text-3xl font-extrabold">
              {activeBiz.name}
            </h1>
            <p className="text-xs text-muted-foreground">
              {enquiries.length} enquiries · {offerings.length} catalogue items ·{" "}
              {avgResponseMins !== null
                ? `Avg response: ${avgResponseMins} min`
                : "No responses logged yet"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {myBusinesses.length > 1 && (
              <select
                value={activeBiz.id}
                onChange={(e) => setSelectedBizId(e.target.value)}
                className="h-9 rounded-full border border-border bg-card px-3 text-xs font-semibold"
              >
                {myBusinesses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
            <Button asChild variant="outline" size="sm" className="rounded-full text-xs gap-1.5">
              <Link to="/b/$slug" params={{ slug: activeBiz.slug }}>
                <ExternalLink className="size-3.5" /> Public Storefront
              </Link>
            </Button>
          </div>
        </div>

        {/* Workspace Section Tabs */}
        <nav className="flex items-center gap-2 overflow-x-auto scrollbar-none pt-3 border-t border-border/60">
          {(
            [
              { id: "inbox", label: `Inbox & Leads (${enquiries.length})`, icon: Inbox },
              { id: "catalogue", label: `Catalogue (${offerings.length})`, icon: Store },
              { id: "team", label: `Team (${team.length + 1})`, icon: Users },
              { id: "ads", label: `Ad Campaigns (${campaigns.length})`, icon: Megaphone },
              { id: "integrations", label: "Integrations & Revenue", icon: Zap },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSection(tab.id)}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors",
                  section === tab.id
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card hover:bg-secondary",
                )}
              >
                <Icon className="size-3.5" /> {tab.label}
              </button>
            );
          })}
        </nav>
      </header>

      {/* 1. MULTI-AGENT INBOX & LEAD CRM */}
      {section === "inbox" && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setStatusFilter("all")}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold",
                  statusFilter === "all"
                    ? "bg-foreground text-background"
                    : "bg-secondary text-muted-foreground",
                )}
              >
                All ({enquiries.length})
              </button>
              {LEAD_STATUSES.map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold capitalize",
                    statusFilter === st
                      ? "bg-foreground text-background"
                      : "bg-secondary text-muted-foreground",
                  )}
                >
                  {st.replace("_", " ")}
                </button>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={visibleEnquiries.length === 0}
              onClick={handleExportCsv}
              className="rounded-full text-xs gap-1.5"
            >
              <Download className="size-3.5" /> Export Leads CSV
            </Button>
          </div>

          {visibleEnquiries.length === 0 ? (
            <div className="surface-card rounded-3xl p-8 text-center text-xs text-muted-foreground border border-border/60">
              No enquiries in this lead stage yet.
            </div>
          ) : (
            <div className="space-y-3">
              {visibleEnquiries.map((enq) => (
                <article
                  key={enq.id}
                  className="surface-card rounded-3xl p-5 border border-border/70 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                        {enq.enquiry_type.replace("_", " ")}
                      </span>
                      <h3 className="font-display text-base font-bold">{enq.subject}</h3>
                      <p className="text-xs text-muted-foreground">
                        From{" "}
                        {enq.customer?.display_name || `@${enq.customer?.username || "Customer"}`}
                        {enq.preferred_date ? ` · Preferred: ${enq.preferred_date}` : ""}
                      </p>
                    </div>
                    <select
                      aria-label="Lead status"
                      value={enq.lead_status}
                      onChange={(e) =>
                        updateEnquiry.mutate(
                          { enquiryId: enq.id, leadStatus: e.target.value as LeadStatus },
                          { onSuccess: () => toast.success("Lead status updated") },
                        )
                      }
                      className="h-8 rounded-full border border-border bg-secondary px-3 text-xs font-semibold capitalize"
                    >
                      {LEAD_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                  </div>

                  <p className="text-xs text-foreground/90 whitespace-pre-line bg-secondary/40 rounded-2xl p-3">
                    {enq.message}
                  </p>

                  {enq.reply_message && (
                    <div className="rounded-2xl border border-primary/25 bg-primary/8 p-3 text-xs">
                      <span className="font-bold text-primary">Latest team reply:</span>{" "}
                      {enq.reply_message}
                    </div>
                  )}

                  {/* Saved reply shortcuts + Response input */}
                  <div className="space-y-2 pt-2 border-t border-border/50">
                    {savedReplies.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-muted-foreground">Saved replies:</span>
                        {savedReplies.map((sr) => (
                          <button
                            key={sr.id}
                            type="button"
                            onClick={() =>
                              setReplyDrafts((prev) => ({ ...prev, [enq.id]: sr.body }))
                            }
                            className="rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] hover:bg-secondary"
                          >
                            /{sr.shortcut}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Input
                        value={replyDrafts[enq.id] ?? ""}
                        onChange={(e) =>
                          setReplyDrafts((prev) => ({ ...prev, [enq.id]: e.target.value }))
                        }
                        placeholder="Write response to customer…"
                        className="rounded-xl text-xs flex-1"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="hero"
                        className="rounded-xl text-xs gap-1"
                        disabled={!(replyDrafts[enq.id] ?? "").trim()}
                        onClick={() => {
                          const text = (replyDrafts[enq.id] ?? "").trim();
                          updateEnquiry.mutate(
                            {
                              enquiryId: enq.id,
                              replyMessage: text,
                              leadStatus:
                                enq.lead_status === "new" ? "in_progress" : enq.lead_status,
                            },
                            {
                              onSuccess: () => {
                                setReplyDrafts((prev) => ({ ...prev, [enq.id]: "" }));
                                toast.success("Reply recorded");
                              },
                            },
                          );
                        }}
                      >
                        <Send className="size-3.5" /> Reply
                      </Button>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Input
                        value={noteDrafts[enq.id] ?? enq.internal_notes}
                        onChange={(e) =>
                          setNoteDrafts((prev) => ({ ...prev, [enq.id]: e.target.value }))
                        }
                        placeholder="Private team CRM notes (not visible to customer)…"
                        className="rounded-xl text-xs flex-1 bg-secondary/30"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="rounded-xl text-xs"
                        onClick={() =>
                          updateEnquiry.mutate(
                            {
                              enquiryId: enq.id,
                              internalNotes: noteDrafts[enq.id] ?? enq.internal_notes,
                            },
                            { onSuccess: () => toast.success("Internal note saved") },
                          )
                        }
                      >
                        Save Note
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

          {/* Create Saved Reply */}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!srTitle.trim() || !srShortcut.trim() || !srBody.trim()) return;
              try {
                await createSavedReply.mutateAsync({
                  title: srTitle,
                  shortcut: srShortcut,
                  body: srBody,
                });
                toast.success("Saved reply added");
                setSrTitle("");
                setSrShortcut("");
                setSrBody("");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Failed to save reply template");
              }
            }}
            className="surface-card rounded-3xl p-5 border border-border/70 space-y-3"
          >
            <h3 className="font-display text-sm font-bold flex items-center gap-1.5">
              <Clock className="size-4 text-primary" /> Team Saved Replies
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                value={srShortcut}
                onChange={(e) => setSrShortcut(e.target.value)}
                placeholder="Shortcut (e.g. pricing)"
                className="rounded-xl text-xs"
              />
              <Input
                value={srTitle}
                onChange={(e) => setSrTitle(e.target.value)}
                placeholder="Title (e.g. Standard Quote)"
                className="rounded-xl text-xs"
              />
            </div>
            <Textarea
              rows={2}
              value={srBody}
              onChange={(e) => setSrBody(e.target.value)}
              placeholder="Thanks for reaching out! Here is our pricing & booking availability…"
              className="rounded-xl text-xs"
            />
            <Button type="submit" size="sm" variant="outline" className="rounded-full text-xs">
              Add Saved Reply
            </Button>
          </form>
        </section>
      )}

      {/* 2. STOREFRONT CATALOGUE MANAGER */}
      {section === "catalogue" && (
        <section className="grid gap-6 lg:grid-cols-[1fr_1.3fr] items-start">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (offTitle.trim().length < 2) return;
              try {
                await createOffering.mutateAsync({
                  kind: offKind,
                  title: offTitle,
                  description: offDesc,
                  priceDisplay: offPrice || "Contact for pricing",
                  currency: "USD",
                  bookingEnabled: offBookable,
                });
                toast.success("Catalogue item published");
                setOffTitle("");
                setOffPrice("");
                setOffDesc("");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Could not publish item");
              }
            }}
            className="surface-card rounded-3xl p-5 border border-border/70 space-y-3"
          >
            <h2 className="font-display text-base font-bold">Add Product or Service</h2>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={offKind}
                onChange={(e) => setOffKind(e.target.value as "product" | "service")}
                className="rounded-xl border border-input bg-background px-3 py-2 text-xs"
              >
                <option value="service">Service</option>
                <option value="product">Product</option>
              </select>
              <Input
                value={offPrice}
                onChange={(e) => setOffPrice(e.target.value)}
                placeholder="e.g. $120 / session"
                className="rounded-xl text-xs"
              />
            </div>
            <Input
              value={offTitle}
              onChange={(e) => setOffTitle(e.target.value)}
              placeholder="Offering title"
              required
              className="rounded-xl text-xs"
            />
            <Textarea
              rows={3}
              value={offDesc}
              onChange={(e) => setOffDesc(e.target.value)}
              placeholder="Describe deliverables, turnaround, or specifications…"
              className="rounded-xl text-xs"
            />
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={offBookable}
                onChange={(e) => setOffBookable(e.target.checked)}
                className="rounded border-border"
              />
              <span>Enable appointment / booking requests</span>
            </label>
            <Button
              type="submit"
              variant="hero"
              size="sm"
              disabled={createOffering.isPending}
              className="rounded-full text-xs"
            >
              Publish to Storefront
            </Button>
          </form>

          <div className="space-y-3">
            {offerings.length === 0 ? (
              <div className="surface-card rounded-3xl p-8 text-center text-xs text-muted-foreground">
                No catalogue items yet.
              </div>
            ) : (
              offerings.map((o) => (
                <article
                  key={o.id}
                  className="surface-card rounded-2xl p-4 border border-border/70 flex items-start justify-between gap-3"
                >
                  <div>
                    <span className="text-[10px] font-bold uppercase text-primary">{o.kind}</span>
                    <h3 className="font-display text-sm font-bold">{o.title}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{o.description}</p>
                  </div>
                  <span className="text-xs font-bold shrink-0">{o.price_display}</span>
                </article>
              ))
            )}
          </div>
        </section>
      )}

      {/* 3. TEAM & ROLES */}
      {section === "team" && (
        <section className="surface-card rounded-3xl p-6 border border-border/70 space-y-4">
          <div>
            <h2 className="font-display text-lg font-bold">Business Team &amp; Role Access</h2>
            <p className="text-xs text-muted-foreground">
              Add team agents, admins, or analysts using their personal Ping accounts — never share
              account passwords.
            </p>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!inviteUsername.trim()) return;
              try {
                await addTeamMember.mutateAsync({ username: inviteUsername, role: inviteRole });
                toast.success(`Added @${inviteUsername.replace(/^@/, "")} as ${inviteRole}`);
                setInviteUsername("");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Could not add team member");
              }
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <Input
              value={inviteUsername}
              onChange={(e) => setInviteUsername(e.target.value)}
              placeholder="@username"
              className="max-w-xs rounded-xl text-xs"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Exclude<BusinessRole, "owner">)}
              className="h-9 rounded-xl border border-input bg-background px-3 text-xs"
            >
              <option value="agent">Support / Sales Agent</option>
              <option value="admin">Business Admin</option>
              <option value="analyst">Analytics Viewer</option>
            </select>
            <Button
              type="submit"
              size="sm"
              variant="hero"
              disabled={addTeamMember.isPending}
              className="rounded-full text-xs"
            >
              Add Team Member
            </Button>
          </form>

          <div className="space-y-2 pt-2">
            {team.map((m) => (
              <div
                key={m.user_id}
                className="flex items-center justify-between rounded-2xl border border-border/60 bg-secondary/35 px-4 py-2.5 text-xs"
              >
                <span className="font-semibold">
                  {m.profile?.display_name || `@${m.profile?.username || m.user_id.slice(0, 8)}`}
                </span>
                <span className="rounded-full bg-primary/15 text-primary px-2.5 py-0.5 text-[10px] font-bold uppercase">
                  {m.role}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 4. CONTROLLED ADVERTISING FOUNDATION (4.8) */}
      {section === "ads" && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-4 text-xs flex items-start gap-2.5">
            <Info className="size-4 shrink-0 mt-0.5 text-amber-500" />
            <p className="text-muted-foreground">
              <strong className="text-foreground">Controlled Advertising Policy Gate:</strong> You
              can draft Sponsored Pings, Sponsored Signals, and Sponsored Hub placements here. Paid
              campaigns cannot go live until billing verification and advertising policy approval
              are activated.
            </p>
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (adTitle.trim().length < 4) return;
              try {
                await createAdDraft.mutateAsync({
                  placement: adPlacement,
                  title: adTitle,
                  targetRegions: adRegions
                    .split(",")
                    .map((r) => r.trim().toUpperCase())
                    .filter(Boolean),
                  targetInterests: [],
                  budgetCurrency: "USD",
                  budgetMinor: Math.max(100, Math.round(Number(adBudgetUsd || 50) * 100)),
                });
                toast.success("Campaign draft saved for policy review");
                setAdTitle("");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Could not save campaign draft");
              }
            }}
            className="surface-card rounded-3xl p-5 border border-border/70 space-y-3"
          >
            <h2 className="font-display text-base font-bold">Draft Sponsored Campaign</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label className="text-xs">Placement</Label>
                <select
                  value={adPlacement}
                  onChange={(e) => setAdPlacement(e.target.value as any)}
                  className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs"
                >
                  <option value="sponsored_ping">Sponsored Ping</option>
                  <option value="sponsored_signal">Sponsored Signal</option>
                  <option value="sponsored_hub">Sponsored Hub Placement</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Planned budget (USD)</Label>
                <Input
                  type="number"
                  min={1}
                  value={adBudgetUsd}
                  onChange={(e) => setAdBudgetUsd(e.target.value)}
                  className="mt-1 rounded-xl text-xs"
                />
              </div>
              <div>
                <Label className="text-xs">Target regions</Label>
                <Input
                  value={adRegions}
                  onChange={(e) => setAdRegions(e.target.value)}
                  placeholder="NG, GH, KE, GB"
                  className="mt-1 rounded-xl text-xs"
                />
              </div>
            </div>
            <Input
              value={adTitle}
              onChange={(e) => setAdTitle(e.target.value)}
              placeholder="Campaign headline (e.g. Q4 SME Clean Energy Audit)"
              required
              minLength={4}
              className="rounded-xl text-xs"
            />
            <Button type="submit" size="sm" variant="hero" className="rounded-full text-xs">
              Save Draft (Pending Policy Review)
            </Button>
          </form>

          {campaigns.length > 0 && (
            <div className="space-y-2">
              {campaigns.map((c) => (
                <div
                  key={c.id}
                  className="surface-card rounded-2xl p-4 border border-border/70 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <p className="font-bold">{c.title}</p>
                    <p className="text-muted-foreground">
                      {c.placement.replace("_", " ")} · ${(c.budget_minor / 100).toFixed(2)}{" "}
                      {c.budget_currency} · {c.target_regions.join(", ")}
                    </p>
                  </div>
                  <span className="rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-300 px-2.5 py-0.5 text-[10px] font-bold uppercase">
                    {c.status.replace(/_/g, " ")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 5. INTEGRATIONS, OPTIONAL WHATSAPP & REVENUE ARCHITECTURE (4.4 & 4.12) */}
      {section === "integrations" && (
        <section className="space-y-6">
          <div className="surface-card rounded-3xl p-6 border border-border/70 space-y-3">
            <h2 className="font-display text-lg font-bold flex items-center gap-2">
              <ShieldCheck className="size-5 text-primary" /> Business Messaging &amp; Optional
              WhatsApp Business Platform
            </h2>
            <p className="text-xs text-muted-foreground">
              {integrationReadiness.whatsappBusiness.policyNote}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-primary/30 bg-primary/8 p-4 text-xs">
                <p className="font-bold text-foreground">Native Ping Business Inbox</p>
                <p className="text-primary font-semibold mt-0.5">Active — No external dependency</p>
              </div>
              <div className="rounded-2xl border border-border bg-secondary/40 p-4 text-xs">
                <p className="font-bold text-foreground">Official WhatsApp Business Platform</p>
                <p className="text-muted-foreground mt-0.5">
                  {integrationReadiness.whatsappBusiness.status}
                </p>
              </div>
            </div>
            <div className="pt-2 flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm" className="rounded-full text-xs">
                <Link to="/developers">Open Business Messaging API &amp; Webhooks →</Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="rounded-full text-xs">
                <Link to="/griot">Opt-in GRIOT Reply Drafting →</Link>
              </Button>
            </div>
          </div>

          <div className="surface-card rounded-3xl p-6 border border-border/70 space-y-3">
            <h2 className="font-display text-lg font-bold">
              Ping Commercial &amp; Revenue Architecture (10 Engines)
            </h2>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {REVENUE_ARCHITECTURE_ENGINES.map((eng) => (
                <div
                  key={eng.id}
                  className="rounded-2xl border border-border/70 bg-secondary/30 p-3.5 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-foreground">{eng.name}</span>
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold">
                      {eng.billingStatus.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="text-muted-foreground">{eng.pricingModel}</p>
                  <p className="text-[11px] text-primary">Gate: {eng.complianceGate}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
