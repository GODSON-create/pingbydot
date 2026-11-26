import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  computeEffectiveConversationMaxPolicy,
  DEFAULT_CHAT_RETENTION_ENTITLEMENT,
  formatMessageExpiryBadge,
  formatStorageBytes,
  isChatRetentionFeatureEnabled,
  isPolicyAllowedByMax,
} from "@/lib/chat-retention";
import {
  handleChatRetentionCronRequest,
  runChatRetentionSweep,
  type ChatRetentionWorkerDeps,
  type MediaDeletionJobRow,
} from "@/lib/chat-retention-worker";
import { handleSignReadRequest } from "@/lib/media-server";
import { DirectMessageChat } from "@/components/messages/DirectMessageChat";
import { PingActivityPrivacy } from "@/components/settings/PingActivityPrivacy";
import type { Conversation, PrivateMessage } from "@/lib/messages";

const ROOT = path.resolve(__dirname, "../..");

function readRel(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function stripSqlComments(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = () => {
    const chain: Record<string, unknown> = {};
    for (const m of [
      "select",
      "eq",
      "neq",
      "in",
      "is",
      "gt",
      "order",
      "limit",
      "range",
      "insert",
      "update",
      "upsert",
      "delete",
    ]) {
      chain[m] = vi.fn(() => chain);
    }
    chain["maybeSingle"] = vi.fn(async () => ({ data: null, error: null }));
    chain["single"] = vi.fn(async () => ({ data: null, error: null }));
    chain["then"] = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve);
    return chain;
  };

  return {
    supabase: {
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: vi.fn(async () => ({
            data: { signedUrl: "https://cdn.ping.test/sign/dm-attachments/ok" },
            error: null,
          })),
          upload: vi.fn(async () => ({ data: { path: "conv-1/user-alice/a.jpg" }, error: null })),
        })),
      },
      rpc: (...args: unknown[]) => rpcMock(...args),
      from: (...args: unknown[]) => {
        fromMock(...args);
        return makeBuilder();
      },
      channel: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
        track: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockResolvedValue(undefined),
        presenceState: vi.fn(() => ({})),
      })),
      removeChannel: vi.fn(),
      auth: {
        getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      },
    },
  };
});

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "user-alice", email: "alice@ping.test" },
    profile: { id: "user-alice", username: "alice", display_name: "Alice" },
    ready: true,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

function renderWithQuery(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const BASE_CONVERSATION: Conversation = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "direct",
  created_by: "user-alice",
  request_status: "accepted",
  title: null,
  description: null,
  avatar_url: null,
  only_admins_can_post: false,
  retention_policy: "7d",
  retention_updated_at: null,
  last_message_at: "2026-11-24T12:00:00Z",
  last_message_preview: "Hello!",
  created_at: "2026-11-24T11:00:00Z",
  updated_at: "2026-11-24T12:00:00Z",
  other_member: {
    id: "user-bob",
    username: "bob",
    display_name: "Bob",
    avatar_url: null,
    bio: "",
    created_at: "2026-01-01T00:00:00Z",
  },
  my_membership: {
    conversation_id: "11111111-1111-4111-8111-111111111111",
    user_id: "user-alice",
    role: "owner",
    joined_at: "2026-11-24T11:00:00Z",
    last_read_at: "2026-11-24T12:00:00Z",
    is_muted: false,
    is_archived: false,
    hidden_at: null,
  },
  unread_count: 0,
};

