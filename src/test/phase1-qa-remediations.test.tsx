import fs from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/lib/theme";

const authState = {
  user: null as { id: string } | null,
  ready: false,
  profile: null as { id: string; username: string; display_name: string | null } | null,
  profileLoading: false,
  sessionExpired: false,
  clearSessionExpired: vi.fn(),
  refreshProfile: vi.fn(),
};

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    createFileRoute: () => (options: Record<string, unknown>) => ({
      options,
      useSearch: () => ({ tab: "foryou" }),
      useLoaderData: () => [],
    }),
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

vi.mock("@/lib/auth", () => ({
  useAuth: () => authState,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithOAuth: vi.fn(),
    },
    rpc: vi.fn(),
  },
}));

vi.mock("@/components/moments/MomentsTray", () => ({
  MomentsTray: () => <div data-testid="moments-tray">Moments Tray</div>,
}));

vi.mock("@/components/AriseCallout", () => ({
  AriseCallout: () => <div data-testid="arise-callout" />,
}));

vi.mock("@/lib/pings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pings")>("@/lib/pings");
  return {
    ...actual,
    feedQuery: () => ({
      queryKey: ["feed", null, 0],
      queryFn: async () => [],
    }),
    followingFeedQuery: () => ({
      queryKey: ["following-feed", null, 0],
      queryFn: async () => [],
    }),
  };
});

vi.mock("@/lib/hub-queries", () => ({
  hubsQuery: () => ({ queryKey: ["hubs"], queryFn: async () => [] }),
  myHubsQuery: () => ({ queryKey: ["my-hubs"], queryFn: async () => [] }),
  myPendingHubsQuery: () => ({ queryKey: ["my-pending-hubs"], queryFn: async () => new Set() }),
  hubError: (err: unknown) => String(err),
}));

vi.mock("@/lib/messages", () => ({
  userConversationsQuery: () => ({ queryKey: ["conversations"], queryFn: async () => [] }),
}));

const sonnerPropsSpy = vi.fn();

vi.mock("sonner", () => ({
  Toaster: (props: Record<string, unknown>) => {
    sonnerPropsSpy(props);
    return <div data-testid="sonner-toaster" data-position={String(props["position"] ?? "")} />;
  },
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

const readSrc = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

describe("Phase 1 QA Remediations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    authState.user = null;
    authState.ready = false;
    authState.profile = null;
  });

  it("positions Sonner at top-center on mobile viewports and top-right on desktop", async () => {
    const mockMatchMedia = (matchesMax767: boolean) =>
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("767px") ? matchesMax767 : false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: mockMatchMedia(true),
    });

    const { Toaster } = await import("@/components/ui/sonner");
    const mobileView = render(
      <ThemeProvider>
        <Toaster />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("sonner-toaster").getAttribute("data-position")).toBe("top-center");
    });
    const lastMobileProps = sonnerPropsSpy.mock.calls.at(-1)?.[0] as {
      mobileOffset?: { top?: string };
    };
    expect(lastMobileProps?.mobileOffset?.top).toContain("4.5rem");
    mobileView.unmount();

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: mockMatchMedia(false),
    });

    render(
      <ThemeProvider>
        <Toaster />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("sonner-toaster").getAttribute("data-position")).toBe("top-right");
    });
    const rootSrc = readSrc("src/routes/__root.tsx");
    expect(rootSrc).not.toContain('<Toaster position="bottom-center"');
    expect(rootSrc).toContain("<Toaster />");
  });

  it("holds Home feed mount during boot and shows 3-slide WelcomeCarousel to first-time guests on /", async () => {
    const indexMod = await import("@/routes/index");
    const HomePageComponent = (
      indexMod.Route as unknown as { options: { component: React.ComponentType } }
    ).options.component;

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    // 1. Pre-ready boot state: never mounts HomeFeedContent underneath BootSplashScreen
    const view = render(
      <QueryClientProvider client={qc}>
        <HomePageComponent />
      </QueryClientProvider>,
    );

    expect(screen.getByText(/Opening Ping/i)).toBeTruthy();
    expect(screen.queryByTestId("moments-tray")).toBeNull();
    expect(screen.queryByText("For You")).toBeNull();

    // 2. Ready first-time visitor (!user, welcome not seen): mounts 3-slide WelcomeCarousel on /
    authState.ready = true;
    view.rerender(
      <QueryClientProvider client={qc}>
        <HomePageComponent />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Slide 1 of 3/i)).toBeTruthy();
      expect(screen.getByText(/Your world\. Your people\. Your possibilities\./i)).toBeTruthy();
    });
    expect(screen.queryByTestId("moments-tray")).toBeNull();

    // 3. Skipping welcome reveals Home feed immediately
    fireEvent.click(screen.getByRole("button", { name: /^Skip$/i }));
    await waitFor(() => {
      expect(screen.getByTestId("moments-tray")).toBeTruthy();
      expect(screen.getByText("For You")).toBeTruthy();
    });
    view.unmount();

    // 4. Returning authenticated user goes directly into Home feed even with fresh storage
    window.localStorage.clear();
    authState.user = { id: "user-123" };
    authState.profile = { id: "user-123", username: "alex", display_name: "Alex" };
    render(
      <QueryClientProvider client={qc}>
        <HomePageComponent />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("moments-tray")).toBeTruthy();
      expect(screen.getByText(/Hey Alex, what's new\?/i)).toBeTruthy();
    });
    expect(screen.queryByText(/Slide 1 of 3/i)).toBeNull();
  }, 30000);

  it("ensures mobile /hubs empty state includes bottom clearance above Community navigation", () => {
    const hubsSrc = readSrc("src/routes/hubs.tsx");
    expect(hubsSrc).toContain("py-4 sm:py-8 pb-32 sm:pb-24");
    expect(hubsSrc).toContain("p-6 sm:p-10 text-center");
  });
});
