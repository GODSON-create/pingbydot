import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { WelcomeCarousel } from "@/components/onboarding/WelcomeCarousel";
import { useAuth } from "@/lib/auth";
import { markWelcomeSeen, needsOnboarding } from "@/lib/pathways";
import { pageHead } from "@/lib/site";

export const Route = createFileRoute("/welcome")({
  staticData: { sitemap: true },
  head: () =>
    pageHead({
      title: "Welcome — Ping by DOT",
      description:
        "Discover Ping by DOT: a broad social, communication, discovery, and economic network for everyone.",
      path: "/welcome",
    }),
  component: WelcomePage,
});

function WelcomePage() {
  const { ready, user, profile, profileLoading } = useAuth();
  const navigate = useNavigate();

  // Existing authenticated users restore cleanly straight into Ping
  useEffect(() => {
    if (!ready || !user || profileLoading) return;
    markWelcomeSeen();
    if (needsOnboarding(profile)) {
      navigate({ to: "/onboarding", replace: true });
    } else {
      navigate({ to: "/", replace: true });
    }
  }, [ready, user, profile, profileLoading, navigate]);

  return (
    <div className="bg-hero min-h-[calc(100dvh-5rem)] px-3.5 sm:px-6 py-4 pb-24 sm:py-16">
      <div className="mx-auto max-w-2xl">
        <WelcomeCarousel
          nextPath="/"
          onCompleteOrSkip={() => {
            markWelcomeSeen();
            navigate({ to: "/" });
          }}
        />
      </div>
    </div>
  );
}