describe("Ping V1 Stage 2 — Scalable Private Chat Retention System (Feature-Flagged)", () => {
  const sql0039 = readRel("drizzle/migrations/0039_stage2_scalable_chat_retention_system.sql");
  const uncommented0039 = stripSqlComments(sql0039);

  beforeEach(() => {
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    }
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Feature Flag Default OFF & Strict Private-Chat-Only Scope", () => {
    it("defaults chat_retention feature flag to OFF in both runtime helpers and Migration 0039", () => {
      expect(isChatRetentionFeatureEnabled({ envOverride: {} })).toBe(false);
      expect(isChatRetentionFeatureEnabled({ dbEnabled: false, envOverride: {} })).toBe(false);
      expect(isChatRetentionFeatureEnabled({ dbEnabled: true, envOverride: {} })).toBe(true);
      expect(
        isChatRetentionFeatureEnabled({ envOverride: { VITE_FEATURE_CHAT_RETENTION: "true" } }),
      ).toBe(true);

      expect(sql0039).toContain("('chat_retention', false");
      expect(sql0039).toContain("('cloudflare_r2_media', false");
      expect(uncommented0039).not.toMatch(/\bUSING\s*\(\s*true\s*\)/i);
      expect(uncommented0039).not.toMatch(/\bWITH\s+CHECK\s*\(\s*true\s*\)/i);
    });

    it("never targets public Pings, profiles, published Moments, Venture listings, Clips, or Hub content for expiration", () => {
      const expireFn = sql0039.slice(
        sql0039.indexOf("CREATE OR REPLACE FUNCTION public.process_expired_private_messages_batch"),
        sql0039.indexOf("CREATE OR REPLACE FUNCTION public.claim_media_deletion_jobs"),
      );
      expect(expireFn).toContain("FROM public.private_messages");
      expect(expireFn).not.toContain("public.pings");
      expect(expireFn).not.toContain("public.moments");
      expect(expireFn).not.toContain("public.hub_messages");
      expect(expireFn).not.toContain("public.profiles");
      expect(expireFn).not.toContain("public.business_listings");
    });

    it("hides retention UI controls in DirectMessageChat and PingActivityPrivacy when feature flag is OFF", async () => {
      rpcMock.mockImplementation(async (fn: string) => {
        if (fn === "get_my_chat_retention_entitlement") {
          return {
            data: { ...DEFAULT_CHAT_RETENTION_ENTITLEMENT, feature_enabled: false },
            error: null,
          };
        }
        return { data: null, error: null };
      });

      const { unmount } = renderWithQuery(
        <DirectMessageChat conversation={BASE_CONVERSATION} messages={[]} />,
      );

      await waitFor(() => {
        expect(rpcMock).toHaveBeenCalledWith("get_my_chat_retention_entitlement");
      });
      expect(screen.queryByTestId("conversation-retention-badge")).toBeNull();
      unmount();

      renderWithQuery(<PingActivityPrivacy userId="user-alice" />);
      expect(screen.queryByTestId("default-chat-retention-section")).toBeNull();
    });
  });

  describe("2. Entitlement Tiers, Participant Ceiling & Central Rules", () => {
    it("enforces tier entitlements and lowest-participant ceiling across mixed accounts", () => {
      // Standard unverified (7d) vs Verified (30d) -> effective max is 7d
      expect(computeEffectiveConversationMaxPolicy(["30d", "7d"])).toBe("7d");
      // Verified (30d) vs Paid (1y) -> effective max is 30d
      expect(computeEffectiveConversationMaxPolicy(["1y", "30d"])).toBe("30d");
      // Two Business / Premium users -> until_deleted allowed
      expect(computeEffectiveConversationMaxPolicy(["until_deleted", "until_deleted"])).toBe(
        "until_deleted",
      );

      expect(isPolicyAllowedByMax("24h_after_view", "7d")).toBe(true);
      expect(isPolicyAllowedByMax("7d", "7d")).toBe(true);
      expect(isPolicyAllowedByMax("30d", "7d")).toBe(false);
      expect(isPolicyAllowedByMax("1y", "30d")).toBe(false);
      expect(isPolicyAllowedByMax("until_deleted", "1y")).toBe(false);
      expect(isPolicyAllowedByMax("until_deleted", "until_deleted")).toBe(true);

      // Verify central entitlement config table & plan reuse in 0039
      expect(sql0039).toContain(
        "CREATE TABLE IF NOT EXISTS public.chat_retention_entitlement_rules",
      );
      expect(sql0039).toMatch(/'standard_unverified',\s*'7d',\s*104857600/);
      expect(sql0039).toMatch(/'verified',\s*'30d',\s*524288000/);
      expect(sql0039).toMatch(/'paid_eligible',\s*'1y',\s*2147483648/);
      expect(sql0039).toMatch(/'premium_eligible',\s*'until_deleted',\s*10737418240/);
      expect(sql0039).toContain("public.account_verifications");
      expect(sql0039).toContain("public.account_subscriptions");
      expect(sql0039).toContain("public.resolve_conversation_max_retention_policy");
      expect(sql0039).toContain("max_retention_rank");
      expect(sql0039).toContain("SELECT min(");
    });

    it("formats storage quotas and expiry remaining-time badges accurately", () => {
      expect(formatStorageBytes(104_857_600)).toBe("100.0 MB");
      expect(formatStorageBytes(2_147_483_648)).toBe("2.00 GB");

      const nowMs = Date.parse("2026-11-24T12:00:00Z");
      expect(
        formatMessageExpiryBadge({
          expiresAt: "2026-11-24T12:30:00Z",
          retentionPolicy: "24h_after_view",
          isSavedInChat: false,
          nowMs,
        }),
      ).toEqual({ label: "Expires in 30m", urgent: true });

      expect(
        formatMessageExpiryBadge({
          expiresAt: "2026-11-24T16:00:00Z",
          retentionPolicy: "24h_after_view",
          isSavedInChat: false,
          nowMs,
        }),
      ).toEqual({ label: "Expires in 4h", urgent: true });

      expect(
        formatMessageExpiryBadge({
          expiresAt: "2026-11-30T12:00:00Z",
          retentionPolicy: "7d",
          isSavedInChat: false,
          nowMs,
        }),
      ).toEqual({ label: "Expires in 6d", urgent: false });

      expect(
        formatMessageExpiryBadge({
          expiresAt: "2026-11-24T12:30:00Z",
          retentionPolicy: "7d",
          isSavedInChat: true,
          nowMs,
        }),
      ).toEqual({ label: "Saved in chat", urgent: false });

      // Legacy message with null expires_at & no until_deleted -> null badge (no fake countdown)
      expect(
        formatMessageExpiryBadge({
          expiresAt: null,
          retentionPolicy: null,
          isSavedInChat: false,
          nowMs,
        }),
      ).toBeNull();
    });
  });

  describe("3. 24h-After-View, Save/Unsave Survival, New-Messages-Only Policy & Legacy Compatibility (SQL + UI)", () => {
    it("verifies 24h_after_view view trigger, save survival, unsave recalculation, quota check, and legacy null preservation in 0039", () => {
      // 24h_after_view starts 24h clock inside mark_conversation_read while preserving 0037 reciprocal read receipts
      expect(sql0039).toContain("retention_policy = '24h_after_view'");
      expect(sql0039).toContain("first_viewed_at = now()");
      expect(sql0039).toContain("now() + interval '24 hours'");

      // Saved messages survive ordinary expiration
      expect(sql0039).toContain("AND pm.is_saved_in_chat = false");
      expect(sql0039).toContain("CREATE OR REPLACE FUNCTION public.toggle_save_private_message");
      // Storage quota enforcement inside toggle_save_private_message
      expect(sql0039).toContain("v_used + v_msg_bytes > v_quota");
      expect(sql0039).toContain("Saved chat storage quota exceeded");
      // Unsave restores applicable expiry based on original policy & timestamps
      expect(sql0039).toContain("ELSIF v_msg.retention_policy = '24h_after_view' THEN");
      expect(sql0039).toContain(
        "public.compute_retention_expires_at(v_msg.retention_policy, v_msg.created_at)",
      );
      expect(sql0039).toContain("WHEN '7d' THEN p_base_time + interval '7 days'");
      expect(sql0039).toContain("WHEN '30d' THEN p_base_time + interval '30 days'");
      expect(sql0039).toContain("WHEN '1y' THEN p_base_time + interval '365 days'");

      // Conversation policy change applies ONLY to new messages and writes visible system notice
      const setPolicyFn = sql0039.slice(
        sql0039.indexOf("CREATE OR REPLACE FUNCTION public.set_conversation_retention_policy"),
        sql0039.indexOf("CREATE OR REPLACE FUNCTION public.toggle_save_private_message"),
      );
      expect(setPolicyFn).toContain("(applies to new messages).");
      expect(setPolicyFn).toContain("is_system");
      expect(setPolicyFn).not.toMatch(/UPDATE\s+public\.private_messages/i);

      // Legacy messages (expires_at IS NULL) are excluded from batch expiry
      expect(sql0039).toContain("pm.expires_at IS NOT NULL");
      expect(sql0039).toContain("pm.expires_at <= now()");
    });

    it("renders visible retention pill, system notice, expiry badge, and shared Saved indicator for both participants when enabled", async () => {
      rpcMock.mockImplementation(async (fn: string) => {
        if (fn === "get_my_chat_retention_entitlement") {
          return {
            data: {
              ...DEFAULT_CHAT_RETENTION_ENTITLEMENT,
              tier_key: "verified",
              is_verified: true,
              max_retention_policy: "30d",
              max_retention_rank: 3,
              saved_storage_quota_bytes: 524_288_000,
              saved_storage_used_bytes: 10_485_760,
              feature_enabled: true,
              default_chat_retention_policy: "7d",
            },
            error: null,
          };
        }
        if (fn === "set_conversation_retention_policy") {
          return {
            data: {
              conversation_id: BASE_CONVERSATION.id,
              retention_policy: "24h_after_view",
              effective_max_policy: "7d",
            },
            error: null,
          };
        }
        return { data: null, error: null };
      });

      const messages: PrivateMessage[] = [
        {
          id: "msg-sys-1",
          conversation_id: BASE_CONVERSATION.id,
          sender_id: "user-alice",
          content: "Chat retention updated to 7 days. Applies to new messages only.",
          media_url: null,
          media_type: null,
          status: "sent",
          edited_at: null,
          deleted_at: null,
          is_pinned: false,
          reply_to_id: null,
          forwarded_from_id: null,
          retention_policy: "7d",
          expires_at: null,
          is_saved_in_chat: false,
          is_system: true,
          created_at: "2026-11-24T11:30:00Z",
          updated_at: "2026-11-24T11:30:00Z",
        },
        {
          id: "msg-saved-peer",
          conversation_id: BASE_CONVERSATION.id,
          sender_id: "user-bob",
          content: "Important contract attachment saved by Bob",
          media_url: null,
          media_type: null,
          status: "read",
          edited_at: null,
          deleted_at: null,
          is_pinned: false,
          reply_to_id: null,
          forwarded_from_id: null,
          retention_policy: "7d",
          expires_at: null,
          is_saved_in_chat: true,
          is_system: false,
          created_at: "2026-11-24T11:45:00Z",
          updated_at: "2026-11-24T11:45:00Z",
        },
        {
          id: "msg-expiring",
          conversation_id: BASE_CONVERSATION.id,
          sender_id: "user-alice",
          content: "Ephemeral update",
          media_url: null,
          media_type: null,
          status: "sent",
          edited_at: null,
          deleted_at: null,
          is_pinned: false,
          reply_to_id: null,
          forwarded_from_id: null,
          retention_policy: "24h_after_view",
          expires_at: new Date(Date.now() + 3 * 3_600_000).toISOString(),
          is_saved_in_chat: false,
          is_system: false,
          created_at: "2026-11-24T11:50:00Z",
          updated_at: "2026-11-24T11:50:00Z",
        },
        {
          id: "msg-legacy",
          conversation_id: BASE_CONVERSATION.id,
          sender_id: "user-bob",
          content: "Legacy pre-retention message",
          media_url: null,
          media_type: null,
          status: "read",
          edited_at: null,
          deleted_at: null,
          is_pinned: false,
          reply_to_id: null,
          forwarded_from_id: null,
          retention_policy: null,
          expires_at: null,
          is_saved_in_chat: false,
          is_system: false,
          created_at: "2026-11-20T10:00:00Z",
          updated_at: "2026-11-20T10:00:00Z",
        },
      ];

      renderWithQuery(<DirectMessageChat conversation={BASE_CONVERSATION} messages={messages} />);

      // Visible retention header pill
      const badge = await screen.findByTestId("conversation-retention-badge");
      expect(badge.textContent).toContain("7 days");

      // Centered system notice visible
      const sysNotice = screen.getByTestId("chat-system-notice");
      expect(sysNotice.textContent).toContain("Applies to new messages only.");

      // Shared "Saved" indicator visible to Alice even on Bob's message
      const savedPill = screen.getByTestId("message-saved-indicator");
      expect(savedPill.textContent).toContain("Saved");

      // Remaining expiry countdown shown on expiring message (and NOT on legacy null-expiry message)
      const expiryPills = screen.getAllByTestId("message-expiry-indicator");
      expect(expiryPills).toHaveLength(1);
      expect(expiryPills[0]?.textContent).toMatch(/Expires in \d+[hm]/);

      // Legacy message renders normally
      expect(screen.getByText("Legacy pre-retention message")).toBeTruthy();

      // Open Conversation Retention Settings dialog -> select 24h_after_view
      fireEvent.click(badge);
      const dialog = await screen.findByTestId("conversation-retention-dialog");
      expect(dialog.textContent).toContain("10.0 MB / 500.0 MB");

      const opt24h = screen.getByRole("button", { name: /24 hours after viewing/i });
      fireEvent.click(opt24h);

      await waitFor(() => {
        expect(rpcMock).toHaveBeenCalledWith("set_conversation_retention_policy", {
          p_conversation_id: BASE_CONVERSATION.id,
          p_policy: "24h_after_view",
        });
      });
    });

    it("renders Default Private Chat Retention & quota meter in PingActivityPrivacy when flag is ON", async () => {
      rpcMock.mockImplementation(async (fn: string) => {
        if (fn === "get_my_chat_retention_entitlement") {
          return {
            data: {
              ...DEFAULT_CHAT_RETENTION_ENTITLEMENT,
              feature_enabled: true,
              saved_storage_used_bytes: 5_242_880,
              saved_storage_quota_bytes: 104_857_600,
              max_retention_policy: "7d",
              default_chat_retention_policy: "7d",
            },
            error: null,
          };
        }
        return { data: null, error: null };
      });

      renderWithQuery(<PingActivityPrivacy userId="user-alice" />);

      const section = await screen.findByTestId("default-chat-retention-section");
      expect(section.textContent).toContain("5.0 MB / 100.0 MB");

      // 30d option must be disabled for standard unverified user (max 7d)
      const opt30d = screen.getByRole("radio", { name: /30 days after sending/i });
      expect((opt30d as HTMLButtonElement).disabled).toBe(true);
    });
  });

  describe("4. Signed URL Non-Renewal After Expiry & Storage RLS Protection", () => {
    it("verifies Migration 0039 blocks signed-URL renewal for expired, deleted, or queued DM objects", () => {
      expect(sql0039).toContain(
        'CREATE POLICY "DM conversation participants read signed files" ON storage.objects',
      );
      expect(sql0039).toContain("pm.expired_at IS NOT NULL");
      expect(sql0039).toContain("pm.expires_at <= now()");
      expect(sql0039).toContain("public.media_deletion_queue");
    });

    it("denies /api/media/sign-read when DM attachment belongs to an expired private message", async () => {
      const env = {
        PING_MEDIA_PROVIDER: "cloudflare_r2",
        R2_ACCOUNT_ID: "acct123",
        R2_ACCESS_KEY_ID: "AKIA_TEST",
        R2_SECRET_ACCESS_KEY: "SECRET_TEST",
      };
      const req = new Request("https://ping.test/api/media/sign-read", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-jwt",
        },
        body: JSON.stringify({
          ref: "r2://dm-attachments/11111111-1111-4111-8111-111111111111/user-bob/expired-photo.webp",
        }),
      });

      const res = await handleSignReadRequest(req, {
        env,
        verifyAuthUser: async () => ({ id: "user-alice" }),
        authorizeAction: async () => ({
          allowed: false,
          reason: "Attachment has expired or been deleted.",
        }),
      });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/expired/i);
    });
  });

  describe("5. Scheduled Worker: Multi-Type Media Deletion, Retries, Idempotency, Orphans & Large Batches", () => {
    it("deletes expired image, video, audio, and document objects plus derivative thumbnails across providers", async () => {
      const deletedCalls: Array<{ provider: string; bucket: string; keys: string[] }> = [];
      const completedJobs: Array<{ jobId: string; success: boolean; error?: string }> = [];

      const jobs: MediaDeletionJobRow[] = [
        {
          id: "job-img",
          provider: "supabase_storage",
          bucket: "dm-attachments",
          object_key: "c1/u1/photo.webp",
          derivative_keys: ["c1/u1/photo_thumb.webp"],
          source_type: "private_message",
          source_id: "m1",
          size_bytes: 120_000,
          status: "processing",
          attempt_count: 1,
          max_attempts: 5,
        },
        {
          id: "job-vid",
          provider: "cloudflare_r2",
          bucket: "dm-attachments",
          object_key: "c1/u1/clip.mp4",
          derivative_keys: ["c1/u1/clip_poster.jpg"],
          source_type: "private_message",
          source_id: "m2",
          size_bytes: 8_400_000,
          status: "processing",
          attempt_count: 1,
          max_attempts: 5,
        },
        {
          id: "job-aud",
          provider: "supabase_storage",
          bucket: "dm-attachments",
          object_key: "c1/u1/voice.webm",
          derivative_keys: [],
          source_type: "private_message",
          source_id: "m3",
          size_bytes: 96_000,
          status: "processing",
          attempt_count: 1,
          max_attempts: 5,
        },
        {
          id: "job-doc-fail",
          provider: "supabase_storage",
          bucket: "dm-attachments",
          object_key: "c1/u1/contract.pdf",
          derivative_keys: [],
          source_type: "private_message",
          source_id: "m4",
          size_bytes: 512_000,
          status: "processing",
          attempt_count: 1,
          max_attempts: 5,
        },
      ];

      const deps: ChatRetentionWorkerDeps = {
        processExpiredBatch: vi.fn(async () => ({
          expired_messages: 4,
          enqueued_media_deletions: 4,
        })),
        enqueueOrphanedStaging: vi.fn(async () => 2),
        claimDeletionJobs: vi.fn(async () => jobs),
        completeDeletionJob: vi.fn(async (jobId, success, error) => {
          completedJobs.push({ jobId, success, ...(error ? { error } : {}) });
        }),
        deleteStorageKeys: vi.fn(async (provider, bucket, keys) => {
          deletedCalls.push({ provider, bucket, keys });
          if (keys.includes("c1/u1/contract.pdf")) {
            return { ok: false, error: "Storage gateway 503" };
          }
          return { ok: true };
        }),
      };

      const summary = await runChatRetentionSweep(deps, { messageBatchSize: 500 });

      expect(summary.expiredMessages).toBe(4);
      expect(summary.enqueuedMediaDeletions).toBe(4);
      expect(summary.orphansEnqueued).toBe(2);
      // 2 keys (photo + thumb) + 2 keys (video + poster) + 1 key (audio) = 5 objects deleted
      expect(summary.deletedObjects).toBe(5);
      expect(summary.failedObjects).toBe(1);
      expect(summary.errors).toEqual(["Storage gateway 503"]);

      expect(deletedCalls[0]?.keys).toEqual(["c1/u1/photo.webp", "c1/u1/photo_thumb.webp"]);
      expect(deletedCalls[1]).toEqual({
        provider: "cloudflare_r2",
        bucket: "dm-attachments",
        keys: ["c1/u1/clip.mp4", "c1/u1/clip_poster.jpg"],
      });
      expect(completedJobs.find((j) => j.jobId === "job-doc-fail")).toEqual({
        jobId: "job-doc-fail",
        success: false,
        error: "Storage gateway 503",
      });

      // Verify idempotency, SKIP LOCKED, exponential retry backoff, & content-free audit in 0038/0039
      const sql0038 = readRel(
        "drizzle/migrations/0038_stage2_storage_buckets_rls_and_media_assets.sql",
      );
      expect(sql0038).toContain("ON CONFLICT (provider, bucket, object_key) DO NOTHING");
      expect(sql0038).toContain("enqueue_orphaned_staging_media");
      expect(sql0039).toContain("FOR UPDATE SKIP LOCKED");
      expect(sql0039).toContain("power(2, least(coalesce(v_attempts, 1), 8))");
      expect(sql0039).toContain("chat_retention_deletion_audit");
      expect(sql0039).toContain("private_messages_expiry_due_idx");
    });

    it("processes large volumes (2,500 expired messages) across bounded batches without full-table scan", async () => {
      let remaining = 2500;
      const deps: ChatRetentionWorkerDeps = {
        processExpiredBatch: vi.fn(async (batchSize) => {
          const take = Math.min(batchSize, remaining);
          remaining -= take;
          return { expired_messages: take, enqueued_media_deletions: Math.floor(take / 5) };
        }),
        enqueueOrphanedStaging: vi.fn(async () => 0),
        claimDeletionJobs: vi.fn(async () => []),
        completeDeletionJob: vi.fn(async () => {}),
        deleteStorageKeys: vi.fn(async () => ({ ok: true })),
      };

      const summary = await runChatRetentionSweep(deps, {
        messageBatchSize: 500,
        maxMessageBatches: 10,
      });

      expect(summary.expiredMessages).toBe(2500);
      expect(summary.enqueuedMediaDeletions).toBe(500);
      // 5 full batches of 500 + 1 final batch returning 0 -> stops early at 6 batches
      expect(summary.batchesProcessed).toBe(6);
      expect(remaining).toBe(0);
    });

    it("enforces CRON_SECRET on POST /api/cron/chat-retention", async () => {
      const unauth = await handleChatRetentionCronRequest(
        new Request("https://ping.test/api/cron/chat-retention", {
          method: "POST",
          headers: { Authorization: "Bearer wrong-secret" },
        }),
        { env: { CRON_SECRET: "super-secret-cron-token" } },
      );
      expect(unauth.status).toBe(401);

      const okRes = await handleChatRetentionCronRequest(
        new Request("https://ping.test/api/cron/chat-retention", {
          method: "POST",
          headers: { Authorization: "Bearer super-secret-cron-token" },
        }),
        {
          env: { CRON_SECRET: "super-secret-cron-token" },
          depsOverride: {
            processExpiredBatch: async () => ({ expired_messages: 3, enqueued_media_deletions: 1 }),
            enqueueOrphanedStaging: async () => 1,
            claimDeletionJobs: async () => [],
            completeDeletionJob: async () => {},
            deleteStorageKeys: async () => ({ ok: true }),
          },
        },
      );
      expect(okRes.status).toBe(200);
      const body = await okRes.json();
      expect(body.ok).toBe(true);
      expect(body.summary.expiredMessages).toBe(3);
      expect(body.summary.orphansEnqueued).toBe(1);
    });
  });
});
