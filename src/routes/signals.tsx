import { createFileRoute, Link, Outlet, useChildMatches } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useDeferredValue, useEffect } from "react";
import {
  Radio,
  Plus,
  CheckCircle,
  Search,
  Building,
  GraduationCap,
  Briefcase,
  Globe,
  Users,
  Bell,
  BellOff,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  signalsQuery,
  myFollowedSignalsQuery,
  useSignalFollow,
  type Signal,
  type SignalInstitutionType,
} from "@/lib/signals";
import { InboxSectionTabs } from "@/components/inbox/InboxSectionTabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { pageHead } from "@/lib/site";

interface SignalsSearchParams {
  category?: string | undefined;
  q?: string | undefined;
}

const SIGNAL_CATEGORIES: Array<{
  value: SignalInstitutionType | "all";
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: "all", label: "All Channels", icon: Radio },
  { value: "university", label: "Universities", icon: GraduationCap },
  { value: "company", label: "Companies", icon: Building },
  { value: "incubator", label: "Incubators & VCs", icon: Briefcase },
  { value: "government", label: "Government & Public", icon: Globe },
  { value: "organization", label: "Organizations & NGOs", icon: Building },
  { value: "association", label: "Associations", icon: Users },
];

export const Route = createFileRoute("/signals")({
  staticData: { sitemap: true },
  validateSearch: (search: Record<string, unknown>): SignalsSearchParams => ({
    category: typeof search["category"] === "string" ? (search["category"] as string) : undefined,
    q: typeof search["q"] === "string" ? (search["q"] as string) : undefined,
  }),
  head: () =>
    pageHead({
      title: "Signals — Institutional Broadcast Channels on PING",
      description:
        "Follow verified institutional broadcast channels from universities, companies, incubators, public agencies, and organizations on PING.",
      path: "/signals",
    }),
  component: SignalsLayout,
});

function SignalsLayout() {
  const childMatches = useChildMatches();
  if (childMatches.length > 0) return <Outlet />;
  return <SignalsDirectoryRoutePage />;
}

