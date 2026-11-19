import { useDeferredValue, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  CheckCircle,
  MessageSquare,
  Plus,
  Radio,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QueryErrorCard } from "@/components/QueryErrorCard";
import { signalsQuery } from "@/lib/signals";
import { pageHead } from "@/lib/site";
import { cn } from "@/lib/utils";

const SIGNAL_CATEGORY_FILTERS = [
  { value: "all", label: "All Channels" },
  { value: "university", label: "Universities" },
  { value: "company", label: "Companies" },
  { value: "incubator", label: "Incubators" },
  { value: "government", label: "Government" },
  { value: "organization", label: "Organizations" },
  { value: "community", label: "Communities" },
  { value: "other", label: "Other" },
] as const;

export const Route = createFileRoute("/signals/channels")({
  staticData: { sitemap: true },
  head: () =>
    pageHead({
      title: "Institutional Signal Channels — PING",
      description:
        "Browse verified institutional broadcast channels, universities, companies, incubators, and organizations on PING.",
      path: "/signals/channels",
    }),
  component: SignalChannelsDirectory,
});

function SignalChannelsDirectory() {
  const [searchInput, setSearchInput] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const deferredSearch = useDeferredValue(searchInput.trim());

  const {
    data: signals = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery(signalsQuery({ search: deferredSearch, category: selectedCategory }));

  return (
    <div className="mx-auto max-w-6xl w-full min-w-0 px-4 sm:px-6 py-8 pb-24 overflow-x-clip">
      {/* Community + Channel Navigation Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex lg:hidden max-w-full flex-nowrap overflow-x-auto scrollbar-none items-center gap-1 rounded-full bg-secondary/80 p-1">
          <Link
            to="/hubs"
            search={{}}
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <Building2 className="size-3.5" /> Hub
          </Link>
          <Link
            to="/signals"
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <MessageSquare className="size-3.5" /> Signal
          </Link>
          <Link
            to="/signals/channels"
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-foreground text-background shadow-sm px-3 py-1.5 text-xs font-semibold transition-colors"
          >
            <Radio className="size-3.5" /> Channels
          </Link>
          <Link
            to="/hubs"
            search={{ view: "moments" }}
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <Sparkles className="size-3.5" /> Moment
          </Link>
        </div>

        <Button asChild variant="hero" size="sm" className="rounded-full gap-1.5 lg:ml-auto">
          <Link to="/signals/create">
            <Plus className="size-4" /> Register Signal Channel
          </Link>
        </Button>
      </div>

      {/* Hero Intro */}
      <header className="relative overflow-hidden rounded-[2rem] bg-hero p-6 sm:p-10 mb-8 border border-border">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-gold/15 text-gold border border-gold/30 px-3 py-1 text-xs font-bold mb-3">
          <Radio className="size-3.5" /> Official Broadcasts &amp; Subscriber Discussion
        </div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
          Institutional Signal Channels
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
          Follow official broadcast feeds from universities, startups, incubators, and organizations
          — with read analytics and real-time subscriber discussions.
        </p>
      </header>

      {/* Search & Filter Controls */}
      <div className="mb-8 space-y-4">
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
          className="flex max-w-full min-w-0 gap-2 overflow-x-auto pb-2 scrollbar-none"
          aria-label="Filter Signal channels by institution type"
        >
          {SIGNAL_CATEGORY_FILTERS.map((cat) => (
            <button
              key={cat.value}
              type="button"
              onClick={() => setSelectedCategory(cat.value)}
              className={cn(
                "shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition-colors",
                selectedCategory === cat.value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card hover:bg-secondary",
              )}
            >
              {cat.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Channels Grid */}
      {isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-52 rounded-3xl bg-muted/40 animate-pulse" />
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
            <article
              key={sig.id}
              className="surface-card flex flex-col justify-between rounded-3xl p-6 border border-border/80 hover:border-primary/40 transition-colors"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {sig.avatar_url ? (
                      <img
                        src={sig.avatar_url}
                        alt={sig.name}
                        className="size-12 rounded-2xl object-cover border border-border/60 shrink-0"
                      />
                    ) : (
                      <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shrink-0">
                        <Radio className="size-6" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <h2 className="font-display text-base font-bold text-foreground truncate flex items-center gap-1.5">
                        <span className="truncate">{sig.name}</span>
                        {sig.verified && (
                          <CheckCircle
                            className="size-4 text-gold shrink-0"
                            aria-label="Verified institutional Signal"
                          />
                        )}
                      </h2>
                      <p className="text-xs text-muted-foreground capitalize">
                        {sig.institution_type} · @{sig.slug}
                      </p>
                    </div>
                  </div>
                </div>

                {sig.description && (
                  <p className="mt-3 text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                    {sig.description}
                  </p>
                )}
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-border/60 pt-4 text-xs">
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Users className="size-3.5" />
                  <strong className="text-foreground">
                    {sig.follower_count.toLocaleString()}
                  </strong>{" "}
                  subscribers
                </span>
                <Button asChild variant="hero" size="sm" className="rounded-xl text-xs h-8">
                  <Link to="/signals/$slug" params={{ slug: sig.slug }}>
                    Open Channel
                  </Link>
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="surface-card mx-auto max-w-lg rounded-3xl p-10 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-gold/15 text-gold">
            <Radio className="size-7" />
          </div>
          <h2 className="mt-4 font-display text-xl font-bold">
            {deferredSearch || selectedCategory !== "all"
              ? "No matching Signal channels"
              : "No official Signal channels registered yet"}
          </h2>
          <p className="mt-2 text-xs text-muted-foreground">
            {deferredSearch || selectedCategory !== "all"
              ? "Try adjusting your search query or institution filter."
              : "Register an institutional Signal channel to publish verified bulletins and engage subscribers."}
          </p>
          <Button asChild variant="hero" className="mt-5 rounded-full">
            <Link to="/signals/create">Register Signal Channel</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
