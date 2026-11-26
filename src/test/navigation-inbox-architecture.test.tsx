import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";

let mockPathname = "/";
let mockUser: { id: string } | null = { id: "user-1" };
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

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    search,
    children,
    className,
    title,
    "aria-label": ariaLabel,
    "aria-current": ariaCurrent,
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
        aria-label={ariaLabel}
        aria-current={ariaCurrent}
      >
        {children}
      </a>
    );
  },
  useLocation: () => ({ pathname: mockPathname, searchStr: "" }),
  useNavigate: () => vi.fn(),
  useChildMatches: () => [],
  Outlet: () => <div data-testid="route-outlet" />,
  createFileRoute: () => (opts: any) => ({
    ...opts,
    useSearch: () => ({}),
    useParams: () => ({ slug: "stanford-ai" }),
  }),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return {
    ...actual,
    useServerFn: () => vi.fn().mockResolvedValue({ isAdmin: false }),
  };
});

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: mockUser,
    profile: mockProfile,
    ready: true,
  }),
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    theme: "dark",
    resolvedTheme: "dark",
    setTheme: vi.fn(),
  }),
}));

vi.mock("@/lib/messages", async () => {
  const actual = await vi.importActual<typeof import("@/lib/messages")>("@/lib/messages");
  return {
    ...actual,
    userConversationsQuery: () => ({
      queryKey: ["user-conversations-test"],
      queryFn: async () => [
        {
          id: "conv-1",
          type: "direct",
          created_by: "user-2",
          last_message_at: new Date().toISOString(),
          last_message_preview: "Hello Ada",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          unread_count: 3,
        },
      ],
    }),
  };
});

vi.mock("@/lib/economy", async () => {
  const actual = await vi.importActual<typeof import("@/lib/economy")>("@/lib/economy");
  return {
    ...actual,
    dotSummaryQuery: () => ({
      queryKey: ["dot-summary-test"],
      queryFn: async () => ({ wallet: { balance: 120 } }),
    }),
  };
});

import { BottomNav, isInboxPath } from "@/components/layout/BottomNav";
import { DesktopSidebar } from "@/components/layout/DesktopSidebar";
import { InboxSectionTabs } from "@/components/inbox/InboxSectionTabs";
import { ConversationList } from "@/components/messages/ConversationList";
import { validateMediaUpload } from "@/lib/shield";
import { parseStorageObjectRef } from "@/lib/storage-url";

