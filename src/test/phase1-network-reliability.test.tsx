import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

type TableQueryState = {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  columns?: string;
  payload?: unknown;
  filters: Array<{ fn: string; args: unknown[] }>;
  singleMode: "many" | "single" | "maybeSingle";
};

type QueryResponse = {
  data?: unknown;
  error?: { message: string; code?: string } | null;
  count?: number | null;
};

const {
  navigateMock,
  routerState,
  authState,
  supabaseState,
  publicSupabaseState,
  publicPingsMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  routerState: {
    params: {} as Record<string, string>,
    search: {} as Record<string, unknown>,
    loaderData: undefined as unknown,
    location: { pathname: "/", searchStr: "" },
  },
  authState: {
    user: null as null | { id: string; email?: string },
    profile: null as null | {
      id: string;
      username: string;
      display_name: string;
      avatar_url: string | null;
      bio: string;
      created_at: string;
      interests?: string[];
      country?: string | null;
    },
    ready: true,
    session: null,
    profileLoading: false,
    profileError: null,
    refreshProfile: vi.fn(async () => null),
  },
  supabaseState: {
    tableHandler: (() => ({ data: [], error: null, count: 0 })) as (
      state: TableQueryState,
    ) => QueryResponse | Promise<QueryResponse>,
    rpcHandler: (async () => ({ data: [], error: null })) as (
      fn: string,
      args?: Record<string, unknown>,
    ) => QueryResponse | Promise<QueryResponse>,
  },
  publicSupabaseState: {
    tableHandler: (() => ({ data: null, error: null, count: 0 })) as (
      state: TableQueryState,
    ) => QueryResponse | Promise<QueryResponse>,
  },
  publicPingsMock: vi.fn(async () => ({
    pings: [],
    profile: null,
    connections: [],
  })),
}));

function buildQueryChain(
  table: string,
  handlerGetter: () => (state: TableQueryState) => QueryResponse | Promise<QueryResponse>,
) {
  const state: TableQueryState = {
    table,
    op: "select",
    filters: [],
    singleMode: "many",
  };
  const chain: Record<string, any> = {
    select(columns?: string) {
      if (columns !== undefined) state.columns = columns;
      return chain;
    },
    insert(payload: unknown) {
      state.op = "insert";
      state.payload = payload;
      return chain;
    },
    update(payload: unknown) {
      state.op = "update";
      state.payload = payload;
      return chain;
    },
    delete() {
      state.op = "delete";
      return chain;
    },
    eq(...args: unknown[]) {
      state.filters.push({ fn: "eq", args });
      return chain;
    },
    neq(...args: unknown[]) {
      state.filters.push({ fn: "neq", args });
      return chain;
    },
    in(...args: unknown[]) {
      state.filters.push({ fn: "in", args });
      return chain;
    },
    is(...args: unknown[]) {
      state.filters.push({ fn: "is", args });
      return chain;
    },
    or(...args: unknown[]) {
      state.filters.push({ fn: "or", args });
      return chain;
    },
    ilike(...args: unknown[]) {
      state.filters.push({ fn: "ilike", args });
      return chain;
    },
    order(...args: unknown[]) {
      state.filters.push({ fn: "order", args });
      return chain;
    },
    range(...args: unknown[]) {
      state.filters.push({ fn: "range", args });
      return chain;
    },
    limit(...args: unknown[]) {
      state.filters.push({ fn: "limit", args });
      return chain;
    },
    single() {
      state.singleMode = "single";
      return chain;
    },
    maybeSingle() {
      state.singleMode = "maybeSingle";
      return chain;
    },
    then(onFulfilled: (val: QueryResponse) => unknown, onRejected?: (err: unknown) => unknown) {
      return Promise.resolve(handlerGetter()(state)).then(onFulfilled, onRejected);
    },
  };
  return chain;
}