function SignalCard({
  signal,
  isFollowing,
  currentUserId,
}: {
  signal: Signal;
  isFollowing: boolean;
  currentUserId?: string | undefined;
}) {
  const followMutation = useSignalFollow(signal.id, currentUserId);

  const handleToggleSubscribe = () => {
    if (!currentUserId) {
      toast.error("Please log in to subscribe to institutional Signals.");
      return;
    }
    followMutation.mutate();
  };

  return (
    <article className="surface-card lift relative flex flex-col justify-between rounded-3xl p-5 sm:p-6 transition-all">
      <div>
        <header className="flex items-start gap-3">
          {signal.avatar_url ? (
            <img
              src={signal.avatar_url}
              alt={signal.name}
              className="size-12 rounded-2xl object-cover shrink-0 border border-border/50"
            />
          ) : (
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary font-bold text-lg">
              <Radio className="size-6" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Link
                to="/signals/$slug"
                params={{ slug: signal.slug }}
                className="font-display text-lg font-bold hover:underline truncate"
              >
                {signal.name}
              </Link>
              {signal.verified && (
                <span
                  title="Verified Institutional Channel"
                  className="inline-flex items-center gap-1 rounded-full bg-gold/15 text-gold border border-gold/30 px-2 py-0.5 text-[10px] font-bold"
                >
                  <CheckCircle className="size-3" />
                  Verified
                </span>
              )}
            </div>
            {(signal.tagline || signal.description) && (
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                {signal.tagline || signal.description}
              </p>
            )}
          </div>
        </header>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold capitalize">
            {signal.institution_type.replace(/_/g, " ")}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {(signal.follower_count ?? 0).toLocaleString()}{" "}
            {signal.follower_count === 1 ? "subscriber" : "subscribers"}
          </span>
        </div>
      </div>

      <div className="mt-5 border-t border-border/60 pt-4 flex items-center justify-between gap-2">
        <Button asChild size="sm" variant="outline" className="rounded-xl flex-1">
          <Link to="/signals/$slug" params={{ slug: signal.slug }}>
            View Broadcasts
          </Link>
        </Button>
        <Button
          type="button"
          size="sm"
          variant={isFollowing ? "secondary" : "hero"}
          disabled={followMutation.isPending}
          onClick={handleToggleSubscribe}
          className="rounded-xl gap-1.5 flex-1"
        >
          {isFollowing ? (
            <>
              <BellOff className="size-3.5" /> Subscribed
            </>
          ) : (
            <>
              <Bell className="size-3.5" /> Subscribe
            </>
          )}
        </Button>
      </div>
    </article>
  );
}

export interface SignalsDirectorySectionProps {
  embeddedInInbox?: boolean | undefined;
  initialCategory?: string | undefined;
  initialQuery?: string | undefined;
}

export function SignalsDirectorySection({
  embeddedInInbox = false,
  initialCategory,
  initialQuery,
}: SignalsDirectorySectionProps) {
  const { user } = useAuth();
  const [search, setSearch] = useState(initialQuery ?? "");
  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategory ?? "all");

  useEffect(() => {
    setSelectedCategory(initialCategory ?? "all");
  }, [initialCategory]);

  const deferredSearch = useDeferredValue(search);

  const { data: signals = [], isLoading } = useQuery(
    signalsQuery({
      search: deferredSearch,
      ...(selectedCategory !== "all" ? { category: selectedCategory } : {}),
    }),
  );
  const { data: followedIds = new Set<string>() } = useQuery(myFollowedSignalsQuery(user?.id));

  const subscribedSignals = signals.filter((s) => followedIds.has(s.id));

  return (
    <div className="space-y-8">
      {!embeddedInInbox && <InboxSectionTabs activeSection="signals" />}

      {/* Institutional Broadcasting Hero */}
      <div className="relative overflow-hidden rounded-[2rem] bg-hero p-6 sm:p-10 border border-border flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-gold/15 text-gold border border-gold/30 px-3 py-1 text-xs font-bold mb-3">
            <Radio className="size-3.5" /> Institutional Broadcasting
          </div>
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
            Signals
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Official broadcast channels from verified universities, companies, incubators,
            government agencies, and institutions. Subscribe to receive announcements, news, and
            urgent bulletins.
          </p>
        </div>

        <Button asChild variant="hero" size="sm" className="rounded-full shrink-0 gap-1.5">
          <Link to="/signals/create">
            <Plus className="size-4" />
            Register Signal
          </Link>
        </Button>
      </div>

      {/* Controls: Search & Institution Category Pills */}
      <div className="flex flex-col gap-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search institutional Signals by name or keyword…"
            className="pl-10 rounded-full h-11 bg-card"
            aria-label="Search institutional Signals"
          />
        </div>

        <div
          className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none"
          role="tablist"
          aria-label="Filter Signals by institution type"
        >
          {SIGNAL_CATEGORIES.map((c) => {
            const Icon = c.icon;
            const isSelected = selectedCategory === c.value;
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => setSelectedCategory(c.value)}
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-4 py-2 text-xs font-semibold transition-all",
                  isSelected
                    ? "border-foreground bg-foreground text-background shadow-sm"
                    : "border-border bg-card text-foreground hover:bg-secondary",
                )}
              >
                <Icon className="size-3.5" />
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Subscribed Signals Strip */}
      {subscribedSignals.length > 0 && selectedCategory === "all" && !deferredSearch && (
        <section>
          <h3 className="font-display text-lg font-bold mb-3 flex items-center gap-2">
            <Bell className="size-4 text-primary" /> Subscribed Channels
          </h3>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {subscribedSignals.map((sig) => (
              <Link
                key={sig.id}
                to="/signals/$slug"
                params={{ slug: sig.slug }}
                className="surface-card shrink-0 flex items-center gap-3 rounded-2xl p-3.5 pr-5 hover:border-primary transition-colors"
              >
                {sig.avatar_url ? (
                  <img
                    src={sig.avatar_url}
                    alt={sig.name}
                    className="size-9 rounded-xl object-cover border border-border/50"
                  />
                ) : (
                  <div className="flex size-9 items-center justify-center rounded-xl bg-primary/15 text-primary font-bold text-sm">
                    <Radio className="size-4" />
                  </div>
                )}
                <div>
                  <p className="font-display font-bold text-sm flex items-center gap-1">
                    <span>{sig.name}</span>
                    {sig.verified && <CheckCircle className="size-3.5 text-gold" />}
                  </p>
                  <p className="text-[11px] text-muted-foreground capitalize">
                    {sig.institution_type.replace(/_/g, " ")}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Results */}
      <div>
        {isLoading ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-52 rounded-3xl bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : signals.length === 0 ? (
          <div className="surface-card mx-auto max-w-lg rounded-3xl p-10 text-center">
            <Radio className="mx-auto size-12 text-muted-foreground/40" />
            <h3 className="mt-4 font-display text-xl font-bold">No Signals found</h3>
            <p className="mt-1 text-xs sm:text-sm text-muted-foreground max-w-sm mx-auto">
              {search
                ? `No institutional Signals matched "${search}". Try another keyword or institution category.`
                : "No institutional Signal channels have been registered in this category yet."}
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              {search && (
                <Button variant="outline" onClick={() => setSearch("")} className="rounded-full">
                  Clear search
                </Button>
              )}
              <Button asChild variant="hero" className="rounded-full">
                <Link to="/signals/create">Register Institutional Signal</Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {signals.map((sig) => (
              <SignalCard
                key={sig.id}
                signal={sig}
                isFollowing={followedIds.has(sig.id)}
                currentUserId={user?.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SignalsDirectoryRoutePage() {
  const { category, q } = Route.useSearch();

  return (
    <div className="mx-auto max-w-6xl w-full min-w-0 px-4 sm:px-6 py-6 pb-24 overflow-x-clip">
      <SignalsDirectorySection initialCategory={category} initialQuery={q} />
    </div>
  );
}