const ROOT = path.resolve(__dirname, "../..");
const readRel = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function renderWithQuery(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("PING Navigation & Communication Architecture Correction", () => {
  beforeEach(() => {
    mockPathname = "/";
    mockUser = { id: "user-1" };
    mockProfile = {
      id: "user-1",
      username: "ada",
      display_name: "Ada Lovelace",
      avatar_url: null,
    };
  });

  it("renders exactly 5 bottom navigation destinations in order: Home, Explore, Create, Inbox, Profile", () => {
    renderWithQuery(<BottomNav />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const controls = Array.from(nav.querySelectorAll("a, button"));
    expect(controls).toHaveLength(5);

    const labels = controls.map((el) => el.querySelector("span:last-child")?.textContent?.trim());
    expect(labels).toEqual(["Home", "Explore", "Create", "Inbox", "Profile"]);

    expect(controls[0]).toHaveAttribute("href", "/");
    expect(controls[1]).toHaveAttribute("href", "/explore");
    expect(controls[3]).toHaveAttribute("href", "/inbox");
    expect(controls[4]).toHaveAttribute("href", "/@ada");

    // Communities must be completely absent
    expect(nav.textContent).not.toContain("Community");
    expect(nav.textContent).not.toContain("Communities");
  });

  it("keeps the 5-destination bottom navigation persistent on /hubs and /signals with Inbox active", () => {
    for (const route of [
      "/inbox",
      "/messages",
      "/hubs",
      "/hubs/builders",
      "/signals",
      "/signals/mit",
    ]) {
      expect(isInboxPath(route)).toBe(true);
    }

    mockPathname = "/signals/mit";
    renderWithQuery(<BottomNav />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: /Inbox/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("navigation", { name: /Community/i })).toBeNull();
  });

  it("routes Profile to /login when unauthenticated while preserving 5 bottom destinations", () => {
    mockUser = null;
    mockProfile = null;
    mockPathname = "/login";

    renderWithQuery(<BottomNav />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const profileLink = within(nav).getByRole("link", { name: "Profile" });
    expect(profileLink).toHaveAttribute("href", "/login");
    expect(profileLink).toHaveAttribute("aria-current", "page");
  });

  it("renders matching desktop navigation with Home, Explore, Inbox, Profile, and Create", () => {
    mockPathname = "/inbox";
    renderWithQuery(<DesktopSidebar />);

    const mainNav = screen.getByRole("navigation", { name: "Desktop Main Navigation" });
    const links = within(mainNav).getAllByRole("link");
    const titles = links.map((l) => l.getAttribute("title"));
    expect(titles).toEqual(["Home", "Explore", "Inbox", "Profile"]);
    expect(within(mainNav).getByTitle("Inbox")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTitle("Create")).toBeInTheDocument();
  });

  it("renders Inbox with exactly three primary sections: Chats, Hubs, and Signals", () => {
    renderWithQuery(<InboxSectionTabs activeSection="signals" />);
    const sectionNav = screen.getByRole("navigation", { name: "Inbox sections" });
    const links = within(sectionNav).getAllByRole("link");
    expect(links).toHaveLength(3);

    expect(links.map((l) => l.textContent?.replace(/\d+\+?/g, "").trim())).toEqual([
      "Chats",
      "Hubs",
      "Signals",
    ]);
    expect(links[0]).toHaveAttribute("href", "/inbox");
    expect(links[1]).toHaveAttribute("href", "/inbox?section=hubs");
    expect(links[2]).toHaveAttribute("href", "/inbox?section=signals");
    expect(links[2]).toHaveAttribute("aria-current", "page");
  });

  it("supports direct and group conversations plus audio/voice-note attachment validation in Chats", () => {
    expect(
      validateMediaUpload({ name: "voice.webm", type: "audio/webm", size: 256_000 }, "audio").valid,
    ).toBe(true);

    const onSelect = vi.fn();
    render(
      <ConversationList
        selectedId="conv-group"
        onSelect={onSelect}
        conversations={[
          {
            id: "conv-direct",
            type: "direct",
            created_by: "user-2",
            last_message_at: new Date().toISOString(),
            last_message_preview: "Direct ping",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            unread_count: 1,
            other_member: {
              id: "user-2",
              username: "grace",
              display_name: "Grace Hopper",
              avatar_url: null,
              bio: "",
              created_at: new Date().toISOString(),
            },
          },
          {
            id: "conv-group",
            type: "group",
            created_by: "user-1",
            last_message_at: new Date().toISOString(),
            last_message_preview: "Team sync at 3pm",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            unread_count: 0,
          },
        ]}
      />,
    );

    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    expect(screen.getByText("Group Conversation")).toBeInTheDocument();

    const dmChatSrc = readRel("src/components/messages/DirectMessageChat.tsx");
    expect(dmChatSrc).toContain('msg.media_type === "audio"');
    expect(dmChatSrc).toContain("<audio");
  });

  it("keeps Signals strictly institutional broadcasting with zero Forums, Hub chat, or private Chat mixing", () => {
    const signalsDirSrc = readRel("src/routes/signals.tsx");
    const signalDetailSrc = readRel("src/routes/signals.$slug.tsx");

    // Parent layout Outlet required for /signals/$slug and /signals/create
    expect(signalsDirSrc).toContain("useChildMatches");
    expect(signalsDirSrc).toContain("<Outlet />");

    // Institutional broadcasting features present
    expect(signalsDirSrc).toContain("Institutional Broadcasting");
    expect(signalsDirSrc).toContain("signalsQuery");
    expect(signalDetailSrc).toContain("Verified Institution");
    expect(signalDetailSrc).toContain("Official Broadcasts");
    expect(signalDetailSrc).toContain("NewBroadcastDialog");
    expect(signalDetailSrc).toContain("{isPublisher && (");

    // Forbidden mixed elements absent from Signals UI
    for (const src of [signalsDirSrc, signalDetailSrc]) {
      expect(src).not.toContain("HubForumsAndBroadcasts");
      expect(src).not.toContain("HubChat");
      expect(src).not.toContain("DirectMessageChat");
      expect(src).not.toContain("Open Hubs & Forums");
      expect(src).not.toContain("Open Direct Messages");
      expect(src).not.toMatch(/Forums/i);
    }

    // Historical forum data & component preserved (not deleted)
    expect(fs.existsSync(path.join(ROOT, "src/components/hubs/HubForumsAndBroadcasts.tsx"))).toBe(
      true,
    );
    expect(
      fs.existsSync(
        path.join(ROOT, "drizzle/migrations/0017_human_coordination_forums_broadcasts.sql"),
      ),
    ).toBe(true);
  });

  it("keeps Hubs strictly group communication with Outlet support, Group Chat default, and membership/notification controls", () => {
    const hubsDirSrc = readRel("src/routes/hubs.tsx");
    const hubDetailSrc = readRel("src/routes/hubs.$slug.tsx");

    expect(hubsDirSrc).toContain("useChildMatches");
    expect(hubsDirSrc).toContain("<Outlet />");
    expect(hubsDirSrc).toContain("Group Communication");
    expect(hubsDirSrc).not.toContain("Forums & Broadcasts");

    expect(hubDetailSrc).toContain('const validTabs = ["chat", "feed", "members", "about"]');
    expect(hubDetailSrc).toContain("Group Chat");
    expect(hubDetailSrc).toContain("Toggle Hub notifications");
    expect(hubDetailSrc).not.toContain("HubForumsAndBroadcasts");
    expect(hubDetailSrc).not.toContain("Forums & Broadcasts");
  });

  it("preserves Moments access across Home, Explore, and Profile with intact image/video storage rendering", () => {
    const homeSrc = readRel("src/routes/index.tsx");
    const exploreSrc = readRel("src/routes/explore.tsx");
    const profileSrc = readRel("src/routes/@{$username}.tsx");
    const viewerSrc = readRel("src/components/moments/MomentViewerModal.tsx");

    expect(homeSrc).toContain("<MomentsTray />");
    expect(exploreSrc).toContain("<MomentsTray />");
    expect(exploreSrc).toContain("<DiscoverableMomentsFeed />");
    expect(profileSrc).toContain("<ProfileHighlights");
    expect(profileSrc).toContain("<MomentViewerModal");

    // Viewer & Profile render real storage media_url for both video and image
    expect(viewerSrc).toContain('currentMoment.media_type === "video"');
    expect(viewerSrc).toContain("src={currentMoment.media_url}");
    expect(profileSrc).toContain('m.media_type === "video"');
    expect(profileSrc).toContain("src={m.media_url}");

    // Storage reference parser extracts bucket + objectPath without inventing URLs
    expect(
      parseStorageObjectRef(
        "https://exlttyafomvqfwgzzjrm.supabase.co/storage/v1/object/public/media/bcffa557-207d-4f19-a56c-dbe3e1f79081/moments/1795722601410_0.jpg",
      ),
    ).toEqual({
      bucket: "media",
      objectPath: "bcffa557-207d-4f19-a56c-dbe3e1f79081/moments/1795722601410_0.jpg",
    });
    expect(parseStorageObjectRef("https://cdn.example.com/custom.jpg")).toBeNull();
  });
});
