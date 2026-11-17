import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft,
  ArrowUpRight,
  Coins,
  Crown,
  Flame,
  History,
  Info,
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
import { Button } from "@/components/ui/button";
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
  const claimDaily = useClaimDailyDot();

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

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="rounded-full">
            <Link to="/analytics">
              <TrendingUp className="size-4" />
              Analytics
            </Link>
          </Button>
          <Button asChild variant="hero" size="sm" className="rounded-full">
            <Link to="/upgrades">
              <Crown className="size-4" />
              Upgrades
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
