import fs from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ONBOARDING_INTERESTS,
  clearOnboardingDraft,
  formatInterestLabel,
  loadOnboardingDraft,
  recommendedFeedCategoryForInterests,
  recommendedHubCategoriesForInterests,
} from "@/lib/pathways";
import { CATEGORIES, profileSchema } from "@/lib/validation";
import { HUB_CATEGORIES } from "@/lib/hubs";

const { navigateMock, mockAuthState, supabaseMock, searchParamsState, mockPublicHubs } = vi.hoisted(
  () => ({
    navigateMock: vi.fn(),
    searchParamsState: { next: "/" },
    mockAuthState: {
      user: null as null | { id: string; email?: string; user_metadata?: Record<string, unknown> },
      ready: true,
      profile: null as null | Record<string, unknown>,
      profileLoading: false,
      refreshProfile: vi.fn(),
    },
    mockPublicHubs: [
      {
        id: "hub-tech-1",
        slug: "builders-lab",
        name: "Builders Lab",
        tagline: "Product builders and engineers",
        description: "",
        rules: "",
        category: "incubator",
        access: "public",
        resources: [],
        verified: false,
        member_count: 14,
        ping_count: 5,
        member_limit: 10000,
        owner_id: "other-user-1",
        created_at: "2026-10-01T00:00:00Z",
      },
    ],
    supabaseMock: {
      rpc: vi.fn(),
      from: vi.fn(),
    },
  }),
);

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: React.ComponentType }) => ({
    options: opts,
    useSearch: () => searchParamsState,
  }),
  Link: ({ children, to, className }: { children: ReactNode; to?: string; className?: string }) => (
    <a href={typeof to === "string" ? to : "#"} className={className}>
      {children}
    </a>
  ),
  useNavigate: () => navigateMock,
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockAuthState,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: supabaseMock,
}));

