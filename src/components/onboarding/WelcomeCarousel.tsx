import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Compass,
  Globe2,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { PingMark } from "@/components/BrandLogo";

type BrandVariant = "lime" | "silver" | "gold";
import { GoogleButton } from "@/components/AuthShell";
import { Button } from "@/components/ui/button";
import { PARTICIPATION_PATHWAYS } from "@/lib/pathways";
import { cn } from "@/lib/utils";

interface WelcomeSlide {
  step: number;
  variant: BrandVariant;
  eyebrow: string;
  title: string;
  description: string;
  highlights: readonly string[];
}

const WELCOME_SLIDES: readonly WelcomeSlide[] = [
  {
    step: 1,
    variant: "lime",
    eyebrow: "Slide 1 of 3 · Welcome to Ping by DOT",
    title: "A network built for everyone",
    description:
      "Connect, communicate, discover opportunities, and exchange value on your own terms — whether you're here socially, creating, growing a business, organizing a community, building, or investing.",
    highlights: [
      "No forced labels or mandatory categories",
      "Explore public feeds, people, and communities freely",
      "Keep your identity and connections portable",
    ],
  },
  {
    step: 2,
    variant: "silver",
    eyebrow: "Slide 2 of 3 · Everything in one place",
    title: "Share Pings, Moments, Hubs & Signal",
    description:
      "Publish quick Pings and visual Moments, collaborate inside community Hubs and topic Forums, message anyone 1-on-1 in Signal, and collect optional DOT credits as you participate.",
    highlights: [
      "Pings & Moments for everyday updates and media",
      "Hubs & Forums for communities, schools, and teams",
      "Signal for private 1-on-1 chats and institutional updates",
    ],
  },
  {
    step: 3,
    variant: "gold",
    eyebrow: "Slide 3 of 3 · Join your way",
    title: "Start in seconds — verification is optional",
    description:
      "Sign in fast with Google or use your email anytime. Ordinary access to Ping is completely free with no compulsory subscription or verification.",
    highlights: [
      "Returning members go straight to Ping",
      "New members get a simple, skippable setup",
      "Choose optional participation pathways anytime",
    ],
  },
];

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
  const slide = WELCOME_SLIDES[index] ?? WELCOME_SLIDES[0]!;
  const isFirst = index === 0;
  const isLast = index === WELCOME_SLIDES.length - 1;

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Welcome to Ping introduction"
      className={cn(
        "surface-card relative overflow-hidden rounded-[2rem] border border-border/80 bg-card shadow-lift",
        compact ? "p-5 sm:p-7" : "p-5 sm:p-10",
      )}
    >
      {/* Top progress & skip row */}
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-[11px] font-bold text-secondary-foreground">
          {slide.step === 1 ? (
            <Globe2 className="size-3.5 text-primary" />
          ) : slide.step === 2 ? (
            <MessageSquare className="size-3.5 text-primary" />
          ) : (
            <Sparkles className="size-3.5 text-gold" />
          )}
          {slide.eyebrow}
        </span>

        {onCompleteOrSkip && (
          <button
            type="button"
            onClick={onCompleteOrSkip}
            className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            Skip
          </button>
        )}
      </div>

      {/* Slide Content */}
      <div className="mt-4 sm:mt-6 flex flex-row items-start sm:items-center gap-3.5 sm:gap-5">
        <div className="flex size-12 sm:size-20 shrink-0 items-center justify-center rounded-2xl sm:rounded-3xl bg-secondary/70 border border-border/60">
          <PingMark variant={slide.variant} size="lg" alt={`Ping mark slide ${slide.step}`} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl sm:text-3xl font-extrabold tracking-tight text-foreground">
            {slide.title}
          </h2>
          <p className="mt-1 sm:mt-2 text-xs sm:text-sm leading-relaxed text-muted-foreground">
            {slide.description}
          </p>
        </div>
      </div>

      {/* Highlights */}
      <ul className="mt-4 sm:mt-5 grid gap-1.5 sm:gap-2 sm:grid-cols-3">
        {slide.highlights.map((item) => (
          <li
            key={item}
            className="flex items-start gap-2 rounded-2xl border border-border/60 bg-secondary/40 px-3 py-2 sm:p-3 text-xs text-foreground/90"
          >
            <CheckCircle2 className="size-3.5 sm:size-4 shrink-0 text-primary mt-0.5" />
            <span>{item}</span>
          </li>
        ))}
      </ul>

      {/* Slide 1 preview of optional pathways */}
      {index === 0 && (
        <div className="mt-3 sm:mt-4 flex flex-wrap gap-1.5" aria-label="Optional ways to use Ping">
          {PARTICIPATION_PATHWAYS.map((p) => (
            <span
              key={p.id}
              className="rounded-full border border-border/70 bg-background/70 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground"
            >
              {p.label}
            </span>
          ))}
        </div>
      )}

      {/* Slide Dots & Navigation / Auth CTAs */}
      <div className="mt-4 sm:mt-6 pt-4 sm:pt-5 border-t border-border/60 flex flex-col gap-3 sm:gap-4">
        <div className="flex items-center justify-between gap-3">
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
                  "h-2.5 rounded-full transition-all",
                  idx === index
                    ? "w-7 bg-primary"
                    : "w-2.5 bg-muted-foreground/35 hover:bg-muted-foreground/60",
                )}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {!isFirst && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                className="rounded-full gap-1"
              >
                <ArrowLeft className="size-3.5" /> Back
              </Button>
            )}
            {!isLast && (
              <Button
                type="button"
                variant="hero"
                size="sm"
                onClick={() => setIndex((i) => Math.min(WELCOME_SLIDES.length - 1, i + 1))}
                className="rounded-full gap-1.5 px-5"
              >
                Next <ArrowRight className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Slide 3 Action Deck: Primary Google Auth + Email Alternative + Browse */}
        {isLast && (
          <div className="space-y-3 pt-1">
            <GoogleButton label="Continue with Google" next={nextPath} variant="hero" />
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                asChild
                variant="outline"
                size="sm"
                className="rounded-full w-full"
                onClick={() => onCompleteOrSkip?.()}
              >
                <Link to="/signup">Sign up or log in with Email</Link>
              </Button>
              {onCompleteOrSkip ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onCompleteOrSkip}
                  className="rounded-full w-full gap-1.5"
                >
                  <Compass className="size-3.5" /> Browse Ping first
                </Button>
              ) : (
                <Button asChild variant="ghost" size="sm" className="rounded-full w-full gap-1.5">
                  <Link to="/">
                    <Compass className="size-3.5" /> Browse Ping first
                  </Link>
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
