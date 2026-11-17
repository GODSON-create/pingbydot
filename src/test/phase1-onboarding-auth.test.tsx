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
    }: {
      children: React.ReactNode;
      to?: string;
      className?: string;
    }) => (
      <a href={typeof to === "string" ? to : "#"} className={className}>
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

  it("navigates the 3-slide WelcomeCarousel with primary Google auth, Email option, and Skip", async () => {
    const { WelcomeCarousel } = await import("@/components/onboarding/WelcomeCarousel");
    const onSkip = vi.fn();
    render(<WelcomeCarousel nextPath="/" onCompleteOrSkip={onSkip} />);

    expect(screen.getByText(/Slide 1 of 3/i)).toBeTruthy();
    expect(screen.getByText(/A network built for everyone/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Next$/i }));
    expect(screen.getByText(/Slide 2 of 3/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Next$/i }));
    expect(screen.getByText(/Slide 3 of 3/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Continue with Google/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Sign up or log in with Email/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Browse Ping first/i }));
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
    expect(onboardingSrc).toContain("verification or upgrades are always optional");
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
});
