import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";

let mockPathname = "/";
let mockSearchStr = "";
const mockNavigate = vi.fn();
const mockOpenOverlay = vi.fn();
const mockCloseOverlays = vi.fn();

let mockUser: { id: string; email: string } | null = {
  id: "user-1",
  email: "ada@ping.test",
};
let mockProfile: {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
} | null = {
  id: "user-1",
  username: "ada",
  display_name: "Ada Lovelace",
  avatar_url: null,
};

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      to,
      params,
      search,
      children,
      className,
      title,
      onClick,
      "aria-label": ariaLabel,
      "aria-current": ariaCurrent,
      "data-inbox-section": dataInboxSection,
    }: any) => {
      const resolvedPath =
        typeof to === "string" && params?.username
          ? to.replace("{$username}", params.username)
          : typeof to === "string" && params?.slug
            ? to.replace("$slug", params.slug)
            : to;
      const qs =
        search && typeof search === "object" && Object.keys(search).length > 0
          ? `?${new URLSearchParams(search).toString()}`
          : "";
      return (
        <a
          href={`${resolvedPath}${qs}`}
          className={className}
          title={title}
          onClick={onClick}
          aria-label={ariaLabel}
          aria-current={ariaCurrent}
          data-inbox-section={dataInboxSection}
        >
          {children}
        </a>
      );
    },
    useLocation: () => ({
      pathname: mockPathname,
      href: `${mockPathname}${mockSearchStr}`,
      searchStr: mockSearchStr,
    }),
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return {
    ...actual,
    useServerFn: () => async () => ({ isAdmin: false }),
  };
});

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: mockUser,
    profile: mockProfile,
    ready: true,
    loading: false,
  }),
  markIntentionalSignOut: vi.fn(),
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    theme: "dark",
    resolvedTheme: "dark",
    setTheme: vi.fn(),
  }),
}));

vi.mock("@/lib/native", () => ({
  isNative: false,
  useKeyboardOpen: () => false,
}));

vi.mock("@/lib/draft-store", () => ({
  useFocusedWorkspace: () => false,
}));

vi.mock("@/lib/nav-overlay", () => ({
  useNavOverlay: () => ({
    activeOverlay: "none",
    openOverlay: mockOpenOverlay,
    closeOverlays: mockCloseOverlays,
    isOpen: () => false,
    onOpenChangeFor: () => vi.fn(),
    sidebarCollapsed: null,
    toggleSidebarCollapsed: vi.fn(),
  }),
}));

vi.mock("@/lib/messages", () => ({
  userConversationsQuery: (userId?: string) => ({
    queryKey: ["conversations", userId],
    queryFn: async () =>
      userId
        ? [
            {
              id: "conv-1",
              type: "direct",
              unread_count: 4,
              last_message_preview: "Hello from Ping",
            },
          ]
        : [],
  }),
  useInboxRealtime: vi.fn(),
}));

vi.mock("@/lib/economy", () => ({
  dotSummaryQuery: (userId?: string) => ({
    queryKey: ["dot-summary", userId],
    queryFn: async () => null,
  }),
}));

vi.mock("@/lib/notifications", () => ({
  fetchUnifiedNotifications: async () => [],
  groupNotifications: () => [],
  markCentralNotificationsRead: async () => undefined,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: () => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
    channel: () => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    }),
    removeChannel: vi.fn(),
  },
}));

import {
  BottomNav,
  isClipsPath,
  isExplorePath,
  isInboxPath,
  shouldHideBottomNav,
} from "@/components/layout/BottomNav";
import { DesktopSidebar } from "@/components/layout/DesktopSidebar";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { InboxSectionTabs } from "@/components/inbox/InboxSectionTabs";
import { routeTree } from "@/routeTree.gen";

