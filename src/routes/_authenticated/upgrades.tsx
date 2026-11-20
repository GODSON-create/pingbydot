import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  Coins,
  Copy,
  Crown,
  Info,
  Lock,
  Megaphone,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { dotSummaryQuery, useUpgradeWithDots, type AccountTier } from "@/lib/economy";
import {
  FALLBACK_MEMBERSHIP_PLANS,
  generateSubscriptionIdempotencyKey,
  isEntitlementActive,
  membershipPlansQuery,
  mySubscriptionEntitlementQuery,
  mySubscriptionReceiptsQuery,
  useCancelDotSubscription,
  useSubscribeWithDots,
  type MembershipPlan,
  type MembershipSlug,
} from "@/lib/memberships";
import { monetizationCatalogQuery } from "@/lib/monetization";
import { OptionalVerificationSection } from "@/components/verification/OptionalVerificationSection";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PingMark } from "@/components/BrandLogo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/upgrades")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "DOT Memberships & Verification — Ping by DOT" },
      {
        name: "description",
        content:
          "Manage configurable DOT membership plans, subscription entitlements, receipts, and optional trust verification.",
      },
    ],
  }),
  component: UpgradesPage,
});

const SLUG_ORDER: Record<MembershipSlug, number> = {
  free: 0,
  plus: 1,
  pro: 2,
  business: 3,
};

function legacyTierToSlug(tier: AccountTier): MembershipSlug {
  if (tier === "institution") return "business";
  return tier;
}

function slugToLegacyTier(slug: Exclude<MembershipSlug, "free">): Exclude<AccountTier, "free"> {
  if (slug === "business") return "institution";
  return slug;
}

