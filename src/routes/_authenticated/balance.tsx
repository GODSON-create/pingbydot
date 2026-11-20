import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft,
  ArrowUpRight,
  Coins,
  CreditCard,
  Crown,
  Flame,
  History,
  Info,
  Megaphone,
  Receipt,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  UPGRADE_TIERS,
  canClaimDailyCheckin,
  dotSummaryQuery,
  useClaimDailyDot,
} from "@/lib/economy";
import {
  DOT_TOPUP_LIMITS,
  calculateDotTopupQuote,
  dotTopupIntentsQuery,
  getCryptoRailStatus,
  getPaystackConfigStatus,
  useCreateDotTopupIntent,
  type DotTopupCurrency,
} from "@/lib/payments/paystack";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PingMark } from "@/components/BrandLogo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/balance")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "DOT Balance — Ping by DOT" },
      {
        name: "description",
        content: "Track your DOT credits, daily streak rewards, and ledger activity on Ping.",
      },
    ],
  }),
  component: BalancePage,
});

function BalancePage() {
  const { user, profile } = useAuth();
  const { data: summary, isLoading } = useQuery(dotSummaryQuery(user?.id));
  const { data: topupIntents = [] } = useQuery(dotTopupIntentsQuery(user?.id));
  const claimDaily = useClaimDailyDot();
  const createTopup = useCreateDotTopupIntent(user?.id);

  const [customDotAmount, setCustomDotAmount] = useState("250");
  const [topupCurrency, setTopupCurrency] = useState<DotTopupCurrency>("NGN");
  const parsedDot = Number(customDotAmount) || DOT_TOPUP_LIMITS.minDot;
  const quote = calculateDotTopupQuote(parsedDot, topupCurrency);
  const paystackStatus = getPaystackConfigStatus();
  const cryptoRail = getCryptoRailStatus();

  const wallet = summary?.wallet;
  const subscription = summary?.subscription;
  const tierInfo = UPGRADE_TIERS.find((t) => t.id === (subscription?.tier ?? "free"));
  const canClaim = Boolean(
    summary?.migrated && wallet && canClaimDailyCheckin(wallet.last_checkin_at),
  );

  const handleClaimDaily = () => {
    if (!summary?.migrated) {
      toast.info("Daily check-in rewards unlock as soon as wallet migration 0016 is applied.");
      return;
    }
    claimDaily.mutate(undefined, {
      onSuccess: (res) => {
        toast.success(`Claimed +${res.reward} DOT! Streak: ${res.streak_days} days`);
      },
      onError: (err: any) => {
        toast.error(err?.message || "Could not claim daily DOT check-in.");
      },
    });
  };

  return (
    <div className="mx-auto max-w-4xl px-5 py-10 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
            <h1 className="font-display text-3xl font-extrabold tracking-tight">DOT Balance</h1>
            <p className="text-sm text-muted-foreground">
              Builder credits earned from daily check-ins, Pings, and network milestones.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm" className="rounded-full">
            <Link to="/boosts">
              <Megaphone className="size-4 text-gold" />
              Boosts
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="rounded-full">
            <Link to="/analytics">
              <TrendingUp className="size-4" />
              Analytics
            </Link>
          </Button>
          <Button asChild variant="hero" size="sm" className="rounded-full">
            <Link to="/upgrades">
              <Crown className="size-4" />
              Memberships
            </Link>
          </Button>
        </div>
      </div>

      {summary && !summary.migrated && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-gold/30 bg-gold/10 p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-gold" />
          <div>
            <p className="font-semibold text-foreground">Estimated activity preview</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Database migration 0016 is pending on this environment, so this page shows your
              computed activity estimate from published Pings. Daily check-ins and upgrades become
              live once the migration runs.
            </p>
          </div>
        </div>
      )}

      {/* Main Wallet Hero Card */}
      <section className="surface-card mt-6 rounded-[2rem] p-6 sm:p-8 shadow-lift">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <PingMark variant="gold" size="lg" />
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-lime/20 dark:bg-lime/15 px-3 py-1 text-xs font-bold text-lime-foreground dark:text-lime">
                  <Coins className="size-3.5" />
                  Active Plan: {tierInfo?.name ?? "Free Builder"}
                </div>
                <div className="mt-2 flex items-baseline gap-2.5">
                  <span className="font-display text-5xl font-extrabold tracking-tight tabular-nums">
                    {isLoading ? "…" : (wallet?.balance ?? 0).toLocaleString()}
                  </span>
                  <span className="font-display text-lg font-bold text-primary">DOT</span>
                </div>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Lifetime earned{" "}
              <strong className="text-foreground">
                {(wallet?.lifetime_earned ?? 0).toLocaleString()} DOT
              </strong>{" "}
              · Lifetime spent{" "}
              <strong className="text-foreground">
                {(wallet?.lifetime_spent ?? 0).toLocaleString()} DOT
              </strong>
            </p>
          </div>

          <div className="flex flex-col items-stretch sm:items-end gap-3">
            <div className="inline-flex items-center gap-2 rounded-2xl border border-border bg-secondary/60 px-4 py-2.5 text-xs font-semibold">
              <Flame className="size-4 text-gold" />
              <span>
                Check-in streak:{" "}
                <strong className="text-foreground">{wallet?.streak_days ?? 0} days</strong>
              </span>
            </div>
            <Button
              type="button"
              variant={canClaim ? "hero" : "outline"}
              disabled={claimDaily.isPending || (summary?.migrated && !canClaim)}
              onClick={handleClaimDaily}
              className="rounded-full px-6 font-bold"
            >
              <Sparkles className="size-4" />
              {claimDaily.isPending
                ? "Claiming…"
                : !summary?.migrated
                  ? "Daily +10 DOT (Migration Pending)"
                  : canClaim
                    ? "Claim Daily +10 DOT (+Streak)"
                    : "Checked In Today"}
            </Button>
          </div>
        </div>
      </section>

      {/* Earning Guide & Upgrade Shortcut */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <section className="surface-card rounded-3xl p-6">
          <h2 className="font-display text-lg font-bold">Ways to earn DOT</h2>
          <ul className="mt-4 space-y-3 text-sm">
            <li className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Daily check-in reward</span>
              <span className="rounded-full bg-lime/20 dark:bg-lime/15 px-2.5 py-0.5 text-xs font-bold text-lime-foreground dark:text-lime">
                +10–25 DOT / day
              </span>
            </li>
            <li className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Publish a build Ping</span>
              <span className="rounded-full bg-lime/20 dark:bg-lime/15 px-2.5 py-0.5 text-xs font-bold text-lime-foreground dark:text-lime">
                +10 DOT
              </span>
            </li>
            <li className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Launch a Community Hub or Signal</span>
              <span className="rounded-full bg-lime/20 dark:bg-lime/15 px-2.5 py-0.5 text-xs font-bold text-lime-foreground dark:text-lime">
                +25 DOT
              </span>
            </li>
          </ul>
        </section>

        <section className="surface-card flex flex-col justify-between rounded-3xl p-6">
          <div>
            <h2 className="font-display text-lg font-bold">Redeem DOT for Upgrades</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Use your DOT balance to unlock Builder Plus, Founder Pro badges, extended analytics,
              or institutional Signal perks.
            </p>
          </div>
          <Button asChild variant="outline" className="mt-5 w-full rounded-full justify-between">
            <Link to="/upgrades">
              <span>Explore Account Tiers</span>
              <ArrowUpRight className="size-4" />
            </Link>
          </Button>
        </section>
      </div>

      {/* Custom DOT Top-Up Infrastructure (Server-Verified Webhook Only — Phase 4.9) */}
      <section className="surface-card mt-6 rounded-3xl p-6 sm:p-7 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold flex items-center gap-2">
              <CreditCard className="size-5 text-primary" /> Custom DOT Top-Up (Paystack)
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Choose any custom DOT credit amount ({DOT_TOPUP_LIMITS.minDot}–
              {DOT_TOPUP_LIMITS.maxDotPerTransaction.toLocaleString()} DOT). Credits are issued
              exclusively after signed server-side webhook verification — never from client
              callbacks.
            </p>
          </div>
          <span className="rounded-full border border-border bg-secondary px-3 py-1 text-[11px] font-semibold text-muted-foreground">
            {paystackStatus.label}
          </span>
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const intent = await createTopup.mutateAsync({
                dotAmount: parsedDot,
                currency: topupCurrency,
                rail: "paystack",
              });
              toast.success(
                `Top-up intent ${intent.provider_reference} created (pending signed Paystack webhook verification).`,
              );
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not create top-up intent.");
            }
          }}
          className="grid gap-3 sm:grid-cols-[1fr_130px_auto] items-end"
        >
          <div>
            <Label htmlFor="custom-dot-amount" className="text-xs">
              Custom DOT amount
            </Label>
            <Input
              id="custom-dot-amount"
              type="number"
              min={DOT_TOPUP_LIMITS.minDot}
              max={DOT_TOPUP_LIMITS.maxDotPerTransaction}
              value={customDotAmount}
              onChange={(e) => setCustomDotAmount(e.target.value)}
              className="mt-1 rounded-xl"
            />
          </div>
          <div>
            <Label htmlFor="topup-currency" className="text-xs">
              Currency
            </Label>
            <select
              id="topup-currency"
              value={topupCurrency}
              onChange={(e) => setTopupCurrency(e.target.value as DotTopupCurrency)}
              className="mt-1 h-10 w-full rounded-xl border border-input bg-card px-3 text-xs font-semibold"
            >
              <option value="NGN">NGN (₦)</option>
              <option value="USD">USD ($)</option>
            </select>
          </div>
          <Button
            type="submit"
            variant="hero"
            disabled={createTopup.isPending}
            className="h-10 rounded-full px-5 text-xs font-bold"
          >
            {createTopup.isPending ? "Creating…" : `Create Intent · ${quote.formattedTotal}`}
          </Button>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/60 bg-secondary/35 px-4 py-2.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-primary shrink-0" />
            <strong>Ledger Separation:</strong> DOT credits are non-cash platform activity credits —
            strictly separate from fiat cash balances, business revenue, or refund liabilities.
          </span>
          <span>Crypto rail: {cryptoRail.statusLabel}</span>
        </div>

        {topupIntents.length > 0 && (
          <div className="pt-2 space-y-2">
            <p className="text-xs font-bold flex items-center gap-1.5">
              <Receipt className="size-3.5 text-primary" /> Top-Up Requests &amp; Receipts
            </p>
            <div className="divide-y divide-border/50 rounded-2xl border border-border/60 px-4">
              {topupIntents.slice(0, 6).map((intent) => (
                <div
                  key={intent.id}
                  className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <p className="font-semibold text-foreground">
                      {intent.dot_amount.toLocaleString()} DOT ·{" "}
                      {intent.receipt_number || intent.provider_reference}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {intent.rail} · {format(new Date(intent.created_at), "MMM d, yyyy · h:mm a")}
                    </p>
                  </div>
                  <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-bold uppercase">
                    {intent.status.replace(/_/g, " ")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Transaction Ledger */}
      <section className="surface-card mt-6 rounded-3xl p-6 sm:p-7">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold flex items-center gap-2">
            <History className="size-5 text-primary" />
            Recent DOT Activity
          </h2>
          <span className="text-xs text-muted-foreground">
            {summary?.transactions.length ?? 0} entries
          </span>
        </div>

        {isLoading ? (
          <div className="mt-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-2xl bg-muted/40" />
            ))}
          </div>
        ) : !summary?.transactions.length ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No DOT ledger entries yet. Claim your daily check-in or publish a Ping to start building
            your balance.
          </p>
        ) : (
          <div className="mt-4 divide-y divide-border/60">
            {summary.transactions.map((tx) => {
              const isCredit = tx.amount >= 0;
              return (
                <div
                  key={tx.id}
                  className="flex items-center justify-between gap-3 py-3.5 first:pt-1 last:pb-1"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {tx.description}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <span className="capitalize">{tx.source.replace(/_/g, " ")}</span> ·{" "}
                      {format(new Date(tx.created_at), "MMM d, yyyy · h:mm a")}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-3 py-1 text-xs font-bold tabular-nums",
                      isCredit
                        ? "bg-lime/20 dark:bg-lime/15 text-lime-foreground dark:text-lime"
                        : "bg-gold/15 text-gold border border-gold/30",
                    )}
                  >
                    {isCredit ? `+${tx.amount}` : tx.amount} DOT
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