const ROOT = path.resolve(__dirname, "../..");
const readRel = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function renderWithQuery(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
    },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("Ping Final Navigation & Communication Architecture Regression Suite", () => {
  beforeEach(() => {
    mockPathname = "/";
    mockSearchStr = "";
    mockNavigate.mockReset();
    mockOpenOverlay.mockReset();
    mockCloseOverlays.mockReset();
    mockUser = { id: "user-1", email: "ada@ping.test" };
    mockProfile = {
      id: "user-1",
      username: "ada",
      display_name: "Ada Lovelace",
      avatar_url: null,
    };
  });

  describe("1. Final Bottom Navigation & Desktop/Tablet Navigation", () => {
    it("renders EXACTLY 5 primary bottom navigation destinations in order: Explore, Clips, Create, Inbox, Profile", () => {
      renderWithQuery(<BottomNav />);

      const nav = screen.getByRole("navigation", { name: "Primary" });
      expect(nav).toHaveAttribute("data-nav-mode", "primary");

      const items = Array.from(nav.querySelectorAll("a, button"));
      expect(items).toHaveLength(5);

      const labels = items.map((el) => {
        const spans = Array.from(el.querySelectorAll("span"));
        return spans.at(-1)?.textContent?.trim() ?? el.textContent?.trim();
      });
      expect(labels).toEqual(["Explore", "Clips", "Create", "Inbox", "Profile"]);

      expect(within(nav).queryByText("Home")).toBeNull();
      expect(within(nav).queryByText("Communities")).toBeNull();
      expect(within(nav).queryByText("Hubs")).toBeNull();
      expect(within(nav).queryByText("Back")).toBeNull();

      // Explore is active when landing on /
      expect(items[0]).toHaveAttribute("href", "/explore");
      expect(items[0]).toHaveAttribute("aria-current", "page");
      expect(items[1]).toHaveAttribute("href", "/clips");

      // Create opens unified Create overlay and preserves prominent lime action styling
      const createBtn = items[2] as HTMLButtonElement;
      expect(createBtn.innerHTML).toContain("bg-lime");
      fireEvent.click(createBtn);
      expect(mockOpenOverlay).toHaveBeenCalledWith("create");

      // Profile links to authenticated user's profile
      expect(items[4]).toHaveAttribute("href", "/@ada");
    });

    it("keeps the 5-destination BottomNav across /inbox, /hubs, /signals, /messages, and /clips with accurate active state", () => {
      for (const route of ["/inbox", "/messages", "/hubs", "/hubs/founders", "/signals", "/signals/mit"]) {
        mockPathname = route;
        const { unmount } = renderWithQuery(<BottomNav />);
        const nav = screen.getByRole("navigation", { name: "Primary" });
        const items = Array.from(nav.querySelectorAll("a, button"));
        expect(items).toHaveLength(5);

        const inboxLink = within(nav).getByRole("link", { name: /Inbox/i });
        expect(inboxLink).toHaveAttribute("aria-current", "page");
        expect(inboxLink).toHaveAttribute("href", "/inbox");
        unmount();
      }

      mockPathname = "/clips";
      const { unmount } = renderWithQuery(<BottomNav />);
      const nav = screen.getByRole("navigation", { name: "Primary" });
      expect(within(nav).getByRole("link", { name: "Clips" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      unmount();
    });

    it("preserves auth state on Profile destination (links to /login when signed out) and hides on auth/onboarding screens", () => {
      mockUser = null;
      mockProfile = null;
      mockPathname = "/";
      renderWithQuery(<BottomNav />);

      const nav = screen.getByRole("navigation", { name: "Primary" });
      const profileLink = within(nav).getByRole("link", { name: "Profile" });
      expect(profileLink).toHaveAttribute("href", "/login");

      expect(shouldHideBottomNav("/login")).toBe(true);
      expect(shouldHideBottomNav("/signup")).toBe(true);
      expect(shouldHideBottomNav("/onboarding")).toBe(true);
      expect(shouldHideBottomNav("/inbox")).toBe(false);
      expect(shouldHideBottomNav("/clips")).toBe(false);
    });

    it("renders consistent 5-destination navigation on DesktopSidebar and SiteHeader without Home, Communities, or contextual community bars", () => {
      mockPathname = "/signals/stanford";
      renderWithQuery(
        <>
          <DesktopSidebar />
          <SiteHeader />
        </>,
      );

      const desktopNav = screen.getByRole("navigation", { name: "Desktop Main Navigation" });
      const desktopLinks = within(desktopNav).getAllByRole("link");
      expect(desktopLinks.map((a) => a.getAttribute("title"))).toEqual([
        "Explore",
        "Clips",
        "Inbox",
        "Profile",
      ]);
      expect(within(desktopNav).getByTitle("Inbox")).toHaveAttribute("aria-current", "page");
      expect(screen.queryByRole("navigation", { name: "Community Navigation" })).toBeNull();

      const tabletNav = screen.getByRole("navigation", { name: "Main" });
      const tabletLinks = within(tabletNav).getAllByRole("link");
      expect(tabletLinks.map((a) => a.textContent?.replace(/\d+/g, "").trim())).toEqual([
        "Explore",
        "Clips",
        "Inbox",
        "Profile",
      ]);
      expect(within(tabletNav).getByRole("link", { name: /Inbox/i })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    it("classifies Explore, Clips, and communication routes cleanly", () => {
      expect(isExplorePath("/")).toBe(true);
      expect(isExplorePath("/explore")).toBe(true);
      expect(isExplorePath("/clips")).toBe(false);

      expect(isClipsPath("/clips")).toBe(true);
      expect(isClipsPath("/explore")).toBe(false);

      expect(isInboxPath("/")).toBe(false);
      expect(isInboxPath("/explore")).toBe(false);
      expect(isInboxPath("/clips")).toBe(false);
      expect(isInboxPath("/@ada")).toBe(false);
      expect(isInboxPath("/inbox")).toBe(true);
      expect(isInboxPath("/messages")).toBe(true);
      expect(isInboxPath("/hubs")).toBe(true);
      expect(isInboxPath("/hubs/founders")).toBe(true);
      expect(isInboxPath("/signals")).toBe(true);
      expect(isInboxPath("/signals/mit")).toBe(true);
      expect(isInboxPath("/signals/channels")).toBe(true);
    });
  });

  describe("2. Inbox Central Communication Centre (Chats, Hubs, Signals)", () => {
    it("renders EXACTLY three primary sections in InboxSectionTabs: Chats, Hubs, Signals", () => {
      renderWithQuery(<InboxSectionTabs activeSection="hubs" />);

      const tabsNav = screen.getByRole("navigation", { name: "Inbox sections" });
      const links = within(tabsNav).getAllByRole("link");
      expect(links).toHaveLength(3);
      expect(links.map((l) => l.getAttribute("data-inbox-section"))).toEqual([
        "chats",
        "hubs",
        "signals",
      ]);
      expect(links.map((l) => l.textContent?.replace(/\d+/g, "").trim())).toEqual([
        "Chats",
        "Hubs",
        "Signals",
      ]);

      expect(links[0]).toHaveAttribute("href", "/inbox");
      expect(links[1]).toHaveAttribute("href", "/inbox?section=hubs");
      expect(links[1]).toHaveAttribute("aria-current", "page");
      expect(links[2]).toHaveAttribute("href", "/inbox?section=signals");
    });

    it("registers /inbox alongside existing deep links (/messages, /hubs, /signals, /signals/channels, /signals/$slug)", () => {
      const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
      for (const routePath of [
        "/",
        "/explore",
        "/inbox",
        "/messages",
        "/hubs",
        "/hubs/create",
        "/hubs/founders",
        "/signals",
        "/signals/channels",
        "/signals/create",
        "/signals/stanford",
        "/@ada",
      ]) {
        expect(
          router.matchRoutes(routePath).at(-1)?.routeId,
          `Route ${routePath} should match`,
        ).not.toBe(rootRouteId);
      }
    });
  });

  describe("3. Pure Institutional Signals & Group-Only Hubs Separation", () => {
    it("keeps Signals exclusively institutional broadcasting (no Forums, no Hubs, no 1-on-1 Chats, no Channel Discussion)", () => {
      const signalsIndex = readRel("src/routes/signals.tsx");
      const signalDetail = readRel("src/routes/signals.$slug.tsx");
      const signalChannels = readRel("src/routes/signals.channels.tsx");

      // Signals index is institutional broadcast directory, not MessagesWorkspace
      expect(signalsIndex).toContain("Official Institutional Broadcasts");
      expect(signalsIndex).toContain("signalsQuery");
      expect(signalsIndex).toContain("useSignalFollow");
      expect(signalsIndex).not.toContain("MessagesWorkspace");
      expect(signalsIndex).not.toContain("HubForumsAndBroadcasts");
      expect(signalsIndex).not.toMatch(/\bForums\b/);

      // Signal detail page has NO Channel Discussion chat, NO 1-on-1 chat links, NO Forums, NO Hubs
      expect(signalDetail).toContain('data-signal-channel-broadcast-only="true"');
      expect(signalDetail).toContain("Official Broadcasts");
      expect(signalDetail).toContain("NewBroadcastDialog");
      expect(signalDetail).toContain("ManagePublishersDialog");
      expect(signalDetail).toContain("isPublisher");
      expect(signalDetail).not.toContain("Channel Discussion");
      expect(signalDetail).not.toContain("Open 1-on-1 Chats");
      expect(signalDetail).not.toContain("signalMessagesQuery");
      expect(signalDetail).not.toContain("useSendSignalMessage");
      expect(signalDetail).not.toMatch(/\bForums\b/);

      // Legacy /signals/channels alias stays clean without Hub/Moment/1-on-1 Chat switcher
      expect(signalChannels).toContain("SignalsDirectorySection");
      expect(signalChannels).not.toContain("view: \"moments\"");
      expect(signalChannels).not.toContain("1-on-1");
    });

    it("keeps Hubs exclusively group communication without mixing institutional broadcasts or Forums tabs", () => {
      const hubsIndex = readRel("src/routes/hubs.tsx");
      const hubDetail = readRel("src/routes/hubs.$slug.tsx");

      expect(hubsIndex).toContain('data-hubs-group-only="true"');
      expect(hubsIndex).toContain("Group Chat");
      expect(hubsIndex).not.toContain("Forums & Broadcasts");
      expect(hubsIndex).not.toContain("Signal Channels");
      expect(hubsIndex).not.toContain("Community Moments");

      expect(hubDetail).toContain('data-hub-group-only="true"');
      expect(hubDetail).toContain("HubChat");
      expect(hubDetail).toContain("Group Chat");
      expect(hubDetail).toContain("Membership &amp; Notifications");
      expect(hubDetail).not.toContain("HubForumsAndBroadcasts");
      expect(hubDetail).not.toContain("Forums & Broadcasts");
    });

    it("preserves existing forum/signal database tables and helper modules without destructive deletion", () => {
      expect(fs.existsSync(path.join(ROOT, "src/components/hubs/HubForumsAndBroadcasts.tsx"))).toBe(
        true,
      );
      const signalsLib = readRel("src/lib/signals.ts");
      expect(signalsLib).toContain("signalMessagesQuery");
      expect(signalsLib).toContain("signalPostsQuery");
      expect(signalsLib).toContain("useSignalFollow");
    });
  });

  describe("4. Moments Preservation Across Explore (/) and Profile", () => {
    it("preserves Moments access on Explore (/ and /explore) and Profile using authorized media resolution", () => {
      const homeSrc = readRel("src/routes/index.tsx");
      const exploreSrc = readRel("src/routes/explore.tsx");
      const exploreViewSrc = readRel("src/components/explore/ExploreDiscoveryView.tsx");
      const profileSrc = readRel("src/routes/@{$username}.tsx");
      const momentsLib = readRel("src/lib/moments.ts");

      expect(homeSrc).toContain("ExploreDiscoveryView");
      expect(exploreSrc).toContain("ExploreDiscoveryView");
      expect(exploreViewSrc).toContain("<MomentsTray />");
      expect(exploreViewSrc).toContain("<DiscoverableMomentsFeed />");
      expect(exploreViewSrc).toContain("Institutional Signals");
      expect(profileSrc).toContain("<ProfileHighlights");
      expect(profileSrc).toContain("ResolvedMomentThumb");
      expect(profileSrc).toContain("MomentViewerModal");
      expect(profileSrc).toContain('data-profile-clips-tab="true"');

      // Private Moment permission guard remains enforced in discoverable query
      expect(momentsLib).toContain('.eq("audience", "public")');
    });
  });
});
