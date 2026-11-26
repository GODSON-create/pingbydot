import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shouldHideBottomNav } from "@/components/layout/BottomNav";
import {
  formatStickerToken,
  parseStickerMessage,
  PING_STICKER_PACK,
} from "@/components/chat/ChatAttachmentControls";
import { getChatDraft, setChatDraftValue, setFocusedWorkspaceActive } from "@/lib/draft-store";
import { deriveProfileUsernameBase, ensureClientProfileRow } from "@/lib/ensure-profile";
import { detectMediaKind, resolveNormalizedMime, validateMediaUpload } from "@/lib/shield";
import {
  DM_MEDIA_BUCKET,
  extractPrivateDmMediaPath,
  formatStorageUploadError,
  isPrivateDmMediaRef,
  MEDIA_BUCKET,
} from "@/lib/storage";

const ROOT = path.resolve(__dirname, "../..");
const readRel = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const { rpcMock, fromMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: rpcMock,
    from: fromMock,
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
  },
}));

describe("Full-System Audit Repairs: Navigation, Creation Flows, Media & Privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setChatDraftValue("draft:dm:conv-1", "");
    setChatDraftValue("draft:hub:hub-1", "");
  });

  it("derives valid Ping usernames and recovers profiles when ensure_my_profile RPC is absent", async () => {
    const base = deriveProfileUsernameBase({
      id: "12345678-abcd-ef00-0000-111122223333",
      email: "a@b.com",
      user_metadata: { username: "!!X!" },
    });
    expect(base).toMatch(/^[a-z0-9_]{3,20}$/);

    const clean = deriveProfileUsernameBase({
      id: "12345678-abcd-ef00-0000-111122223333",
      email: "Ada.Lovelace+qa@example.com",
      user_metadata: {},
    });
    expect(clean).toBe("adalovelaceqa");

    const maybeSingleExisting = vi.fn().mockResolvedValue({ data: null, error: null });
    const maybeSingleInserted = vi.fn().mockResolvedValue({
      data: {
        id: "user-123",
        username: "founder_qa",
        display_name: "Founder QA",
        bio: "",
        avatar_url: null,
        created_at: new Date().toISOString(),
      },
      error: null,
    });

    fromMock.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: maybeSingleExisting }) }),
      insert: () => ({ select: () => ({ maybeSingle: maybeSingleInserted }) }),
    }));

    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find function ensure_my_profile" },
    });

    const recovered = await ensureClientProfileRow({
      id: "user-123",
      email: "founder_qa@pingbydot.test",
      user_metadata: { display_name: "Founder QA" },
    });

    expect(recovered?.username).toBe("founder_qa");
    expect(rpcMock).toHaveBeenCalledWith("ensure_my_profile");
    expect(fromMock).toHaveBeenCalledWith("profiles");
  });

  it("validates empty-MIME mobile captures, 0-byte guards, audio voice notes, and documents cleanly", () => {
    expect(resolveNormalizedMime({ type: "", name: "camera_capture.JPG" })).toBe("image/jpeg");
    expect(resolveNormalizedMime({ type: "video/x-m4v", name: "clip.m4v" })).toBe("video/mp4");
    expect(detectMediaKind({ type: "", name: "voice.m4a" })).toBe("audio");
    expect(detectMediaKind({ type: "", name: "pitch_deck.pdf" })).toBe("document");

    expect(validateMediaUpload({ type: "", size: 2048, name: "photo.jpg" }, "image").valid).toBe(
      true,
    );
    expect(
      validateMediaUpload({ type: "audio/webm", size: 64000, name: "note.webm" }, "audio").valid,
    ).toBe(true);
    expect(
      validateMediaUpload({ type: "application/pdf", size: 120000, name: "deck.pdf" }, "document")
        .valid,
    ).toBe(true);

    const zeroByte = validateMediaUpload(
      { type: "image/jpeg", size: 0, name: "empty.jpg" },
      "image",
    );
    expect(zeroByte.valid).toBe(false);
    expect(zeroByte.error).toContain("empty (0 bytes)");

    expect(
      validateMediaUpload(
        { type: "application/octet-stream", size: 500, name: "bad.apk" },
        "document",
      ).valid,
    ).toBe(false);
  });

  it("preserves DM/Hub drafts and coordinates focused chat workspace state", () => {
    setChatDraftValue("draft:dm:conv-1", "Unsent founder note");
    expect(getChatDraft("draft:dm:conv-1")).toBe("Unsent founder note");
    setChatDraftValue("draft:dm:conv-1", "");
    expect(getChatDraft("draft:dm:conv-1")).toBe("");

    const releaseA = setFocusedWorkspaceActive(true);
    const releaseB = setFocusedWorkspaceActive(true);
    releaseA();
    releaseB();

    expect(shouldHideBottomNav("/login")).toBe(true);
    expect(shouldHideBottomNav("/signup")).toBe(true);
    expect(shouldHideBottomNav("/onboarding")).toBe(true);
    expect(shouldHideBottomNav("/")).toBe(false);
    expect(shouldHideBottomNav("/explore")).toBe(false);
    expect(shouldHideBottomNav("/hubs")).toBe(false);
  });

  it("parses sticker tokens and validates private DM bucket refs safely", () => {
    const firstSticker = PING_STICKER_PACK[0]!;
    const encoded = formatStickerToken(firstSticker);
    const parsed = parseStickerMessage(encoded);
    expect(parsed?.id).toBe(firstSticker.id);
    expect(parseStickerMessage("Plain hello world")).toBeNull();

    const ref = `storage://${DM_MEDIA_BUCKET}/user-1/dm/conv-1/note.webm`;
    expect(isPrivateDmMediaRef(ref)).toBe(true);
    expect(extractPrivateDmMediaPath(ref)).toBe("user-1/dm/conv-1/note.webm");
    expect(isPrivateDmMediaRef("https://example.com/public.jpg")).toBe(false);

    expect(
      formatStorageUploadError(new Error("Bucket not found"), "fail", DM_MEDIA_BUCKET),
    ).toContain("0027");
    expect(formatStorageUploadError(new Error("Bucket not found"), "fail", MEDIA_BUCKET)).toContain(
      "0021",
    );
  });

  it("fixes Phase 3 Desktop Sidebar & Peer Profile overlap while keeping Mobile exclusivity", () => {
    const sidebarSrc = readRel("src/components/layout/DesktopSidebar.tsx");
    expect(sidebarSrc).toContain("desktop-sidebar-toggle");
    expect(sidebarSrc).toContain("hidden lg:flex");
    expect(sidebarSrc).toContain("w-20 xl:w-64");
    expect(sidebarSrc).toContain("effectiveCollapsed");
    expect(sidebarSrc).toContain("isInboxPath(pathname)");

    const workspaceSrc = readRel("src/components/messages/MessagesWorkspace.tsx");
    expect(workspaceSrc).toContain('isOpen("chat-peer-profile")');
    expect(workspaceSrc).toMatch(
      /peerProfileOpen\s*&&\s*activeConversation\s*&&\s*activeConversation\.type !== "group"\s*&&\s*otherUser/,
    );
    expect(workspaceSrc).toContain("setFocusedWorkspaceActive");

    const dmSrc = readRel("src/components/messages/DirectMessageChat.tsx");
    expect(dmSrc).toContain('data-no-gesture="true"');
    expect(dmSrc).toContain("chat-peer-profile-toggle");
    expect(dmSrc).toContain("useChatDraft");

    const splashSrc = readRel("src/components/layout/BootSplashScreen.tsx");
    expect(splashSrc).toContain("ping_boot_shown_v1");
    expect(splashSrc).toContain("SKIP_BOOT_PREFIXES");
  });

  it("repairs Hubs, Signals, Moments creation paths and broken Ping media handling", () => {
    const hubsCreateSrc = readRel("src/routes/hubs.create.tsx");
    expect(hubsCreateSrc).toContain("HUB_LEGACY_CATEGORY_MAP");
    expect(hubsCreateSrc).toContain("ensureClientProfileRow");
    expect(hubsCreateSrc).toContain("ImageUploadField");
    expect(hubsCreateSrc).not.toContain('supabase.from("hub_members").insert');

    const signalsCreateSrc = readRel("src/routes/signals.create.tsx");
    expect(signalsCreateSrc).toContain("SLUG_RE");
    expect(signalsCreateSrc).toContain("ensureClientProfileRow");
    expect(signalsCreateSrc).toContain("ImageUploadField");
    expect(signalsCreateSrc).not.toContain('supabase.from("signal_publishers").upsert');

    const momentsSrc = readRel("src/components/moments/MomentComposer.tsx");
    expect(momentsSrc).toContain("ensureClientProfileRow");
    expect(momentsSrc).toContain("handleTakePhoto");
    expect(momentsSrc).toContain("handleRecordVideo");
    expect(momentsSrc).toContain("detectMediaKind");

    const pingCardSrc = readRel("src/components/ping/PingCard.tsx");
    expect(pingCardSrc).toContain("onError={() => markMediaFailed(url)}");
    expect(pingCardSrc).toContain("isSharePageUrl");

    const commentsSrc = readRel("src/components/ping/Comments.tsx");
    expect(commentsSrc).not.toContain("search={{ redirect:");
  });

  it("registers forward-only migration 0027 and native audio/video permissions", () => {
    const journal = JSON.parse(readRel("drizzle/migrations/meta/_journal.json"));
    const entries = journal.entries as Array<{ idx: number; tag: string }>;
    expect(
      entries.some((e) => e.idx === 27 && e.tag === "0027_full_audit_repairs_media_privacy"),
    ).toBe(true);

    const sql0027 = readRel("drizzle/migrations/0027_full_audit_repairs_media_privacy.sql");
    expect(sql0027).toContain("'dm-attachments'");
    expect(sql0027).toContain("dot_topup_intents");
    expect(sql0027).not.toMatch(/USING\s*\(\s*true\s*\)/i);

    const manifest = readRel("android/app/src/main/AndroidManifest.xml");
    expect(manifest).toContain("android.permission.RECORD_AUDIO");
    expect(manifest).toContain("android.media.action.VIDEO_CAPTURE");

    const plist = readRel("ios/App/App/Info.plist");
    expect(plist).toContain("NSMicrophoneUsageDescription");
  });
});
