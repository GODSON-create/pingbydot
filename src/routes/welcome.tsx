import { useEffect } from "react";
import { createFileRoute, useNavigate, type SearchSchemaInput } from "@tanstack/react-router";
import { WelcomeCarousel } from "@/components/onboarding/WelcomeCarousel";
import { PingMark } from "@/components/BrandLogo";
import { useAuth } from "@/lib/auth";
import { authDestination, unwrapOnboardingDestination } from "@/lib/auth-return";
import { markWelcomeSeen, needsOnboarding } from "@/lib/pathways";
import { trackSessionRestoredOnce } from "@/lib/telemetry";
import { pageHead } from "@/lib/site";

export const Route = createFileRoute("/welcome")({
  staticData: { sitemap: true },
  validateSearch: (search: SearchSchemaInput & { next?: unknown }) => ({
    next:
      typeof search.next === "string" && search.next.trim() ? authDestination(search.next) : "/",
  }),
  head: () =>
    pageHead({
      title: "Welcome — Ping by DOT",
      description:
        "Discover Ping by DOT: connect with your world, discover what matters, and make something happen.",
      path: "/welcome",
    }),
  component: WelcomePage,
});

function WelcomePage() {
  const { ready, user, profile, profileLoading } = useAuth();
  const { next } = Route.useSearch();
  const navigate = useNavigate();

  // Restore valid authenticated sessions directly into Ping without flashing logged-out slides
  useEffect(() => {
    if (!ready || !user || profileLoading) return;
    markWelcomeSeen();
    const isNew = needsOnboarding(profile);
    const resolvedNext = unwrapOnboardingDestination(next);
    trackSessionRestoredOnce(isNew);
    if (isNew) {
      navigate({ to: "/onboarding", search: { next: resolvedNext }, replace: true });
    } else {
      navigate({ to: resolvedNext, replace: true });
    }
  }, [ready, user, profile, profileLoading, next, navigate]);

  if (!ready || (user && (profileLoading || !profileLoading))) {
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

  return (
    <div className="bg-hero min-h-[calc(100dvh-5rem)] px-3.5 sm:px-6 py-5 pb-24 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <WelcomeCarousel
          nextPath={next}
          onCompleteOrSkip={() => {
            markWelcomeSeen();
            navigate({ to: "/" });
          }}
        />
      </div>
    </div>
  );
}