vi.mock("@/lib/public-hubs.functions", () => ({
  PUBLIC_PING_SELECT: "id",
  readPublicHubs: vi.fn(async () => mockPublicHubs),
  readPublicHub: vi.fn(async () => null),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

function renderOnboarding(Comp: React.ComponentType) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <Comp />
    </QueryClientProvider>,
  );
}

function buildProfilesQueryMock(opts?: {
  conflictOnUsername?: string;
  peopleRows?: Array<Record<string, unknown>>;
}) {
  return {
    select: (cols: string) => {
      // Uniqueness check: select("id").eq("username", val).neq("id", uid).maybeSingle()
      if (cols === "id") {
        let checkedUsername = "";
        const chain = {
          eq: (_col: string, val: string) => {
            checkedUsername = val;
            return chain;
          },
          neq: () => chain,
          maybeSingle: vi.fn(async () => ({
            data:
              opts?.conflictOnUsername && checkedUsername === opts.conflictOnUsername
                ? { id: "taken-user-id" }
                : null,
            error: null,
          })),
        };
        return chain;
      }

      // Suggested people query: select("*").neq("id", uid).order(...).limit(...)
      const rows = opts?.peopleRows ?? [
        {
          id: "person-suggested-1",
          username: "maya_tech",
          display_name: "Maya Lin",
          bio: "Exploring community tech",
          avatar_url: null,
          country: "Canada",
          interests: ["technology", "creativity"],
          created_at: "2026-10-01T00:00:00Z",
        },
      ];
      return {
        neq: () => ({
          order: () => ({
            limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
          }),
        }),
      };
    },
  };
}

describe("Phase 1 Workstream 2: Universal User Onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    searchParamsState.next = "/";
    mockAuthState.user = null;
    mockAuthState.ready = true;
    mockAuthState.profile = null;
    mockAuthState.profileLoading = false;

    supabaseMock.rpc.mockResolvedValue({ data: null, error: null });
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return buildProfilesQueryMock();
      }
      if (table === "follows") {
        return {
          select: () => ({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
          insert: vi.fn().mockResolvedValue({ error: null }),
          delete: () => ({
            eq: () => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        };
      }
      if (table === "hub_members") {
        const res = { data: [], error: null };
        const chain: Record<string, unknown> = {
          eq: () => chain,
          order: vi.fn().mockResolvedValue(res),
          then: (resolve: (v: typeof res) => void) => Promise.resolve(res).then(resolve),
        };
        return {
          select: () => chain,
        };
      }
      return {
        select: () => ({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      };
    });
  });

  it("registers migration 0024 and maps all 10 interests cleanly to existing Ping and Hub categories", () => {
    const root = process.cwd();
    const journal = JSON.parse(
      fs.readFileSync(path.resolve(root, "drizzle/migrations/meta/_journal.json"), "utf8"),
    );
    const entry24 = journal.entries.find((e: { idx: number }) => e.idx === 24);
    expect(entry24).toBeDefined();
    expect(entry24.tag).toBe("0024_universal_onboarding_identity_interests");

    const sql = fs.readFileSync(
      path.resolve(root, "drizzle/migrations/0024_universal_onboarding_identity_interests.sql"),
      "utf8",
    );
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT ''");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS interests text[] NOT NULL DEFAULT '{}'");
    expect(sql).toContain("DROP FUNCTION IF EXISTS public.complete_my_onboarding");
    expect(sql).toContain("_mark_complete boolean DEFAULT true");

    expect(ONBOARDING_INTERESTS.map((i) => i.label)).toEqual([
      "Technology",
      "Business",
      "Education",
      "Entertainment",
      "Lifestyle",
      "Communities",
      "Creativity",
      "Opportunities",
      "Culture",
      "Other",
    ]);

    const pingCatValues = new Set<string>(CATEGORIES.map((c) => c.value));
    const hubCatValues = new Set<string>(HUB_CATEGORIES.map((c) => c.value));
    for (const interest of ONBOARDING_INTERESTS) {
      expect(pingCatValues.has(interest.pingCategory)).toBe(true);
      expect(hubCatValues.has(interest.hubCategory)).toBe(true);
    }

    expect(recommendedFeedCategoryForInterests(["creativity", "technology"])).toBe("idea");
    expect(recommendedHubCategoriesForInterests(["education"]).has("university")).toBe(true);
    expect(formatInterestLabel("communities")).toBe("Communities");

    const validProfile = profileSchema.safeParse({
      username: "alex_world",
      display_name: "Alex",
      bio: "",
      country: "Ghana",
      interests: ["technology", "culture"],
    });
    expect(validProfile.success).toBe(true);
  });

  it("completes 4-step universal onboarding for a new Google user without forcing avatar, verification, or payment", async () => {
    const mod = await import("@/routes/_authenticated/onboarding");
    const OnboardingComp = mod.Route.options.component as React.ComponentType;

    mockAuthState.user = {
      id: "google-new-1",
      user_metadata: {
        full_name: "Ada Lovelace",
        avatar_url: "https://example.com/ada.jpg",
      },
    };
    mockAuthState.profile = {
      id: "google-new-1",
      username: "ada_lovelace",
      display_name: "Ada Lovelace",
      bio: "",
      country: "",
      avatar_url: "https://example.com/ada.jpg",
      interests: [],
      participation_pathways: [],
      onboarding_completed_at: null,
    };

    renderOnboarding(OnboardingComp);

    // Step 1: Identity
    expect(screen.getByText(/Step 1 of 4/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Country/i), { target: { value: "United Kingdom" } });
    fireEvent.click(screen.getByRole("button", { name: /Save & continue/i }));

    await waitFor(() => {
      expect(supabaseMock.rpc).toHaveBeenCalledWith(
        "complete_my_onboarding",
        expect.objectContaining({
          _display_name: "Ada Lovelace",
          _username: "ada_lovelace",
          _country: "United Kingdom",
          _mark_complete: false,
          _skip: false,
        }),
      );
      expect(screen.getByText(/Step 2 of 4/i)).toBeTruthy();
    });

    // Step 2: Interests
    fireEvent.click(screen.getByRole("button", { name: /^Technology/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Creativity/i }));
    fireEvent.click(screen.getByRole("button", { name: /Save & continue/i }));

    await waitFor(() => {
      expect(supabaseMock.rpc).toHaveBeenCalledWith(
        "complete_my_onboarding",
        expect.objectContaining({
          _interests: ["technology", "creativity"],
          _mark_complete: false,
        }),
      );
      expect(screen.getByText(/Step 3 of 4/i)).toBeTruthy();
    });

    // Step 3: Connections (suggested account + community + follow)
    await waitFor(() => {
      expect(screen.getByText("Maya Lin")).toBeTruthy();
      expect(screen.getByText("Builders Lab")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /^Follow$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Join$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

    // Step 4: Enter Ping
    await waitFor(() => {
      expect(screen.getByText(/Step 4 of 4/i)).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /^Enter Ping$/i }));

    await waitFor(() => {
      expect(supabaseMock.rpc).toHaveBeenCalledWith(
        "complete_my_onboarding",
        expect.objectContaining({
          _mark_complete: true,
          _skip: false,
        }),
      );
      expect(navigateMock).toHaveBeenCalledWith({ to: "/", replace: true });
    });

    expect(loadOnboardingDraft("google-new-1")).toBeNull();
  }, 15000);

  it("handles new email users, preserves incomplete onboarding across refresh, and never repeats for returning users", async () => {
    const mod = await import("@/routes/_authenticated/onboarding");
    const OnboardingComp = mod.Route.options.component as React.ComponentType;

    // 1. New email user advances Step 1 -> Step 2, picks Education & refreshes mid-flow
    mockAuthState.user = { id: "email-new-2", email: "carlos@example.com", user_metadata: {} };
    mockAuthState.profile = {
      id: "email-new-2",
      username: "carlos_edu",
      display_name: "Carlos",
      bio: "",
      country: "",
      avatar_url: null,
      interests: [],
      onboarding_completed_at: null,
    };

    const firstRender = renderOnboarding(OnboardingComp);
    fireEvent.change(screen.getByLabelText(/Country/i), { target: { value: "Mexico" } });
    fireEvent.click(screen.getByRole("button", { name: /Save & continue/i }));

    await waitFor(() => {
      expect(screen.getByText(/Step 2 of 4/i)).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /^Education/i }));
    firstRender.unmount();

    // Verify incomplete draft persisted cleanly
    const savedDraft = loadOnboardingDraft("email-new-2");
    expect(savedDraft?.step).toBe(2);
    expect(savedDraft?.country).toBe("Mexico");
    expect(savedDraft?.interests).toEqual(["education"]);

    // Simulated refresh remounts on Step 2 with state preserved
    const refreshedRender = renderOnboarding(OnboardingComp);
    expect(screen.getByText(/Step 2 of 4/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Education/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Can skip Connections (Step 3) and enter Ping cleanly
    fireEvent.click(screen.getByRole("button", { name: /Save & continue/i }));
    await waitFor(() => {
      expect(screen.getByText(/Step 3 of 4/i)).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /Skip this step/i }));
    expect(screen.getByText(/Step 4 of 4/i)).toBeTruthy();
    refreshedRender.unmount();
    clearOnboardingDraft("email-new-2");

    // 2. Returning user (onboarding_completed_at set) bypasses onboarding immediately
    navigateMock.mockClear();
    mockAuthState.user = { id: "returning-user-3" };
    mockAuthState.profile = {
      id: "returning-user-3",
      username: "returning_ping",
      display_name: "Returning User",
      bio: "",
      country: "Japan",
      interests: ["culture"],
      onboarding_completed_at: "2026-10-15T12:00:00Z",
    };

    renderOnboarding(OnboardingComp);
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({ to: "/", replace: true });
    });
  });

  it("blocks duplicate or invalid usernames and recovers cleanly from network interruption", async () => {
    const mod = await import("@/routes/_authenticated/onboarding");
    const OnboardingComp = mod.Route.options.component as React.ComponentType;

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return buildProfilesQueryMock({ conflictOnUsername: "taken_handle" });
      }
      return {
        select: () => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }),
      };
    });

    mockAuthState.user = { id: "conflict-user-4" };
    mockAuthState.profile = {
      id: "conflict-user-4",
      username: "starter_4",
      display_name: "Sam",
      bio: "",
      country: "",
      avatar_url: null,
      interests: [],
      onboarding_completed_at: null,
    };

    renderOnboarding(OnboardingComp);

    // 1. Invalid username rejected before RPC save
    fireEvent.change(screen.getByLabelText(/^Username$/i), { target: { value: "x!" } });
    fireEvent.click(screen.getByRole("button", { name: /Save & continue/i }));
    expect(screen.getByRole("alert").textContent).toMatch(/3–24 characters/i);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();

    // 2. Taken username conflict caught and prevents advancing step
    fireEvent.change(screen.getByLabelText(/^Username$/i), { target: { value: "taken_handle" } });
    await waitFor(() => {
      expect(screen.getByText(/taken_handle is already taken/i)).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /Save & continue/i })).toBeDisabled();

    // 3. Pick available handle, then simulate network failure -> retry succeeds
    fireEvent.change(screen.getByLabelText(/^Username$/i), { target: { value: "sam_available" } });
    await waitFor(() => {
      expect(screen.getByText(/sam_available is available/i)).toBeTruthy();
    });

    supabaseMock.rpc.mockRejectedValueOnce(new Error("Failed to fetch"));
    fireEvent.click(screen.getByRole("button", { name: /Save & continue/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/Network interruption/i);
      expect(screen.getByText(/Step 1 of 4/i)).toBeTruthy();
    });

    supabaseMock.rpc.mockResolvedValueOnce({ data: null, error: null });
    fireEvent.click(screen.getByRole("button", { name: /Retry save/i }));

    await waitFor(() => {
      expect(screen.getByText(/Step 2 of 4/i)).toBeTruthy();
    });
  });

  it("enforces mobile-first navigation, responsive grid controls, and optional verification messaging", () => {
    const root = process.cwd();
    const onboardingSrc = fs.readFileSync(
      path.resolve(root, "src/routes/_authenticated/onboarding.tsx"),
      "utf8",
    );
    const stepsSrc = fs.readFileSync(
      path.resolve(root, "src/components/onboarding/OnboardingSteps.tsx"),
      "utf8",
    );
    const settingsSrc = fs.readFileSync(
      path.resolve(root, "src/routes/_authenticated/settings.tsx"),
      "utf8",
    );
    const indexSrc = fs.readFileSync(path.resolve(root, "src/routes/index.tsx"), "utf8");

    expect(onboardingSrc).toContain("pb-28");
    expect(onboardingSrc).toContain("grid-cols-4");
    expect(onboardingSrc).toMatch(/verification\s+or upgrades are always optional/i);
    expect(stepsSrc).toContain("min-h-11");
    expect(stepsSrc).toContain("min-h-12");
    expect(settingsSrc).toContain("ONBOARDING_COUNTRIES");
    expect(settingsSrc).toContain("ONBOARDING_INTERESTS");
    expect(indexSrc).toContain("Recommended:");
    expect(indexSrc).toContain("Create Ping");
  });
});
