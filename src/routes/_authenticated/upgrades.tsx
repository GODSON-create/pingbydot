import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Coins, Crown, Info, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  UPGRADE_TIERS,
  dotSummaryQuery,
  useUpgradeWithDots,
  type AccountTier,
} from "@/lib/economy";
import { Button } from "@/components/ui/button";
import { PingMark } from "@/components/BrandLogo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/upgrades")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Account Upgrades — Ping by DOT" },
      {
        name: "description",
        content: "Upgrade your Ping membership tier using DOT builder credits.",
      },
    ],
  }),
  component: UpgradesPage,
});

const TIER_ORDER: Record<AccountTier, number> = {
  free: 0,
  plus: 1,
  pro: 2,
  institution: 3,
};

function UpgradesPage() {
  const { user, profile } = useAuth();
  const { data: summary, isLoading } = useQuery(dotSummaryQuery(user?.id));
  const upgradeMutation = useUpgradeWithDots();

  const currentTier: AccountTier = summary?.subscription.tier ?? "free";
  const balance = summary?.wallet.balance ?? 0;

  const handleUpgrade = (tier: Exclude<AccountTier, "free">, name: string) => {
    if (!summary?.migrated) {
      toast.info("Account upgrades unlock once database migration 0016 is applied.");
      return;
    }
    upgradeMutation.mutate(
      { tier, billingCycle: "dot_credits" },
      {
        onSuccess: () => {
          toast.success(`Welcome to ${name}! Your badge is now active.`);
        },
        onError: (err: any) => {
          toast.error(err?.message || "Could not complete account upgrade.");
        },
      },
    );
  };

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
              Account Upgrades
            </h1>
            <p className="text-sm text-muted-foreground">
              Redeem earned DOT credits for Creator Pro badges, extended analytics, and
              institutional tools.
            </p>
          </div>
        </div>

        <Button asChild variant="outline" className="rounded-full self-start sm:self-auto">
          <Link to="/balance">
            <Coins className="size-4 text-primary" />
            <span className="font-bold tabular-nums">
              {isLoading ? "…" : `${balance.toLocaleString()} DOT`}
            </span>
          </Link>
        </Button>
      </div>

      {summary && !summary.migrated && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-gold/30 bg-gold/10 p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-gold" />
          <div>
            <p className="font-semibold text-foreground">
              Migration 0016 required for live redemptions
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Plans and DOT costs are ready below. Live plan activation runs cleanly as soon as
              migration 0016 is applied on this environment.
            </p>
          </div>
        </div>
      )}

      <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        {UPGRADE_TIERS.map((tier) => {
          const isCurrent = currentTier === tier.id;
          const isLower = TIER_ORDER[tier.id] < TIER_ORDER[currentTier];
          const affordable = balance >= tier.dotCost;
          const missingDots = Math.max(0, tier.dotCost - balance);
          const isPremiumBadge = tier.id === "pro" || tier.id === "institution";

          return (
            <article
              key={tier.id}
              className={cn(
                "surface-card flex flex-col justify-between rounded-3xl p-6 transition-all",
                tier.highlighted && "border-gold/50 ring-1 ring-gold/25",
                isCurrent && "border-primary/60 ring-1 ring-primary/30",
              )}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <PingMark
                      variant={tier.id === "free" ? "silver" : tier.id === "plus" ? "lime" : "gold"}
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
                      {tier.id === "institution" ? (
                        <ShieldCheck className="size-3" />
                      ) : tier.id === "pro" ? (
                        <Crown className="size-3" />
                      ) : (
                        <Sparkles className="size-3" />
                      )}
                      {tier.badge}
                    </span>
                  </div>
                  {isCurrent && (
                    <span className="rounded-full bg-lime/20 dark:bg-lime/15 px-2.5 py-0.5 text-[10px] font-bold text-lime-foreground dark:text-lime">
                      Active
                    </span>
                  )}
                </div>

                <h2 className="mt-4 font-display text-xl font-extrabold">{tier.name}</h2>
                <div className="mt-2 flex items-baseline gap-1.5">
                  <span className="font-display text-3xl font-extrabold tabular-nums">
                    {tier.dotCost === 0 ? "Free" : `${tier.dotCost} DOT`}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{tier.tagline}</p>

                <ul className="mt-5 space-y-2.5 border-t border-border/60 pt-4 text-xs">
                  {tier.perks.map((perk) => (
                    <li key={perk} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                      <span className="text-foreground/90">{perk}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-6">
                {isCurrent ? (
                  <Button disabled variant="outline" className="w-full rounded-full">
                    Current Plan
                  </Button>
                ) : tier.id === "free" || isLower ? (
                  <Button disabled variant="outline" className="w-full rounded-full">
                    Included
                  </Button>
                ) : affordable ? (
                  <Button
                    type="button"
                    variant={tier.highlighted ? "hero" : "default"}
                    disabled={upgradeMutation.isPending}
                    onClick={() =>
                      handleUpgrade(tier.id as Exclude<AccountTier, "free">, tier.name)
                    }
                    className="w-full rounded-full font-bold"
                  >
                    {upgradeMutation.isPending ? "Upgrading…" : `Unlock for ${tier.dotCost} DOT`}
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
    </div>
  );
}
