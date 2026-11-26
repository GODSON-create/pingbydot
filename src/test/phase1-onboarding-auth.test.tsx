import fs from "node:fs";
import path from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  PARTICIPATION_PATHWAYS,
  formatPathwayLabel,
  hasSeenWelcome,
  markWelcomeSeen,
  needsOnboarding,
} from "@/lib/pathways";
import {
  authDestination,
  buildAuthRedirectUri,
  buildSignupConfirmationRedirect,
  extractAuthCallbackParams,
  unwrapOnboardingDestination,
} from "@/lib/auth-return";
import { normalizeDeepLinkPath } from "@/lib/native";
import { trackEvent, trackSessionRestoredOnce } from "@/lib/telemetry";
import { profileSchema } from "@/lib/validation";
import { routeTree } from "@/routeTree.gen";

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    Link: ({
      children,
      to,
      className,
      onClick,
    }: {
      children: React.ReactNode;
      to?: string;
      className?: string;
      onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
    }) => (
      <a
        href={typeof to === "string" ? to : "#"}
        className={className}
        onClick={(e) => {
          e.preventDefault();
          onClick?.(e);
        }}
      >
        {children}
      </a>
    ),
  };
});

const root = process.cwd();
const readSrc = (rel: string) => fs.readFileSync(path.resolve(root, rel), "utf8");

