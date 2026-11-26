import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Coins,
  Crown,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  Lock,
  MessageSquareLock,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  appointAdminRole,
  checkAdminAccess,
  getAdminControlCentreMetrics,
  getAdminList,
  getGrowthAttributionBreakdown,
  moderateBoostCampaign,
  moderatePing,
  reviewVerification,
  revokeAdminRole,
  setAdminUserPermission,
  updateCourseReleaseSchedule,
  upsertMembershipPlan,
  verifySignal,
} from "@/lib/admin.functions";
import { ADMIN_PAGE_SIZE, APPOINTABLE_ADMIN_ROLES, moderationSchema } from "@/lib/admin-policy";
import {
  ADMIN_PERMISSIONS,
  ADMIN_PERMISSION_LABELS,
  ADMIN_ROLE_DEFINITIONS,
  formatAdminRoleLabel,
  getAccessibleAdminModules,
  hasAdminPermission,
  type AdminModuleId,
  type AdminPermission,
  type EffectiveAdminAccess,
} from "@/lib/admin-rbac";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/admin")({
  staticData: { sitemap: "exclude-subtree" },
  ssr: false,
  head: () => ({
    meta: [
      { title: "Admin Control Centre — Ping by DOT" },
      { name: "description", content: "Secure Ping by DOT administration and governance." },
      { property: "og:title", content: "Admin Control Centre — Ping by DOT" },
      { property: "og:description", content: "Secure Ping by DOT administration." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPage,
});

type ListView =
  | "pings"
  | "users"
  | "reports"
  | "signals"
  | "hubs"
  | "verifications"
  | "plans"
  | "boosts"
  | "businesses"
  | "learn"
  | "early_access"
  | "system_errors"
  | "staff"
  | "audit";

const MODULE_DEFAULT_VIEW: Partial<Record<AdminModuleId, ListView>> = {
  people: "users",
  content: "pings",
  communities: "hubs",
  economy: "plans",
  business: "businesses",
  growth: "early_access",
  system_health: "system_errors",
  administration: "staff",
};

function AdminPage() {
  const { ready, user } = useAuth();
  const verify = useServerFn(checkAdminAccess);
  const access = useQuery({
    queryKey: ["admin-access", user?.id],
    queryFn: () => verify(),
    enabled: ready && !!user,
    retry: false,
    staleTime: 0,
  });

  if (!ready || (user && access.isPending)) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-16" role="status">
        Verifying administrator credentials…
      </div>
    );
  }

  if (!user || !access.data?.isAdmin) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <ShieldCheck className="mx-auto size-10 text-muted-foreground" />
        <h1 className="mt-4 font-display text-3xl font-bold">Access denied</h1>
        <p className="mt-3 text-muted-foreground">
          {access.isError
            ? "Administrator access couldn't be verified. Retry before continuing."
            : "This page is reserved for appointed Ping administrators."}
        </p>
        {access.isError && (
          <Button className="mt-6" onClick={() => access.refetch()}>
            <RefreshCw className="size-4 mr-1.5" /> Retry
          </Button>
        )}
        <Button asChild variant="outline" className="mt-6">
          <Link to={user ? "/explore" : "/login"}>{user ? "Back to Explore" : "Log in"}</Link>
        </Button>
      </div>
    );
  }

  return <AdminControlCentre access={access.data} currentUserId={user.id} />;
}

