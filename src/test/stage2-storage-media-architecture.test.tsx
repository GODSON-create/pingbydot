import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  buildUniqueMediaFilename,
  optimizeImageForUpload,
  sanitizeStorageExtension,
} from "@/lib/media-optimizer";
import {
  MULTIPART_CHUNK_SIZE_BYTES,
  RESUMABLE_UPLOAD_THRESHOLD_BYTES,
  uploadPartsDirectly,
  uploadViaTusResumable,
} from "@/lib/resumable-upload";
import {
  CloudflareR2MediaProvider,
  isR2ClientFlagEnabled,
  parseMediaReference,
  type MediaStorageProvider,
} from "@/lib/media-provider";
import { getR2EndpointHost, presignS3Request, readR2ServerConfig } from "@/lib/r2-sigv4";
import { handlePresignUploadRequest, handleSignReadRequest } from "@/lib/media-server";
import {
  buildDmAttachmentPath,
  buildHubAttachmentPath,
  buildPrivateMomentPath,
  buildPublicMediaPath,
  clearAllPrivateSignedUrlCaches,
  createAuthorizedMediaReadUrl,
  DM_MEDIA_BUCKET,
  HUB_MEDIA_BUCKET,
  isPrivateMediaRef,
  LovableCloudMediaProvider,
  MEDIA_BUCKET,
  PRIVATE_MOMENTS_BUCKET,
  setMediaStorageProviderForTesting,
  uploadPrivateDmMedia,
  uploadPrivateHubMedia,
  uploadPrivateMomentMedia,
  uploadUserMedia,
} from "@/lib/storage";
import { buildMediaRecorderOptions, VOICE_NOTE_TARGET_BITRATE_BPS } from "@/lib/voice-recorder";
import { validateMediaUpload } from "@/lib/shield";
import { ResolvedMomentThumb } from "@/components/media/ResolvedPrivateMedia";

const ROOT = path.resolve(__dirname, "../..");

function readRel(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

const storageUploadMock = vi.fn();
const storageCreateSignedUrlMock = vi.fn();
const storageGetPublicUrlMock = vi.fn();
const storageRemoveMock = vi.fn();
const storageFromMock = vi.fn();
const mediaAssetsInsertMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: (bucket: string) => {
        storageFromMock(bucket);
        return {
          upload: (...args: unknown[]) => storageUploadMock(bucket, ...args),
          createSignedUrl: (...args: unknown[]) => storageCreateSignedUrlMock(bucket, ...args),
          getPublicUrl: (...args: unknown[]) => storageGetPublicUrlMock(bucket, ...args),
          remove: (...args: unknown[]) => storageRemoveMock(bucket, ...args),
        };
      },
    },
    from: (table: string) => ({
      insert: (payload: unknown) => mediaAssetsInsertMock(table, payload),
    }),
    auth: {
      getSession: () => getSessionMock(),
    },
  },
}));

const VALID_R2_ENV: Record<string, string> = {
  PING_MEDIA_PROVIDER: "cloudflare_r2",
  R2_ACCOUNT_ID: "acct1234567890",
  R2_ACCESS_KEY_ID: "AKIA_TEST_R2_KEY",
  R2_SECRET_ACCESS_KEY: "SECRET_TEST_R2_KEY_0123456789abcdef",
  R2_PUBLIC_BUCKET: "ping-media-prod",
  R2_PRIVATE_BUCKET: "ping-private-prod",
  R2_PUBLIC_CDN_URL: "https://media.pingbydot.test",
  R2_REGION: "auto",
};

