import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Compass,
  Globe2,
  Mail,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { GoogleButton, OrDivider } from "@/components/AuthShell";
import { PingMark } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { markWelcomeSeen } from "@/lib/pathways";
import { trackEvent } from "@/lib/telemetry";
import { cn } from "@/lib/utils";

type BrandVariant = "lime" | "silver" | "gold";

interface WelcomeSlide {
  step: number;
  variant: BrandVariant;
  eyebrow: string;
  headline: string;
  description: string;
  highlights: readonly string[];
}

export const WELCOME_SLIDES: readonly WelcomeSlide[] = [
  {
    step: 1,
    variant: "lime",
    eyebrow: "Connect & Communicate",
    headline: "Your world. Your people. Your possibilities.",
    description:
      "Ping helps you connect with people around you, communicate in real time, and discover what is unfolding across an open social network.",
    highlights: [
      "Direct 1-on-1 conversations",
      "Real-time community spaces",
      "Open profiles built for everyone",
    ],
  },
  {
    step: 2,
    variant: "silver",
    eyebrow: "Explore & Belong",
    headline: "Discover what matters.",
    description:
      "Find inspiring people, creators, fresh ideas, active communities, and real-world opportunities — all organized so the right things find you.",
    highlights: [
      "People & creators to follow",
      "Topic-driven Hubs & discussions",
      "Ideas & live opportunities",
    ],
  },
  {
    step: 3,
    variant: "gold",
    eyebrow: "Participate & Create Value",
    headline: "Make something happen.",
    description:
      "Share Pings and Moments, participate in conversations, build genuine relationships, and create lasting value together on Ping.",
    highlights: [
      "Share updates, stories & media",
      "Collaborate with your community",
      "Build lasting relationships",
    ],
  },
];

const SWIPE_THRESHOLD_PX = 40;

