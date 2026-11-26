import { pageHead } from "@/lib/site";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { PingMark } from "@/components/BrandLogo";
import { useAuth } from "@/lib/auth";
import { feedQuery } from "@/lib/pings";
import { WelcomeCarousel } from "@/components/onboarding/WelcomeCarousel";
import { ExploreDiscoveryView } from "@/components/explore/ExploreDiscoveryView";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { hasSeenWelcome, markWelcomeSeen } from "@/lib/pathways";

export const Route = createFileRoute("/")({
  staticData: { sitemap: true },
  validateSearch: z.object({
    tab: z.enum(["foryou", "following", "latest", "trending", "opportunities"]).optional(),
    c: z
      .enum([
        "progress",
        "need",
        "offer",
        "opportunity",
        "idea",
        "question",
        "collaboration",
        "update",
        "launch",
        "milestone",
      ])
      .optional(),
    filter: z
      .enum(["all", "pings", "people", "moments", "communities", "signals", "opportunities"])
      .optional(),
    q: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(0).max(10000).optional().catch(undefined),
  }),
  loaderDeps: ({ search: { c, page } }) => ({ cat: c ?? null, page: page ?? 0 }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(feedQuery(deps.cat, deps.page)),
  head: () =>
    pageHead({
      title: "Ping by DOT — Explore People, Moments, Hubs, Signals & Clips",
      description:
        "Discover people, Moments, Hubs, institutional Signals, open opportunities, and persistent short-form Clips on Ping by DOT.",
      path: "/",
      card: "summary_large_image",
    }),
  component: ExploreLandingRoute,
});

function ExploreLandingRoute() {
  const { user, ready } = useAuth();
  const search = Route.useSearch();
  const initialPings = Route.useLoaderData();
  const [hydrated, setHydrated] = useState(false);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const [welcomeModalOpen, setWelcomeModalOpen] = useState(false);

  useEffect(() => {
    setHydrated(true);
    setWelcomeDismissed(hasSeenWelcome());
  }, []);

  if (!hydrated || !ready) {
    return (
      <div className="bg-hero flex min-h-[calc(100dvh-5rem)] items-center justify-center px-4 pb-24">
        <div
          role="status"
          aria-live="polite"
          className="surface-card flex flex-col items-center gap-3 rounded-3xl px-8 py-7 text-center shadow-lift"
        >
          <PingMark variant="lime" size="lg" alt="Ping by DOT" />
          <p className="text-sm font-medium text-muted-foreground">Opening Ping…</p>
        </div>
      </div>
    );
  }

  if (!user && !welcomeDismissed) {
    return (
      <div className="bg-hero min-h-[calc(100dvh-5rem)] px-3.5 sm:px-6 py-5 pb-24 sm:py-12">
        <div className="mx-auto max-w-5xl">
          <WelcomeCarousel
            nextPath="/"
            onCompleteOrSkip={() => {
              markWelcomeSeen();
              setWelcomeDismissed(true);
            }}
          />
        </div>
      </div>
    );
  }

  const resolvedFilter =
    search.filter ?? (search.tab === "opportunities" ? "opportunities" : undefined);

  return (
    <>
      <ExploreDiscoveryView
        basePath="/"
        initialPings={initialPings}
        category={search.c ?? null}
        initialFilter={resolvedFilter}
        initialQuery={search.q ?? ""}
        pageNum={search.page ?? 0}
        onOpenIntroSlides={() => setWelcomeModalOpen(true)}
      />

      <Dialog
        open={welcomeModalOpen}
        onOpenChange={(open) => {
          setWelcomeModalOpen(open);
          if (!open) {
            markWelcomeSeen();
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto border-none bg-transparent p-0 shadow-none">
          <DialogHeader className="sr-only">
            <DialogTitle>Welcome to Ping by DOT</DialogTitle>
          </DialogHeader>
          <WelcomeCarousel
            nextPath="/"
            onCompleteOrSkip={() => {
              markWelcomeSeen();
              setWelcomeModalOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