describe("Ping V1 Stage 2 — Storage Repair, Security, Media Architecture & R2 Readiness", () => {
  beforeEach(() => {
    clearAllPrivateSignedUrlCaches();
    setMediaStorageProviderForTesting(null);
    storageUploadMock.mockReset();
    storageCreateSignedUrlMock.mockReset();
    storageGetPublicUrlMock.mockReset();
    storageRemoveMock.mockReset();
    storageFromMock.mockReset();
    mediaAssetsInsertMock.mockReset();
    getSessionMock.mockReset();

    getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
    mediaAssetsInsertMock.mockResolvedValue({ data: null, error: null });
    storageGetPublicUrlMock.mockImplementation((bucket: string, objectPath: string) => ({
      data: { publicUrl: `https://cdn.ping.test/storage/v1/object/public/${bucket}/${objectPath}` },
    }));
    storageUploadMock.mockImplementation(async (_bucket: string, objectPath: string) => ({
      data: { path: objectPath },
      error: null,
    }));
    storageCreateSignedUrlMock.mockImplementation(async (bucket: string, objectPath: string) => ({
      data: {
        signedUrl: `https://cdn.ping.test/storage/v1/object/sign/${bucket}/${objectPath}?token=sig-1`,
      },
      error: null,
    }));
    storageRemoveMock.mockResolvedValue({ data: [], error: null });
  });

  afterEach(() => {
    clearAllPrivateSignedUrlCaches();
    setMediaStorageProviderForTesting(null);
    vi.restoreAllMocks();
  });

  describe("1. Public Media Access & Sanitized Unique Paths (Track A)", () => {
    it("uploads public media to 'media' with immutable 1-year Cache-Control and sanitized unique filenames", async () => {
      const pathBuilt = buildPublicMediaPath("user-123", "pings/2026", "../../Evil File (1).PNG");
      expect(pathBuilt).toMatch(/^user-123\/pings\/2026\/\d+-[a-z0-9]+\.png$/);
      expect(pathBuilt).not.toContain("..");

      const file = new File([new Uint8Array(64)], "photo.jpg", { type: "image/jpeg" });
      const url = await uploadUserMedia(pathBuilt, file, { ownerId: "user-123" });

      expect(storageFromMock).toHaveBeenCalledWith(MEDIA_BUCKET);
      expect(storageUploadMock).toHaveBeenCalledWith(
        MEDIA_BUCKET,
        pathBuilt,
        file,
        expect.objectContaining({
          cacheControl: "31536000",
          contentType: "image/jpeg",
        }),
      );
      expect(url).toContain(`/public/${MEDIA_BUCKET}/${pathBuilt}`);
      expect(isPrivateMediaRef(url)).toBe(false);
    });

    it("sanitizes unsafe extensions and generates collision-resistant unique filenames", () => {
      expect(sanitizeStorageExtension("malware.tar.gz/../../sh", "bin")).toBe("sh");
      expect(sanitizeStorageExtension("no-extension", "jpg")).toBe("jpg");
      expect(sanitizeStorageExtension("report.PDF", "bin")).toBe("pdf");

      const f1 = buildUniqueMediaFilename("photo.jpeg", "jpg");
      const f2 = buildUniqueMediaFilename("photo.jpeg", "jpg");
      expect(f1).toMatch(/^\d+-[a-z0-9]+\.jpeg$/);
      expect(f1).not.toBe(f2);
    });
  });

  describe("2. Private DM Attachment Access (dm-attachments)", () => {
    it("uploads DM attachments exclusively into 'dm-attachments' and persists raw conversation-scoped paths", async () => {
      const convId = "11111111-1111-4111-8111-111111111111";
      const userId = "22222222-2222-4222-8222-222222222222";
      const dmPath = buildDmAttachmentPath(convId, userId, "voice-note.webm", "webm");
      expect(dmPath).toMatch(new RegExp(`^${convId}/${userId}/\\d+-[a-z0-9]+\\.webm$`));

      const voiceFile = new File([new Uint8Array(128)], "voice-note.webm", { type: "audio/webm" });
      const uploaded = await uploadPrivateDmMedia(dmPath, voiceFile, voiceFile.name, {
        conversationId: convId,
        ownerId: userId,
      });

      expect(storageFromMock).toHaveBeenCalledWith(DM_MEDIA_BUCKET);
      expect(uploaded.storagePath).toBe(dmPath);
      expect(uploaded.signedUrl).toContain(`/sign/${DM_MEDIA_BUCKET}/${dmPath}`);
      expect(isPrivateMediaRef(uploaded.storagePath)).toBe(true);
    });

    it("enforces mediaRestricted guard in DirectMessageChat multi-file upload handler", () => {
      const dmChatSrc = readRel("src/components/messages/DirectMessageChat.tsx");
      const uploadFnMatch = dmChatSrc.match(/const uploadSelectedFiles = async[\s\S]{0,600}/);
      expect(uploadFnMatch?.[0]).toContain("if (mediaRestricted)");
    });
  });

  describe("3. Private Hub Attachment Access (hub-attachments)", () => {
    it("uploads Hub attachments into private 'hub-attachments' with storage://hub-attachments/ ref", async () => {
      const hubId = "33333333-3333-4333-8333-333333333333";
      const userId = "22222222-2222-4222-8222-222222222222";
      const pdf = new File([new Uint8Array(256)], "pitch-deck.pdf", { type: "application/pdf" });

      const result = await uploadPrivateHubMedia(hubId, userId, pdf);

      expect(storageFromMock).toHaveBeenCalledWith(HUB_MEDIA_BUCKET);
      expect(result.storageRef).toMatch(
        new RegExp(`^storage://hub-attachments/${hubId}/${userId}/\\d+-[a-z0-9]+\\.pdf$`),
      );
      expect(result.signedUrl).toContain(`/sign/${HUB_MEDIA_BUCKET}/`);
      expect(isPrivateMediaRef(result.storageRef)).toBe(true);

      const hubPath = buildHubAttachmentPath(hubId, userId, "notes.txt", "txt");
      expect(hubPath.startsWith(`${hubId}/${userId}/`)).toBe(true);

      // Verify HubChat component routes uploads through uploadPrivateHubMedia (not public 'media')
      const hubChatSrc = readRel("src/components/hubs/HubChat.tsx");
      expect(hubChatSrc).toContain("uploadPrivateHubMedia");
    });

    it("verifies Migration 0038 defines Hub membership RLS on hub-attachments without weakening public Hubs", () => {
      const sql0038 = readRel(
        "drizzle/migrations/0038_stage2_storage_buckets_rls_and_media_assets.sql",
      );
      expect(sql0038).toMatch(/'hub-attachments',\s*'hub-attachments',\s*false,\s*52428800/);
      expect(sql0038).toContain('"Hub attachments readable by authorized viewers"');
      expect(sql0038).toContain("hm.status = 'active'");
      expect(sql0038).toContain("h.access = 'public'");
      expect(sql0038).toContain('"Active hub members upload own hub attachments"');
      expect(sql0038).toContain('"Hub uploaders or staff delete hub attachments"');
      expect(sql0038).toContain("hm.role IN ('owner', 'admin', 'moderator')");
    });
  });

  describe("4. Restricted Moments (private-moments) Without Disabling Any Audience", () => {
    it("routes followers, close_circle, and hub Moments to private-moments while preserving public Moments in media", async () => {
      const authorId = "22222222-2222-4222-8222-222222222222";
      const hubId = "33333333-3333-4333-8333-333333333333";
      const img = new File([new Uint8Array(64)], "story.jpg", { type: "image/jpeg" });

      const followersRes = await uploadPrivateMomentMedia(authorId, "followers", null, img);
      expect(followersRes.storageRef).toMatch(
        new RegExp(`^storage://private-moments/${authorId}/followers/self/\\d+-[a-z0-9]+\\.jpg$`),
      );
      expect(isPrivateMediaRef(followersRes.storageRef)).toBe(true);

      const closeCircleRes = await uploadPrivateMomentMedia(authorId, "close_circle", null, img);
      expect(closeCircleRes.storageRef).toMatch(
        new RegExp(
          `^storage://private-moments/${authorId}/close_circle/self/\\d+-[a-z0-9]+\\.jpg$`,
        ),
      );

      const hubRes = await uploadPrivateMomentMedia(authorId, "hub", hubId, img);
      expect(hubRes.storageRef).toMatch(
        new RegExp(`^storage://private-moments/${authorId}/hub/${hubId}/\\d+-[a-z0-9]+\\.jpg$`),
      );

      expect(buildPrivateMomentPath(authorId, "hub", hubId, "clip.mp4", "mp4")).toContain(
        `${authorId}/hub/${hubId}/`,
      );

      // MomentComposer must preserve all 4 audience types and branch cleanly between public 'media' & 'private-moments'
      const composerSrc = readRel("src/components/moments/MomentComposer.tsx");
      expect(composerSrc).toContain("uploadPrivateMomentMedia");
      expect(composerSrc).toContain("buildPublicMediaPath");
      expect(composerSrc).toContain('"followers"');
      expect(composerSrc).toContain('"close_circle"');
      expect(composerSrc).toContain('"hub"');
      expect(composerSrc).toContain('"public"');

      // Migration 0038 must define audience-aware SQL RLS helper for all restricted audiences
      const sql0038 = readRel(
        "drizzle/migrations/0038_stage2_storage_buckets_rls_and_media_assets.sql",
      );
      expect(sql0038).toContain(
        "CREATE OR REPLACE FUNCTION public.can_access_private_moment_object",
      );
      expect(sql0038).toContain("v_moment.audience = 'followers'");
      expect(sql0038).toContain("v_moment.audience = 'close_circle'");
      expect(sql0038).toContain("v_moment.audience = 'hub'");
      expect(sql0038).toContain("public.user_blocks");
    });

    it("resolves private Moment thumbs via signed URL and forces refresh retry on expired-URL load error", async () => {
      const ref = "storage://private-moments/author-1/close_circle/self/123-abc.jpg";
      storageCreateSignedUrlMock
        .mockResolvedValueOnce({
          data: { signedUrl: "https://cdn.ping.test/sign/private-moments/expired-tok" },
          error: null,
        })
        .mockResolvedValueOnce({
          data: { signedUrl: "https://cdn.ping.test/sign/private-moments/refreshed-tok" },
          error: null,
        });

      render(<ResolvedMomentThumb mediaUrl={ref} mediaType="image" alt="Close circle story" />);

      const img = await screen.findByAltText("Close circle story");
      expect(img.getAttribute("src")).toBe(
        "https://cdn.ping.test/sign/private-moments/expired-tok",
      );

      // Simulate expired signed URL failing to load -> hook forces refresh once
      fireEvent.error(img);

      await waitFor(() => {
        expect(img.getAttribute("src")).toBe(
          "https://cdn.ping.test/sign/private-moments/refreshed-tok",
        );
      });
      expect(storageCreateSignedUrlMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("5. Revoked Membership, Invalid Files, Oversized Uploads & Signed URL Expiry", () => {
    it("rejects invalid MIME types, dangerous extensions, 0-byte files, and oversized uploads", () => {
      // Dangerous executable disguised as document
      const exe = validateMediaUpload(
        { type: "application/x-msdownload", size: 1024, name: "invoice.exe" },
        "document",
      );
      expect(exe.valid).toBe(false);

      // Oversized image (> 10 MB)
      const hugeImg = validateMediaUpload(
        { type: "image/jpeg", size: 15 * 1024 * 1024, name: "raw.jpg" },
        "image",
      );
      expect(hugeImg.valid).toBe(false);

      // Oversized audio (> 25 MB limit in shield.ts)
      const hugeAudio = validateMediaUpload(
        { type: "audio/webm", size: 30 * 1024 * 1024, name: "long-voice.webm" },
        "audio",
      );
      expect(hugeAudio.valid).toBe(false);

      // Oversized document (> 25 MB)
      const hugeDoc = validateMediaUpload(
        { type: "application/pdf", size: 30 * 1024 * 1024, name: "manual.pdf" },
        "document",
      );
      expect(hugeDoc.valid).toBe(false);

      // Oversized video (> 50 MB)
      const hugeVideo = validateMediaUpload(
        { type: "video/mp4", size: 60 * 1024 * 1024, name: "movie.mp4" },
        "video",
      );
      expect(hugeVideo.valid).toBe(false);

      // Empty 0-byte audio
      const emptyAudio = validateMediaUpload(
        { type: "audio/webm", size: 0, name: "empty.webm" },
        "audio",
      );
      expect(emptyAudio.valid).toBe(false);

      // Valid voice note & valid PDF accepted
      expect(
        validateMediaUpload(
          { type: "audio/webm;codecs=opus", size: 180_000, name: "note.webm" },
          "audio",
        ).valid,
      ).toBe(true);
      expect(
        validateMediaUpload(
          { type: "application/pdf", size: 420_000, name: "deck.pdf" },
          "document",
        ).valid,
      ).toBe(true);
    });

    it("denies signed reads when Hub membership, DM participation, or Moment audience access is revoked", async () => {
      const revokedHubReq = new Request("https://ping.test/api/media/sign-read", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-jwt",
        },
        body: JSON.stringify({
          ref: "r2://hub-attachments/33333333-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222/secret.pdf",
        }),
      });

      const resHub = await handleSignReadRequest(revokedHubReq, {
        env: VALID_R2_ENV,
        verifyAuthUser: async () => ({ id: "revoked-user-9" }),
        authorizeAction: async () => ({
          allowed: false,
          reason: "Active Hub membership required.",
        }),
      });
      expect(resHub.status).toBe(403);
      expect((await resHub.json()).error).toMatch(/Hub membership/i);

      // Revoked Close Circle / Follower Moment viewer
      const revokedMomentReq = new Request("https://ping.test/api/media/sign-read", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-jwt",
        },
        body: JSON.stringify({
          ref: "r2://private-moments/author-1/close_circle/self/story.jpg",
        }),
      });

      const resMoment = await handleSignReadRequest(revokedMomentReq, {
        env: VALID_R2_ENV,
        verifyAuthUser: async () => ({ id: "removed-friend-7" }),
        authorizeAction: async () => ({
          allowed: false,
          reason: "Caller is not in this Moment's authorized audience.",
        }),
      });
      expect(resMoment.status).toBe(403);
    });

    it("returns null and clears cache when signed URL renewal fails after revocation or expiry", async () => {
      const ref =
        "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/file.jpg";
      storageCreateSignedUrlMock.mockResolvedValueOnce({
        data: { signedUrl: "https://cdn.ping.test/sign/dm-attachments/initial" },
        error: null,
      });

      const first = await createAuthorizedMediaReadUrl(ref);
      expect(first).toBe("https://cdn.ping.test/sign/dm-attachments/initial");

      // After membership revocation or expiry, forced refresh fails cleanly and returns null
      storageCreateSignedUrlMock.mockResolvedValueOnce({
        data: null,
        error: { message: "Object not found or forbidden" },
      });
      const refreshed = await createAuthorizedMediaReadUrl(ref, { forceRefresh: true });
      expect(refreshed).toBeNull();
    });
  });

  describe("6. Legacy Media Compatibility", () => {
    it("passes through legacy https:// URLs untouched and parses legacy storage:// and bare DM refs", async () => {
      const legacyHttps =
        "https://exlttyafomvqfwgzzjrm.supabase.co/storage/v1/object/public/media/u1/old.jpg";
      expect(parseMediaReference(legacyHttps)).toMatchObject({
        provider: "external",
        isPrivate: false,
      });
      expect(await createAuthorizedMediaReadUrl(legacyHttps)).toBe(legacyHttps);
      expect(storageCreateSignedUrlMock).not.toHaveBeenCalled();

      const legacyDmPrefix = "storage://dm-attachments/conv-1/user-1/old-voice.webm";
      expect(parseMediaReference(legacyDmPrefix)).toMatchObject({
        provider: "lovable_cloud",
        bucket: "dm-attachments",
        objectKey: "conv-1/user-1/old-voice.webm",
        isPrivate: true,
      });

      const resolved = await createAuthorizedMediaReadUrl(legacyDmPrefix);
      expect(resolved).toContain("/sign/dm-attachments/conv-1/user-1/old-voice.webm");
    });
  });

  describe("7. Resumable & Interrupted Uploads (TUS 1.0.0 & Multipart Direct)", () => {
    it("recovers from a mid-upload dropped chunk via TUS HEAD offset query and completes at 100%", async () => {
      const payload = new Blob([new Uint8Array(600 * 1024)], { type: "video/mp4" }); // 600 KB
      const chunkSize = 256 * 1024; // 256 KB test chunks -> 3 chunks
      const progressEvents: number[] = [];
      let patchCalls = 0;
      let serverOffset = 0;

      const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const url = String(input);

        if (method === "POST" && url.endsWith("/storage/v1/upload/resumable")) {
          return new Response(null, {
            status: 201,
            headers: { Location: "/storage/v1/upload/resumable/session-42" },
          });
        }

        if (method === "PATCH") {
          patchCalls += 1;
          // Simulate dropped mobile network on 2nd PATCH attempt
          if (patchCalls === 2) {
            throw new TypeError("Failed to fetch: network drop");
          }
          const headers = init?.headers as Record<string, string>;
          const sentOffset = Number(headers["Upload-Offset"]);
          const bodyBlob = init?.body as Blob;
          serverOffset = sentOffset + bodyBlob.size;
          return new Response(null, {
            status: 204,
            headers: { "Upload-Offset": String(serverOffset) },
          });
        }

        if (method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: { "Upload-Offset": String(serverOffset) },
          });
        }

        return new Response("Unexpected", { status: 500 });
      }) as unknown as typeof fetch;

      const uploaded = await uploadViaTusResumable({
        supabaseUrl: "https://proj.supabase.co",
        anonKey: "anon-key",
        accessToken: "jwt-token",
        bucket: "dm-attachments",
        objectPath: "conv-1/user-1/big-video.mp4",
        file: payload,
        contentType: "video/mp4",
        chunkSizeBytes: chunkSize,
        onProgress: (pct) => progressEvents.push(pct),
        fetchImpl: mockFetch,
      });

      expect(uploaded).toBe("conv-1/user-1/big-video.mp4");
      expect(progressEvents[0]).toBe(0);
      expect(progressEvents[progressEvents.length - 1]).toBe(100);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://proj.supabase.co/storage/v1/upload/resumable/session-42",
        expect.objectContaining({ method: "HEAD" }),
      );
    });

    it("fails fast on non-retryable HTTP 403 rejection during TUS upload", async () => {
      const payload = new Blob([new Uint8Array(300 * 1024)], { type: "video/mp4" });
      const mockFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return new Response(null, {
            status: 201,
            headers: { Location: "https://proj.supabase.co/storage/v1/upload/resumable/s-99" },
          });
        }
        return new Response("Forbidden by storage RLS", { status: 403 });
      }) as unknown as typeof fetch;

      await expect(
        uploadViaTusResumable({
          supabaseUrl: "https://proj.supabase.co",
          anonKey: "anon-key",
          accessToken: "jwt",
          bucket: "dm-attachments",
          objectPath: "wrong-conv/user-1/video.mp4",
          file: payload,
          contentType: "video/mp4",
          chunkSizeBytes: 256 * 1024,
          fetchImpl: mockFetch,
        }),
      ).rejects.toThrow(/rejected \(HTTP 403\)/i);

      // 1 POST + 1 PATCH (no HEAD retry on 403)
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("retries transient part failure during direct S3/R2 multipart upload without server proxying", async () => {
      const partData = new Blob([new Uint8Array(MULTIPART_CHUNK_SIZE_BYTES + 1024)], {
        type: "video/mp4",
      });
      let part1Attempts = 0;

      const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("partNumber=1")) {
          part1Attempts += 1;
          if (part1Attempts === 1) return new Response("Transient 503", { status: 503 });
          return new Response(null, { status: 200, headers: { ETag: '"etag-part-1"' } });
        }
        return new Response(null, { status: 200, headers: { ETag: '"etag-part-2"' } });
      }) as unknown as typeof fetch;

      const completed = await uploadPartsDirectly({
        file: partData,
        partUrls: [
          { partNumber: 1, url: "https://acct.r2.cloudflarestorage.com/b/k?partNumber=1" },
          { partNumber: 2, url: "https://acct.r2.cloudflarestorage.com/b/k?partNumber=2" },
        ],
        chunkSizeBytes: MULTIPART_CHUNK_SIZE_BYTES,
        fetchImpl: mockFetch,
      });

      expect(part1Attempts).toBe(2);
      expect(completed).toEqual([
        { partNumber: 1, etag: '"etag-part-1"' },
        { partNumber: 2, etag: '"etag-part-2"' },
      ]);
    });
  });

  describe("8. Client-Side Image Optimization, EXIF Removal & Voice-Note Bitrate", () => {
    it("preserves animated GIFs unmodified and falls back cleanly on non-canvas environments", async () => {
      const gif = new File([new Uint8Array(512)], "anim.gif", { type: "image/gif" });
      const res = await optimizeImageForUpload(gif);
      expect(res.file).toBe(gif);
      expect(res.optimized).toBe(false);
    });

    it("resizes oversized JPEG via canvas re-encode into WebP and marks EXIF stripped", async () => {
      const origCreateObjectUrl = URL.createObjectURL;
      const origRevokeObjectUrl = URL.revokeObjectURL;
      const origImage = globalThis.Image;
      const origCreateElement = document.createElement.bind(document);

      URL.createObjectURL = vi.fn(() => "blob:mock-image");
      URL.revokeObjectURL = vi.fn();

      class MockImage {
        naturalWidth = 4000;
        naturalHeight = 3000;
        width = 4000;
        height = 3000;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_v: string) {
          queueMicrotask(() => this.onload?.());
        }
      }
      globalThis.Image = MockImage as unknown as typeof Image;

      const drawImageSpy = vi.fn();
      vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
        if (tagName.toLowerCase() === "canvas") {
          return {
            width: 0,
            height: 0,
            getContext: () => ({ drawImage: drawImageSpy }),
            toBlob: (cb: (b: Blob | null) => void, mime: string) => {
              cb(new Blob([new Uint8Array(120)], { type: mime }));
            },
          } as unknown as HTMLCanvasElement;
        }
        return origCreateElement(tagName);
      });

      try {
        const bigPhoto = new File([new Uint8Array(8000)], "IMG_GPS_EXIF.jpg", {
          type: "image/jpeg",
        });
        const result = await optimizeImageForUpload(bigPhoto, { maxDimension: 1920 });

        expect(result.optimized).toBe(true);
        expect(result.exifStripped).toBe(true);
        expect(result.width).toBe(1920);
        expect(result.height).toBe(1440);
        expect(result.file.type).toBe("image/webp");
        expect(result.file.name).toBe("IMG_GPS_EXIF.webp");
        expect(result.outputBytes).toBeLessThan(result.originalBytes);
        expect(drawImageSpy).toHaveBeenCalledTimes(1);
      } finally {
        URL.createObjectURL = origCreateObjectUrl;
        URL.revokeObjectURL = origRevokeObjectUrl;
        globalThis.Image = origImage;
      }
    });

    it("configures MediaRecorder with speech-optimized 32 kbps Opus bitrate", () => {
      expect(VOICE_NOTE_TARGET_BITRATE_BPS).toBe(32_000);
      expect(
        buildMediaRecorderOptions({
          recorderMimeType: "audio/webm;codecs=opus",
          baseMimeType: "audio/webm",
          extension: "webm",
        }),
      ).toEqual({
        mimeType: "audio/webm;codecs=opus",
        audioBitsPerSecond: 32_000,
      });
      expect(buildMediaRecorderOptions(null)).toEqual({
        audioBitsPerSecond: 32_000,
      });
    });
  });

  describe("9. Track C — Cloudflare R2 Adapter, SigV4 Presigning & Zero-Credential Fallback", () => {
    it("keeps R2 disabled by default without R2 credentials and falls back transparently to Lovable Cloud", async () => {
      expect(isR2ClientFlagEnabled({})).toBe(false);
      expect(readR2ServerConfig({}).enabled).toBe(false);

      // Server endpoint returns 503 when R2 is disabled
      const req = new Request("https://ping.test/api/media/presign-upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer tok",
        },
        body: JSON.stringify({
          bucket: "media",
          objectKey: "u1/pings/123.jpg",
          fileName: "123.jpg",
          contentType: "image/jpeg",
          sizeBytes: 1024,
          visibility: "public",
        }),
      });
      const disabledRes = await handlePresignUploadRequest(req, { env: {} });
      expect(disabledRes.status).toBe(503);

      // CloudflareR2MediaProvider automatically falls back to LovableCloudMediaProvider on 503
      const fallback = new LovableCloudMediaProvider();
      const r2Provider = new CloudflareR2MediaProvider({
        getAccessToken: async () => "jwt-token",
        fallbackProvider: fallback,
        fetchImpl: vi.fn(
          async () => new Response(JSON.stringify({ error: "disabled" }), { status: 503 }),
        ) as unknown as typeof fetch,
      });

      const file = new File([new Uint8Array(64)], "pic.jpg", { type: "image/jpeg" });
      const res = await r2Provider.upload({
        bucket: MEDIA_BUCKET,
        objectKey: "u1/pings/pic.jpg",
        file,
        fileName: "pic.jpg",
        contentType: "image/jpeg",
        visibility: "public",
      });
      expect(res.provider).toBe("lovable_cloud");
      expect(storageFromMock).toHaveBeenCalledWith(MEDIA_BUCKET);
    });

    it("delegates legacy Lovable Cloud objects to fallbackProvider during dual-read", async () => {
      const fallbackSpy: MediaStorageProvider = {
        id: "lovable_cloud",
        supportsResumable: true,
        supportsMultipart: false,
        upload: vi.fn(),
        getReadUrl: vi.fn(async (ref: string) => `https://lovable-signed.test/${ref}`),
        deleteObjects: vi.fn(async () => ({ deleted: [], failed: [] })),
      };
      const r2Provider = new CloudflareR2MediaProvider({
        getAccessToken: async () => "jwt-token",
        fallbackProvider: fallbackSpy,
        fetchImpl: vi.fn() as unknown as typeof fetch,
      });

      const legacyRef = "storage://hub-attachments/hub-1/u-1/old.pdf";
      const resolved = await r2Provider.getReadUrl(legacyRef);
      expect(resolved).toBe(`https://lovable-signed.test/${legacyRef}`);
      expect(fallbackSpy.getReadUrl).toHaveBeenCalledWith(legacyRef, {});
    });

    it("generates valid AWS SigV4 presigned URLs for R2 and handles direct single & multipart uploads", async () => {
      const signed = await presignS3Request({
        method: "PUT",
        endpointHost: getR2EndpointHost("acct123"),
        bucket: "ping-private",
        objectKey: "dm-attachments/c1/u1/pic.webp",
        accessKeyId: "AKIA_TEST",
        secretAccessKey: "SECRET_TEST",
        region: "auto",
        expiresInSec: 300,
        now: new Date("2026-11-24T12:00:00Z"),
      });
      expect(signed).toContain("https://acct123.r2.cloudflarestorage.com/ping-private/");
      expect(signed).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
      expect(signed).toContain("X-Amz-Expires=300");
      expect(signed).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/);

      // Rejects non-JSON body (prevents binary proxying through Cloudflare Worker)
      const binaryRes = await handlePresignUploadRequest(
        new Request("https://ping.test/api/media/presign-upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            Authorization: "Bearer jwt",
          },
          body: new Uint8Array(64),
        }),
        { env: VALID_R2_ENV },
      );
      expect(binaryRes.status).toBe(415);

      // Issues direct single PUT presign for <= 6 MB file
      const singleRes = await handlePresignUploadRequest(
        new Request("https://ping.test/api/media/presign-upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer jwt",
          },
          body: JSON.stringify({
            bucket: "dm-attachments",
            objectKey:
              "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/a.webp",
            fileName: "a.webp",
            contentType: "image/webp",
            sizeBytes: 250_000,
            visibility: "private",
            conversationId: "11111111-1111-4111-8111-111111111111",
          }),
        }),
        {
          env: VALID_R2_ENV,
          verifyAuthUser: async () => ({ id: "22222222-2222-4222-8222-222222222222" }),
          authorizeAction: async () => ({ allowed: true }),
        },
      );
      expect(singleRes.status).toBe(200);
      const singlePlan = await singleRes.json();
      expect(singlePlan.mode).toBe("single");
      expect(singlePlan.uploadUrl).toContain("acct1234567890.r2.cloudflarestorage.com");
      expect(singlePlan.storedRef).toBe(
        "r2://dm-attachments/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/a.webp",
      );

      // Issues direct multipart presign plan for > 6 MB video without touching file bytes
      const mpRes = await handlePresignUploadRequest(
        new Request("https://ping.test/api/media/presign-upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer jwt",
          },
          body: JSON.stringify({
            bucket: "hub-attachments",
            objectKey:
              "33333333-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222/demo.mp4",
            fileName: "demo.mp4",
            contentType: "video/mp4",
            sizeBytes: RESUMABLE_UPLOAD_THRESHOLD_BYTES * 2 + 1024,
            visibility: "private",
            hubId: "33333333-3333-4333-8333-333333333333",
          }),
        }),
        {
          env: VALID_R2_ENV,
          verifyAuthUser: async () => ({ id: "22222222-2222-4222-8222-222222222222" }),
          authorizeAction: async () => ({ allowed: true }),
          fetchImpl: vi.fn(
            async () =>
              new Response(
                "<InitiateMultipartUploadResult><UploadId>up-777</UploadId></InitiateMultipartUploadResult>",
                {
                  status: 200,
                },
              ),
          ) as unknown as typeof fetch,
        },
      );
      expect(mpRes.status).toBe(200);
      const mpPlan = await mpRes.json();
      expect(mpPlan.mode).toBe("multipart");
      expect(mpPlan.uploadId).toBe("up-777");
      expect(mpPlan.partUrls).toHaveLength(3);
      expect(mpPlan.completeUrl).toContain("uploadId=up-777");
    });

    it("verifies Track D portability documentation and sequential journal parity through 0039", () => {
      const doc = readRel("docs/architecture/DATABASE_PORTABILITY_AND_MEDIA_SCALE.md");
      expect(doc).toContain("PostgreSQL 17.11.0.003");
      expect(doc).toContain("eu-west-3");
      expect(doc).toContain("Cloudflare R2");
      expect(doc).toContain("24-hour RPO");

      const journal = JSON.parse(readRel("drizzle/migrations/meta/_journal.json")) as {
        entries: Array<{ idx: number; tag: string }>;
      };
      expect(journal.entries[38]?.tag).toBe("0038_stage2_storage_buckets_rls_and_media_assets");
      expect(journal.entries[39]?.tag).toBe("0039_stage2_scalable_chat_retention_system");
    });
  });
});
