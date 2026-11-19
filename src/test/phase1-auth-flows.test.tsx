import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  navigateMock,
  mockAuthState,
  supabaseMock,
  searchParamsState,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  searchParamsState: {
    next: "/",
    reason: undefined as "expired" | undefined,
  },
  mockAuthState: {
    user: null as null | { id: string; email?: string; user_metadata?: Record<string, unknown> },
    ready: true,
    profile: null as null | Record<string, unknown>,
    profileLoading: false,
    sessionExpired: false,
    clearSessionExpired: vi.fn(),
    refreshProfile: vi.fn(),
  },
  supabaseMock: {
    auth: {
      getSession: vi.fn(),
      exchangeCodeForSession: vi.fn(),
      setSession: vi.fn(),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signInWithOAuth: vi.fn(),
      updateUser: vi.fn(),
    },
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

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

vi.mock("@/integrations/lovable", () => ({
  lovable: {
    auth: {
      signInWithOAuth: vi.fn(),
    },
  },
}));

function renderWithQuery(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("Phase 1 Workstream 1 Interactive Auth, OAuth Callback & Welcome Routing Flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
    searchParamsState.next = "/";
    searchParamsState.reason = undefined;
    mockAuthState.user = null;
    mockAuthState.ready = true;
    mockAuthState.profile = null;
    mockAuthState.profileLoading = false;
    mockAuthState.sessionExpired = false;

    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    supabaseMock.auth.exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    supabaseMock.auth.setSession.mockResolvedValue({ data: { session: null }, error: null });
    supabaseMock.auth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    supabaseMock.auth.signUp.mockResolvedValue({
      data: { user: { id: "new-user-uuid", identities: [{ id: "id-1" }] }, session: null },
      error: null,
    });
    supabaseMock.auth.updateUser.mockResolvedValue({ data: { user: null }, error: null });
    supabaseMock.rpc.mockResolvedValue({ data: null, error: null });
    supabaseMock.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    });
  });

  it("holds logged-out UI while auth readiness is pending to avoid auth flicker", async () => {
    const loginMod = await import("@/routes/login");
    const LoginComp = loginMod.Route.options.component as React.ComponentType;
    const welcomeMod = await import("@/routes/welcome");
    const WelcomeComp = welcomeMod.Route.options.component as React.ComponentType;

    mockAuthState.ready = false;
    const loginView = renderWithQuery(<LoginComp />);
    expect(screen.getByRole("status").textContent).toMatch(/Restoring your session/i);
    expect(screen.queryByRole("button", { name: /Continue with Google/i })).toBeNull();
    loginView.unmount();

    const welcomeView = renderWithQuery(<WelcomeComp />);
    expect(screen.getByRole("status").textContent).toMatch(/Opening Ping/i);
    expect(screen.queryByText(/Your world\./i)).toBeNull();
    welcomeView.unmount();
  });

  it("handles new and existing email authentication and blocks duplicate account registration", async () => {
    const signupMod = await import("@/routes/signup");
    const SignupComp = signupMod.Route.options.component as React.ComponentType;

    // 1. Existing duplicate email (identities: []) shows explicit duplicate-account error
    supabaseMock.auth.signUp.mockResolvedValueOnce({
      data: { user: { id: "dup-id", identities: [] }, session: null },
      error: null,
    });
    const dupView = renderWithQuery(<SignupComp />);
    fireEvent.change(screen.getByLabelText(/Your name/i), { target: { value: "Taylor" } });
    fireEvent.change(screen.getByLabelText(/^Username$/i), { target: { value: "taylor_m" } });
    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: "taylor@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue with Email/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/already exists/i);
    });
    dupView.unmount();

    // 2. Clean new email registration with immediate session routes to onboarding preserving destination
    searchParamsState.next = "/hubs";
    supabaseMock.auth.signUp.mockResolvedValueOnce({
      data: {
        user: { id: "fresh-user", identities: [{ id: "id-fresh" }] },
        session: { user: { id: "fresh-user" } },
      },
      error: null,
    });
    const newView = renderWithQuery(<SignupComp />);
    fireEvent.change(screen.getByLabelText(/Your name/i), { target: { value: "Jordan" } });
    fireEvent.change(screen.getByLabelText(/^Username$/i), { target: { value: "jordan_p" } });
    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: "jordan@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue with Email/i }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: "/onboarding",
        search: { next: "/hubs" },
        replace: true,
      });
    });
    newView.unmount();

    // 3. Existing email login submits signInWithPassword cleanly
    const loginMod = await import("@/routes/login");
    const LoginComp = loginMod.Route.options.component as React.ComponentType;
    renderWithQuery(<LoginComp />);
    expect(screen.queryByText(/Welcome back/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: "jordan@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: /Log in with Email/i }));

    await waitFor(() => {
      expect(supabaseMock.auth.signInWithPassword).toHaveBeenCalledWith({
        email: "jordan@example.com",
        password: "password123",
      });
    });
  });

  it("exchanges PKCE ?code= OAuth callbacks and handles failed OAuth callbacks and expired sessions", async () => {
    const loginMod = await import("@/routes/login");
    const LoginComp = loginMod.Route.options.component as React.ComponentType;

    // 1. PKCE callback
    window.history.replaceState(null, "", "/login?code=oauth_code_999&state=xyz");
    const view1 = renderWithQuery(<LoginComp />);
    await waitFor(() => {
      expect(supabaseMock.auth.exchangeCodeForSession).toHaveBeenCalledWith("oauth_code_999");
    });
    view1.unmount();

    // 2. Failed OAuth callback error in URL
    window.history.replaceState(
      null,
      "",
      "/login?error=access_denied&error_description=Google+sign-in+cancelled",
    );
    const view2 = renderWithQuery(<LoginComp />);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/cancelled/i);
    });
    view2.unmount();

    // 3. Expired session reason notice
    window.history.replaceState(null, "", "/login");
    searchParamsState.reason = "expired";
    renderWithQuery(<LoginComp />);
    expect(screen.getByRole("alert").textContent).toMatch(/session expired/i);
  });

  it("routes returning Google/authenticated users straight into Ping and new Google users to onboarding", async () => {
    const loginMod = await import("@/routes/login");
    const LoginComp = loginMod.Route.options.component as React.ComponentType;

    mockAuthState.user = { id: "user-returning" };
    mockAuthState.profile = {
      id: "user-returning",
      username: "returning_user",
      onboarding_completed_at: "2026-10-01T00:00:00Z",
    };
    searchParamsState.next = "/onboarding?next=%2Fhubs";

    const first = renderWithQuery(<LoginComp />);
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({ to: "/hubs", replace: true });
    });
    first.unmount();

    navigateMock.mockClear();
    mockAuthState.user = { id: "user-brand-new" };
    mockAuthState.profile = {
      id: "user-brand-new",
      username: "new_user",
      onboarding_completed_at: null,
    };
    searchParamsState.next = "/signals";

    renderWithQuery(<LoginComp />);
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: "/onboarding",
        search: { next: "/signals" },
        replace: true,
      });
    });
  });

  it("keeps onboarding skippable and preserves recovery-expired guidance on /reset-password", async () => {
    const onboardingMod = await import("@/routes/_authenticated/onboarding");
    const OnboardingComp = onboardingMod.Route.options.component as React.ComponentType;

    mockAuthState.user = { id: "new-user-1", user_metadata: { full_name: "Sam Rivera" } };
    mockAuthState.profile = {
      id: "new-user-1",
      username: "sam_rivera",
      display_name: "Sam Rivera",
      bio: "",
      avatar_url: null,
      participation_pathways: [],
      onboarding_completed_at: null,
    };

    const view = renderWithQuery(<OnboardingComp />);
    fireEvent.click(screen.getByRole("button", { name: /Skip for now/i }));
    await waitFor(() => {
      expect(supabaseMock.rpc).toHaveBeenCalledWith("complete_my_onboarding", {
        _display_name: null,
        _username: null,
        _bio: null,
        _avatar_url: null,
        _participation_pathways: null,
        _skip: true,
        _country: null,
        _interests: null,
        _mark_complete: true,
      });
    });
    view.unmount();

    const resetMod = await import("@/routes/reset-password");
    const ResetComp = resetMod.Route.options.component as React.ComponentType;
    renderWithQuery(<ResetComp />);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/missing or expired/i);
    });
  });
});