function MetricTile({
  label,
  value,
  hint,
  unavailableLabel = "Unavailable",
}: {
  label: string;
  value: number | null | undefined;
  hint?: string | undefined;
  unavailableLabel?: string | undefined;
}) {
  const display = typeof value === "number" ? value.toLocaleString() : unavailableLabel;
  return (
    <div className="rounded-xl border border-border/80 bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={`mt-1.5 font-display text-2xl font-bold tabular-nums ${
          typeof value === "number" ? "text-foreground" : "text-muted-foreground/70 text-base"
        }`}
      >
        {display}
      </p>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground leading-snug">{hint}</p>}
    </div>
  );
}

function AdminControlCentre({
  access,
  currentUserId,
}: {
  access: EffectiveAdminAccess;
  currentUserId: string;
}) {
  const qc = useQueryClient();
  const metricsFn = useServerFn(getAdminControlCentreMetrics);
  const listFn = useServerFn(getAdminList);
  const growthFn = useServerFn(getGrowthAttributionBreakdown);
  const moderateFn = useServerFn(moderatePing);
  const verifySignalFn = useServerFn(verifySignal);
  const reviewVerificationFn = useServerFn(reviewVerification);
  const upsertPlanFn = useServerFn(upsertMembershipPlan);
  const moderateBoostFn = useServerFn(moderateBoostCampaign);
  const updateLearnScheduleFn = useServerFn(updateCourseReleaseSchedule);
  const appointAdminFn = useServerFn(appointAdminRole);
  const revokeAdminFn = useServerFn(revokeAdminRole);
  const setUserPermFn = useServerFn(setAdminUserPermission);

  const modules = useMemo(() => getAccessibleAdminModules(access), [access]);
  const [activeModule, setActiveModule] = useState<AdminModuleId>(
    () => modules[0]?.id ?? "overview",
  );
  const [subView, setSubView] = useState<ListView>("users");
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [draftSearch, setDraftSearch] = useState("");

  // Moderation & governance dialog states
  const [pending, setPending] = useState<{
    id: string;
    action: "hide" | "restore" | "resolve_report";
  } | null>(null);
  const [reason, setReason] = useState("");
  const [planDrafts, setPlanDrafts] = useState<
    Record<string, { dotPrice: number; durationDays: number; isActive: boolean }>
  >({});
  const [boostMod, setBoostMod] = useState<{
    campaignId: string;
    decision: "paused" | "rejected" | "refunded";
    maxRefund: number;
  } | null>(null);
  const [boostReason, setBoostReason] = useState("");
  const [boostRefundAmt, setBoostRefundAmt] = useState(0);
  const [learnDraft, setLearnDraft] = useState<{
    requireLeapfrogCompletion: boolean;
    releaseIntervalDays: number;
    coursesPerCycle: number;
    minAssessmentScore: number;
    releaseOrder: string[];
  } | null>(null);

  // Platform Owner appointment & permission override dialogs
  const [appointTargetId, setAppointTargetId] = useState("");
  const [appointRole, setAppointRole] =
    useState<(typeof APPOINTABLE_ADMIN_ROLES)[number]>("moderator");
  const [appointReason, setAppointReason] = useState("");
  const [revokeDialog, setRevokeDialog] = useState<{
    userId: string;
    username: string;
    role: (typeof APPOINTABLE_ADMIN_ROLES)[number] | null;
  } | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [permDialog, setPermDialog] = useState<{
    userId: string;
    username: string;
    permission: AdminPermission;
    effect: "grant" | "revoke" | "clear";
  } | null>(null);
  const [permReason, setPermReason] = useState("");

  const canModerateContent = hasAdminPermission(access, "content.moderate");
  const canVerifyPeople = hasAdminPermission(access, "people.verify");
  const canManageCommunities = hasAdminPermission(access, "communities.manage");
  const canManagePlans = hasAdminPermission(access, "economy.manage_plans");
  const canModerateBoosts = hasAdminPermission(access, "economy.moderate_boosts");
  const canManageLearn = hasAdminPermission(access, "learn.manage_schedule");
  const canAppointAdmins =
    access.isPlatformOwner || hasAdminPermission(access, "admin.appoint_admins");
  const canViewStaff = access.isPlatformOwner || hasAdminPermission(access, "admin.view_staff");

  const activeListView: ListView | null = useMemo(() => {
    if (activeModule === "overview" || activeModule === "communications") return null;
    if (activeModule === "people") {
      return subView === "verifications" ? "verifications" : "users";
    }
    if (activeModule === "content") {
      return subView === "reports" ? "reports" : "pings";
    }
    if (activeModule === "communities") {
      return subView === "signals" ? "signals" : "hubs";
    }
    if (activeModule === "economy") {
      return subView === "boosts" ? "boosts" : "plans";
    }
    if (activeModule === "business") return "businesses";
    if (activeModule === "growth") {
      return subView === "learn" ? "learn" : "early_access";
    }
    if (activeModule === "system_health") return "system_errors";
    if (activeModule === "administration") {
      return subView === "audit" || !canViewStaff ? "audit" : "staff";
    }
    return null;
  }, [activeModule, subView, canViewStaff]);

  const metrics = useQuery({
    queryKey: ["admin-control-centre-metrics"],
    queryFn: () => metricsFn(),
    retry: false,
  });

  const growthAttribution = useQuery({
    queryKey: ["admin-growth-attribution"],
    queryFn: () => growthFn(),
    enabled: activeModule === "growth" && hasAdminPermission(access, "growth.view"),
    retry: false,
  });

  const list = useQuery({
    queryKey: ["admin-list", activeListView, page, search],
    queryFn: () => listFn({ data: { view: activeListView!, page, search } }),
    enabled: activeListView !== null,
    retry: false,
  });

  const switchModule = (mod: AdminModuleId) => {
    setActiveModule(mod);
    const defaultSub = MODULE_DEFAULT_VIEW[mod];
    if (defaultSub) setSubView(defaultSub);
    setPage(0);
    setSearch("");
    setDraftSearch("");
  };

  const switchSubView = (next: ListView) => {
    setSubView(next);
    setPage(0);
    setSearch("");
    setDraftSearch("");
  };

  // Mutations
  const moderateMutation = useMutation({
    mutationFn: (data: {
      id: string;
      action: "hide" | "restore" | "resolve_report";
      reason: string;
    }) => moderateFn({ data }),
    onSuccess: async () => {
      setPending(null);
      setReason("");
      await qc.invalidateQueries({ queryKey: ["admin-list"] });
      await qc.invalidateQueries({ queryKey: ["admin-control-centre-metrics"] });
      toast.success("Moderation action recorded with audit trail.");
    },
    onError: (e: any) => toast.error(e?.message || "Couldn't complete moderation."),
  });

  const verifySignalMutation = useMutation({
    mutationFn: (data: {
      id: string;
      status: "verified" | "rejected" | "pending" | "unverified";
    }) => verifySignalFn({ data }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin-list"] });
      toast.success("Signal verification updated.");
    },
    onError: (e: any) => toast.error(e?.message || "Couldn't update Signal verification."),
  });

  const reviewVerificationMutation = useMutation({
    mutationFn: (data: {
      id: string;
      status: "verified" | "rejected" | "revoked" | "pending";
      reviewerNote?: string;
      expiresAt?: string | null;
    }) => reviewVerificationFn({ data: { reviewerNote: "", ...data } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin-list"] });
      await qc.invalidateQueries({ queryKey: ["public-verification"] });
      toast.success("Account verification updated.");
    },
    onError: (e: any) => toast.error(e?.message || "Couldn't update verification status."),
  });

  const upsertPlanMutation = useMutation({
    mutationFn: (data: {
      slug: "free" | "plus" | "pro" | "business";
      name: string;
      badge: string;
      tagline: string;
      dotPrice: number;
      durationDays: number;
      benefits: Record<string, string | number | boolean | null>;
      perks: string[];
      isActive: boolean;
    }) => upsertPlanFn({ data }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin-list"] });
      await qc.invalidateQueries({ queryKey: ["membership-plans"] });
      toast.success("Membership plan updated.");
    },
    onError: (e: any) => toast.error(e?.message || "Couldn't update membership plan."),
  });

  const moderateBoostMutation = useMutation({
    mutationFn: (data: {
      campaignId: string;
      decision: "paused" | "rejected" | "refunded";
      reason: string;
      refundAmount: number;
    }) => moderateBoostFn({ data }),
    onSuccess: async () => {
      setBoostMod(null);
      setBoostReason("");
      setBoostRefundAmt(0);
      await qc.invalidateQueries({ queryKey: ["admin-list"] });
      await qc.invalidateQueries({ queryKey: ["active-boosts-map"] });
      toast.success("Boost campaign decision recorded.");
    },
    onError: (e: any) => toast.error(e?.message || "Couldn't moderate boost campaign."),
  });

  const updateLearnScheduleMutation = useMutation({
    mutationFn: (data: {
      requireLeapfrogCompletion: boolean;
      releaseIntervalDays: number;
      coursesPerCycle: number;
      minAssessmentScore: number;
      releaseOrder: string[];
    }) => updateLearnScheduleFn({ data }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["admin-list"] });
      await qc.invalidateQueries({ queryKey: ["learn-release-schedule"] });
      toast.success("Ping Learn release schedule updated.");
    },
    onError: (e: any) => toast.error(e?.message || "Couldn't update Ping Learn schedule."),
  });

  const appointMutation = useMutation({
    mutationFn: () =>
      appointAdminFn({
        data: {
          targetUserId: appointTargetId.trim(),
          role: appointRole,
          reason: appointReason.trim(),
        },
      }),
    onSuccess: async () => {
      setAppointTargetId("");
      setAppointReason("");
      await qc.invalidateQueries({ queryKey: ["admin-list"] });
      await qc.invalidateQueries({ queryKey: ["admin-control-centre-metrics"] });
      toast.success("Administrator appointed and logged in audit trail.");
    },
    onError: (e: any) => toast.error(e?.message || "Couldn't appoint administrator."),
  });

  const revokeMutation = useMutation({
    mutationFn: () => {
      if (!revokeDialog) throw new Error("No target selected");
      return revokeAdminFn({
        data: {
          targetUserId: revokeDialog.userId,
          role: revokeDialog.role,
          reason: revokeReason.trim(),
        },
      });
    },
    onSuccess: async () => {
      setRevokeDialog(null);
      setRevokeReason("");
      await qc.invalidateQueries({ queryKey: ["admin-list"] });
      await qc.invalidateQueries({ queryKey: ["admin-control-centre-metrics"] });
      toast.success("Administrator access revoked and logged.");
    },
    onError: (e: any) => toast.error(e?.message || "Couldn't revoke administrator access."),
  });

  const setPermMutation = useMutation({
    mutationFn: () => {
      if (!permDialog) throw new Error("No target selected");
      return setUserPermFn({
        data: {
          targetUserId: permDialog.userId,
          permission: permDialog.permission,
          effect: permDialog.effect,
          reason: permReason.trim(),
        },
      });
    },
    onSuccess: async () => {
      setPermDialog(null);
      setPermReason("");
      await qc.invalidateQueries({ queryKey: ["admin-list"] });
      toast.success("Individual permission override saved.");
    },
    onError: (e: any) => toast.error(e?.message || "Couldn't update individual permission."),
  });

  const m = metrics.data;
  const legacyNotice =
    m?.source === "legacy_admin_metrics"
      ? "Connected database is running pre-0035 metrics RPC; unavailable counters are shown honestly rather than fabricated."
      : null;

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 space-y-6">
      {/* Header & Role Badge */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
        <div className="space-y-2">
          <span className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <img
              src="/brand/ping-mark-silver.png"
              alt="PING Official Silver Mark"
              width={20}
              height={20}
              className="size-5 rounded-md object-contain"
            />
            <ShieldCheck className="size-4 text-primary" />
            Ping by DOT · Admin Control Centre
          </span>
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight">
            Administration
          </h1>
          <div className="flex flex-wrap items-center gap-1.5">
            {access.isPlatformOwner && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 px-2.5 py-0.5 text-xs font-semibold">
                <Crown className="size-3.5" /> Platform Owner
              </span>
            )}
            {access.roles
              .filter((r) => r !== "platform_owner")
              .map((r) => (
                <span
                  key={r}
                  className="rounded-full border border-border bg-secondary/70 px-2.5 py-0.5 text-xs font-medium"
                >
                  {formatAdminRoleLabel(r)}
                </span>
              ))}
            <span className="text-xs text-muted-foreground ml-1">
              {access.permissions.length} server-verified permissions
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/spotlight/editorial">Spotlight Editorial Desk</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/download">Download Centre</Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void qc.invalidateQueries({ queryKey: ["admin-control-centre-metrics"] });
              void qc.invalidateQueries({ queryKey: ["admin-list"] });
            }}
          >
            <RefreshCw className="size-3.5 mr-1.5" /> Refresh metrics
          </Button>
        </div>
      </header>

      {/* 10-Module Navigation */}
      <nav
        aria-label="Admin Control Centre modules"
        role="tablist"
        className="flex flex-wrap gap-1.5"
      >
        {modules.map((mod) => {
          const active = activeModule === mod.id;
          return (
            <Button
              key={mod.id}
              type="button"
              role="tab"
              size="sm"
              aria-selected={active}
              variant={active ? "default" : "outline"}
              onClick={() => switchModule(mod.id)}
              className="rounded-full text-xs"
            >
              {mod.label}
            </Button>
          );
        })}
      </nav>

      {legacyNotice && (
        <div
          role="note"
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5"
        >
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>{legacyNotice}</span>
        </div>
      )}

      {/* MODULE 1: OVERVIEW */}
      {activeModule === "overview" && (
        <section aria-label="Platform Overview" className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <MetricTile label="Total Accounts" value={m?.accounts} />
            <MetricTile
              label="Online Now (5m)"
              value={m?.onlineNow}
              hint="Reliable presence heartbeats"
              unavailableLabel="Pending 0035"
            />
            <MetricTile label="Daily Active (DAU)" value={m?.dau} unavailableLabel="Pending 0035" />
            <MetricTile
              label="Weekly Active (WAU)"
              value={m?.wau}
              unavailableLabel="Pending 0035"
            />
            <MetricTile
              label="Monthly Active (MAU)"
              value={m?.mau}
              unavailableLabel="Pending 0035"
            />
            <MetricTile
              label="New Accounts (24h)"
              value={m?.newRegistrations24h}
              unavailableLabel="Pending 0035"
            />
            <MetricTile
              label="New Accounts (7d)"
              value={m?.newRegistrations7d}
              unavailableLabel="Pending 0035"
            />
            <MetricTile label="Published Pings" value={m?.pings} />
            <MetricTile label="Moments" value={m?.moments} unavailableLabel="Pending 0035" />
            <MetricTile label="Ping Clips" value={m?.clips} unavailableLabel="Pending 0035" />
            <MetricTile
              label="Repings"
              value={m?.repings}
              hint="Quote Pings + Moment repings"
              unavailableLabel="Pending 0035"
            />
            <MetricTile
              label="Shares & Referrals"
              value={m?.shares}
              hint={
                typeof m?.referralClicks === "number"
                  ? `${m.referralClicks} attributed link clicks`
                  : undefined
              }
              unavailableLabel="Pending 0035"
            />
            <MetricTile
              label="Hubs / Memberships"
              value={m?.hubs}
              hint={
                typeof m?.hubMemberships === "number"
                  ? `${m.hubMemberships} total memberships`
                  : undefined
              }
              unavailableLabel="Pending 0035"
            />
            <MetricTile
              label="Signals / Followers"
              value={m?.signals}
              hint={
                typeof m?.signalFollowers === "number"
                  ? `${m.signalFollowers} total followers`
                  : undefined
              }
              unavailableLabel="Pending 0035"
            />
            <MetricTile
              label="Open Reports"
              value={m?.openReports}
              hint={
                typeof m?.resolvedReports === "number" ? `${m.resolvedReports} resolved` : undefined
              }
            />
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricTile
              label="Messages Sent (Total)"
              value={m?.messagesSentTotal}
              hint="Aggregate count only — zero message text exposed"
              unavailableLabel="Pending 0035"
            />
            <MetricTile
              label="DOT Ledger Events"
              value={m?.dotTransactions}
              hint={
                typeof m?.activeSubscriptions === "number"
                  ? `${m.activeSubscriptions} active subscriptions`
                  : undefined
              }
              unavailableLabel="Pending 0035"
            />
            <MetricTile
              label="Boost Campaigns"
              value={m?.boostCampaignsTotal}
              hint={
                typeof m?.boostDotVolume === "number"
                  ? `${m.boostDotVolume} DOT total boost volume`
                  : undefined
              }
              unavailableLabel="Pending 0035"
            />
            <MetricTile
              label="Open Errors / Failed Jobs"
              value={m?.openErrors}
              hint={
                typeof m?.failedBackgroundJobs === "number"
                  ? `${m.failedBackgroundJobs} failed background jobs`
                  : undefined
              }
              unavailableLabel="Pending 0035"
            />
          </div>

          <div className="rounded-2xl border border-border bg-card/60 p-5 text-xs text-muted-foreground space-y-1.5">
            <p className="font-semibold text-foreground">
              Metric Transparency &amp; Privacy Guarantee
            </p>
            <p>
              All counters above query live PostgreSQL tables directly through server-verified
              permissions. Unavailable metrics are displayed honestly rather than estimated or
              invented. Private message content, user passwords, and payment secrets are never
              readable in the Admin Control Centre.
            </p>
            <p>
              Last database check:{" "}
              <span className="font-mono">{m?.checkedAt ?? "Pending initial check"}</span>
            </p>
          </div>
        </section>
      )}

      {/* MODULE 5: COMMUNICATIONS (PRIVACY-PRESERVING AGGREGATE TELEMETRY ONLY) */}
      {activeModule === "communications" && (
        <section aria-label="Communications Telemetry" className="space-y-5">
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 flex items-start gap-3">
            <MessageSquareLock className="size-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-1 text-sm">
              <h2 className="font-semibold text-foreground">
                Strict Private Messaging Confidentiality Enforced
              </h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                By architecture and PostgreSQL RLS policy, administrators and the Platform Owner
                cannot read private Direct Message bodies, voice notes, or attachments from this
                dashboard. Only aggregate throughput and delivery-failure counts are surfaced for
                service reliability.
              </p>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <MetricTile
              label="Total Messages Sent"
              value={m?.messagesSentTotal}
              hint="Count across private conversations (body text excluded)"
              unavailableLabel="Pending 0035"
            />
            <MetricTile
              label="Messages Sent (Last 24h)"
              value={m?.messagesSent24h}
              hint="Rolling 24-hour delivery volume"
              unavailableLabel="Pending 0035"
            />
            <MetricTile
              label="Open Delivery Failures"
              value={m?.messageDeliveryFailures}
              hint="Logged in system_error_logs (category = delivery_failure)"
              unavailableLabel="Pending 0035"
            />
          </div>
        </section>
      )}

      {/* MODULE-SPECIFIC SUMMARY & SUB-TABS FOR LIST MODULES */}
      {activeModule === "people" && (
        <section className="space-y-4" aria-label="People Module">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricTile label="Total Accounts" value={m?.accounts} />
            <MetricTile
              label="New (24h)"
              value={m?.newRegistrations24h}
              unavailableLabel="Pending 0035"
            />
            <MetricTile
              label="New (7d)"
              value={m?.newRegistrations7d}
              unavailableLabel="Pending 0035"
            />
            <MetricTile
              label="New (30d)"
              value={m?.newRegistrations30d}
              unavailableLabel="Pending 0035"
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={activeListView === "users" ? "default" : "outline"}
              onClick={() => switchSubView("users")}
            >
              <Users className="size-3.5 mr-1.5" /> Accounts Directory
            </Button>
            <Button
              size="sm"
              variant={activeListView === "verifications" ? "default" : "outline"}
              onClick={() => switchSubView("verifications")}
            >
              <ShieldCheck className="size-3.5 mr-1.5" /> Account Verifications
            </Button>
          </div>
        </section>
      )}

      {activeModule === "content" && (
        <section className="space-y-4" aria-label="Content Module">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <MetricTile label="Published Pings" value={m?.pings} />
            <MetricTile label="Hidden Pings" value={m?.hiddenPings} />
            <MetricTile label="Moments" value={m?.moments} unavailableLabel="Pending 0035" />
            <MetricTile label="Ping Clips" value={m?.clips} unavailableLabel="Pending 0035" />
            <MetricTile label="Open Reports" value={m?.openReports} />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={activeListView === "pings" ? "default" : "outline"}
              onClick={() => switchSubView("pings")}
            >
              <FileText className="size-3.5 mr-1.5" /> Published &amp; Hidden Pings
            </Button>
            <Button
              size="sm"
              variant={activeListView === "reports" ? "default" : "outline"}
              onClick={() => switchSubView("reports")}
            >
              <AlertTriangle className="size-3.5 mr-1.5" /> Open Reports Queue
            </Button>
          </div>
        </section>
      )}

      {activeModule === "communities" && (
        <section className="space-y-4" aria-label="Communities Module">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricTile label="Hubs" value={m?.hubs} unavailableLabel="Pending 0035" />
            <MetricTile
              label="Hub Memberships"
              value={m?.hubMemberships}
              unavailableLabel="Pending 0035"
            />
            <MetricTile label="Signals" value={m?.signals} unavailableLabel="Pending 0035" />
            <MetricTile
              label="Signal Followers"
              value={m?.signalFollowers}
              unavailableLabel="Pending 0035"
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={activeListView === "hubs" ? "default" : "outline"}
              onClick={() => switchSubView("hubs")}
            >
              Hubs Directory
            </Button>
            <Button
              size="sm"
              variant={activeListView === "signals" ? "default" : "outline"}
              onClick={() => switchSubView("signals")}
            >
              Signals &amp; Verification
            </Button>
          </div>
        </section>
      )}

      {activeModule === "economy" && (
        <section className="space-y-4" aria-label="Economy Module">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricTile
              label="DOT Transactions"
              value={m?.dotTransactions}
              unavailableLabel="Pending 0035"
            />
            <MetricTile
              label="Active Subscriptions"
              value={m?.activeSubscriptions}
              unavailableLabel="Pending 0035"
            />
            <MetricTile
              label="Active Boosts"
              value={m?.boostCampaignsActive}
              unavailableLabel="Pending 0035"
            />
            <MetricTile
              label="Total Boost DOT Volume"
              value={m?.boostDotVolume}
              unavailableLabel="Pending 0035"
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={activeListView === "plans" ? "default" : "outline"}
              onClick={() => switchSubView("plans")}
            >
              <Coins className="size-3.5 mr-1.5" /> Membership Plans
            </Button>
            <Button
              size="sm"
              variant={activeListView === "boosts" ? "default" : "outline"}
              onClick={() => switchSubView("boosts")}
            >
              Boost Campaigns
            </Button>
          </div>
        </section>
      )}

      {activeModule === "business" && (
        <section className="space-y-4" aria-label="Business Module">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <MetricTile
              label="Business Profiles"
              value={m?.businessesTotal}
              unavailableLabel="Pending 0035"
            />
            <MetricTile
              label="Customer Enquiries"
              value={m?.businessEnquiriesTotal}
              unavailableLabel="Pending 0035"
            />
            <div className="rounded-xl border border-border/80 bg-card p-4 text-xs text-muted-foreground flex items-center gap-2">
              <Building2 className="size-4 text-primary shrink-0" />
              <span>Commercial verification remains separated from paid DOT plans.</span>
            </div>
          </div>
        </section>
      )}

      {activeModule === "growth" && (
        <section className="space-y-4" aria-label="Growth & Distribution Module">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricTile label="Share Events" value={m?.shares} unavailableLabel="Pending 0035" />
            <MetricTile
              label="Referral Link Clicks"
              value={m?.referralClicks}
              unavailableLabel="Pending 0035"
            />
            <MetricTile
              label="Early-Access Signups"
              value={m?.earlyAccessRegistrations}
              unavailableLabel="Pending 0035"
            />
            <MetricTile
              label="Download Page Events"
              value={m?.downloadAttributionEvents}
              unavailableLabel="Pending 0035"
            />
          </div>

          {/* Multi-site referral attribution table */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold flex items-center gap-1.5">
                <TrendingUp className="size-4 text-primary" /> External Website Download Attribution
              </h2>
              <span className="text-xs text-muted-foreground">
                Real events recorded via <code>/download?ref=…</code>
              </span>
            </div>
            {growthAttribution.data?.unmigrated ? (
              <p className="text-xs text-muted-foreground">
                download_attribution_events table awaits migration 0035 on the remote database.
              </p>
            ) : !growthAttribution.data?.bySource.length ? (
              <p className="text-xs text-muted-foreground">
                No external download attribution events recorded yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="py-2 pr-4">Source / Website</th>
                      <th className="py-2 pr-4">Page Views</th>
                      <th className="py-2 pr-4">Install / Download Clicks</th>
                      <th className="py-2">Early-Access Signups</th>
                    </tr>
                  </thead>
                  <tbody>
                    {growthAttribution.data.bySource.map((row) => (
                      <tr key={row.source} className="border-b border-border/50">
                        <td className="py-2 pr-4 font-medium">{row.source}</td>
                        <td className="py-2 pr-4 tabular-nums">{row.pageViews}</td>
                        <td className="py-2 pr-4 tabular-nums">{row.installs}</td>
                        <td className="py-2 tabular-nums">{row.signups}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant={activeListView === "early_access" ? "default" : "outline"}
              onClick={() => switchSubView("early_access")}
            >
              Early-Access Registrations
            </Button>
            <Button
              size="sm"
              variant={activeListView === "learn" ? "default" : "outline"}
              onClick={() => switchSubView("learn")}
            >
              Ping Learn Release Schedule
            </Button>
          </div>
        </section>
      )}

      {activeModule === "system_health" && (
        <section className="space-y-4" aria-label="System Health Module">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricTile
              label="Open System Errors"
              value={m?.openErrors}
              unavailableLabel="Pending 0035"
            />
            <MetricTile
              label="Failed Background Jobs"
              value={m?.failedBackgroundJobs}
              unavailableLabel="Pending 0035"
            />
            <MetricTile
              label="Message Delivery Failures"
              value={m?.messageDeliveryFailures}
              unavailableLabel="Pending 0035"
            />
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground">Database Health</p>
              <p className="mt-1.5 font-display text-lg font-bold flex items-center gap-1.5">
                <Activity className="size-4 text-emerald-500" />
                {metrics.isError ? "Unreachable" : metrics.isSuccess ? "Reachable" : "Checking…"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Pending remote DDL: 0022–0035 require owner approval.
              </p>
            </div>
          </div>
        </section>
      )}

      {activeModule === "administration" && (
        <section className="space-y-5" aria-label="Administration & Platform Owner Governance">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <MetricTile
              label="Appointed Staff Accounts"
              value={m?.appointedStaffCount}
              unavailableLabel="Pending 0035"
            />
            <MetricTile
              label="Audit Events (30d)"
              value={m?.auditEvents30d}
              unavailableLabel="Pending 0035"
            />
            <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground flex items-start gap-2">
              <Lock className="size-4 text-primary shrink-0 mt-0.5" />
              <span>
                Only the Platform Owner can appoint/revoke roles, toggle individual permissions, and
                review all governance actions. Self-escalation is blocked in PostgreSQL.
              </span>
            </div>
          </div>

          {/* Appoint Administrator Card (Platform Owner or explicitly delegated admin.appoint_admins) */}
          {canAppointAdmins && (
            <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
              <div>
                <h2 className="font-semibold flex items-center gap-2">
                  <UserPlus className="size-4 text-primary" /> Appoint Administrator
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Assign a least-privilege role to an existing Ping user UUID. Platform Owner cannot
                  be created via UI and self-escalation is permanently rejected.
                </p>
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="appoint-user-id" className="text-xs">
                    Target User UUID
                  </Label>
                  <Input
                    id="appoint-user-id"
                    placeholder="00000000-0000-4000-8000-000000000000"
                    value={appointTargetId}
                    onChange={(e) => setAppointTargetId(e.target.value)}
                    className="mt-1 font-mono text-xs"
                  />
                </div>
                <div>
                  <Label htmlFor="appoint-role" className="text-xs">
                    Administrative Role
                  </Label>
                  <select
                    id="appoint-role"
                    value={appointRole}
                    onChange={(e) =>
                      setAppointRole(e.target.value as (typeof APPOINTABLE_ADMIN_ROLES)[number])
                    }
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-xs"
                  >
                    {APPOINTABLE_ADMIN_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {formatAdminRoleLabel(r)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="appoint-reason" className="text-xs">
                    Mandatory Appointment Reason
                  </Label>
                  <Input
                    id="appoint-reason"
                    placeholder="e.g., Appointed lead moderator for West Africa community"
                    value={appointReason}
                    onChange={(e) => setAppointReason(e.target.value)}
                    className="mt-1 text-xs"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  {appointRole !== "spotlight_editor"
                    ? ADMIN_ROLE_DEFINITIONS[appointRole]?.description
                    : "Editorial role for Ping Spotlight review & publication without financial permissions."}
                </p>
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    appointMutation.isPending ||
                    appointTargetId.trim().length < 30 ||
                    appointReason.trim().length < 5
                  }
                  onClick={() => appointMutation.mutate()}
                >
                  {appointMutation.isPending ? "Appointing…" : "Confirm Appointment"}
                </Button>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            {canViewStaff && (
              <Button
                size="sm"
                variant={activeListView === "staff" ? "default" : "outline"}
                onClick={() => switchSubView("staff")}
              >
                <KeyRound className="size-3.5 mr-1.5" /> Appointed Staff &amp; Permissions
              </Button>
            )}
            <Button
              size="sm"
              variant={activeListView === "audit" ? "default" : "outline"}
              onClick={() => switchSubView("audit")}
            >
              Audit Trail
            </Button>
          </div>
        </section>
      )}

      {/* DATA TABLE / QUEUE AREA FOR ACTIVE LIST VIEW */}
      {activeListView !== null && (
        <section className="space-y-4" aria-label={`Data view: ${activeListView}`}>
          {activeListView !== "plans" && activeListView !== "learn" && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(draftSearch);
                setPage(0);
              }}
            >
              <Input
                aria-label={`Search ${activeListView}`}
                placeholder={`Filter ${activeListView.replace("_", " ")}…`}
                value={draftSearch}
                maxLength={100}
                onChange={(e) => setDraftSearch(e.target.value)}
              />
              <Button type="submit" size="sm">
                Search
              </Button>
            </form>
          )}

          {list.isPending && (
            <p className="py-8 text-sm text-muted-foreground" role="status">
              Loading records…
            </p>
          )}
          {list.isError && (
            <div className="py-6 text-sm text-destructive flex items-center gap-3" role="alert">
              <span>{(list.error as Error)?.message || "Couldn't load this view."}</span>
              <Button variant="outline" size="sm" onClick={() => list.refetch()}>
                Retry
              </Button>
            </div>
          )}

          <div className="divide-y divide-border rounded-xl border border-border bg-card px-4">
            {/* USERS */}
            {list.data?.view === "users" &&
              list.data.rows.map((u) => (
                <article
                  key={u.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3.5"
                >
                  <div>
                    <p className="font-semibold text-sm">
                      {u.display_name}{" "}
                      <span className="text-muted-foreground font-normal">@{u.username}</span>
                    </p>
                    <p className="text-xs text-muted-foreground font-mono">{u.id}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Joined {new Date(u.created_at).toLocaleDateString()}
                    </span>
                    {canAppointAdmins && u.id !== currentUserId && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setAppointTargetId(u.id);
                          switchModule("administration");
                          toast.info(`Loaded @${u.username} into Appoint Administrator form.`);
                        }}
                      >
                        Appoint Role
                      </Button>
                    )}
                  </div>
                </article>
              ))}

            {/* PINGS */}
            {list.data?.view === "pings" &&
              list.data.rows.map((p: any) => (
                <article
                  key={p.id}
                  className="flex flex-wrap items-start justify-between gap-3 py-3.5"
                >
                  <div className="space-y-1 max-w-2xl">
                    <p className="text-xs text-muted-foreground">
                      @{p.author?.username ?? "unknown"} · {p.category ?? "general"} ·{" "}
                      {new Date(p.created_at).toLocaleString()}
                      {p.hidden_at && (
                        <span className="ml-2 rounded bg-destructive/15 px-1.5 py-0.5 text-destructive font-semibold">
                          Hidden
                        </span>
                      )}
                    </p>
                    <p className="text-sm">{p.content}</p>
                  </div>
                  {canModerateContent && (
                    <Button
                      size="sm"
                      variant={p.hidden_at ? "outline" : "destructive"}
                      onClick={() => {
                        setReason("");
                        setPending({ id: p.id, action: p.hidden_at ? "restore" : "hide" });
                      }}
                    >
                      {p.hidden_at ? (
                        <>
                          <Eye className="size-3.5 mr-1" /> Restore
                        </>
                      ) : (
                        <>
                          <EyeOff className="size-3.5 mr-1" /> Hide
                        </>
                      )}
                    </Button>
                  )}
                </article>
              ))}

            {/* REPORTS */}
            {list.data?.view === "reports" &&
              list.data.rows.map((r: any) => (
                <article
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3.5"
                >
                  <div className="space-y-0.5">
                    <p className="font-semibold text-sm">{r.reason}</p>
                    <p className="text-xs text-muted-foreground">
                      Ping {r.ping_id} · {r.details || "No additional details"}
                    </p>
                  </div>
                  {canModerateContent && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setReason("");
                        setPending({ id: r.id, action: "resolve_report" });
                      }}
                    >
                      <Check className="size-3.5 mr-1" /> Resolve
                    </Button>
                  )}
                </article>
              ))}

            {/* HUBS */}
            {list.data?.view === "hubs" &&
              (list.data.unmigrated ? (
                <p className="py-6 text-xs text-muted-foreground">Hubs table unavailable.</p>
              ) : (
                list.data.rows.map((h) => (
                  <article
                    key={h.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3.5"
                  >
                    <div>
                      <p className="font-semibold text-sm">
                        {h.name}{" "}
                        <span className="text-xs font-normal text-muted-foreground">/{h.slug}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {h.category ?? "General"} · {h.is_private ? "Private Hub" : "Public Hub"} ·{" "}
                        {h.member_count ?? 0} members
                      </p>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/hubs/$slug" params={{ slug: h.slug }}>
                        Inspect Hub
                      </Link>
                    </Button>
                  </article>
                ))
              ))}

            {/* SIGNALS */}
            {list.data?.view === "signals" &&
              (list.data.unmigrated ? (
                <p className="py-6 text-xs text-muted-foreground">Signals table unavailable.</p>
              ) : (
                list.data.rows.map((s: any) => (
                  <article
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3.5"
                  >
                    <div>
                      <p className="font-semibold text-sm">{s.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.institution_type} · Status: {s.verification_status} ·{" "}
                        {s.follower_count ?? 0} followers
                      </p>
                    </div>
                    {canManageCommunities && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={verifySignalMutation.isPending}
                          onClick={() =>
                            verifySignalMutation.mutate({ id: s.id, status: "verified" })
                          }
                        >
                          Verify
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={verifySignalMutation.isPending}
                          onClick={() =>
                            verifySignalMutation.mutate({ id: s.id, status: "rejected" })
                          }
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </article>
                ))
              ))}

            {/* VERIFICATIONS */}
            {list.data?.view === "verifications" &&
              (list.data.unmigrated ? (
                <p className="py-6 text-xs text-muted-foreground">
                  account_verifications table awaits migration 0026.
                </p>
              ) : (
                list.data.rows.map((v) => (
                  <article
                    key={v.id}
                    className="flex flex-wrap items-start justify-between gap-3 py-3.5"
                  >
                    <div className="space-y-1">
                      <p className="font-semibold text-sm">
                        {v.profile?.display_name ?? v.user_id.slice(0, 8)} (@
                        {v.profile?.username ?? "unknown"}) ·{" "}
                        <span className="uppercase text-xs text-primary">{v.status}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Domain: {v.verification_domain} · Pathway: {v.pathway_type}
                        {v.organization_name ? ` · Org: ${v.organization_name}` : ""}
                      </p>
                      {v.submission_note && (
                        <p className="text-xs text-muted-foreground">Note: {v.submission_note}</p>
                      )}
                    </div>
                    {canVerifyPeople && (
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          size="sm"
                          disabled={reviewVerificationMutation.isPending}
                          onClick={() =>
                            reviewVerificationMutation.mutate({
                              id: v.id,
                              status: "verified",
                              reviewerNote: "Verified by authorized Ping reviewer",
                            })
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={reviewVerificationMutation.isPending}
                          onClick={() =>
                            reviewVerificationMutation.mutate({
                              id: v.id,
                              status: "rejected",
                              reviewerNote: "Insufficient verification evidence",
                            })
                          }
                        >
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={reviewVerificationMutation.isPending}
                          onClick={() =>
                            reviewVerificationMutation.mutate({
                              id: v.id,
                              status: "revoked",
                              reviewerNote: "Verification revoked after review",
                            })
                          }
                        >
                          Revoke
                        </Button>
                      </div>
                    )}
                  </article>
                ))
              ))}

            {/* MEMBERSHIP PLANS */}
            {list.data?.view === "plans" &&
              (list.data.unmigrated ? (
                <p className="py-6 text-xs text-muted-foreground">
                  membership_plans table awaits migration 0033 on the remote database.
                </p>
              ) : (
                list.data.rows.map((plan) => {
                  const draft = planDrafts[plan.slug] ?? {
                    dotPrice: plan.dot_price,
                    durationDays: plan.duration_days,
                    isActive: plan.is_active,
                  };
                  return (
                    <article
                      key={plan.slug}
                      className="py-4 flex flex-wrap items-end justify-between gap-3"
                    >
                      <div className="space-y-0.5 max-w-md">
                        <p className="font-semibold text-sm">
                          {plan.name}{" "}
                          <span className="text-xs text-muted-foreground">({plan.slug})</span>
                        </p>
                        <p className="text-xs text-muted-foreground">{plan.tagline}</p>
                      </div>
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="w-24">
                          <Label className="text-[11px]">DOT Price</Label>
                          <Input
                            type="number"
                            min={0}
                            value={draft.dotPrice}
                            disabled={!canManagePlans}
                            onChange={(e) =>
                              setPlanDrafts((prev) => ({
                                ...prev,
                                [plan.slug]: { ...draft, dotPrice: Number(e.target.value) || 0 },
                              }))
                            }
                            className="h-8 text-xs mt-1"
                          />
                        </div>
                        <div className="w-24">
                          <Label className="text-[11px]">Days</Label>
                          <Input
                            type="number"
                            min={0}
                            value={draft.durationDays}
                            disabled={!canManagePlans}
                            onChange={(e) =>
                              setPlanDrafts((prev) => ({
                                ...prev,
                                [plan.slug]: {
                                  ...draft,
                                  durationDays: Number(e.target.value) || 0,
                                },
                              }))
                            }
                            className="h-8 text-xs mt-1"
                          />
                        </div>
                        {canManagePlans && (
                          <Button
                            size="sm"
                            disabled={upsertPlanMutation.isPending}
                            onClick={() =>
                              upsertPlanMutation.mutate({
                                slug: plan.slug,
                                name: plan.name,
                                badge: plan.badge,
                                tagline: plan.tagline,
                                dotPrice: draft.dotPrice,
                                durationDays: draft.durationDays,
                                benefits: plan.benefits,
                                perks: plan.perks,
                                isActive: draft.isActive,
                              })
                            }
                          >
                            Save
                          </Button>
                        )}
                      </div>
                    </article>
                  );
                })
              ))}

            {/* BOOST CAMPAIGNS */}
            {list.data?.view === "boosts" &&
              (list.data.unmigrated ? (
                <p className="py-6 text-xs text-muted-foreground">
                  boost_campaigns table awaits migration 0033 on the remote database.
                </p>
              ) : (
                list.data.rows.map((bc) => (
                  <article
                    key={bc.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3.5"
                  >
                    <div className="space-y-0.5">
                      <p className="font-semibold text-sm">
                        {bc.content_type.toUpperCase()} Boost · {bc.dot_cost} DOT ·{" "}
                        <span className="uppercase text-xs text-primary">{bc.status}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Receipt {bc.receipt_number} · Reach {bc.reach_count} · Impressions{" "}
                        {bc.impressions_count} · Clicks {bc.clicks_count}
                      </p>
                    </div>
                    {canModerateBoosts && bc.status === "active" && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setBoostReason("");
                            setBoostRefundAmt(0);
                            setBoostMod({
                              campaignId: bc.id,
                              decision: "paused",
                              maxRefund: bc.dot_cost,
                            });
                          }}
                        >
                          Pause
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            setBoostReason("");
                            setBoostRefundAmt(bc.dot_cost);
                            setBoostMod({
                              campaignId: bc.id,
                              decision: "refunded",
                              maxRefund: bc.dot_cost,
                            });
                          }}
                        >
                          Audited Refund
                        </Button>
                      </div>
                    )}
                  </article>
                ))
              ))}

            {/* BUSINESSES */}
            {list.data?.view === "businesses" &&
              (list.data.unmigrated ? (
                <p className="py-6 text-xs text-muted-foreground">
                  business_profiles table awaits migration 0031 on the remote database.
                </p>
              ) : (
                list.data.rows.map((b) => (
                  <article
                    key={b.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3.5"
                  >
                    <div>
                      <p className="font-semibold text-sm">{b.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {b.category} · {b.location || "Global"} · Verification:{" "}
                        {b.verification_status}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/b/$slug" params={{ slug: b.slug }}>
                        Open Storefront
                      </Link>
                    </Button>
                  </article>
                ))
              ))}

            {/* EARLY ACCESS REGISTRATIONS */}
            {list.data?.view === "early_access" &&
              (list.data.unmigrated ? (
                <p className="py-6 text-xs text-muted-foreground">
                  early_access_registrations table awaits migration 0035 on the remote database.
                </p>
              ) : (
                list.data.rows.map((ea) => (
                  <article
                    key={ea.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3.5"
                  >
                    <div>
                      <p className="font-semibold text-sm">
                        {ea.email}{" "}
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] uppercase ml-1">
                          {ea.platform}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Source: {ea.source_site || ea.referral_source} · Device:{" "}
                        {ea.device_model || "Not specified"} · Status: {ea.status}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(ea.created_at).toLocaleString()}
                    </span>
                  </article>
                ))
              ))}

            {/* PING LEARN RELEASE SCHEDULE */}
            {list.data?.view === "learn" &&
              (list.data.unmigrated ? (
                <p className="py-6 text-xs text-muted-foreground">
                  course_release_schedules table awaits migration 0034 on the remote database.
                </p>
              ) : (
                list.data.rows.map((sched) => {
                  const cur = learnDraft ?? {
                    requireLeapfrogCompletion: sched.require_leapfrog_completion,
                    releaseIntervalDays: sched.release_interval_days,
                    coursesPerCycle: sched.courses_per_cycle,
                    minAssessmentScore: sched.min_assessment_score,
                    releaseOrder: sched.release_order,
                  };
                  return (
                    <article key={sched.id} className="py-5 space-y-4">
                      <div>
                        <h3 className="font-semibold text-sm">
                          Builder Plus Periodic Course Release Schedule
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Controls how Builder Plus members unlock subsequent Ping Learn courses
                          after completing LEAPFROG.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="w-28">
                          <Label className="text-[11px]">Interval (days)</Label>
                          <Input
                            type="number"
                            min={7}
                            max={180}
                            disabled={!canManageLearn}
                            value={cur.releaseIntervalDays}
                            onChange={(e) =>
                              setLearnDraft({
                                ...cur,
                                releaseIntervalDays: Math.max(7, Number(e.target.value) || 30),
                              })
                            }
                            className="mt-1 h-8 text-xs"
                          />
                        </div>
                        <div className="w-28">
                          <Label className="text-[11px]">Courses / cycle</Label>
                          <Input
                            type="number"
                            min={1}
                            max={5}
                            disabled={!canManageLearn}
                            value={cur.coursesPerCycle}
                            onChange={(e) =>
                              setLearnDraft({
                                ...cur,
                                coursesPerCycle: Math.max(1, Number(e.target.value) || 1),
                              })
                            }
                            className="mt-1 h-8 text-xs"
                          />
                        </div>
                        <div className="w-28">
                          <Label className="text-[11px]">Min Score (%)</Label>
                          <Input
                            type="number"
                            min={50}
                            max={100}
                            disabled={!canManageLearn}
                            value={cur.minAssessmentScore}
                            onChange={(e) =>
                              setLearnDraft({
                                ...cur,
                                minAssessmentScore: Math.max(50, Number(e.target.value) || 70),
                              })
                            }
                            className="mt-1 h-8 text-xs"
                          />
                        </div>
                        {canManageLearn && (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setLearnDraft({
                                  ...cur,
                                  requireLeapfrogCompletion: !cur.requireLeapfrogCompletion,
                                })
                              }
                            >
                              {cur.requireLeapfrogCompletion
                                ? "Leapfrog Required: ON"
                                : "Leapfrog Required: OFF"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              disabled={updateLearnScheduleMutation.isPending}
                              onClick={() => updateLearnScheduleMutation.mutate(cur)}
                            >
                              Save Schedule
                            </Button>
                          </>
                        )}
                      </div>
                    </article>
                  );
                })
              ))}

            {/* SYSTEM ERROR LOGS */}
            {list.data?.view === "system_errors" &&
              (list.data.unmigrated ? (
                <p className="py-6 text-xs text-muted-foreground">
                  system_error_logs table awaits migration 0035 on the remote database.
                </p>
              ) : (
                list.data.rows.map((err) => (
                  <article
                    key={err.id}
                    className="flex flex-wrap items-start justify-between gap-3 py-3.5"
                  >
                    <div className="space-y-0.5">
                      <p className="font-semibold text-sm">
                        <span className="uppercase text-xs text-destructive mr-1.5">
                          [{err.severity}]
                        </span>
                        {err.category} · {err.source}
                      </p>
                      <p className="text-xs text-muted-foreground">{err.message}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {err.status} · {new Date(err.created_at).toLocaleString()}
                    </span>
                  </article>
                ))
              ))}

            {/* APPOINTED STAFF ROSTER */}
            {list.data?.view === "staff" &&
              list.data.rows.map((staff) => {
                const isSelf = staff.user_id === currentUserId;
                const isOwnerRow = staff.roles.includes("platform_owner");
                return (
                  <article key={staff.user_id} className="py-4 space-y-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-sm">
                          {staff.display_name}{" "}
                          <span className="text-muted-foreground font-normal">
                            @{staff.username}
                          </span>
                          {isSelf && (
                            <span className="ml-2 text-[11px] rounded bg-primary/15 text-primary px-1.5 py-0.5">
                              You
                            </span>
                          )}
                        </p>
                        <p className="text-xs font-mono text-muted-foreground">{staff.user_id}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {staff.roles.map((r) => (
                            <span
                              key={r}
                              className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-semibold"
                            >
                              {formatAdminRoleLabel(r)}
                            </span>
                          ))}
                        </div>
                      </div>
                      {access.isPlatformOwner && !isSelf && !isOwnerRow && (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setPermReason("");
                              setPermDialog({
                                userId: staff.user_id,
                                username: staff.username,
                                permission: "content.moderate",
                                effect: "grant",
                              });
                            }}
                          >
                            <KeyRound className="size-3.5 mr-1" /> Edit Permission
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              setRevokeReason("");
                              setRevokeDialog({
                                userId: staff.user_id,
                                username: staff.username,
                                role: null,
                              });
                            }}
                          >
                            <UserMinus className="size-3.5 mr-1" /> Revoke Access
                          </Button>
                        </div>
                      )}
                    </div>
                    {staff.overrides.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {staff.overrides.map((ov) => (
                          <span
                            key={`${ov.permission}-${ov.effect}`}
                            className={`rounded-md px-2 py-0.5 text-[11px] font-mono ${
                              ov.effect === "grant"
                                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                : "bg-destructive/15 text-destructive"
                            }`}
                          >
                            {ov.effect === "grant" ? "+" : "−"} {ov.permission}
                          </span>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}

            {/* AUDIT TRAIL */}
            {list.data?.view === "audit" &&
              list.data.rows.map((a: any) => (
                <article
                  key={a.id}
                  className="flex flex-wrap items-start justify-between gap-3 py-3.5"
                >
                  <div className="space-y-0.5">
                    <p className="font-semibold text-sm font-mono">{a.action}</p>
                    <p className="text-xs text-muted-foreground">
                      Actor: {a.actor_id ?? "system"} → Target: {a.target_id}
                    </p>
                    <p className="text-xs">{a.reason}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(a.created_at).toLocaleString()}
                  </span>
                </article>
              ))}

            {list.data &&
              list.data.rows.length === 0 &&
              !("unmigrated" in list.data && list.data.unmigrated) && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No matching records.
                </p>
              )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Page {page + 1} · {list.data?.total ?? 0} records
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label="Previous page"
                disabled={page === 0 || list.isFetching}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Next page"
                disabled={
                  !list.data || (page + 1) * ADMIN_PAGE_SIZE >= list.data.total || list.isFetching
                }
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* DIALOG: CONTENT MODERATION */}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !moderateMutation.isPending) setPending(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm {pending?.action.replaceAll("_", " ")}</DialogTitle>
            <DialogDescription>
              Hiding removes a Ping from public discovery while preserving content for review. Every
              decision records your mandatory reason in the audit trail.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="moderation-reason">Reason</Label>
          <Input
            id="moderation-reason"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={moderateMutation.isPending}
              onClick={() => setPending(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={
                moderateMutation.isPending ||
                !pending ||
                !moderationSchema.safeParse({ ...pending, reason }).success
              }
              onClick={() => {
                if (pending) moderateMutation.mutate({ ...pending, reason });
              }}
            >
              {moderateMutation.isPending ? "Saving…" : "Confirm"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* DIALOG: BOOST MODERATION */}
      <Dialog
        open={boostMod !== null}
        onOpenChange={(open) => {
          if (!open && !moderateBoostMutation.isPending) setBoostMod(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="capitalize">Confirm Boost {boostMod?.decision}</DialogTitle>
            <DialogDescription>
              Every boost moderation decision or DOT refund is permanently recorded in the audit
              ledger.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="boost-mod-reason">Moderation / Refund Reason</Label>
              <Input
                id="boost-mod-reason"
                value={boostReason}
                maxLength={500}
                onChange={(e) => setBoostReason(e.target.value)}
                className="mt-1"
              />
            </div>
            {boostMod?.decision === "refunded" && (
              <div>
                <Label htmlFor="boost-refund-amount">
                  Refund DOT Credits (max {boostMod.maxRefund} DOT)
                </Label>
                <Input
                  id="boost-refund-amount"
                  type="number"
                  min={0}
                  max={boostMod.maxRefund}
                  value={boostRefundAmt}
                  onChange={(e) =>
                    setBoostRefundAmt(
                      Math.max(0, Math.min(boostMod.maxRefund, Number(e.target.value) || 0)),
                    )
                  }
                  className="mt-1"
                />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="outline"
              disabled={moderateBoostMutation.isPending}
              onClick={() => setBoostMod(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={
                moderateBoostMutation.isPending || boostReason.trim().length < 3 || !boostMod
              }
              onClick={() => {
                if (!boostMod) return;
                moderateBoostMutation.mutate({
                  campaignId: boostMod.campaignId,
                  decision: boostMod.decision,
                  reason: boostReason.trim(),
                  refundAmount: boostMod.decision === "refunded" ? boostRefundAmt : 0,
                });
              }}
            >
              {moderateBoostMutation.isPending ? "Recording…" : "Confirm Decision"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* DIALOG: PLATFORM OWNER REVOKE ADMIN */}
      <Dialog
        open={revokeDialog !== null}
        onOpenChange={(open) => {
          if (!open && !revokeMutation.isPending) setRevokeDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke Administrator Access (@{revokeDialog?.username})</DialogTitle>
            <DialogDescription>
              Revoking removes all appointed administrative roles and individual permission
              overrides for this account immediately, with an immutable audit entry.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="revoke-admin-reason">Mandatory Revocation Reason (min 5 chars)</Label>
          <Input
            id="revoke-admin-reason"
            value={revokeReason}
            maxLength={500}
            onChange={(e) => setRevokeReason(e.target.value)}
            placeholder="e.g., Role rotation completed"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={revokeMutation.isPending}
              onClick={() => setRevokeDialog(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={revokeMutation.isPending || revokeReason.trim().length < 5}
              onClick={() => revokeMutation.mutate()}
            >
              {revokeMutation.isPending ? "Revoking…" : "Revoke Access"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* DIALOG: PLATFORM OWNER INDIVIDUAL PERMISSION OVERRIDE */}
      <Dialog
        open={permDialog !== null}
        onOpenChange={(open) => {
          if (!open && !setPermMutation.isPending) setPermDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Individual Permission Override (@{permDialog?.username})</DialogTitle>
            <DialogDescription>
              Grant or revoke a single permission for this staff account without changing its base
              role. Owner-exclusive permissions cannot be delegated.
            </DialogDescription>
          </DialogHeader>
          {permDialog && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="perm-select" className="text-xs">
                  Permission
                </Label>
                <select
                  id="perm-select"
                  value={permDialog.permission}
                  onChange={(e) =>
                    setPermDialog({ ...permDialog, permission: e.target.value as AdminPermission })
                  }
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-xs"
                >
                  {ADMIN_PERMISSIONS.filter(
                    (p) => p !== "admin.revoke_admins" && p !== "admin.manage_permissions",
                  ).map((p) => (
                    <option key={p} value={p}>
                      {p} — {ADMIN_PERMISSION_LABELS[p].label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="perm-effect" className="text-xs">
                  Action
                </Label>
                <select
                  id="perm-effect"
                  value={permDialog.effect}
                  onChange={(e) =>
                    setPermDialog({
                      ...permDialog,
                      effect: e.target.value as "grant" | "revoke" | "clear",
                    })
                  }
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-xs"
                >
                  <option value="grant">Grant individual permission</option>
                  <option value="revoke">Explicitly revoke permission</option>
                  <option value="clear">Reset to role default</option>
                </select>
              </div>
              <div>
                <Label htmlFor="perm-reason" className="text-xs">
                  Mandatory Reason (min 5 chars)
                </Label>
                <Input
                  id="perm-reason"
                  value={permReason}
                  maxLength={500}
                  onChange={(e) => setPermReason(e.target.value)}
                  placeholder="State justification for permission change…"
                  className="mt-1 text-xs"
                />
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="outline"
              disabled={setPermMutation.isPending}
              onClick={() => setPermDialog(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={setPermMutation.isPending || permReason.trim().length < 5}
              onClick={() => setPermMutation.mutate()}
            >
              {setPermMutation.isPending ? "Saving…" : "Save Override"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
