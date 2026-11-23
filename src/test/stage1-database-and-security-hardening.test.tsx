import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  GRIOT_RATE_LIMIT_MAX,
  handleGriotAssistRequest,
  resetGriotInMemoryRateLimiter,
} from "@/lib/griot-server";
import { ConversationList } from "@/components/messages/ConversationList";
import type { Conversation, PrivateMessage } from "@/lib/messages";

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS_DIR = path.join(ROOT, "drizzle", "migrations");

function readRel(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function stripSqlComments(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const storageDownloadMock = vi.fn();
const storageUploadMock = vi.fn();
const storageCreateSignedUrlMock = vi.fn();
const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = () => {
    const chain: Record<string, unknown> = {};
    const methods = [
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
    ];
    for (const m of methods) {
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
          download: storageDownloadMock,
          upload: storageUploadMock,
          createSignedUrl: storageCreateSignedUrlMock,
          getPublicUrl: vi.fn(() => ({
            data: { publicUrl: "https://cdn.example/media/test.jpg" },
          })),
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
    user: { id: "user-bob", email: "bob@ping.test" },
    profile: { id: "user-bob", username: "bob", display_name: "Bob" },
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

describe("Ping V1 Stage 1 — Database Repair & Security Hardening", () => {
  beforeEach(() => {
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    }
    resetGriotInMemoryRateLimiter();
    storageDownloadMock.mockReset();
    storageUploadMock.mockReset();
    storageCreateSignedUrlMock.mockReset();
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  afterEach(() => {
    resetGriotInMemoryRateLimiter();
  });

  describe("1. Migration Repair & Drizzle Journal Consistency (0000–0037)", () => {
    it("verifies _journal.json is strictly sequential from 0000 through 0037 with full disk parity", () => {
      const journal = JSON.parse(readRel("drizzle/migrations/meta/_journal.json")) as {
        entries: Array<{ idx: number; when: number; tag: string }>;
      };

      expect(journal.entries.length).toBeGreaterThanOrEqual(38);
      let prevWhen = -1;
      const expectedFiles = new Set<string>();

      journal.entries.forEach((entry, i) => {
        expect(entry.idx).toBe(i);
        expect(entry.tag.startsWith(`${String(i).padStart(4, "0")}_`)).toBe(true);
        expect(entry.when).toBeGreaterThan(prevWhen);
        prevWhen = entry.when;
        const sqlFile = `${entry.tag}.sql`;
        expect(fs.existsSync(path.join(MIGRATIONS_DIR, sqlFile))).toBe(true);
        expectedFiles.add(sqlFile);
      });

      const diskSqlFiles = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
      expect(new Set(diskSqlFiles)).toEqual(expectedFiles);

      const entry37 = journal.entries.find((e) => e.idx === 37);
      expect(entry37?.tag).toBe("0037_stage1_messaging_privacy_and_security_hardening");
    });

    it("verifies all 4 migration defects are repaired across 0029, 0031, 0033, 0035 and re-asserted in 0037", () => {
      const sql0029 = readRel(
        "drizzle/migrations/0029_phase2_social_messaging_hubs_signals_notifications.sql",
      );
      const sql0031 = readRel(
        "drizzle/migrations/0031_phase4_business_commerce_ads_and_wallet.sql",
      );
      const sql0033 = readRel(
        "drizzle/migrations/0033_premium_ux_dot_economy_and_interactions.sql",
      );
      const sql0035 = readRel("drizzle/migrations/0035_admin_control_centre_and_early_access.sql");
      const sql0037 = readRel(
        "drizzle/migrations/0037_stage1_messaging_privacy_and_security_hardening.sql",
      );

      // Repair 1: dot_transactions.reference_id (zero source_ref on dot_transactions)
      expect(sql0031).not.toMatch(/dot_transactions\s*\([^)]*source_ref/i);
      expect(sql0033).not.toMatch(/dot_transactions\s*\([^)]*source_ref/i);
      expect(sql0031).toContain(
        "INSERT INTO public.dot_transactions (user_id, amount, tx_type, source, reference_id, description)",
      );
      expect(sql0033).toContain(
        "INSERT INTO public.dot_transactions (user_id, amount, tx_type, source, reference_id, description)",
      );

      // Repair 2: notifications schema reconciliation (0005 <-> 0029 <-> 0033)
      expect(sql0029).toContain("ALTER COLUMN ping_id DROP NOT NULL");
      expect(sql0029).toContain("ALTER COLUMN comment_id DROP NOT NULL");
      expect(sql0029).toContain("notifications_kind_check");
      expect(sql0029).toContain("'ping_reply', 'comment_reply'");
      expect(sql0029).toContain("'message_request'");
      expect(sql0033).not.toMatch(/INSERT\s+INTO\s+public\.notifications\s*\([^)]*category/i);
      expect(sql0033).toContain(
        "INSERT INTO public.notifications (user_id, kind, title, body, href)",
      );

      // Repair 3: conversation_members.role CHECK widened to allow 'owner'
      expect(sql0029).toContain("conversation_members_role_check");
      expect(sql0029).toContain("CHECK (role IN ('owner', 'admin', 'member'))");
      expect(sql0037).toContain("conversation_members_role_check");

      // Repair 4: admin_moderate preserves comment moderation actions with RBAC check
      for (const action of ["hide_comment", "restore_comment", "resolve_comment_report"]) {
        expect(sql0035).toContain(`_action = '${action}'`);
        expect(sql0037).toContain(`_action = '${action}'`);
      }
      expect(sql0035).toContain("has_admin_permission_for_user(_actor, 'content.moderate')");
      expect(sql0037).toContain(
        "REVOKE ALL ON FUNCTION public.admin_moderate(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;",
      );
    });
  });

  describe("2. Database Messaging, Privacy & Storage Security Review (Migration 0037)", () => {
    const sql0037 = readRel(
      "drizzle/migrations/0037_stage1_messaging_privacy_and_security_hardening.sql",
    );
    const uncommented = stripSqlComments(sql0037);

    it("enforces zero USING(true), zero WITH CHECK(true), and valid PostgreSQL DROP POLICY syntax", () => {
      expect(uncommented).not.toMatch(/\bUSING\s*\(\s*true\s*\)/i);
      expect(uncommented).not.toMatch(/\bWITH\s+CHECK\s*\(\s*true\s*\)/i);
      expect(uncommented).not.toMatch(/DROP\s+POLICY\s+IF\s+EXISTS\s+"[^"]+"\s+ON\s+\S+\s+FOR\s+/i);
      const dollarCount = (uncommented.match(/\$\$/g) ?? []).length;
      expect(dollarCount % 2).toBe(0);
    });

    it("blocks group admin self-promotion, unauthorized membership changes, and private_messages tampering", () => {
      // Conversations & conversation_members write lockdown
      expect(sql0037).toContain(
        "REVOKE INSERT, UPDATE, DELETE ON public.conversations FROM PUBLIC, anon, authenticated;",
      );
      expect(sql0037).toContain(
        "REVOKE INSERT, UPDATE, DELETE ON public.conversation_members FROM PUBLIC, anon, authenticated;",
      );
      expect(sql0037).toContain(
        "GRANT UPDATE (is_muted, is_archived, hidden_at, last_read_at) ON public.conversation_members TO authenticated;",
      );
      expect(sql0037).toContain("CREATE OR REPLACE FUNCTION public.guard_conversation_members()");
      expect(sql0037).toContain("NEW.role IS DISTINCT FROM OLD.role");

      // Private messages tampering & legacy backdoor lockdown
      expect(sql0037).toContain(
        "REVOKE INSERT, UPDATE, DELETE ON public.conversation_messages FROM PUBLIC, anon, authenticated;",
      );
      expect(sql0037).toContain(
        "REVOKE UPDATE, DELETE ON public.private_messages FROM PUBLIC, anon, authenticated;",
      );
      expect(sql0037).toContain(
        "GRANT UPDATE (content, deleted_at, edited_at, updated_at) ON public.private_messages TO authenticated;",
      );
      expect(sql0037).toContain("CREATE OR REPLACE FUNCTION public.guard_private_message_write()");
      expect(sql0037).toContain("OR NEW.status IS DISTINCT FROM OLD.status");
      expect(sql0037).toContain("OR NEW.is_pinned IS DISTINCT FROM OLD.is_pinned");
      expect(sql0037).toContain("Deleted messages cannot be restored or edited");
    });

    it("enforces message-request lifecycle, blocks, only_admins_can_post, profile_visibility, and read_receipts_enabled", () => {
      // Message requests + private profile unsolicited contact lock
      expect(sql0037).toContain(
        "dm_permission IN ('everyone', 'requests', 'mutual_follows', 'nobody')",
      );
      expect(sql0037).toContain("request_status IN ('accepted', 'pending', 'declined')");
      expect(sql0037).toContain(
        "This account is private and only accepts messages from mutual connections",
      );
      expect(sql0037).toContain("Pending message requests are text-only until accepted");
      expect(sql0037).toContain(
        "You can only send one message request until the recipient accepts",
      );
      expect(sql0037).toContain("CREATE OR REPLACE FUNCTION public.accept_message_request(");
      expect(sql0037).toContain("CREATE OR REPLACE FUNCTION public.decline_message_request(");

      // only_admins_can_post + blocks + attachment path scoping
      expect(sql0037).toContain("Only group admins can post in this conversation");
      expect(sql0037).toContain("Cannot send message: communication is blocked");
      expect(sql0037).toContain("Private attachment path must be scoped to this conversation");

      // profile_visibility RLS across pings, profile_connections, comments, moments
      expect(sql0037).toContain("CREATE OR REPLACE FUNCTION public.can_view_profile_content(");
      expect(sql0037).toContain("public.can_view_profile_content(pings.user_id)");
      expect(sql0037).toContain("public.can_view_profile_content(profile_connections.user_id)");
      expect(sql0037).toContain("public.can_view_profile_content(moments.author_id)");

      // read_receipts_enabled privacy enforcement
      expect(sql0037).toContain("SELECT coalesce(read_receipts_enabled, true)");
      expect(sql0037).toContain("IF v_send_receipts AND v_req_status = 'accepted' THEN");

      // Storage dm-attachments INSERT policy restricts pending/declined/blocked/admin-only uploads
      expect(sql0037).toContain("coalesce(c.request_status, 'accepted') = 'accepted'");
    });
  });

  describe("3. GRIOT AI Server Endpoint Security (/api/griot/assist)", () => {
    function makeReq(body: unknown, headers: Record<string, string> = {}) {
      return new Request("https://pingbydot.example/api/griot/assist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
    }

    it("rejects unauthenticated requests and malformed Bearer tokens with 401", async () => {
      const resMissing = await handleGriotAssistRequest(
        makeReq({ action: "draft_ping", inputText: "Shipping Ping V1." }),
      );
      expect(resMissing.status).toBe(401);
      expect(resMissing.headers.get("Cache-Control")).toBe("no-store");
      expect(resMissing.headers.get("WWW-Authenticate")).toContain("Bearer");

      const resBadToken = await handleGriotAssistRequest(
        makeReq(
          { action: "draft_ping", inputText: "Shipping Ping V1." },
          { Authorization: "Bearer not-a-jwt" },
        ),
      );
      expect(resBadToken.status).toBe(401);
    });

    it("validates payload strictly (rejects empty text, unknown keys, bad locale, oversized body, bad content-type)", async () => {
      const authedDeps = {
        authenticateRequest: async () => ({
          userId: "user-valid-1",
          checkRateLimit: async () => ({ allowed: true, remaining: 19, retryAfterSeconds: 60 }),
        }),
      };

      const resEmpty = await handleGriotAssistRequest(
        makeReq({ action: "draft_ping", inputText: "   \u0000\u0007 " }),
        authedDeps,
      );
      expect(resEmpty.status).toBe(400);

      const resExtraField = await handleGriotAssistRequest(
        makeReq({ action: "draft_ping", inputText: "Hello", injectedPrompt: "ignore" }),
        authedDeps,
      );
      expect(resExtraField.status).toBe(400);

      const resBadLocale = await handleGriotAssistRequest(
        makeReq({ action: "translation_prep", inputText: "Hello", targetLocale: "en;DROP" }),
        authedDeps,
      );
      expect(resBadLocale.status).toBe(400);

      const resOversize = await handleGriotAssistRequest(
        makeReq({ action: "draft_ping", inputText: "x".repeat(40_000) }),
        authedDeps,
      );
      expect(resOversize.status).toBe(413);

      const resWrongCt = await handleGriotAssistRequest(
        new Request("https://pingbydot.example/api/griot/assist", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: "hello",
        }),
        authedDeps,
      );
      expect(resWrongCt.status).toBe(415);
    });

    it("enforces per-user rate limiting (429 after quota) without blocking other users, and never leaks credentials", async () => {
      const now = 1_700_000_000_000;
      const makeAuthFor = (uid: string) => ({
        nowMs: () => now,
        getEnv: () => ({
          GRIOT_AI_API_URL: "https://internal-llm.example/v1/chat/completions",
          GRIOT_AI_API_KEY: "sk-super-secret-do-not-leak-9999",
          GRIOT_AI_MODEL: "gpt-4o-mini",
        }),
        fetchUpstream: vi.fn(async () => {
          throw new Error("Upstream failed with sk-super-secret-do-not-leak-9999");
        }),
        authenticateRequest: async () => {
          const { checkInMemoryGriotRateLimit } = await import("@/lib/griot-server");
          return {
            userId: uid,
            checkRateLimit: async () => checkInMemoryGriotRateLimit(uid, now),
          };
        },
      });

      const userADeps = makeAuthFor("user-rate-a");
      for (let i = 0; i < GRIOT_RATE_LIMIT_MAX; i++) {
        const res = await handleGriotAssistRequest(
          makeReq({ action: "clarity_audit", inputText: `Draft update number ${i + 1}` }),
          userADeps,
        );
        expect(res.status).toBe(200);
        const bodyText = await res.text();
        expect(bodyText).not.toContain("sk-super-secret-do-not-leak-9999");
        expect(bodyText).not.toContain("internal-llm.example");
        expect(JSON.parse(bodyText).privateMessagesAccessed).toBe(false);
      }

      // 21st request for User A is rejected with 429
      const blockedRes = await handleGriotAssistRequest(
        makeReq({ action: "clarity_audit", inputText: "One request too many" }),
        userADeps,
      );
      expect(blockedRes.status).toBe(429);
      expect(blockedRes.headers.get("X-RateLimit-Remaining")).toBe("0");
      expect(Number(blockedRes.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);

      // User B still succeeds independently
      const userBRes = await handleGriotAssistRequest(
        makeReq({ action: "draft_ping", inputText: "Independent user B draft" }),
        makeAuthFor("user-rate-b"),
      );
      expect(userBRes.status).toBe(200);
    });
  });

  describe("4. Safe DM Attachment Forwarding & Message Request UI", () => {
    it("re-uploads private DM attachments under targetConversationId/forwarderUserId when forwarding", async () => {
      const sourceConv = "11111111-1111-4111-8111-111111111111";
      const targetConv = "22222222-2222-4222-8222-222222222222";
      const forwarderId = "33333333-3333-4333-8333-333333333333";
      const sourcePath = `${sourceConv}/99999999-9999-4999-8999-999999999999/voice-123.webm`;

      const mockBlob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm" });
      storageDownloadMock.mockResolvedValueOnce({ data: mockBlob, error: null });
      storageUploadMock.mockImplementationOnce(async (uploadPath: string) => ({
        data: { path: uploadPath },
        error: null,
      }));
      storageCreateSignedUrlMock.mockResolvedValueOnce({
        data: {
          signedUrl:
            "https://exlttyafomvqfwgzzjrm.supabase.co/storage/v1/object/sign/dm-attachments/copied?token=xyz",
        },
        error: null,
      });

      const { forwardPrivateDmAttachment } = await import("@/lib/storage");
      const copied = await forwardPrivateDmAttachment(sourcePath, targetConv, forwarderId, "audio");

      expect(storageDownloadMock).toHaveBeenCalledWith(sourcePath);
      expect(copied.storagePath.startsWith(`${targetConv}/${forwarderId}/`)).toBe(true);
      expect(copied.storagePath).not.toContain(sourceConv);
      expect(copied.signedUrl).toContain("/storage/v1/object/sign/dm-attachments/");
    });

    it("separates incoming pending message requests into ConversationList Requests tab", () => {
      const acceptedConv: Conversation = {
        id: "conv-accepted",
        type: "direct",
        request_status: "accepted",
        created_by: "user-alice",
        last_message_at: "2026-11-23T12:00:00Z",
        last_message_preview: "Mutual friend hello",
        created_at: "2026-11-23T12:00:00Z",
        updated_at: "2026-11-23T12:00:00Z",
        other_member: {
          id: "user-alice",
          username: "alice",
          display_name: "Alice Mutual",
          bio: "",
          avatar_url: null,
          created_at: "2026-01-01T00:00:00Z",
        },
        unread_count: 0,
      };
      const pendingReqConv: Conversation = {
        id: "conv-req",
        type: "direct",
        request_status: "pending",
        requested_by: "user-stranger",
        request_recipient_id: "user-bob",
        created_by: "user-stranger",
        last_message_at: "2026-11-23T13:00:00Z",
        last_message_preview: "Hi Bob, can we collaborate?",
        created_at: "2026-11-23T13:00:00Z",
        updated_at: "2026-11-23T13:00:00Z",
        other_member: {
          id: "user-stranger",
          username: "stranger",
          display_name: "New Contact",
          bio: "",
          avatar_url: null,
          created_at: "2026-01-01T00:00:00Z",
        },
        unread_count: 1,
      };

      render(
        <ConversationList
          conversations={[acceptedConv, pendingReqConv]}
          currentUserId="user-bob"
          onSelect={vi.fn()}
        />,
      );

      // Default Inbox tab shows accepted chats, NOT incoming pending requests
      expect(screen.getByText("Alice Mutual")).toBeInTheDocument();
      expect(screen.queryByText("New Contact")).not.toBeInTheDocument();

      // Switching to Requests (1) tab shows the pending request
      const requestsTab = screen.getByRole("button", { name: /Requests \(1\)/i });
      fireEvent.click(requestsTab);
      expect(screen.getByText("New Contact")).toBeInTheDocument();
      expect(screen.queryByText("Alice Mutual")).not.toBeInTheDocument();
    });

    it("renders Accept/Decline/Block banner on incoming pending request and enforces single text-only limit on outgoing request", async () => {
      const { DirectMessageChat } = await import("@/components/messages/DirectMessageChat");
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

      const incomingPendingConv: Conversation = {
        id: "conv-incoming-req",
        type: "direct",
        request_status: "pending",
        requested_by: "user-stranger",
        request_recipient_id: "user-bob",
        created_by: "user-stranger",
        last_message_at: "2026-11-23T13:00:00Z",
        last_message_preview: "Hello Bob!",
        created_at: "2026-11-23T13:00:00Z",
        updated_at: "2026-11-23T13:00:00Z",
        other_member: {
          id: "user-stranger",
          username: "stranger",
          display_name: "Stranger",
          bio: "",
          avatar_url: null,
          created_at: "2026-01-01T00:00:00Z",
        },
        unread_count: 1,
      };

      const incomingMsg: PrivateMessage = {
        id: "msg-req-1",
        conversation_id: incomingPendingConv.id,
        sender_id: "user-stranger",
        content: "Hello Bob!",
        media_url: null,
        media_type: null,
        status: "sent",
        deleted_at: null,
        created_at: "2026-11-23T13:00:00Z",
        updated_at: "2026-11-23T13:00:00Z",
      };

      rpcMock.mockResolvedValue({
        data: { conversation_id: incomingPendingConv.id, request_status: "accepted" },
        error: null,
      });

      const { unmount } = render(
        <QueryClientProvider client={qc}>
          <DirectMessageChat conversation={incomingPendingConv} messages={[incomingMsg]} />
        </QueryClientProvider>,
      );

      expect(screen.getByTestId("incoming-message-request-banner")).toBeInTheDocument();
      const acceptBtn = screen.getByRole("button", { name: /^Accept$/i });
      expect(screen.getByRole("button", { name: /^Decline$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Block$/i })).toBeInTheDocument();

      fireEvent.click(acceptBtn);
      await waitFor(() => {
        expect(rpcMock).toHaveBeenCalledWith("accept_message_request", {
          p_conversation_id: incomingPendingConv.id,
        });
      });

      unmount();

      // Outgoing pending request with 1 already-sent message locks composer until accepted
      const outgoingPendingConv: Conversation = {
        ...incomingPendingConv,
        id: "conv-outgoing-req",
        requested_by: "user-bob",
        request_recipient_id: "user-stranger",
      };
      const outgoingMsg: PrivateMessage = {
        ...incomingMsg,
        id: "msg-out-1",
        conversation_id: outgoingPendingConv.id,
        sender_id: "user-bob",
      };

      render(
        <QueryClientProvider client={qc}>
          <DirectMessageChat conversation={outgoingPendingConv} messages={[outgoingMsg]} />
        </QueryClientProvider>,
      );

      expect(screen.getByTestId("outgoing-request-limit-banner")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Send message" })).not.toBeInTheDocument();
    });
  });
});