describe("Phase 1 Onboarding, Welcome Experience & Primary Google Auth", () => {
  it("registers migration 0023 non-destructive backfill, optional pathways constraint & onboarding RPC", () => {
    const journal = JSON.parse(readSrc("drizzle/migrations/meta/_journal.json"));
    const entry23 = journal.entries.find((e: { idx: number }) => e.idx === 23);
    expect(entry23).toBeDefined();
    expect(entry23.tag).toBe("0023_onboarding_and_pathways");

    const sql = readSrc("drizzle/migrations/0023_onboarding_and_pathways.sql");
    expect(sql).toContain(
      "ADD COLUMN IF NOT EXISTS participation_pathways text[] NOT NULL DEFAULT '{}'",
    );
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz");
    expect(sql).toContain("SET onboarding_completed_at = created_at");
    expect(sql).toContain("WHERE onboarding_completed_at IS NULL");
    expect(sql).toContain("'general'");
    expect(sql).toContain("'creator'");
    expect(sql).toContain("'business'");
    expect(sql).toContain("'community'");
    expect(sql).toContain("'builder'");
    expect(sql).toContain("'investor'");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.complete_my_onboarding");
    expect(sql).toContain("FROM PUBLIC, anon");
  });

  it("matches /welcome and /onboarding routes cleanly inside the generated router tree", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    for (const routePath of ["/welcome", "/onboarding", "/login", "/signup", "/"]) {
      expect(router.matchRoutes(routePath).at(-1)?.routeId).not.toBe(rootRouteId);
    }
  });

  it("navigates the 3-slide WelcomeCarousel via clicks, swipe, and keyboard with auth always visible", async () => {
    const { WelcomeCarousel } = await import("@/components/onboarding/WelcomeCarousel");
    const onSkip = vi.fn();
    render(<WelcomeCarousel nextPath="/" onCompleteOrSkip={onSkip} />);

    // Auth options are immediately visible on Slide 1 without forcing all 3 slides
    expect(screen.getByText(/Slide 1 of 3/i)).toBeTruthy();
    expect(screen.getByText(/Your world\. Your people\. Your possibilities\./i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Continue with Google/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Continue with email/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Sign in$/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Terms$/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Privacy Policy/i })).toBeTruthy();

    // Advance via Next button to Slide 2
    fireEvent.click(screen.getByRole("button", { name: /^Next/i }));
    expect(screen.getByText(/Slide 2 of 3/i)).toBeTruthy();
    expect(screen.getByText(/Discover what matters\./i)).toBeTruthy();

    // Advance via keyboard ArrowRight to Slide 3
    const carousel = screen.getByRole("region", { name: /Ping welcome slides/i });
    fireEvent.keyDown(carousel, { key: "ArrowRight" });
    expect(screen.getByText(/Slide 3 of 3/i)).toBeTruthy();
    expect(screen.getByText(/Make something happen\./i)).toBeTruthy();

    // Navigate back via Previous button and swipe forward via touch
    fireEvent.click(screen.getByRole("button", { name: /^Previous/i }));
    expect(screen.getByText(/Slide 2 of 3/i)).toBeTruthy();

    fireEvent.touchStart(carousel, { touches: [{ clientX: 260, clientY: 120 }] });
    fireEvent.touchEnd(carousel, { changedTouches: [{ clientX: 120, clientY: 125 }] });
    expect(screen.getByText(/Slide 3 of 3/i)).toBeTruthy();

    fireEvent.keyDown(carousel, { key: "Home" });
    expect(screen.getByText(/Slide 1 of 3/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Skip$/i }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("keeps participation pathways strictly optional and supports all 6 user types", () => {
    expect(PARTICIPATION_PATHWAYS.map((p) => p.id)).toEqual([
      "general",
      "creator",
      "business",
      "community",
      "builder",
      "investor",
    ]);

    const skippedRes = profileSchema.safeParse({
      username: "alex_member",
      display_name: "Alex",
      bio: "",
      avatar_url: "",
      participation_pathways: [],
    });
    expect(skippedRes.success).toBe(true);

    const multiRes = profileSchema.safeParse({
      username: "alex_member",
      display_name: "Alex",
      bio: "Sharing photos and local events",
      participation_pathways: ["general", "creator", "community"],
    });
    expect(multiRes.success).toBe(true);

    const invalidRes = profileSchema.safeParse({
      username: "alex_member",
      display_name: "Alex",
      bio: "",
      participation_pathways: ["unknown_role"],
    });
    expect(invalidRes.success).toBe(false);
  });

  it("routes returning authenticated users straight into Ping without re-onboarding", () => {
    // Missing column (pre-0023 DB): never force onboarding
    expect(needsOnboarding({})).toBe(false);
    expect(needsOnboarding({ onboarding_completed_at: undefined })).toBe(false);
    // Backfilled or completed user: never force onboarding
    expect(needsOnboarding({ onboarding_completed_at: "2026-11-17T00:00:00Z" })).toBe(false);
    // Newly created user with column present and null: route to universal onboarding
    expect(needsOnboarding({ onboarding_completed_at: null })).toBe(true);
    expect(needsOnboarding(null)).toBe(false);

    const authShellSrc = readSrc("src/components/AuthShell.tsx");
    const loginSrc = readSrc("src/routes/login.tsx");
    const signupSrc = readSrc("src/routes/signup.tsx");
    const authGuardSrc = readSrc("src/routes/_authenticated/route.tsx");
    const onboardingSrc = readSrc("src/routes/_authenticated/onboarding.tsx");

    expect(authShellSrc).toContain('variant = "hero"');
    expect(authShellSrc).toContain("export function GoogleButton");
    expect(loginSrc).toContain("Continue with Google");
    expect(loginSrc).toContain("needsOnboarding(profile)");
    expect(signupSrc).toContain("needsOnboarding(profile)");
    expect(signupSrc).toContain("Continue with Google");
    expect(authGuardSrc).toContain("supabase.auth.getSession()");
    expect(onboardingSrc).toContain("Skip for now");
    expect(onboardingSrc).toMatch(/verification\s+or upgrades are always optional/i);
  });

  it("tracks welcome visibility state and formats participation pathway labels", () => {
    window.localStorage.clear();
    expect(hasSeenWelcome()).toBe(false);
    markWelcomeSeen();
    expect(hasSeenWelcome()).toBe(true);

    expect(formatPathwayLabel("general")).toBe("General User");
    expect(formatPathwayLabel("community")).toBe("Community Member");
    expect(formatPathwayLabel("investor")).toBe("Investor");
  });

  it("handles auth redirect safety, PKCE/hash callback extraction, and native deep links", () => {
    expect(authDestination("/welcome")).toBe("/explore");
    expect(unwrapOnboardingDestination("/onboarding")).toBe("/");
    expect(unwrapOnboardingDestination("/onboarding?next=%2Fhubs")).toBe("/hubs");
    expect(buildAuthRedirectUri("/signals", "https://ping.example")).toBe(
      "https://ping.example/login?next=%2Fsignals",
    );
    expect(buildSignupConfirmationRedirect("/hubs", "https://ping.example")).toBe(
      "https://ping.example/login?next=%2Fonboarding%3Fnext%3D%252Fhubs",
    );

    expect(extractAuthCallbackParams("?code=pkce_123&next=%2F", "#error=access_denied")).toEqual({
      code: "pkce_123",
      accessToken: null,
      refreshToken: null,
      error: "access_denied",
    });

    expect(normalizeDeepLinkPath("https://pingbydot.lovable.app/login?code=abc#x")).toBe(
      "/login?code=abc#x",
    );
    expect(normalizeDeepLinkPath("pingbydot://login?code=abc")).toBe("/login?code=abc");
    expect(normalizeDeepLinkPath("not a valid url")).toBeNull();
  });

  it("emits sanitized client telemetry without PII and preserves navigation on Email link click", async () => {
    const tracked: Array<{ event: string; props?: Record<string, unknown> | undefined }> = [];
    window.__lovableEvents = {
      track: (event, props) => {
        tracked.push({ event, props });
        return null;
      },
    };
    window.localStorage.clear();
    window.sessionStorage.clear();

    const { WelcomeCarousel } = await import("@/components/onboarding/WelcomeCarousel");
    const onSkip = vi.fn();
    render(<WelcomeCarousel nextPath="/hubs" onCompleteOrSkip={onSkip} />);

    const emailLink = screen.getByRole("link", { name: /Continue with email/i });
    fireEvent.click(emailLink);
    expect(hasSeenWelcome()).toBe(true);
    expect(onSkip).not.toHaveBeenCalled();

    trackEvent("auth_started", { method: "google", email: "user@example.com" });
    trackSessionRestoredOnce(false);
    trackSessionRestoredOnce(false);

    const started = tracked.find((t) => t.event === "auth_started");
    expect(started?.props?.["method"]).toBe("google");
    expect(started?.props?.["email"]).toBe("[redacted]");
    expect(tracked.filter((t) => t.event === "auth_completed")).toHaveLength(1);

    delete window.__lovableEvents;
  });

  it("removes Welcome back copy and surfaces responsive layout + /welcome across desktop and mobile", () => {
    const rootSrc = readSrc("src/routes/__root.tsx");
    const footerSrc = readSrc("src/components/layout/SiteFooter.tsx");
    const headerSrc = readSrc("src/components/layout/SiteHeader.tsx");
    const indexSrc = readSrc("src/routes/index.tsx");
    const loginSrc = readSrc("src/routes/login.tsx");
    const authShellSrc = readSrc("src/components/AuthShell.tsx");

    expect(rootSrc).not.toContain("Ping is where founders share progress");
    expect(loginSrc).not.toContain("Welcome back");
    expect(footerSrc).toContain('to="/welcome"');
    expect(headerSrc).toContain('to="/login"');
    expect(headerSrc).toContain("md:hidden");
    expect(indexSrc).toContain("max-h-[90dvh] overflow-y-auto");
    expect(indexSrc).toContain("WelcomeCarousel");
    expect(authShellSrc).toContain('to="/welcome"');
    expect(authShellSrc).toContain('to="/terms"');
    expect(authShellSrc).toContain('to="/privacy"');
  });
});