function UpgradesPage() {
  const { user, profile } = useAuth();
  const { data: summary, isLoading: loadingWallet } = useQuery(dotSummaryQuery(user?.id));
  const { data: plansRes, isLoading: loadingPlans } = useQuery(membershipPlansQuery());
  const { data: entitlement } = useQuery(mySubscriptionEntitlementQuery(user?.id));
  const { data: receipts = [] } = useQuery(mySubscriptionReceiptsQuery(user?.id));
  const { data: foundation } = useQuery(monetizationCatalogQuery());

  const subscribeMutation = useSubscribeWithDots();
  const cancelMutation = useCancelDotSubscription();
  const legacyUpgradeMutation = useUpgradeWithDots();

  const [confirmPlan, setConfirmPlan] = useState<MembershipPlan | null>(null);
  const [confirmIdempotencyKey, setConfirmIdempotencyKey] = useState<string>("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const plans = (plansRes?.plans ?? [...FALLBACK_MEMBERSHIP_PLANS]).filter((p) => p.is_active);
  const membershipMigrated = plansRes?.migrated ?? false;
  const balance = summary?.wallet.balance ?? 0;

  const activeEntitlement = isEntitlementActive(entitlement) ? entitlement : null;
  const currentPlanSlug: MembershipSlug = activeEntitlement
    ? activeEntitlement.plan_slug
    : legacyTierToSlug(summary?.subscription.tier ?? "free");
  const currentPlanObj = plans.find((p) => p.slug === currentPlanSlug) ?? plans[0];

  const openSubscribeConfirm = (plan: MembershipPlan) => {
    if (!user?.id || plan.slug === "free") return;
    setConfirmPlan(plan);
    setConfirmIdempotencyKey(generateSubscriptionIdempotencyKey(user.id, plan.slug));
  };

  const handleConfirmSubscribe = async () => {
    if (!confirmPlan || confirmPlan.slug === "free") return;
    const targetSlug = confirmPlan.slug;

    // Prefer migration 0033 idempotent DOT subscription RPC when deployed
    if (membershipMigrated) {
      try {
        const res = await subscribeMutation.mutateAsync({
          planSlug: targetSlug,
          idempotencyKey: confirmIdempotencyKey,
        });
        toast.success(
          res.idempotent_replay
            ? `${confirmPlan.name} membership already processed (receipt ${res.receipt.receipt_number}).`
            : `${confirmPlan.name} membership activated! Receipt ${res.receipt.receipt_number}.`,
        );
        setConfirmPlan(null);
        return;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not process DOT subscription.");
        return;
      }
    }

    // Graceful fallback to migration 0016 upgrade RPC when 0033 hasn't been applied yet
    if (!summary?.migrated) {
      toast.info("DOT membership redemptions unlock once database migrations 0016 & 0033 apply.");
      setConfirmPlan(null);
      return;
    }

    legacyUpgradeMutation.mutate(
      { tier: slugToLegacyTier(targetSlug), billingCycle: "dot_credits" },
      {
        onSuccess: () => {
          toast.success(`Welcome to ${confirmPlan.name}! Your plan entitlement is now active.`);
          setConfirmPlan(null);
        },
        onError: (err: unknown) => {
          toast.error(
            err instanceof Error ? err.message : "Could not complete membership activation.",
          );
        },
      },
    );
  };

  const handleCancelSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!membershipMigrated) {
      toast.info("Subscription cancellation ledger unlocks once migration 0033 is applied.");
      setCancelOpen(false);
      return;
    }
    try {
      await cancelMutation.mutateAsync(cancelReason);
      toast.success(
        "Auto-renewal cancelled. Your active benefits remain available until the end of the current period.",
      );
      setCancelReason("");
      setCancelOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel subscription.");
    }
  };

  const isBusy =
    subscribeMutation.isPending || legacyUpgradeMutation.isPending || cancelMutation.isPending;

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 pb-24">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          {profile?.username ? (
            <Button asChild variant="outline" size="icon" className="rounded-full shrink-0">
              <Link
                to="/@{$username}"
                params={{ username: profile.username }}
                aria-label="Back to profile"
              >
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
          ) : (
            <Button asChild variant="outline" size="icon" className="rounded-full shrink-0">
              <Link to="/" aria-label="Back to feed">
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
          )}
          <div>
            <h1 className="font-display text-3xl font-extrabold tracking-tight">
              DOT Memberships &amp; Verification
            </h1>
            <p className="text-sm text-muted-foreground">
              Redeem earned non-cash DOT credits for optional memberships, or request optional trust
              verification. Core Ping access is always free.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <Button asChild variant="outline" size="sm" className="rounded-full gap-1.5">
            <Link to="/boosts">
              <Megaphone className="size-3.5 text-gold" />
              <span>Boost Campaigns</span>
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="rounded-full gap-1.5">
            <Link to="/balance">
              <Coins className="size-4 text-primary" />
              <span className="font-bold tabular-nums">
                {loadingWallet ? "…" : `${balance.toLocaleString()} DOT`}
              </span>
            </Link>
          </Button>
        </div>
      </div>

      {/* Authoritative Entitlement & DOT Separation Summary */}
      <section
        aria-label="Active subscription entitlement"
        className="mt-6 grid gap-4 md:grid-cols-3"
      >
        <div className="surface-card rounded-3xl p-5 border border-border/70 md:col-span-2 flex flex-col justify-between gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Active Subscription Entitlement
              </p>
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                <h2 className="font-display text-2xl font-extrabold">
                  {currentPlanObj?.name ?? "Free"} Membership
                </h2>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                    entitlement?.status === "cancelled"
                      ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                      : currentPlanSlug === "free"
                        ? "bg-secondary text-secondary-foreground"
                        : "bg-primary/15 text-primary border border-primary/30",
                  )}
                >
                  {entitlement?.status === "cancelled"
                    ? "Cancelled · Ends Soon"
                    : currentPlanSlug === "free"
                      ? "Free Access"
                      : "Active"}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Entitlements are stored independently from your DOT wallet ledger. Spending DOT for
                memberships never grants identity verification.
              </p>
            </div>

            {currentPlanSlug !== "free" && (
              <div className="flex items-center gap-2">
                {currentPlanObj && currentPlanObj.dot_price > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isBusy || balance < currentPlanObj.dot_price}
                    onClick={() => openSubscribeConfirm(currentPlanObj)}
                    className="rounded-full text-xs gap-1.5"
                  >
                    <RefreshCw className="size-3.5" /> Renew
                  </Button>
                )}
                {entitlement && entitlement.status === "active" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setCancelOpen(true)}
                    className="rounded-full text-xs text-destructive hover:text-destructive gap-1"
                  >
                    <XCircle className="size-3.5" /> Cancel
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 border-t border-border/60 text-xs">
            <div className="rounded-2xl bg-secondary/45 px-3 py-2">
              <span className="text-[10px] text-muted-foreground block">Profile Links</span>
              <span className="font-bold tabular-nums">
                {activeEntitlement?.entitlements.max_profile_links ??
                  currentPlanObj?.benefits.max_profile_links ??
                  3}
              </span>
            </div>
            <div className="rounded-2xl bg-secondary/45 px-3 py-2">
              <span className="text-[10px] text-muted-foreground block">Analytics Window</span>
              <span className="font-bold tabular-nums">
                {activeEntitlement?.entitlements.analytics_days ??
                  currentPlanObj?.benefits.analytics_days ??
                  7}
                d
              </span>
            </div>
            <div className="rounded-2xl bg-secondary/45 px-3 py-2">
              <span className="text-[10px] text-muted-foreground block">Scheduling</span>
              <span className="font-bold">
                {(activeEntitlement?.entitlements.scheduling ?? currentPlanObj?.benefits.scheduling)
                  ? "Enabled"
                  : "Standard"}
              </span>
            </div>
            <div className="rounded-2xl bg-secondary/45 px-3 py-2">
              <span className="text-[10px] text-muted-foreground block">Period Ends</span>
              <span className="font-bold">
                {activeEntitlement?.expires_at
                  ? format(new Date(activeEntitlement.expires_at), "MMM d, yyyy")
                  : "No expiry"}
              </span>
            </div>
          </div>
        </div>

        {/* DOT Policy & Ledger Separation Note */}
        <div className="surface-card rounded-3xl p-5 border border-border/70 flex flex-col justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Info className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="text-xs text-muted-foreground space-y-1.5">
              <p className="font-semibold text-foreground">Non-Cash DOT Credits</p>
              <p>
                DOT credits are virtual activity credits earned on Ping — not cash, stored value, or
                financial deposits. Real-money checkout is not active until payment provider
                integration and security verification are completed.
              </p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm" className="w-full rounded-full text-xs">
            <Link to="/balance">View DOT Wallet &amp; Ledger</Link>
          </Button>
        </div>
      </section>

      {!membershipMigrated && (
        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-gold/30 bg-gold/10 p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-gold" />
          <div>
            <p className="font-semibold text-foreground">
              Configurable membership catalogue preview
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Live server-side idempotent subscriptions, expiry tracking, and receipts activate
              automatically once migration 0033 is applied on this environment.
            </p>
          </div>
        </div>
      )}

      {/* Configurable 4-Tier Membership Catalogue */}
      <section aria-labelledby="membership-catalogue-heading" className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-2 mb-4">
          <div>
            <h2
              id="membership-catalogue-heading"
              className="font-display text-2xl font-extrabold tracking-tight"
            >
              Membership Plans
            </h2>
            <p className="text-xs text-muted-foreground">
              Prices, durations, and benefit limits are dynamically managed by Ping administrators.
              All debits are verified server-side and idempotent.
            </p>
          </div>
        </div>

        {loadingPlans ? (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-96 animate-pulse rounded-3xl bg-secondary/50" />
            ))}
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => {
              const isCurrent = currentPlanSlug === plan.slug;
              const isLower = SLUG_ORDER[plan.slug] < SLUG_ORDER[currentPlanSlug];
              const affordable = balance >= plan.dot_price;
              const missingDots = Math.max(0, plan.dot_price - balance);
              const isPremiumBadge = plan.slug === "pro" || plan.slug === "business";

              return (
                <article
                  key={plan.slug}
                  data-testid={`membership-card-${plan.slug}`}
                  className={cn(
                    "surface-card flex flex-col justify-between rounded-3xl p-6 transition-all",
                    plan.highlighted && "border-gold/50 ring-1 ring-gold/25",
                    isCurrent && "border-primary/60 ring-1 ring-primary/30",
                  )}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <PingMark
                          variant={
                            plan.slug === "free" ? "silver" : plan.slug === "plus" ? "lime" : "gold"
                          }
                          size="sm"
                        />
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold",
                            isPremiumBadge
                              ? "bg-gold/15 text-gold border border-gold/30"
                              : "bg-secondary text-secondary-foreground",
                          )}
                        >
                          {plan.slug === "business" ? (
                            <ShieldCheck className="size-3" />
                          ) : plan.slug === "pro" ? (
                            <Crown className="size-3" />
                          ) : (
                            <Sparkles className="size-3" />
                          )}
                          {plan.badge}
                        </span>
                      </div>
                      {isCurrent && (
                        <span className="rounded-full bg-lime/20 dark:bg-lime/15 px-2.5 py-0.5 text-[10px] font-bold text-lime-foreground dark:text-lime">
                          Active
                        </span>
                      )}
                    </div>

                    <h3 className="mt-4 font-display text-xl font-extrabold">{plan.name}</h3>
                    <div className="mt-2 flex items-baseline gap-1.5">
                      <span className="font-display text-3xl font-extrabold tabular-nums">
                        {plan.dot_price === 0 ? "Free" : `${plan.dot_price} DOT`}
                      </span>
                      {plan.duration_days > 0 && (
                        <span className="text-xs text-muted-foreground">
                          / {plan.duration_days}d
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {plan.tagline}
                    </p>

                    <ul className="mt-5 space-y-2.5 border-t border-border/60 pt-4 text-xs">
                      {plan.perks.map((perk) => (
                        <li key={perk} className="flex items-start gap-2">
                          <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                          <span className="text-foreground/90">{perk}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-6">
                    {isCurrent && plan.slug === "free" ? (
                      <Button disabled variant="outline" className="w-full rounded-full">
                        Current Plan
                      </Button>
                    ) : isCurrent && plan.dot_price > 0 ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isBusy || !affordable}
                        onClick={() => openSubscribeConfirm(plan)}
                        className="w-full rounded-full font-semibold"
                      >
                        {affordable ? `Renew (${plan.dot_price} DOT)` : `Need ${missingDots} DOT`}
                      </Button>
                    ) : plan.slug === "free" || isLower ? (
                      <Button disabled variant="outline" className="w-full rounded-full">
                        Included
                      </Button>
                    ) : affordable ? (
                      <Button
                        type="button"
                        variant={plan.highlighted ? "hero" : "default"}
                        disabled={isBusy}
                        onClick={() => openSubscribeConfirm(plan)}
                        className="w-full rounded-full font-bold"
                      >
                        {`Subscribe · ${plan.dot_price} DOT`}
                      </Button>
                    ) : (
                      <Button asChild variant="outline" className="w-full rounded-full">
                        <Link to="/balance">Need {missingDots} more DOT</Link>
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Subscription History & Transaction Receipts */}
      <section aria-labelledby="subscription-receipts-heading" className="mt-10">
        <div className="surface-card rounded-3xl p-6 border border-border/70">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2
                id="subscription-receipts-heading"
                className="font-display text-lg font-extrabold flex items-center gap-2"
              >
                <Receipt className="size-4 text-primary" /> Subscription History &amp; Receipts
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Immutable transaction receipts recorded by Ping&apos;s authoritative DOT ledger.
              </p>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {receipts.length} {receipts.length === 1 ? "receipt" : "receipts"}
            </span>
          </div>

          {receipts.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-dashed border-border/80 bg-secondary/25 px-4 py-6 text-center text-xs text-muted-foreground">
              No subscription transactions yet. Once you activate or renew a DOT membership, every
              verified receipt appears here.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {receipts.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-secondary/25 px-4 py-3 text-xs"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold capitalize text-foreground">
                        {r.plan_slug} · {r.action}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {r.receipt_number}
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(r.receipt_number);
                            toast.success("Receipt number copied");
                          } catch {
                            toast.error("Couldn't copy receipt number");
                          }
                        }}
                        aria-label={`Copy receipt ${r.receipt_number}`}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Copy className="size-3" />
                      </button>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {format(new Date(r.created_at), "MMM d, yyyy · HH:mm")}
                      {r.period_end
                        ? ` · Active until ${format(new Date(r.period_end), "MMM d, yyyy")}`
                        : ""}
                    </p>
                  </div>
                  <span className="font-display font-extrabold tabular-nums text-sm">
                    {r.dot_charged > 0 ? `-${r.dot_charged} DOT` : "0 DOT"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Optional Identity & Professional Account-Type Verification */}
      <OptionalVerificationSection />

      {/* Monetization & Commerce Foundation Catalog (Non-Compulsory, Payment Gateway Inactive) */}
      <section aria-labelledby="monetization-foundation-heading" className="mt-10">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2
              id="monetization-foundation-heading"
              className="font-display text-2xl font-extrabold tracking-tight"
            >
              Commercial &amp; Creator Service Foundations
            </h2>
            <p className="text-xs text-muted-foreground">
              Prepared service tiers across personal, creator, business, and verification pathways.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/70 px-3 py-1 text-[11px] font-semibold text-muted-foreground self-start">
            <Lock className="size-3" /> Cash Checkout Not Active Yet
          </span>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(foundation?.offerings ?? []).map((offering) => (
            <article
              key={offering.slug}
              className="surface-card rounded-3xl p-5 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-secondary-foreground">
                    {offering.category.replace("_", " ")}
                  </span>
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    {offering.billing_mode === "free"
                      ? "Free · Optional"
                      : offering.billing_mode === "dot_credits"
                        ? `${offering.dot_credit_cost ?? 0} DOT (non-cash)`
                        : "Planned (Payment Audit Pending)"}
                  </span>
                </div>
                <h3 className="mt-3 font-display text-base font-bold">{offering.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {offering.summary}
                </p>
              </div>
              <ul className="mt-4 space-y-1.5 border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
                {offering.features.map((feat) => (
                  <li key={feat} className="flex items-start gap-1.5">
                    <Check className="mt-0.5 size-3 shrink-0 text-primary" />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      {/* Server-Verified Subscription Confirmation Dialog */}
      <Dialog open={Boolean(confirmPlan)} onOpenChange={(o) => !o && setConfirmPlan(null)}>
        <DialogContent className="sm:max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <Sparkles className="size-5 text-primary" /> Confirm {confirmPlan?.name} Membership
            </DialogTitle>
            <DialogDescription className="text-xs">
              Review your DOT membership details before processing on the server ledger.
            </DialogDescription>
          </DialogHeader>

          {confirmPlan && (
            <div className="mt-2 space-y-4">
              <div className="rounded-2xl border border-border/70 bg-secondary/35 p-4 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Plan</span>
                  <span className="font-bold text-foreground">{confirmPlan.name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Duration</span>
                  <span className="font-semibold inline-flex items-center gap-1">
                    <CalendarClock className="size-3.5 text-primary" /> {confirmPlan.duration_days}{" "}
                    days
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-border/60 pt-2">
                  <span className="text-muted-foreground">Exact DOT debit</span>
                  <span className="font-display text-lg font-extrabold text-primary tabular-nums">
                    {confirmPlan.dot_price} DOT
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Current wallet balance</span>
                  <span className="tabular-nums">{balance.toLocaleString()} DOT</span>
                </div>
              </div>

              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Protected by idempotency key{" "}
                <code className="rounded bg-secondary px-1 py-0.5 text-[10px]">
                  {confirmIdempotencyKey.slice(0, 22)}…
                </code>{" "}
                — repeated submissions will never deduct DOT twice. Identity verification remains
                separate.
              </p>

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirmPlan(null)}
                  className="rounded-full"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="hero"
                  disabled={isBusy}
                  onClick={() => void handleConfirmSubscribe()}
                  className="rounded-full font-bold"
                >
                  {isBusy ? "Verifying on Ledger…" : `Confirm ${confirmPlan.dot_price} DOT`}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Cancel Subscription Dialog */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="sm:max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-lg">Cancel Membership Renewal?</DialogTitle>
            <DialogDescription className="text-xs">
              Your paid benefits stay active through the end of your current period. You can
              re-subscribe at any time.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCancelSubscription} className="mt-2 space-y-3">
            <div>
              <Label htmlFor="cancel-reason" className="text-xs">
                Optional feedback
              </Label>
              <Input
                id="cancel-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Tell us how we can improve Ping memberships…"
                className="mt-1 rounded-xl text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCancelOpen(false)}
                className="rounded-full text-xs"
              >
                Keep Membership
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={cancelMutation.isPending}
                className="rounded-full text-xs"
              >
                {cancelMutation.isPending ? "Cancelling…" : "Confirm Cancellation"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