const channelMock = {
  on() {
    return channelMock;
  },
  subscribe() {
    return channelMock;
  },
  track() {
    return Promise.resolve("ok");
  },
  presenceState() {
    return {};
  },
};

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    createFileRoute: () => (opts: any) => ({
      ...opts,
      options: opts,
      useParams: () => routerState.params,
      useSearch: () => routerState.search,
      useLoaderData: () => routerState.loaderData,
    }),
    Link: ({
      children,
      to,
      onClick,
      className,
      search: _search,
      params: _params,
      activeProps: _activeProps,
      activeOptions: _activeOptions,
      preload: _preload,
      replace: _replace,
      ...rest
    }: {
      children?: ReactNode;
      to?: string;
      onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
      className?: string;
      search?: unknown;
      params?: unknown;
      activeProps?: unknown;
      activeOptions?: unknown;
      preload?: unknown;
      replace?: unknown;
      [key: string]: unknown;
    }) => (
      <a
        href={typeof to === "string" ? to : "#"}
        onClick={(e) => {
          e.preventDefault();
          onClick?.(e);
        }}
        className={className}
        {...rest}
      >
        {children}
      </a>
    ),
    useNavigate: () => navigateMock,
    useLocation: () => routerState.location,
  };
});

vi.mock("@tanstack/react-start", () => {
  const createChain = (): any => ({
    inputValidator: () => createChain(),
    validator: () => createChain(),
    middleware: () => createChain(),
    handler: (fn: (ctx: { data: any }) => unknown) => (input?: { data?: any }) =>
      fn({ data: input?.data ?? input ?? {} }),
  });
  return {
    createServerFn: () => createChain(),
    useServerFn: (fn: any) => fn,
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((table: string) => buildQueryChain(table, () => supabaseState.tableHandler)),
    rpc: vi.fn((fn: string, args?: Record<string, unknown>) => supabaseState.rpcHandler(fn, args)),
    channel: vi.fn(() => channelMock),
    removeChannel: vi.fn(),
    auth: {
      signOut: vi.fn(async () => ({ error: null })),
    },
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(async () => ({ error: null })),
        getPublicUrl: vi.fn(() => ({ data: { publicUrl: "https://cdn.example.com/file.png" } })),
      })),
    },
  },
}));

vi.mock("@/lib/supabase-public-config", () => ({
  createPublicSupabaseClient: () => ({
    from: vi.fn((table: string) => buildQueryChain(table, () => publicSupabaseState.tableHandler)),
  }),
}));

vi.mock("@/lib/public-pings.functions", () => ({
  PUBLIC_PING_SELECT: "id",
  readPublicPings: (...args: any[]) => publicPingsMock(...(args as [])),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => authState,
  markIntentionalSignOut: vi.fn(),
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: "dark", resolvedTheme: "dark", setTheme: vi.fn() }),
}));

vi.mock("@/lib/admin.functions", () => ({
  checkAdminAccess: vi.fn(async () => ({ isAdmin: false })),
}));

