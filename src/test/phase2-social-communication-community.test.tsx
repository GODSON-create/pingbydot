import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { extractHashtags, extractMentions, tokenizeRichText, PING_REACTIONS } from "@/lib/social";
import { extractTrendingTopics, rankFeedPings, scorePingForFeed } from "@/lib/feed-engine";
import { groupNotifications, DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/notifications";
import { OPPORTUNITY_CATEGORIES } from "@/lib/opportunities";
import { ConversationList } from "@/components/messages/ConversationList";
import type { Ping } from "@/lib/pings";
import type { Conversation } from "@/lib/messages";

function makePing(overrides: Partial<Ping> & { scheduled_for?: string | null } = {}): Ping {
  return {
    id: overrides.id ?? "ping-1",
    user_id: overrides.user_id ?? "user-1",
    category: overrides.category ?? "progress",
    content: overrides.content ?? "Shipping our #climate beta with @ada today!",
    image_url: overrides.image_url ?? null,
    cta_url: overrides.cta_url ?? null,
    cta_label: overrides.cta_label ?? null,
    created_at: overrides.created_at ?? new Date().toISOString(),
    updated_at: overrides.updated_at ?? new Date().toISOString(),
    author: overrides.author ?? {
      id: overrides.user_id ?? "user-1",
      username: "builder",
      display_name: "Builder",
      avatar_url: null,
    },
    likes: overrides.likes ?? [{ count: 0 }],
    ...overrides,
  };
}

describe("Phase 2 — Social Network, Communication & Community", () => {
  describe("Database migration 0029 & RLS security", () => {
    const migrationsDir = path.resolve(__dirname, "../../drizzle/migrations");
    const m29Path = path.join(
      migrationsDir,
      "0029_phase2_social_messaging_hubs_signals_notifications.sql",
    );
    const journalPath = path.join(migrationsDir, "meta/_journal.json");

    it("registers migration 0029 sequentially in _journal.json with zero USING (true) policies", () => {
      const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
      const entry = journal.entries.find((e: { idx: number }) => e.idx === 29);
      expect(entry?.tag).toBe("0029_phase2_social_messaging_hubs_signals_notifications");

      const sql = fs.readFileSync(m29Path, "utf8");
      const uncommented = sql
        .split("\n")
        .map((l) => l.replace(/--.*$/, ""))
        .join("\n");
      expect(uncommented).not.toMatch(/\bUSING\s*\(\s*true\s*\)/i);
      expect(sql).not.toMatch(/DROP\s+POLICY\s+IF\s+EXISTS\s+"[^"]+"\s+ON\s+\S+\s+FOR\s+/i);

      const requiredTables = [
        "user_saved_accounts",
        "user_topic_follows",
        "ping_reactions",
        "ping_polls",
        "ping_poll_options",
        "ping_poll_votes",
        "private_message_reactions",
        "saved_messages",
        "hub_events",
        "hub_event_rsvps",
        "signal_opportunities",
        "signal_applications",
        "notifications",
      ];
      for (const table of requiredTables) {
        expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
      }

      // All sensitive RPCs must revoke execution from PUBLIC and anon
      expect(sql).toContain("REVOKE ALL ON FUNCTION public.create_group_conversation");
      expect(sql).toContain("REVOKE ALL ON FUNCTION public.submit_signal_application");
      expect(sql).toContain("REVOKE ALL ON FUNCTION public.mark_notifications_read");
      expect(sql).toContain("REVOKE ALL ON FUNCTION public.vote_ping_poll");
    });
  });

  describe("Social graph rich-text helpers & multi-reactions (2.1 & 2.2)", () => {
    it("extracts unique lowercase hashtags and mentions and tokenizes rich text", () => {
      const sample = "Excited to build #Fintech & #Climate with @Ada and @kofi! #fintech";
      expect(extractHashtags(sample)).toEqual(["fintech", "climate"]);
      expect(extractMentions(sample)).toEqual(["ada", "kofi"]);

      const tokens = tokenizeRichText("Hi @Ada check #Ping");
      expect(tokens.some((t) => t.type === "mention" && t.username === "ada")).toBe(true);
      expect(tokens.some((t) => t.type === "hashtag" && t.tag === "ping")).toBe(true);
      expect(PING_REACTIONS.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe("Personalised Home Feed Ranking Engine (2.3)", () => {
    const nowMs = Date.parse("2026-11-19T12:00:00Z");

    it("filters muted users, blocked users, and other users' future-scheduled Pings", () => {
      const pings = [
        makePing({ id: "ok", user_id: "u1", created_at: "2026-11-19T11:00:00Z" }),
        makePing({ id: "muted", user_id: "u-muted", created_at: "2026-11-19T11:30:00Z" }),
        makePing({ id: "blocked", user_id: "u-blocked", created_at: "2026-11-19T11:45:00Z" }),
        makePing({
          id: "future-other",
          user_id: "u2",
          created_at: "2026-11-19T11:50:00Z",
          scheduled_for: "2026-11-20T12:00:00Z",
        }),
        makePing({
          id: "future-mine",
          user_id: "me",
          created_at: "2026-11-19T11:55:00Z",
          scheduled_for: "2026-11-20T12:00:00Z",
        }),
      ];

      const ranked = rankFeedPings(pings, {
        mode: "foryou",
        viewerId: "me",
        mutedUserIds: new Set(["u-muted"]),
        blockedUserIds: new Set(["u-blocked"]),
        nowMs,
      });

      expect(ranked.map((p) => p.id)).toEqual(expect.arrayContaining(["ok", "future-mine"]));
      expect(ranked.map((p) => p.id)).not.toContain("muted");
      expect(ranked.map((p) => p.id)).not.toContain("blocked");
      expect(ranked.map((p) => p.id)).not.toContain("future-other");
    });

    it("prioritises interest + relationship relevance over raw engagement bait", () => {
      const relevant = makePing({
        id: "relevant",
        user_id: "followed-creator",
        content: "Building #climate hardware — Needs: PCB engineer",
        cta_url: "https://example.com",
        likes: [{ count: 4 }],
        created_at: "2026-11-19T10:00:00Z",
      });
      const bait = makePing({
        id: "bait",
        user_id: "stranger",
        content: "Comment YES if you agree!",
        likes: [{ count: 500 }],
        created_at: "2026-11-19T10:00:00Z",
      });

      const ctx = {
        mode: "foryou" as const,
        interests: ["climate"],
        followedTopics: ["climate"],
        followedAuthorIds: new Set(["followed-creator"]),
        nowMs,
      };
      expect(scorePingForFeed(relevant, ctx)).toBeGreaterThan(scorePingForFeed(bait, ctx));
    });

    it("filters opportunities mode and extracts trending topics", () => {
      const pings = [
        makePing({ id: "p1", category: "progress", content: "Shipped #ai feature" }),
        makePing({ id: "p2", category: "opportunity", content: "Hiring #ai researcher" }),
      ];

      const opps = rankFeedPings(pings, { mode: "opportunities", nowMs });
      expect(opps.map((p) => p.id)).toEqual(["p2"]);

      const topics = extractTrendingTopics(pings, 5);
      expect(topics[0]?.slug).toBe("ai");
      expect(topics[0]?.count).toBe(2);
    });
  });

  describe("Signals Opportunity Infrastructure (2.8)", () => {
    it("exposes all 14 blueprint opportunity categories", () => {
      const expected = [
        "funding",
        "investment",
        "jobs",
        "recruitment",
        "partnerships",
        "procurement",
        "grants",
        "competitions",
        "mentorship",
        "services",
        "research",
        "events",
        "business_proposals",
        "product_requests",
      ];
      expect(OPPORTUNITY_CATEGORIES.map((c) => c.value)).toEqual(expected);
    });
  });

  describe("Central Notification Centre grouping & preferences (2.9)", () => {
    it("groups repeated reactions on the same target and computes unread state", () => {
      const grouped = groupNotifications(
        [
          {
            id: "1",
            kind: "like",
            text: "Ada liked your Ping",
            href: "/p/123",
            group_key: "like:/p/123",
            created_at: "2026-11-19T12:00:00Z",
          },
          {
            id: "2",
            kind: "like",
            text: "Kofi liked your Ping",
            href: "/p/123",
            group_key: "like:/p/123",
            created_at: "2026-11-19T11:50:00Z",
          },
          {
            id: "3",
            kind: "follow",
            text: "Zara followed you",
            href: "/@zara",
            group_key: "follow:zara",
            created_at: "2026-11-19T10:00:00Z",
          },
        ],
        "2026-11-19T11:00:00Z",
      );

      expect(grouped).toHaveLength(2);
      expect(grouped[0]?.count).toBe(2);
      expect(grouped[0]?.text).toContain("(+1 more)");
      expect(grouped[0]?.unread).toBe(true);
      expect(grouped[1]?.unread).toBe(false);
      expect(DEFAULT_NOTIFICATION_PREFERENCES.replies).toBe(true);
      expect(DEFAULT_NOTIFICATION_PREFERENCES.opportunities).toBe(true);
    });
  });

  describe("ConversationList Inbox / Archived & Group chats (2.5 & 2.6)", () => {
    const sampleConvs: Conversation[] = [
      {
        id: "c-direct",
        type: "direct",
        created_by: "u1",
        last_message_at: new Date().toISOString(),
        last_message_preview: "Hello there",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        unread_count: 2,
        other_member: {
          id: "u2",
          username: "ada",
          display_name: "Ada Lovelace",
          bio: "",
          avatar_url: null,
          created_at: new Date().toISOString(),
        },
        my_membership: {
          conversation_id: "c-direct",
          user_id: "u1",
          role: "member",
          joined_at: new Date().toISOString(),
          last_read_at: new Date().toISOString(),
          is_muted: false,
          is_archived: false,
          hidden_at: null,
        },
      },
      {
        id: "c-group-archived",
        type: "group",
        title: "Launch Team",
        description: "Core group",
        created_by: "u1",
        last_message_at: new Date().toISOString(),
        last_message_preview: "Launch checklist ready",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        unread_count: 0,
        my_membership: {
          conversation_id: "c-group-archived",
          user_id: "u1",
          role: "owner",
          joined_at: new Date().toISOString(),
          last_read_at: new Date().toISOString(),
          is_muted: true,
          is_archived: true,
          hidden_at: null,
        },
      },
    ];

    it("separates active Inbox conversations from Archived group chats and exposes New Group button", () => {
      const onSelect = vi.fn();
      const onNewGroup = vi.fn();
      render(
        <ConversationList
          conversations={sampleConvs}
          onSelect={onSelect}
          onNewGroup={onNewGroup}
        />,
      );

      expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
      expect(screen.queryByText("Launch Team")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /Archived/i }));
      expect(screen.getByText("Launch Team")).toBeInTheDocument();
      expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "New Group Chat" }));
      expect(onNewGroup).toHaveBeenCalledTimes(1);
    });
  });
});
