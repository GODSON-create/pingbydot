import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useDeferredValue } from "react";
import { z } from "zod";
import { Radio, Plus, CheckCircle, Search, Building, GraduationCap, Briefcase, Globe, Users } from "lucide-react";
import { signalsQuery, type Signal, type SignalInstitutionType } from "@/lib/signals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { pageHead } from "@/lib/site";

const SIGNAL_CATEGORIES: Array<{ value: SignalInstitutionType | "all"; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { value: "all", label: "All", icon: Radio },
  { value: "university", label: "Universities", icon: GraduationCap },
  { value: "company", label: "Companies", icon: Building },
  { value: "incubator", label: "Incubators & VCs", icon: Briefcase },
  { value: "community", label: "Collectives", icon: Users },
  { value: "government", label: "Public & Gov", icon: Globe },
];

export const Route = createFileRoute("/signals")({
  staticData: { sitemap: true },
  validateSearch: z.object({
    category: z.string().optional(),
    q: z.string().optional(),
  }),
  head: () =>
    pageHead({
      title: "Signals — Institutional Broadcasts on Ping",
      description:
        "Official broadcasts and alerts from universities, developer communities, and startup accelerators on Ping.",
      path: "/signals",
    }),
  component: SignalsDirectory,
});

function SignalCard({ signal }: { signal: Signal }) {
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
            {signal.description && (
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{signal.description}</p>
            )}
          </div>
        </header>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold capitalize">
            {signal.institution_type}
          </span>
          <span className="text-xs text-muted-foreground">
            {signal.follower_count.toLocaleString()} {signal.follower_count === 1 ? "subscriber" : "subscribers"}
          </span>
        </div>
      </div>

      <div className="mt-5 border-t border-border/60 pt-4 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full bg-primary animate-pulse" />
          Active Broadcast Channel
        </span>
        <Button asChild size="sm" variant="hero" className="rounded-xl">
          <Link to="/signals/$slug" params={{ slug: signal.slug }}>
            Tune In
          </Link>
        </Button>
      </div>
    </article>
  );
}

function SignalsDirectory() {
  const searchParams = Route.useSearch();
  const [search, setSearch] = useState(searchParams.q ?? "");
  const [selectedCategory, setSelectedCategory] = useState<string>(searchParams.category ?? "all");

  const deferredSearch = useDeferredValue(search);

  const { data: signals = [], isLoading } = useQuery(
    signalsQuery({
      search: deferredSearch,
      ...(selectedCategory !== "all" ? { category: selectedCategory } : {}),
    }),
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      {/* Hero */}
      <div className="flex flex-col items-start justify-between gap-4 border-b border-border/60 pb-8 sm:flex-row sm:items-end">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Radio className="size-3.5" />
            Institutional Broadcasting Layer
          </div>
          <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
            Signals
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Verified announcement feeds from universities, tech companies, accelerators, and developer collectives. Receive direct institutional broadcasts without social noise.
          </p>
        </div>

        <Button asChild variant="hero" className="rounded-2xl shrink-0 gap-2">
          <Link to="/signals/create">
            <Plus className="size-4" />
            Register Signal
          </Link>
        </Button>
      </div>

      {/* Controls: Search & Category Pills */}
      <div className="mt-6 flex flex-col gap-4">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search verified signals by institution or keyword…"
            className="pl-10 rounded-2xl h-11 bg-card/60"
          />
        </div>

        {/* Category filters */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
          {SIGNAL_CATEGORIES.map((c) => {
            const Icon = c.icon;
            const isSelected = selectedCategory === c.value;
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => setSelectedCategory(c.value)}
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all",
                  isSelected
                    ? "bg-foreground text-background shadow-sm"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                )}
              >
                <Icon className="size-3.5" />
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Results */}
      <div className="mt-8">
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-48 rounded-3xl bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : signals.length === 0 ? (
          <div className="surface-card rounded-3xl p-12 text-center">
            <Radio className="mx-auto size-12 text-muted-foreground/40" />
            <h2 className="mt-4 font-display text-xl font-bold">No signals found</h2>
            <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
              {search
                ? `No signals matched "${search}". Try searching for another institution or category.`
                : "No institutional signals published yet. Be the first to register an official channel!"}
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              {search && (
                <Button variant="outline" onClick={() => setSearch("")} className="rounded-xl">
                  Clear search
                </Button>
              )}
              <Button asChild variant="hero" className="rounded-xl">
                <Link to="/signals/create">Register your organization</Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {signals.map((sig) => (
              <SignalCard key={sig.id} signal={sig} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
