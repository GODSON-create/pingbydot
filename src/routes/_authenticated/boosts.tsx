import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import {
  BarChart3,
  Clock,
  Coins,
  Eye,
  Info,
  Megaphone,
  MousePointerClick,
  Pause,
  Play,
  Plus,
  Sparkles,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { dotSummaryQuery } from "@/lib/economy";
import { myBoostCampaignsQuery, useUpdateMyBoostStatus, type BoostCampaign } from "@/lib/boosts";
import { userActiveMomentsQuery } from "@/lib/moments";
import { supabase } from "@/integrations/supabase/client";
import { BoostContentDialog, type BoostTargetItem } from "@/components/boost/BoostContentDialog";
import { EmptyStateCard, LoadingSkeletonStack } from "@/components/ui/state-views";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/boosts")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Boost Campaigns — Ping by DOT" },
    ],
  }),
  component: BoostCampaignsDashboard,
});

function BoostCampaignsDashboard() {
  const { user } = useAuth();
  const { data: dotSummary } = useQuery(dotSummaryQuery(user?.id));
  const { data: campaignsState, isLoading } = useQuery(myBoostCampaignsQuery(user?.id));
  const { data: myMoments = [] } = useQuery(userActiveMomentsQuery(user?.id ?? "", user?.id));
  const updateStatus = useUpdateMyBoostStatus();

  const { data: myPings = [] } = useQuery({
    queryKey: ["boost-eligible-pings", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      if (!user?.id) return [];
      const { data } = await supabase
        .from("pings")
        .select("id, content, category, created_at")
        .eq("user_id", user.id)
        .is("hidden_at", null)
        .order("created_at", { ascending: false })
        .limit(12);
      return (data ?? []) as Array<{
        id: string;
        content: string;
        category: string;
        created_at: string;
      }>;
    },
  });

  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<BoostTargetItem | null>(null);

  const campaigns = campaignsState?.campaigns ?? [];
  const totalSpent = campaigns.reduce((sum, c) => sum + c.dot_cost, 0);
  const totalImpressions = campaigns.reduce((sum, c) => sum + c.impressions_count, 0);
  const totalReach = campaigns.reduce((sum, c) => sum + c.reach_count, 0);
  const totalClicks = campaigns.reduce((sum, c) => sum + c.clicks_count, 0);
  const totalEngagement = campaigns.reduce((sum, c) => sum + c.engagement_count, 0);

  const handleStatusChange = (c: BoostCampaign, nextStatus: "active" | "paused" | "cancelled") => {
    updateStatus.mutate(
      { campaignId: c.id, status: nextStatus },
      {
        onSuccess: () => toast.success(`Campaign ${nextStatus}`),
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Could not update campaign status."),
      },
    );
  };

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 pb-24 space-y-6">
      <header className="surface-card rounded-3xl p-6 sm:p-8 border border-border/70 flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
            <Megaphone className="size-3.5" /> DOT Content Promotion
          </span>
          <h1 className="mt-2 font-display text-2xl sm:text-3xl font-extrabold">
            Boost Campaign Manager
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-muted-foreground max-w-xl">
            Promote eligible public Pings and active public Moments using DOT credits. Every metric
            below reflects verified observed events — zero fabricated numbers.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm" className="rounded-full text-xs gap-1.5">
            <Link to="/balance">
              <Coins className="size-3.5 text-gold" />
              <span className="tabular-nums font-bold">
                {(dotSummary?.wallet.balance ?? 0).toLocaleString()} DOT
              </span>
            </Link>
          </Button>
          <Button
            type="button"
            variant="hero"
            size="sm"
            onClick={() => setPickerOpen((v) => !v)}
            className="rounded-full text-xs gap-1.5"
          >
            <Plus className="size-3.5" /> New Boost Campaign
          </Button>
        </div>
      </header>

      {campaignsState && !campaignsState.migrated && (
        <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-4 text-xs flex items-start gap-2.5">
          <Info className="size-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-muted-foreground">
            <strong className="text-foreground">Migration 0033 Pending:</strong> Server-verified DOT
            boost debits and observed event logging activate automatically once migration{" "}
            <code>0033</code> is applied to Supabase.
          </p>
        </div>
      )}

      {/* Content Picker to Launch a Boost */}
      {pickerOpen && (
        <section className="surface-card rounded-3xl p-6 border border-primary/30 space-y-4">
          <h2 className="font-display text-base font-bold">
            1. Select Eligible Content to Promote
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Your Recent Public Pings ({myPings.length})
              </p>
              {myPings.length === 0 ? (
                <p className="text-xs text-muted-foreground">Publish a public Ping first.</p>
              ) : (
                myPings.slice(0, 5).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() =>
                      setSelectedTarget({
                        contentType: "ping",
                        contentId: p.id,
                        previewText: p.content,
                      })
                    }
                    className="w-full rounded-2xl border border-border/70 bg-secondary/35 hover:bg-secondary p-3 text-left text-xs transition-colors"
                  >
                    <p className="line-clamp-2 text-foreground font-medium">{p.content}</p>
                    <p className="mt-1 text-[10px] text-primary font-semibold">
                      Select Ping to Boost →
                    </p>
                  </button>
                ))
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Your Active Public Moments (
                {myMoments.filter((m) => m.audience === "public").length})
              </p>
              {myMoments.filter((m) => m.audience === "public").length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No active public Moments right now (Close Circle Moments are ineligible).
                </p>
              ) : (
                myMoments
                  .filter((m) => m.audience === "public")
                  .slice(0, 5)
                  .map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() =>
                        setSelectedTarget({
                          contentType: "moment",
                          contentId: m.id,
                          previewText: m.caption || "Public Moment",
                          momentExpiresAt: m.expires_at,
                          momentAudience: m.audience,
                        })
                      }
                      className="w-full rounded-2xl border border-border/70 bg-secondary/35 hover:bg-secondary p-3 text-left text-xs transition-colors"
                    >
                      <p className="line-clamp-1 text-foreground font-medium">
                        {m.caption || "Public Photo/Video Moment"}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        Expires {formatDistanceToNowStrict(new Date(m.expires_at))} from now
                      </p>
                    </button>
                  ))
              )}
            </div>
          </div>
        </section>
      )}

      {/* KPI Summary Strip */}
      <section className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        {[
          { label: "DOT Spent", value: `${totalSpent} DOT`, icon: Coins },
          { label: "Observed Impressions", value: totalImpressions.toLocaleString(), icon: Eye },
          { label: "Unique Reach", value: totalReach.toLocaleString(), icon: Users },
          {
            label: "Observed Clicks",
            value: totalClicks.toLocaleString(),
            icon: MousePointerClick,
          },
          { label: "Engagement", value: totalEngagement.toLocaleString(), icon: Sparkles },
        ].map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.label}
              className="surface-card rounded-2xl p-4 border border-border/70 space-y-1"
            >
              <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                <Icon className="size-3.5 text-primary" /> {kpi.label}
              </span>
              <p className="font-display text-xl font-extrabold tabular-nums">{kpi.value}</p>
            </div>
          );
        })}
      </section>

      {/* Campaign List */}
      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold flex items-center gap-2">
          <BarChart3 className="size-5 text-primary" /> Your Campaigns ({campaigns.length})
        </h2>

        {isLoading ? (
          <LoadingSkeletonStack rows={3} heightClass="h-28" label="Loading boost campaigns" />
        ) : campaigns.length === 0 ? (
          <EmptyStateCard
            icon={<Megaphone className="size-6" />}
            title="No boost campaigns yet"
            description="Select any eligible public Ping or active public Moment to configure a transparent DOT-powered promotion."
            action={
              <Button
                type="button"
                variant="hero"
                size="sm"
                onClick={() => setPickerOpen(true)}
                className="rounded-full text-xs"
              >
                Create Your First Boost
              </Button>
            }
          />
        ) : (
          campaigns.map((camp) => (
            <article
              key={camp.id}
              className="surface-card rounded-3xl p-5 border border-border/70 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                        camp.status === "active"
                          ? "bg-primary/15 text-primary"
                          : camp.status === "paused"
                            ? "bg-amber-500/15 text-amber-500"
                            : camp.status === "refunded"
                              ? "bg-gold/15 text-gold"
                              : "bg-secondary text-muted-foreground",
                      )}
                    >
                      {camp.status}
                    </span>
                    <span className="text-xs font-bold uppercase text-muted-foreground">
                      {camp.content_type}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {camp.receipt_number}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground flex items-center gap-1.5">
                    <Clock className="size-3.5" /> {camp.duration_hours}h · {camp.dot_cost} DOT ·
                    Audience: {camp.audience.replace(/_/g, " ")}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  {camp.content_type === "ping" && (
                    <Button asChild size="sm" variant="outline" className="rounded-full text-xs">
                      <Link to="/p/$id" params={{ id: camp.content_id }}>
                        View Ping
                      </Link>
                    </Button>
                  )}
                  {camp.status === "active" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => handleStatusChange(camp, "paused")}
                      className="rounded-full text-xs gap-1"
                    >
                      <Pause className="size-3" /> Pause
                    </Button>
                  )}
                  {camp.status === "paused" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => handleStatusChange(camp, "active")}
                      className="rounded-full text-xs gap-1"
                    >
                      <Play className="size-3" /> Resume
                    </Button>
                  )}
                  {(camp.status === "active" || camp.status === "paused") && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleStatusChange(camp, "cancelled")}
                      className="rounded-full text-xs text-destructive gap-1"
                    >
                      <XCircle className="size-3" /> Stop
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 pt-2 border-t border-border/50 text-xs">
                <div>
                  <span className="text-[10px] text-muted-foreground block">Impressions</span>
                  <span className="font-bold tabular-nums">{camp.impressions_count}</span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block">Reach</span>
                  <span className="font-bold tabular-nums">{camp.reach_count}</span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block">Clicks</span>
                  <span className="font-bold tabular-nums">{camp.clicks_count}</span>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground block">Engagement</span>
                  <span className="font-bold tabular-nums">{camp.engagement_count}</span>
                </div>
              </div>

              {camp.moderation_note && (
                <p className="text-[11px] rounded-xl bg-secondary/45 px-3 py-2 text-muted-foreground">
                  Moderation note: {camp.moderation_note}
                </p>
              )}
            </article>
          ))
        )}
      </section>

      <BoostContentDialog
        open={Boolean(selectedTarget)}
        onOpenChange={(open) => {
          if (!open) setSelectedTarget(null);
        }}
        target={selectedTarget}
      />
    </div>
  );
}
