import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowLeft,
  BarChart3,
  Coins,
  Eye,
  Heart,
  MessageCircle,
  Radio,
  Sparkles,
  Users,
} from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { useAuth } from "@/lib/auth";
import { creatorAnalyticsQuery } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { PingMark } from "@/components/BrandLogo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/analytics")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Creator Analytics — Ping by DOT" },
      {
        name: "description",
        content: "Inspect your Pings, Moments, Hubs, and follower engagement telemetry.",
      },
    ],
  }),
  component: AnalyticsPage,
});

const RANGE_OPTIONS = [7, 30, 90] as const;

function AnalyticsPage() {
  const { user, profile } = useAuth();
  const [rangeDays, setRangeDays] = useState<(typeof RANGE_OPTIONS)[number]>(30);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const { data: analytics, isLoading } = useQuery(creatorAnalyticsQuery(user?.id, rangeDays));

  const totals = analytics?.totals;
  const kpis = [
    {
      label: "Pings Published",
      value: totals?.pingsCount ?? 0,
      icon: Sparkles,
      accent: "text-primary",
    },
    {
      label: "Likes Received",
      value: totals?.likesReceived ?? 0,
      icon: Heart,
      accent: "text-blush-foreground",
    },
    {
      label: "Replies Received",
      value: totals?.commentsReceived ?? 0,
      icon: MessageCircle,
      accent: "text-foreground",
    },
    {
      label: "Followers",
      value: totals?.followersCount ?? 0,
      sub: `${totals?.followingCount ?? 0} following`,
      icon: Users,
      accent: "text-gold",
    },
    {
      label: "Moments Shared",
      value: totals?.momentsCount ?? 0,
      sub: `${totals?.momentViews ?? 0} views`,
      icon: Eye,
      accent: "text-primary",
    },
    {
      label: "Avg Engagement / Ping",
      value: totals?.avgEngagementPerPing ?? 0,
      icon: BarChart3,
      accent: "text-gold",
    },
    {
      label: "Active Hubs",
      value: totals?.hubsJoined ?? 0,
      icon: Users,
      accent: "text-foreground",
    },
    {
      label: "Signals Tuned",
      value: totals?.signalsSubscribed ?? 0,
      icon: Radio,
      accent: "text-primary",
    },
  ];

  const maxCategoryCount = Math.max(
    1,
    ...(analytics?.categoryBreakdown.map((c) => c.count) ?? [1]),
  );

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 pb-24">
      {/* Header */}
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
          <PingMark variant="lime" size="md" />
          <div>
            <h1 className="font-display text-3xl font-extrabold tracking-tight">
              Creator Analytics
            </h1>
            <p className="text-sm text-muted-foreground">
              Performance across your Pings, Moments, Community Hubs, and Signal channels.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full border border-border bg-secondary/60 p-1">
            {RANGE_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setRangeDays(days)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                  rangeDays === days
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {days}d
              </button>
            ))}
          </div>
          <Button asChild variant="outline" size="sm" className="rounded-full">
            <Link to="/balance">
              <Coins className="size-4" />
              DOT Balance
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI Grid */}
      <section className="mt-7 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        {kpis.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="surface-card rounded-3xl p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">{item.label}</span>
                <Icon className={cn("size-4 shrink-0", item.accent)} />
              </div>
              <p className="mt-2.5 font-display text-2xl sm:text-3xl font-extrabold tabular-nums">
                {isLoading ? "…" : item.value.toLocaleString()}
              </p>
              {item.sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{item.sub}</p>}
            </div>
          );
        })}
      </section>

      {/* Engagement Trend Chart */}
      <section className="surface-card mt-6 rounded-[2rem] p-6 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-bold">Daily Engagement ({rangeDays} days)</h2>
            <p className="text-xs text-muted-foreground">
              Likes and replies generated on Pings published in this window.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-primary" /> Likes
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-gold" /> Replies
            </span>
          </div>
        </div>

        <div className="mt-5 h-64 w-full">
          {mounted && analytics ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={analytics.dailySeries}
                margin={{ top: 10, right: 12, left: -18, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.6} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={18}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--popover)",
                    borderColor: "var(--border)",
                    borderRadius: "1rem",
                    color: "var(--popover-foreground)",
                    fontSize: "12px",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="likes"
                  name="Likes"
                  stroke="var(--primary)"
                  fill="var(--primary)"
                  fillOpacity={0.22}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="replies"
                  name="Replies"
                  stroke="var(--gold)"
                  fill="var(--gold)"
                  fillOpacity={0.18}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full animate-pulse rounded-2xl bg-muted/40" />
          )}
        </div>
      </section>

      {/* Bottom Split: Category Breakdown + Top Pings */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="surface-card rounded-3xl p-6">
          <h2 className="font-display text-lg font-bold">Category Breakdown</h2>
          <p className="text-xs text-muted-foreground">
            Distribution of your Pings across builder categories.
          </p>

          {!analytics?.categoryBreakdown.length ? (
            <p className="mt-6 text-sm text-muted-foreground">
              No Pings published in the last {rangeDays} days.
            </p>
          ) : (
            <div className="mt-5 space-y-4">
              {analytics.categoryBreakdown.map((item) => {
                const widthPct = Math.max(8, Math.round((item.count / maxCategoryCount) * 100));
                return (
                  <div key={item.category}>
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span>
                        {item.emoji} {item.label}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {item.count} {item.count === 1 ? "Ping" : "Pings"} · {item.engagement}{" "}
                        interactions
                      </span>
                    </div>
                    <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="surface-card rounded-3xl p-6">
          <h2 className="font-display text-lg font-bold">Top Performing Pings</h2>
          <p className="text-xs text-muted-foreground">Sorted by combined likes and replies.</p>

          {!analytics?.topPings.length ? (
            <div className="mt-6">
              <p className="text-sm text-muted-foreground">
                Share your first Ping to start tracking engagement here.
              </p>
              <Button asChild variant="hero" size="sm" className="mt-4 rounded-full">
                <Link to="/create">Create a Ping</Link>
              </Button>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {analytics.topPings.map((ping) => (
                <Link
                  key={ping.id}
                  to="/p/$id"
                  params={{ id: ping.id }}
                  className="block rounded-2xl border border-border/70 bg-background/50 p-3.5 transition-colors hover:bg-secondary/60"
                >
                  <p className="text-sm font-medium text-foreground line-clamp-2">{ping.content}</p>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span className="capitalize">{ping.category}</span>
                    <span className="flex items-center gap-3 tabular-nums">
                      <span>♥ {ping.likes}</span>
                      <span>💬 {ping.replies}</span>
                      <span>{formatDistanceToNowStrict(new Date(ping.created_at))} ago</span>
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
