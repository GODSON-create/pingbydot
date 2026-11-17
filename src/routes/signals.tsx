import { createFileRoute, Link, Outlet, useChildMatches } from "@tanstack/react-router";
import { Building2, CheckCircle, MessageSquare, Radio, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pageHead } from "@/lib/site";

export const Route = createFileRoute("/signals")({
  staticData: { sitemap: true },
  head: () =>
    pageHead({
      title: "Signal — Community Destination on PING",
      description:
        "Signal is a dedicated Community destination on PING, distinct from Hubs, Forums, and private messaging.",
      path: "/signals",
    }),
  component: SignalsLayout,
});

function SignalsLayout() {
  const childMatches = useChildMatches();
  if (childMatches.length > 0) return <Outlet />;
  return <SignalCommunityDestination />;
}

function SignalCommunityDestination() {
  return (
    <div className="mx-auto max-w-5xl w-full min-w-0 px-4 sm:px-6 py-8 pb-24 overflow-x-clip">
      {/* Community Section Switcher: Hub | Signal | Moment */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-secondary/80 p-1">
          <Link
            to="/hubs"
            search={{}}
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <Building2 className="size-3.5" /> Hub
          </Link>
          <Link
            to="/signals"
            className="inline-flex items-center gap-1.5 rounded-full bg-foreground text-background shadow-sm px-4 py-1.5 text-xs font-semibold transition-colors"
          >
            <Radio className="size-3.5" /> Signal
          </Link>
          <Link
            to="/hubs"
            search={{ view: "moments" }}
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <Sparkles className="size-3.5" /> Moment
          </Link>
        </div>
      </div>

      {/* Signal Distinct Community Destination Card */}
      <section className="surface-card rounded-[2rem] p-7 sm:p-11 border border-border shadow-soft">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
            <Radio className="size-3.5" />
            Community Destination · Signal
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 text-gold border border-gold/30 px-2.5 py-0.5 text-[11px] font-bold">
            <CheckCircle className="size-3" />
            Reserved Specification
          </span>
        </div>

        <h1 className="mt-4 font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
          Signal
        </h1>

        <p className="mt-3 max-w-2xl text-sm sm:text-base leading-relaxed text-muted-foreground">
          Signal is a distinct destination inside the PING Community architecture. Per the PING
          coordination standard, institutional broadcasting and subject-based Forums now live inside{" "}
          <strong className="text-foreground">Hubs</strong>, while one-to-one conversations live in{" "}
          <strong className="text-foreground">Direct Messages</strong>.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-3xl border border-border/80 bg-secondary/35 p-5">
            <div className="flex items-center gap-2 font-display text-base font-bold text-foreground">
              <Building2 className="size-4 text-primary" />
              Looking for Institutional Broadcasts & Forums?
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Universities, companies, government agencies, NGOs, and associations publish official
              Broadcasts and host topic Forums directly inside their Hub.
            </p>
            <Button asChild variant="hero" size="sm" className="mt-4 rounded-full">
              <Link to="/hubs" search={{}}>
                Open Hubs & Forums
              </Link>
            </Button>
          </div>

          <div className="rounded-3xl border border-border/80 bg-secondary/35 p-5">
            <div className="flex items-center gap-2 font-display text-base font-bold text-foreground">
              <MessageSquare className="size-4 text-primary" />
              Looking for Private 1-to-1 Conversations?
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Private direct messaging is a separate communication capability with real-time read
              receipts and presence.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-4 rounded-full">
              <Link to="/messages">Open Direct Messages</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
