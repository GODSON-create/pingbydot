import fs from "node:fs";
import path from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { routeTree } from "@/routeTree.gen";

const root = process.cwd();
const readSrc = (rel: string) => fs.readFileSync(path.resolve(root, rel), "utf8");

describe("PING Stabilization & 1M-User Readiness Verification", () => {
  it("registers migration 0022 with forum posts, signal messages, profile recovery, DM inbox RPC & 1M indexes", () => {
    const journal = JSON.parse(readSrc("drizzle/migrations/meta/_journal.json"));
    const entry22 = journal.entries.find((e: { idx: number }) => e.idx === 22);
    expect(entry22).toBeDefined();
    expect(entry22.tag).toBe("0022_stabilization_forums_signals_scale");

    const sql = readSrc("drizzle/migrations/0022_stabilization_forums_signals_scale.sql");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.ensure_my_profile()");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.update_hub(");
    expect(sql).toContain("'university', 'company', 'government', 'ngo', 'association', 'other'");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.hub_forum_posts");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.signal_messages");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.get_my_conversations_summary(");
    expect(sql).toContain("pings_public_feed_idx");
    expect(sql).toContain("private_messages_unread_idx");
    expect(sql).toContain("hub_members_active_hub_user_idx");
  });

  it("matches all stabilized community, messaging, creation, and institutional channel routes", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    for (const routePath of [
      "/",
      "/explore",
      "/create",
      "/hubs",
      "/hubs/create",
      "/hubs/founders",
      "/signals",
      "/signals/channels",
      "/signals/create",
      "/signals/mit-news",
      "/messages",
    ]) {
      expect(router.matchRoutes(routePath).at(-1)?.routeId).not.toBe(rootRouteId);
    }
  });

  it("coordinates navigation overlays centrally with route dismissal and no 30ms timers", () => {
    const navOverlaySrc = readSrc("src/lib/nav-overlay.tsx");
    const rootRouteSrc = readSrc("src/routes/__root.tsx");
    const headerSrc = readSrc("src/components/layout/SiteHeader.tsx");
    const sidebarSrc = readSrc("src/components/layout/DesktopSidebar.tsx");
    const bottomNavSrc = readSrc("src/components/layout/BottomNav.tsx");
    const createModalSrc = readSrc("src/components/layout/CreateStackModal.tsx");

    expect(navOverlaySrc).toContain("useLocation");
    expect(navOverlaySrc).toContain('setActiveOverlay("none")');
    expect(navOverlaySrc).not.toContain("setTimeout");
    expect(rootRouteSrc).toContain("NavOverlayProvider");
    expect(rootRouteSrc).toContain("overflow-x-clip");
    expect(headerSrc).toContain("useNavOverlay");
    expect(sidebarSrc).toContain("useNavOverlay");
    expect(bottomNavSrc).toContain("useNavOverlay");
    expect(createModalSrc).toContain("location.pathname");
  });

  it("removes mock DEFAULT_FORUMS data, silent error catch fake successes, and Realtime channel leaks", () => {
    const forumsSrc = readSrc("src/components/hubs/HubForumsAndBroadcasts.tsx");
    const dmChatSrc = readSrc("src/components/messages/DirectMessageChat.tsx");
    const hubChatSrc = readSrc("src/components/hubs/HubChat.tsx");
    const presenceSrc = readSrc("src/lib/presence.ts");

    expect(forumsSrc).not.toContain("DEFAULT_FORUMS");
    expect(forumsSrc).toContain("hub_forum_posts");
    expect(forumsSrc).toContain("removeChannel");

    expect(dmChatSrc).not.toContain("Flagged @");
    expect(dmChatSrc).toContain("prefers-reduced-motion");

    expect(hubChatSrc).not.toContain("channel.unsubscribe()");
    expect(hubChatSrc).toContain("removeChannel");
    expect(presenceSrc).not.toContain("channel.unsubscribe()");
    expect(presenceSrc).toContain("removeChannel");
  });

  it("repairs Ping publishing error/profile handling and removes N+1 inbox waterfalls", () => {
    const createPingSrc = readSrc("src/routes/_authenticated/create.tsx");
    const composerSrc = readSrc("src/components/ping/PingComposer.tsx");
    const messagesLibSrc = readSrc("src/lib/messages.ts");

    expect(createPingSrc).toContain("ensure_my_profile");
    expect(createPingSrc).toContain("describePublishError");
    expect(createPingSrc).toContain("share_ping_to_hub");
    expect(composerSrc).toContain("uploadUserMedia");
    expect(messagesLibSrc).toContain("get_my_conversations_summary");
    expect(messagesLibSrc).toContain("conversationByIdQuery");
  });
});
