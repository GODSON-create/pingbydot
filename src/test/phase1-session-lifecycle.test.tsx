import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { navigateMock, invalidateMock, authListeners, supabaseSessionMock, mockAdminCheck } =
  vi.hoisted(() => ({
    navigateMock: vi.fn(),
    invalidateMock: vi.fn(),
    authListeners: new Set<(event: string, session: { user: { id: string } } | null) => void>(),
    supabaseSessionMock: {
      auth: {
        getSession: vi.fn(),
        getUser: vi.fn(),
        signOut: vi.fn(),
        onAuthStateChange: vi.fn(),
      },
      from: vi.fn(),
      rpc: vi.fn(),
    },
    mockAdminCheck: vi.fn().mockResolvedValue({ isAdmin: false }),
  }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    options: opts,
  }),
  Outlet: () => null,
  redirect: (opts: unknown) => Object.assign(new Error("REDIRECT"), { redirectOptions: opts }),
  Link: ({ children, to }: { children: React.ReactNode; to?: string }) => (
    <a href={typeof to === "string" ? to : "#"}>{children}</a>
  ),
  useNavigate: () => navigateMock,
  useRouter: () => ({ invalidate: invalidateMock }),
}));

vi.mock("@tanstack/react-start", () => {
  const fnChain = (): Record<string, unknown> => ({
    handler: () => vi.fn(),
    validator: () => fnChain(),
    inputValidator: () => fnChain(),
    middleware: () => fnChain(),
  });
  return {
    createMiddleware: () => ({
      client: () => ({}),
      server: () => ({}),
    }),
    createServerFn: () => fnChain(),
    useServerFn: () => mockAdminCheck,
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: supabaseSessionMock,
}));

vi.mock("@/lib/nav-overlay", () => ({
  useNavOverlay: () => ({
    openOverlay: vi.fn(),
    closeOverlays: vi.fn(),
    isOpen: () => false,
    onOpenChangeFor: () => vi.fn(),
  }),
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    theme: "system",
    resolvedTheme: "dark",
    setTheme: vi.fn(),
  }),
}));

import { AuthProvider, useAuth } from "@/lib/auth";
import { hasSeenWelcome } from "@/lib/pathways";
import { useSignOut } from "@/components/layout/SiteHeader";

function SessionProbe() {
  const { user, ready, profile, sessionExpired } = useAuth();
  const signOut = useSignOut();
  return (
    <div>
      <span data-testid="ready">{String(ready)}</span>
      <span data-testid="user-id">{user?.id ?? "none"}</span>
      <span data-testid="username">{profile?.username ?? "none"}</span>
      <span data-testid="expired">{String(sessionExpired)}</span>
      <button type="button" onClick={() => void signOut()}>
        Log out
      </button>
    </div>
  );
}

describe("Phase 1 Session Restoration, Expired Session, Logout & Protected Route Guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authListeners.clear();
    window.localStorage.clear();
    window.sessionStorage.clear();

    supabaseSessionMock.auth.onAuthStateChange.mockImplementation((cb) => {
      authListeners.add(cb);
      return {
        data: {
          subscription: {
            unsubscribe: () => authListeners.delete(cb),
          },
        },
      };
    });

    supabaseSessionMock.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    supabaseSessionMock.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });
    supabaseSessionMock.auth.signOut.mockImplementation(async () => {
      for (const cb of authListeners) {
        cb("SIGNED_OUT", null);
      }
      return { error: null };
    });

    supabaseSessionMock.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: "user-123",
              username: "sam_ping",
              display_name: "Sam",
              bio: "",
              avatar_url: null,
              created_at: "2026-01-01T00:00:00Z",
              onboarding_completed_at: "2026-01-01T00:00:00Z",
            },
            error: null,
          }),
        }),
      }),
    });
  });

  it("restores a valid Supabase session after refresh without spurious expiration", async () => {
    supabaseSessionMock.auth.getSession.mockResolvedValueOnce({
      data: {
        session: {
          user: { id: "user-123" },
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
      error: null,
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <SessionProbe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("ready").textContent).toBe("true");
      expect(screen.getByTestId("user-id").textContent).toBe("user-123");
      expect(screen.getByTestId("username").textContent).toBe("sam_ping");
      expect(screen.getByTestId("expired").textContent).toBe("false");
    });
  });

  it("detects expired stored sessions on restore and triggers clean logout without marking sessionExpired", async () => {
    // 1. Expired session whose server validation fails
    supabaseSessionMock.auth.getSession.mockResolvedValueOnce({
      data: {
        session: {
          user: { id: "user-expired" },
          expires_at: Math.floor(Date.now() / 1000) - 120,
        },
      },
      error: null,
    });
    supabaseSessionMock.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "JWT expired" },
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const expiredView = render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <SessionProbe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("ready").textContent).toBe("true");
      expect(screen.getByTestId("user-id").textContent).toBe("none");
      expect(screen.getByTestId("expired").textContent).toBe("true");
    });
    expect(supabaseSessionMock.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expiredView.unmount();

    // 2. Intentional logout clears cache, preserves welcome-seen, routes to /login, and does not set sessionExpired
    vi.clearAllMocks();
    supabaseSessionMock.auth.getSession.mockResolvedValueOnce({
      data: {
        session: {
          user: { id: "user-123" },
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
      error: null,
    });

    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <SessionProbe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("user-id").textContent).toBe("user-123");
    });

    fireEvent.click(screen.getByRole("button", { name: /Log out/i }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({ to: "/login", replace: true });
    });
    expect(hasSeenWelcome()).toBe(true);
    expect(screen.getByTestId("expired").textContent).toBe("false");
  });

  it("preserves intended protected-route URL and marks expired reason cleanly in _authenticated guard", async () => {
    const routeMod = await import("@/routes/_authenticated/route");
    const beforeLoad = (
      routeMod.Route.options as unknown as {
        beforeLoad: (args: { location: { pathname: string; searchStr: string } }) => Promise<void>;
      }
    ).beforeLoad;

    // 1. Signed-out protected access preserves /create?draft=1
    supabaseSessionMock.auth.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });
    await expect(
      beforeLoad({ location: { pathname: "/create", searchStr: "?draft=1" } }),
    ).rejects.toMatchObject({
      redirectOptions: {
        to: "/login",
        search: { next: "/create?draft=1" },
      },
    });

    // 2. Expired session on protected access adds reason: "expired"
    supabaseSessionMock.auth.getSession.mockResolvedValueOnce({
      data: {
        session: {
          user: { id: "user-old" },
          expires_at: Math.floor(Date.now() / 1000) - 60,
        },
      },
      error: null,
    });
    supabaseSessionMock.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "Token expired" },
    });

    await expect(
      beforeLoad({ location: { pathname: "/settings", searchStr: "" } }),
    ).rejects.toMatchObject({
      redirectOptions: {
        to: "/login",
        search: { next: "/settings", reason: "expired" },
      },
    });
  });
});