export function WelcomeCarousel({
  nextPath = "/",
  onCompleteOrSkip,
  compact = false,
}: {
  nextPath?: string;
  onCompleteOrSkip?: () => void;
  compact?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const slide = WELCOME_SLIDES[index] ?? WELCOME_SLIDES[0]!;
  const isFirst = index === 0;
  const isLast = index === WELCOME_SLIDES.length - 1;

  useEffect(() => {
    trackEvent("welcome_slide_viewed", {
      slide: slide.step,
      surface: compact ? "modal" : "page",
    });
  }, [slide.step, compact]);

  const goPrevious = () => setIndex((i) => Math.max(0, i - 1));
  const goNext = () => setIndex((i) => Math.min(WELCOME_SLIDES.length - 1, i + 1));

  const handleSkipOrBrowse = () => {
    markWelcomeSeen();
    trackEvent("welcome_skipped", {
      slide: slide.step,
      surface: compact ? "modal" : "page",
    });
    onCompleteOrSkip?.();
  };

  const beginSwipe = (clientX: number, clientY: number, target: EventTarget | null) => {
    if (
      target instanceof Element &&
      target.closest("button, a, input, textarea, select, [role='tab']")
    ) {
      swipeStartRef.current = null;
      return;
    }
    swipeStartRef.current = { x: clientX, y: clientY };
  };

  const finishSwipe = (clientX: number, clientY: number) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;
    const dx = clientX - start.x;
    const dy = clientY - start.y;
    if (Math.abs(dx) >= SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) goNext();
      else goPrevious();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.target instanceof Element && e.target.closest("input, textarea, select")) {
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      goNext();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      goPrevious();
    } else if (e.key === "Home") {
      e.preventDefault();
      setIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setIndex(WELCOME_SLIDES.length - 1);
    }
  };

  const SlideIcon = slide.step === 1 ? Globe2 : slide.step === 2 ? MessageSquare : Sparkles;

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Ping welcome slides"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onTouchStart={(e) => {
        const touch = e.touches[0];
        if (touch) beginSwipe(touch.clientX, touch.clientY, e.target);
      }}
      onTouchEnd={(e) => {
        const touch = e.changedTouches[0];
        if (touch) finishSwipe(touch.clientX, touch.clientY);
      }}
      onPointerDown={(e) => {
        if (e.pointerType === "touch") return;
        beginSwipe(e.clientX, e.clientY, e.target);
      }}
      onPointerUp={(e) => {
        if (e.pointerType === "touch") return;
        finishSwipe(e.clientX, e.clientY);
      }}
      className={cn(
        "surface-card relative overflow-hidden rounded-[2rem] border border-border/80 bg-card shadow-lift outline-none focus-visible:ring-2 focus-visible:ring-ring touch-pan-y select-none sm:select-auto",
        compact ? "p-5 sm:p-7" : "p-5 sm:p-8 lg:p-10",
      )}
    >
      <div
        className={cn(
          "grid gap-6 lg:gap-9 items-stretch",
          !compact && "lg:grid-cols-[1.15fr_0.85fr]",
        )}
      >
        {/* LEFT COLUMN: 3-SLIDE INTERACTIVE CAROUSEL */}
        <div className="flex flex-col justify-between min-w-0">
          <div>
            {/* Top progress & Skip header */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-[11px] font-bold text-secondary-foreground">
                  <SlideIcon
                    className={cn("size-3.5", slide.step === 3 ? "text-gold" : "text-primary")}
                  />
                  Slide {slide.step} of {WELCOME_SLIDES.length}
                </span>
                <span className="hidden sm:inline-block text-xs font-medium text-muted-foreground">
                  {slide.eyebrow}
                </span>
              </div>

              {onCompleteOrSkip ? (
                <button
                  type="button"
                  onClick={handleSkipOrBrowse}
                  className="rounded-full px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                >
                  Skip
                </button>
              ) : (
                <Link
                  to="/"
                  onClick={handleSkipOrBrowse}
                  className="rounded-full px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                >
                  Skip
                </Link>
              )}
            </div>

            {/* Linear progress bar */}
            <div
              className="mt-3 h-1 w-full overflow-hidden rounded-full bg-secondary"
              aria-hidden="true"
            >
              <div
                className="h-full rounded-full bg-primary transition-all duration-300 motion-reduce:transition-none"
                style={{ width: `${((index + 1) / WELCOME_SLIDES.length) * 100}%` }}
              />
            </div>

            {/* Active Slide Content */}
            <div
              role="tabpanel"
              aria-live="polite"
              aria-label={`Slide ${slide.step} of ${WELCOME_SLIDES.length}`}
              className="mt-5 sm:mt-7"
            >
              <div className="flex items-center gap-3.5 sm:gap-4">
                <div className="flex size-12 sm:size-16 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-secondary/70">
                  <PingMark variant={slide.variant} size="lg" alt={`Ping slide ${slide.step}`} />
                </div>
                <span className="sm:hidden text-xs font-semibold uppercase tracking-wider text-primary">
                  {slide.eyebrow}
                </span>
              </div>

              <h1 className="mt-4 font-display text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-foreground leading-[1.12]">
                {slide.headline}
              </h1>

              <p className="mt-3 text-sm sm:text-base leading-relaxed text-muted-foreground">
                {slide.description}
              </p>

              <ul className="mt-5 grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                {slide.highlights.map((highlight) => (
                  <li
                    key={highlight}
                    className="rounded-2xl border border-border/60 bg-secondary/45 px-3.5 py-2.5 text-xs font-medium text-foreground/90"
                  >
                    {highlight}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Carousel Controls: Progress dots + Previous / Next */}
          <div className="mt-6 pt-5 border-t border-border/60 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2" role="tablist" aria-label="Welcome slides">
              {WELCOME_SLIDES.map((s, idx) => (
                <button
                  key={s.step}
                  type="button"
                  role="tab"
                  aria-selected={idx === index}
                  aria-label={`Go to slide ${s.step}`}
                  onClick={() => setIndex(idx)}
                  className={cn(
                    "h-2.5 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    idx === index
                      ? "w-7 bg-primary"
                      : "w-2.5 bg-muted-foreground/35 hover:bg-muted-foreground/60",
                  )}
                />
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isFirst}
                aria-label="Previous slide"
                onClick={goPrevious}
                className="rounded-full gap-1 px-3.5"
              >
                <ArrowLeft className="size-3.5" /> Previous
              </Button>
              <Button
                type="button"
                variant={isLast ? "outline" : "hero"}
                size="sm"
                disabled={isLast}
                aria-label="Next slide"
                onClick={goNext}
                className="rounded-full gap-1.5 px-4"
              >
                Next <ArrowRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN / AUTH PANEL: ALWAYS ACCESSIBLE WITHOUT COMPLETING ALL SLIDES */}
        <div
          className={cn(
            "flex flex-col justify-center rounded-3xl border border-border/70 bg-secondary/35 p-5 sm:p-6",
            !compact && "lg:p-7",
          )}
        >
          <div className="mb-4">
            <p className="text-xs font-bold uppercase tracking-wider text-primary">Join Ping</p>
            <h2 className="mt-1 font-display text-xl font-extrabold tracking-tight text-foreground">
              Get started in seconds
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Continue straight with Google or set up your account using email anytime.
            </p>
          </div>

          <div className="space-y-3">
            <GoogleButton label="Continue with Google" next={nextPath} variant="hero" />

            <OrDivider />

            <Button asChild variant="outline" size="lg" className="w-full rounded-full gap-2">
              <Link to="/signup" search={{ next: nextPath }} onClick={() => markWelcomeSeen()}>
                <Mail className="size-4" /> Continue with email
              </Link>
            </Button>
          </div>

          <div className="mt-4 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              to="/login"
              search={{ next: nextPath }}
              onClick={() => markWelcomeSeen()}
              className="font-semibold text-foreground underline underline-offset-4 hover:text-primary"
            >
              Sign in
            </Link>
          </div>

          <div className="mt-4 pt-3 border-t border-border/50 flex flex-col items-center gap-2.5">
            {onCompleteOrSkip ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleSkipOrBrowse}
                className="rounded-full text-xs text-muted-foreground hover:text-foreground gap-1.5"
              >
                <Compass className="size-3.5" /> Explore Ping first
              </Button>
            ) : (
              <Button asChild variant="ghost" size="sm" className="rounded-full text-xs gap-1.5">
                <Link to="/" onClick={handleSkipOrBrowse}>
                  <Compass className="size-3.5" /> Explore Ping first
                </Link>
              </Button>
            )}

            <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
              By continuing, you agree to our{" "}
              <Link to="/terms" className="underline hover:text-foreground">
                Terms
              </Link>{" "}
              and{" "}
              <Link to="/privacy" className="underline hover:text-foreground">
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