vi.mock("@/lib/economy", () => ({
  dotSummaryQuery: (userId?: string) => ({
    queryKey: ["dot-summary", userId],
    enabled: false,
    queryFn: async () => null,
  }),
  publicAccountTierQuery: (userId?: string) => ({
    queryKey: ["account-tier", userId],
    enabled: false,
    queryFn: async () => null,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { NavOverlayProvider } from "@/lib/nav-overlay";
import { readPublicHub } from "@/lib/public-hubs.functions";
import { useMarkConversationRead } from "@/lib/messages";
import { Route as ExploreRoute } from "@/routes/explore";
import { Route as HubDetailRoute } from "@/routes/hubs.$slug";
import { Route as ProfileRoute } from "@/routes/@{$username}";
import { DirectMessageChat } from "@/components/messages/DirectMessageChat";
import { MessagesWorkspace } from "@/components/messages/MessagesWorkspace";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { DesktopSidebar } from "@/components/layout/DesktopSidebar";

const userA = {
  id: "user-a-uuid",
  username: "alice",
  display_name: "Alice Wonder",
  avatar_url: null,
  bio: "Product designer and founder",
  created_at: "2026-01-01T00:00:00Z",
};

const userB = {
  id: "user-b-uuid",
  username: "bob",
  display_name: "Bob Builder",
  avatar_url: null,
  bio: "Community organizer",
  created_at: "2026-01-02T00:00:00Z",
};

const userC = {
  id: "user-c-uuid",
  username: "charlie",
  display_name: "Charlie Spark",
  avatar_url: null,
  bio: "Creative technologist",
  created_at: "2026-01-03T00:00:00Z",
};

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function renderWithApp(ui: ReactNode, client = makeClient()) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <NavOverlayProvider>
          <Suspense fallback={<div>Loading...</div>}>{ui}</Suspense>
        </NavOverlayProvider>
      </QueryClientProvider>,
    ),
  };
}

describe("Phase 1 Workstream 3: Core Network Reliability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    }
    routerState.params = {};
    routerState.search = {};
    routerState.loaderData = undefined;
    routerState.location = { pathname: "/", searchStr: "" };
    authState.user = { id: userA.id, email: "alice@example.com" };
    authState.profile = { ...userA };
    authState.ready = true;
    supabaseState.tableHandler = () => ({ data: [], error: null, count: 0 });
    supabaseState.rpcHandler = async () => ({ data: [], error: null });
    publicSupabaseState.tableHandler = () => ({ data: null, error: null, count: 0 });
    publicPingsMock.mockResolvedValue({ pings: [], profile: null, connections: [] });
  });

  describe("1. Two-account & public/private content boundaries", () => {
    it("readPublicHub never exposes feed items for private hubs", async () => {
      const queriedTables: string[] = [];
      publicSupabaseState.tableHandler = (state) => {
        queriedTables.push(state.table);
        if (state.table === "hubs") {
          return {
            data: {
              id: "hub-priv-1",
              slug: "inner-circle",
              name: "Inner Circle",
              tagline: "Private group",
              description: "",
              rules: "",
              category: "other",
              access: "private",
              resources: [],
              verified: false,
              member_count: 4,
              ping_count: 12,
              member_limit: 500,
              owner_id: userA.id,
              created_at: "2026-02-01T00:00:00Z",
            },
            error: null,
          };
        }
        return { data: [], error: null };
      };

      const res = await readPublicHub({ data: { slug: "inner-circle", intent: null } });
      expect(res.hub?.access).toBe("private");
      expect(res.feed).toEqual([]);
      expect(queriedTables).toEqual(["hubs"]);
    });

    it("HubDetail blocks private feed and member list queries for pending User B, while allowing active User A", async () => {
      const privateHub = {
        id: "hub-priv-1",
        slug: "inner-circle",
        name: "Inner Circle",
        tagline: "Private workspace",
        description: "",
        rules: "",
        category: "other",
        access: "private",
        resources: [],
        verified: false,
        member_count: 2,
        ping_count: 1,
        member_limit: 500,
        owner_id: userA.id,
        created_at: "2026-02-01T00:00:00Z",
      };

      // Switch active session to User B (pending applicant)
      authState.user = { id: userB.id, email: "bob@example.com" };
      authState.profile = { ...userB };
      routerState.params = { slug: "inner-circle" };
      routerState.search = { tab: "feed" };

      publicSupabaseState.tableHandler = (state) =>
        state.table === "hubs" ? { data: privateHub, error: null } : { data: [], error: null };

      const queriesAsPending: string[] = [];
      supabaseState.tableHandler = (state) => {
        queriesAsPending.push(`${state.table}:${state.singleMode}`);
        if (state.table === "hub_members" && state.singleMode === "maybeSingle") {
          return { data: { role: "member", status: "pending" }, error: null };
        }
        return { data: [], error: null };
      };

      const HubDetail = HubDetailRoute.options.component as React.ComponentType;
      const pendingRender = renderWithApp(<HubDetail />);

      await waitFor(
        () => {
          expect(screen.getByText("This hub is private")).toBeInTheDocument();
          expect(screen.getByRole("button", { name: "Request Pending" })).toBeDisabled();
        },
        { timeout: 4000 },
      );

      expect(queriesAsPending.some((q) => q.startsWith("hub_pings:"))).toBe(false);
      expect(queriesAsPending.some((q) => q === "hub_members:many")).toBe(false);
      pendingRender.unmount();

      // Switch to active owner User A
      authState.user = { id: userA.id, email: "alice@example.com" };
      authState.profile = { ...userA };
      supabaseState.tableHandler = (state) => {
        if (state.table === "hub_members" && state.singleMode === "maybeSingle") {
          return { data: { role: "owner", status: "active" }, error: null };
        }
        if (state.table === "hub_pings") {
          return {
            data: [
              {
                intent: "update",
                is_pinned: false,
                created_at: "2026-03-01T00:00:00Z",
                ping: {
                  id: "ping-priv-1",
                  user_id: userA.id,
                  category: "progress",
                  content: "Private hub update visible only to active members",
                  image_url: null,
                  cta_url: null,
                  cta_label: null,
                  created_at: "2026-03-01T00:00:00Z",
                  updated_at: "2026-03-01T00:00:00Z",
                  author: userA,
                  likes: [{ count: 0 }],
                  replies: [{ count: 0 }],
                },
              },
            ],
            error: null,
          };
        }
        return { data: [], error: null };
      };

      renderWithApp(<HubDetail />);
      await waitFor(
        () => {
          expect(
            screen.getByText("Private hub update visible only to active members"),
          ).toBeInTheDocument();
        },
        { timeout: 4000 },
      );
    });

    it("MessagesWorkspace shows recoverable error and unavailable fallback when a conversation link is restricted", async () => {
      authState.user = { id: userB.id, email: "bob@example.com" };
      authState.profile = { ...userB };

      supabaseState.rpcHandler = async (fn) => {
        if (fn === "get_my_conversations_summary") {
          return { data: [], error: null };
        }
        return { data: null, error: null };
      };
      supabaseState.tableHandler = (state) => {
        if (state.table === "conversation_members" && state.singleMode === "maybeSingle") {
          return { data: null, error: { message: "permission denied for conversation" } };
        }
        return { data: [], error: null };
      };

      const errRender = renderWithApp(
        <MessagesWorkspace basePath="/messages" conversationId="conv-secret-1" />,
      );

      await waitFor(() => {
        expect(screen.getByText("Couldn't open conversation")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Back to conversations" })).toBeInTheDocument();
      });
      errRender.unmount();

      supabaseState.tableHandler = (state) => {
        if (state.table === "conversation_members" && state.singleMode === "maybeSingle") {
          return { data: null, error: null };
        }
        return { data: [], error: null };
      };

      renderWithApp(<MessagesWorkspace basePath="/signals" conversationId="conv-missing-2" />);
      await waitFor(() => {
        expect(screen.getByText("Conversation unavailable")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Back to inbox" })).toBeInTheDocument();
      });
    });
  });

  describe("2. Explore discovery & follow persistence", () => {
    it("hydrates follow state for User A, handles follow errors without fake success toasts, and renders people/feed recovery UI", async () => {
      routerState.search = { filter: "people" };
      let failFollowInsert = true;

      supabaseState.tableHandler = (state) => {
        if (state.table === "profiles") {
          return { data: [userB, userC], error: null };
        }
        if (state.table === "follows" && state.op === "select") {
          return { data: [{ following_id: userB.id }], error: null };
        }
        if (state.table === "follows" && state.op === "insert") {
          if (failFollowInsert) {
            return { data: null, error: { message: "Network timeout writing follow" } };
          }
          return { data: [{ following_id: userC.id }], error: null };
        }
        return { data: [], error: null };
      };

      const Explore = ExploreRoute.options.component as React.ComponentType;
      renderWithApp(<Explore />);

      await waitFor(() => {
        expect(screen.getByText("@bob")).toBeInTheDocument();
        expect(screen.getByText("@charlie")).toBeInTheDocument();
      });

      const followButtons = screen.getAllByRole("button", { name: /Follow|Following/i });
      expect(followButtons[0]).toHaveTextContent(/Following/i);
      expect(followButtons[1]).toHaveTextContent(/^Follow$/i);

      // Failed follow must report error and NOT show "Following @charlie"
      const initialFollowBtn = followButtons[1];
      if (!initialFollowBtn) throw new Error("Expected follow button for Charlie");
      fireEvent.click(initialFollowBtn);
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("Could not update follow status.");
      });
      expect(toast.success).not.toHaveBeenCalled();

      // Recover cleanly when retry succeeds
      failFollowInsert = false;
      const retryFollowBtn = screen.getAllByRole("button", { name: /^Follow$/i })[0];
      if (!retryFollowBtn) throw new Error("Expected retry follow button for Charlie");
      fireEvent.click(retryFollowBtn);
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith("Following @charlie");
      });
    });
  });

  describe("3. Public profile & FollowListDialog state sync", () => {
    it("syncs FollowListDialog mode between Followers and Following on repeated opens and displays QueryErrorCard on errors", async () => {
      routerState.params = { username: "alice" };
      authState.user = { id: userB.id, email: "bob@example.com" };
      authState.profile = { ...userB };

      let failFollowersFetch = false;
      supabaseState.tableHandler = (state) => {
        if (state.table === "follows") {
          if (state.columns?.includes("follower:profiles")) {
            if (failFollowersFetch) {
              return { data: null, error: { message: "Could not read followers" } };
            }
            return { data: [{ follower: userB }], error: null };
          }
          if (state.columns?.includes("following:profiles")) {
            return { data: [{ following: userC }], error: null };
          }
          return { data: [], error: null, count: 1 };
        }
        return { data: [], error: null };
      };

      const client = makeClient();
      client.setQueryData(["profile", "alice"], {
        profile: userA,
        pings: [],
        connections: [],
      });
      client.setQueryData(["follow", userA.id, userB.id], {
        followers: 1,
        following: 1,
        isFollowing: false,
      });

      const ProfilePage = ProfileRoute.options.component as React.ComponentType;
      renderWithApp(<ProfilePage />, client);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /1\s+followers/i })).toBeInTheDocument();
      });

      // Open Followers modal
      fireEvent.click(screen.getByRole("button", { name: /1\s+followers/i }));
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(screen.getByText("@bob")).toBeInTheDocument();
      });

      // Close modal via Close button, then reopen in Following mode
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: /1\s+following/i }));
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(screen.getByText("@charlie")).toBeInTheDocument();
      });

      // Inject error into followers query and switch tab to Followers
      failFollowersFetch = true;
      await client.invalidateQueries({ queryKey: ["profile-follow-list", userA.id, "followers"] });
      fireEvent.click(screen.getByRole("button", { name: "Followers" }));
      await waitFor(() => {
        expect(screen.getByText("Couldn't load connections")).toBeInTheDocument();
      });
    });
  });

  describe("4. Direct messages, draft preservation & optimistic unread counts", () => {
    it("DirectMessageChat shows loading state cleanly and restores typed draft when sending fails", async () => {
      authState.user = { id: userA.id, email: "alice@example.com" };
      authState.profile = { ...userA };

      const conv = {
        id: "conv-1",
        type: "direct" as const,
        created_by: userA.id,
        last_message_at: "2026-03-01T00:00:00Z",
        last_message_preview: null,
        created_at: "2026-03-01T00:00:00Z",
        updated_at: "2026-03-01T00:00:00Z",
        other_member: {
          id: userB.id,
          username: userB.username,
          display_name: userB.display_name,
          bio: userB.bio,
          avatar_url: null,
          created_at: userB.created_at,
        },
        unread_count: 0,
      };

      const loadingView = renderWithApp(
        <DirectMessageChat conversation={conv} messages={[]} isLoading={true} />,
      );
      expect(screen.getByLabelText("Loading messages")).toBeInTheDocument();
      expect(screen.queryByText(/Say hello!/i)).not.toBeInTheDocument();
      loadingView.unmount();

      supabaseState.rpcHandler = async (fn) => {
        if (fn === "send_private_message") {
          return { data: null, error: { message: "Offline send failure" } };
        }
        return { data: null, error: null };
      };

      renderWithApp(<DirectMessageChat conversation={conv} messages={[]} isLoading={false} />);

      const input = screen.getByPlaceholderText("Message Bob Builder…") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "Important unsent draft" } });
      fireEvent.click(screen.getByRole("button", { name: "Send message" }));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("Offline send failure");
        expect(input.value).toBe("Important unsent draft");
      });
    });

    it("useMarkConversationRead optimistically zeroes unread_count and rolls back on RPC error", async () => {
      authState.user = { id: userB.id, email: "bob@example.com" };
      const client = makeClient();
      const seedConvs = [
        {
          id: "conv-1",
          type: "direct" as const,
          created_by: userA.id,
          last_message_at: "2026-03-01T00:00:00Z",
          last_message_preview: "Hi Bob",
          created_at: "2026-03-01T00:00:00Z",
          updated_at: "2026-03-01T00:00:00Z",
          other_member: userA,
          unread_count: 3,
        },
      ];
      client.setQueryData(["user-conversations", userB.id, 50, 0], seedConvs);

      let resolveRpc!: (val: QueryResponse) => void;
      supabaseState.rpcHandler = () =>
        new Promise<QueryResponse>((resolve) => {
          resolveRpc = resolve;
        });

      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );

      const { result } = renderHook(() => useMarkConversationRead(), { wrapper });

      let mutationPromise!: Promise<void>;
      act(() => {
        mutationPromise = result.current.mutateAsync("conv-1").catch(() => {});
      });

      await waitFor(() => {
        const cached = client.getQueryData<typeof seedConvs>([
          "user-conversations",
          userB.id,
          50,
          0,
        ]);
        expect(cached?.[0]?.unread_count).toBe(0);
      });

      await act(async () => {
        resolveRpc({ data: null, error: { message: "RPC failed" } });
        await mutationPromise;
      });

      const restored = client.getQueryData<typeof seedConvs>([
        "user-conversations",
        userB.id,
        50,
        0,
      ]);
      expect(restored?.[0]?.unread_count).toBe(3);
    });
  });

  describe("5. Notifications & Navigation overlays", () => {
    it("renders comment, follow, and like notifications, clears unread dot on open, and closes overlays on route change", async () => {
      authState.user = { id: userA.id, email: "alice@example.com" };
      authState.profile = { ...userA };

      supabaseState.tableHandler = (state) => {
        if (state.table === "pings") {
          return { data: [{ id: "ping-1", content: "Launch update" }], error: null };
        }
        if (state.table === "comments") {
          return {
            data: [
              {
                id: "c-1",
                ping_id: "ping-1",
                user_id: userB.id,
                content: "Great update!",
                created_at: "2026-03-01T10:02:00Z",
                author: { username: userB.username, display_name: userB.display_name },
              },
            ],
            error: null,
          };
        }
        if (state.table === "follows") {
          return {
            data: [
              {
                follower_id: userC.id,
                created_at: "2026-03-01T10:01:00Z",
                follower: { username: userC.username, display_name: userC.display_name },
              },
            ],
            error: null,
          };
        }
        if (state.table === "likes") {
          return {
            data: [
              {
                ping_id: "ping-1",
                user_id: userB.id,
                created_at: "2026-03-01T10:03:00Z",
                actor: { username: userB.username, display_name: userB.display_name },
              },
            ],
            error: null,
          };
        }
        return { data: [], error: null };
      };

      const client = makeClient();
      const { rerender } = render(
        <QueryClientProvider client={client}>
          <NavOverlayProvider>
            <DesktopSidebar />
            <SiteHeader />
          </NavOverlayProvider>
        </QueryClientProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("notifications-unread-dot")).toBeInTheDocument();
        expect(screen.getByTestId("sidebar-notifications-unread-dot")).toBeInTheDocument();
      });

      const bellButtons = screen.getAllByRole("button", { name: "Notifications" });
      const firstBellBtn = bellButtons[0];
      if (!firstBellBtn) throw new Error("Expected notifications bell button");
      fireEvent.click(firstBellBtn);

      await waitFor(() => {
        expect(screen.getByText(/Bob Builder liked "Launch update…"/i)).toBeInTheDocument();
        expect(screen.getByText(/Bob Builder replied to "Launch update…"/i)).toBeInTheDocument();
        expect(screen.getByText(/Charlie Spark started following you/i)).toBeInTheDocument();
        expect(screen.queryByTestId("notifications-unread-dot")).not.toBeInTheDocument();
        expect(screen.queryByTestId("sidebar-notifications-unread-dot")).not.toBeInTheDocument();
      });

      // Route change closes active Notifications sheet automatically
      routerState.location = { pathname: "/explore", searchStr: "" };
      rerender(
        <QueryClientProvider client={client}>
          <NavOverlayProvider>
            <DesktopSidebar />
            <SiteHeader />
          </NavOverlayProvider>
        </QueryClientProvider>,
      );

      await waitFor(() => {
        expect(screen.queryByText(/Bob Builder liked "Launch update…"/i)).not.toBeInTheDocument();
      });
    });

    it("surfaces recoverable QueryErrorCard inside Notifications Sheet when Supabase fails", async () => {
      authState.user = { id: userA.id, email: "alice@example.com" };
      authState.profile = { ...userA };

      supabaseState.tableHandler = (state) => {
        if (state.table === "pings") {
          return { data: null, error: { message: "Notifications service unreachable" } };
        }
        return { data: [], error: null };
      };

      renderWithApp(<SiteHeader />);
      fireEvent.click(screen.getByRole("button", { name: "Notifications" }));

      await waitFor(() => {
        expect(screen.getByText("Couldn't load notifications")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Try again|Retry/i })).toBeInTheDocument();
      });
    });
  });
});
