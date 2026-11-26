import {
  createFileRoute,
  Link,
  Outlet,
  useChildMatches,
  useNavigate,
} from "@tanstack/react-router";
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
  recentSignalBroadcastsQuery,
  useSignalFollow,
  type Signal,
  type SignalInstitutionType,
} from "@/lib/signals";
import { InboxSectionTabs } from "@/components/inbox/InboxSectionTabs";
import { ResolvedMomentThumb } from "@/components/media/ResolvedPrivateMedia";
import { QueryErrorCard } from "@/components/QueryErrorCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { pageHead } from "@/lib/site";

interface SignalsSearchParams {
  category?: string | undefined;
  q?: string | undefined;
  conversationId?: string | undefined;
  userId?: string | undefined;
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
  { value: "community", label: "Communities", icon: Users },
  { value: "other", label: "Other", icon: Radio },
];

export const Route = createFileRoute("/signals")({
  staticData: { sitemap: true },
  validateSearch: (search: Record<string, unknown>): SignalsSearchParams => ({
    category: typeof search["category"] === "string" ? (search["category"] as string) : undefined,
    q: typeof search["q"] === "string" ? (search["q"] as string) : undefined,
    conversationId:
      typeof search["conversationId"] === "string"
        ? (search["conversationId"] as string)
        : undefined,
    userId: typeof search["userId"] === "string" ? (search["userId"] as string) : undefined,
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
  latestBroadcast,
  currentUserId,
}: {
  signal: Signal;
  isFollowing: boolean;
  latestBroadcast?: { id: string; title: string; content: string; created_at: string } | undefined;
  currentUserId?: string | undefined;
}) {
  const followMutation = useSignalFollow(signal.id, currentUserId);

  const handleToggleSubscribe = () => {
    if (!currentUserId) {
      toast.error("Please log in to subscribe to institutional Signals.");
      return;
    }
    followMutation.mutate(undefined, {
      onSuccess: (res) => {
        toast.success(
          res.following ? `Subscribed to ${signal.name}` : `Unsubscribed from ${signal.name}`,
        );
      },
      onError: (err: any) => {
        toast.error(err?.message || "Could not update subscription.");
      },
    });
  };

  return (
    <article className="surface-card lift relative flex flex-col justify-between rounded-3xl p-5 sm:p-6 border border-border/80 hover:border-primary/40 transition-all">
      <div>
        <header className="flex items-start gap-3">
          {signal.avatar_url ? (
            <ResolvedMomentThumb
              mediaUrl={signal.avatar_url}
              mediaType="image"
              alt={signal.name}
              className="size-12 rounded-2xl object-cover shrink-0 border border-border/50"
              fallback={
                <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary font-bold text-lg">
                  <Radio className="size-6" />
                </div>
              }
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
            <p className="mt-0.5 text-xs text-muted-foreground capitalize">
              {signal.institution_type.replace("_", " ")} · @{signal.slug}
            </p>
          </div>
        </header>

        {(signal.tagline || signal.description) && (
          <p className="mt-3 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {signal.tagline || signal.description}
          </p>
        )}

        {latestBroadcast && (
          <div className="mt-3 rounded-2xl bg-secondary/45 border border-border/50 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
              Latest Broadcast
            </p>
            <p className="mt-0.5 text-xs font-semibold text-foreground line-clamp-1">
              {latestBroadcast.title}
            </p>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
          <span className="inline-flex items-center gap-1">
            <Users className="size-3.5" />
            <strong className="text-foreground">
              {(signal.follower_count ?? 0).toLocaleString()}
            </strong>{" "}
            subscribers
          </span>
          {typeof signal.post_count === "number" && (
            <>
              <span>·</span>
              <span>
                {signal.post_count} {signal.post_count === 1 ? "broadcast" : "broadcasts"}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="mt-5 pt-3 border-t border-border/60 flex items-center justify-between gap-2">
        <Button asChild variant="outline" size="sm" className="w-full rounded-2xl">
          <Link to="/signals/$slug" params={{ slug: signal.slug }}>
            Open Channel
          </Link>
        </Button>
        <Button
          type="button"
          variant={isFollowing ? "secondary" : "hero"}
          size="sm"
          disabled={followMutation.isPending}
          onClick={handleToggleSubscribe}
          className="w-full rounded-2xl gap-1.5"
        >
          {isFollowing ? (
            <>
              <BellOff className="size-3.5" />
              Subscribed
            </>
          ) : (
            <>
              <Bell className="size-3.5" />
              Subscribe
            </>
          )}
        </Button>
      </div>
    </article>
  );
}

export function SignalsDirectorySection({
  embeddedInInbox = false,
  initialCategory,
  initialQuery,
}: {
  embeddedInInbox?: boolean;
  initialCategory?: string | undefined;
  initialQuery?: string | undefined;
}) {
  const { user } = useAuth();
  const [searchInput, setSearchInput] = useState(initialQuery ?? "");
  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategory || "all");
  const deferredSearch = useDeferredValue(searchInput.trim());

  useEffect(() => {
    if (initialCategory !== undefined) {
      setSelectedCategory(initialCategory || "all");
    }
  }, [initialCategory]);

  useEffect(() => {
    if (initialQuery !== undefined) {
      setSearchInput(initialQuery);
    }
  }, [initialQuery]);

  const {
    data: signals = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery(signalsQuery({ search: deferredSearch, category: selectedCategory }));

  const { data: followedSignalIds = new Set<string>() } = useQuery(
    myFollowedSignalsQuery(user?.id),
  );
  const { data: recentBroadcasts = {} } = useQuery(recentSignalBroadcastsQuery());

  const followedSignals = signals.filter((s) => followedSignalIds.has(s.id));

  return (
    <section
      aria-label="Institutional Signal Channels"
      data-signals-broadcast-only="true"
      className={cn(
        "w-full min-w-0 space-y-6",
        !embeddedInInbox && "mx-auto max-w-6xl px-4 sm:px-6 py-4 sm:py-8 pb-32 sm:pb-24",
      )}
    >
      {/* Hero Banner */}
      <header className="relative overflow-hidden rounded-[2rem] bg-hero p-5 sm:p-9 border border-border">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-gold/15 text-gold border border-gold/30 px-3 py-1 text-xs font-bold mb-3">
              <Radio className="size-3.5" /> Official Institutional Broadcasts
            </div>
            <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-4xl">
              Signals
            </h2>
            <p className="mt-1.5 max-w-2xl text-xs sm:text-sm text-muted-foreground">
              Subscribe to official broadcast channels from universities, companies, incubators,
              public agencies, and verified organizations for announcements, bulletins, and alerts.
            </p>
          </div>
          <Button asChild variant="hero" size="sm" className="rounded-full gap-1.5 shrink-0 self-start sm:self-auto">
            <Link to="/signals/create">
              <Plus className="size-4" /> Register Signal Channel
            </Link>
          </Button>
        </div>
      </header>

      {/* Search & Institutional Category Filter */}
      <div className="space-y-3 sm:space-y-4">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search institutional Signal channels…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search institutional Signal channels"
            className="h-11 rounded-full pl-10 pr-4 bg-card"
          />
        </div>

        <nav
          className="flex max-w-full min-w-0 gap-2 overflow-x-auto pb-1 scrollbar-none"
          aria-label="Filter Signal channels by institution type"
        >
          {SIGNAL_CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            return (
              <button
                key={cat.value}
                type="button"
                onClick={() => setSelectedCategory(cat.value)}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-semibold transition-colors",
                  selectedCategory === cat.value
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card hover:bg-secondary",
                )}
              >
                <Icon className="size-3.5" />
                {cat.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Subscribed Signals Strip */}
      {followedSignals.length > 0 && selectedCategory === "all" && !deferredSearch && (
        <section aria-label="Subscribed Signals">
          <h3 className="font-display text-base font-bold mb-3 flex items-center gap-2">
            <Bell className="size-4 text-primary" /> Subscribed Signals ({followedSignals.length})
          </h3>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
            {followedSignals.map((sig) => (
              <Link
                key={sig.id}
                to="/signals/$slug"
                params={{ slug: sig.slug }}
                className="surface-card shrink-0 flex items-center gap-3 rounded-2xl p-3 pr-5 hover:border-primary transition-colors"
              >
                <div className="flex size-9 items-center justify-center rounded-xl bg-primary/15 text-primary font-bold text-sm overflow-hidden">
                  {sig.avatar_url ? (
                    <ResolvedMomentThumb
                      mediaUrl={sig.avatar_url}
                      mediaType="image"
                      alt={sig.name}
                      className="size-full object-cover"
                      fallback={<Radio className="size-4" />}
                    />
                  ) : (
                    <Radio className="size-4" />
                  )}
                </div>
                <div>
                  <p className="font-display font-bold text-sm flex items-center gap-1">
                    {sig.name}
                    {sig.verified && <CheckCircle className="size-3.5 text-gold" />}
                  </p>
                  <p className="text-[11px] text-muted-foreground capitalize">
                    {sig.institution_type.replace("_", " ")}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Institutional Channels Grid */}
      {isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="surface-card h-56 animate-pulse rounded-3xl p-6" />
          ))}
        </div>
      ) : isError ? (
        <QueryErrorCard
          title="Couldn't load Signal channels"
          description="Unable to load the institutional Signal directory right now."
          error={error}
          onRetry={() => void refetch()}
        />
      ) : signals.length > 0 ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {signals.map((sig) => (
            <SignalCard
              key={sig.id}
              signal={sig}
              isFollowing={followedSignalIds.has(sig.id)}
              latestBroadcast={recentBroadcasts[sig.id]}
              currentUserId={user?.id}
            />
          ))}
        </div>
      ) : (
        <div className="surface-card mx-auto max-w-lg rounded-3xl p-6 sm:p-10 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-gold/15 text-gold">
            <Radio className="size-7" />
          </div>
          <h3 className="mt-4 font-display text-xl font-bold">
            {deferredSearch || selectedCategory !== "all"
              ? "No matching Signal channels"
              : "No official Signal channels registered yet"}
          </h3>
          <p className="mt-2 text-xs text-muted-foreground">
            {deferredSearch || selectedCategory !== "all"
              ? "Try adjusting your search query or institution filter."
              : "Establish an institutional Signal channel to publish verified announcements and broadcasts."}
          </p>
          <Button asChild variant="hero" className="mt-5 rounded-full">
            <Link to="/signals/create">Register Signal Channel</Link>
          </Button>
        </div>
      )}
    </section>
  );
}

function SignalsDirectoryRoutePage() {
  const { category, q, conversationId, userId } = Route.useSearch();
  const navigate = useNavigate();

  // Preserve compatibility for legacy deep links that previously opened 1-on-1 chats via /signals?conversationId=...
  useEffect(() => {
    if (conversationId || userId) {
      navigate({
        to: "/inbox",
        search: {
          section: "chats",
          ...(conversationId ? { conversationId } : {}),
          ...(userId ? { userId } : {}),
        },
        replace: true,
      });
    }
  }, [conversationId, userId, navigate]);

  if (conversationId || userId) {
    return null;
  }

  return (
    <div className="mx-auto max-w-6xl w-full min-w-0 px-4 sm:px-6 pt-4 pb-32 sm:pb-24 space-y-5 overflow-x-clip">
      <InboxSectionTabs activeSection="signals" />
      <SignalsDirectorySection embeddedInInbox initialCategory={category} initialQuery={q} />
    </div>
  );
}
