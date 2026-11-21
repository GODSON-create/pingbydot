import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CameraErrorCode,
  MediaType,
  MediaTypeSelection,
  type MediaResult,
} from "@capacitor/camera";

const {
  isNativePlatformMock,
  convertFileSrcMock,
  cameraMocks,
  storageUploadMock,
  storageCreateSignedUrlMock,
  storageGetPublicUrlMock,
  storageFromMock,
  rpcMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  isNativePlatformMock: vi.fn(() => false),
  convertFileSrcMock: vi.fn((uri: string) => `capacitor://localhost/_capacitor_file_${uri}`),
  cameraMocks: {
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    chooseFromGallery: vi.fn(),
    takePhoto: vi.fn(),
    recordVideo: vi.fn(),
    getPhoto: vi.fn(),
  },
  storageUploadMock: vi.fn(),
  storageCreateSignedUrlMock: vi.fn(),
  storageGetPublicUrlMock: vi.fn(),
  storageFromMock: vi.fn(),
  rpcMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: isNativePlatformMock,
    convertFileSrc: convertFileSrcMock,
    getPlatform: () => (isNativePlatformMock() ? "android" : "web"),
  },
}));

vi.mock("@capacitor/camera", async () => {
  const actual = await vi.importActual<typeof import("@capacitor/camera")>("@capacitor/camera");
  return {
    ...actual,
    Camera: cameraMocks,
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: storageFromMock,
    },
    rpc: rpcMock,
    from: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
    info: vi.fn(),
  },
}));

import {
  capturePhotoWithCamera,
  captureVideoWithCamera,
  mediaResultToFile,
  pickMediaFromGallery,
} from "@/lib/media-picker";
import {
  buildVoiceNoteFile,
  formatMicrophoneError,
  formatVoiceDuration,
  selectSupportedAudioMimeType,
} from "@/lib/voice-recorder";
import {
  buildDmAttachmentPath,
  clearPrivateDmSignedUrlCache,
  createPrivateDmSignedUrl,
  DM_MEDIA_BUCKET,
  extractPrivateDmMediaPath,
  formatStorageUploadError,
  isPrivateDmMediaRef,
  MEDIA_BUCKET,
  uploadPrivateDmMedia,
} from "@/lib/storage";
import { validateMediaUpload } from "@/lib/shield";
import { ResolvedChatMedia, VoiceNoteButton } from "@/components/chat/ChatAttachmentControls";
import { formatConversationPreview } from "@/components/messages/ConversationList";
import { useSendPrivateMessage } from "@/lib/messages";

const ROOT = path.resolve(__dirname, "../..");
const readRel = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

class FakeMediaRecorder {
  static supportedTypes = new Set<string>(["audio/webm;codecs=opus", "audio/webm"]);
  static instances: FakeMediaRecorder[] = [];
  static nextChunks: BlobPart[] = [new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])];

  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supportedTypes.has(type);
  }

  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType: string;
  stream: MediaStream;
  ondataavailable: ((ev: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  constructor(stream: MediaStream, options?: { mimeType?: string }) {
    this.stream = stream;
    this.mimeType = options?.mimeType || "audio/webm;codecs=opus";
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
  }

  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    for (const chunk of FakeMediaRecorder.nextChunks) {
      const blob = chunk instanceof Blob ? chunk : new Blob([chunk], { type: this.mimeType });
      this.ondataavailable?.({ data: blob });
    }
    this.onstop?.();
  }
}

function makeFakeStream() {
  const stopTrack = vi.fn();
  const track = {
    kind: "audio",
    stop: stopTrack,
    onended: null as null | (() => void),
  };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track, stopTrack };
}

describe("Urgent Repair: Device Media Picker, Storage Buckets/RLS & Voice Notes", () => {
  const originalFetch = globalThis.fetch;
  const originalMediaRecorder = globalThis.MediaRecorder;
  const originalMediaDevices = navigator.mediaDevices;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    vi.clearAllMocks();
    clearPrivateDmSignedUrlCache();
    isNativePlatformMock.mockReturnValue(false);
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.supportedTypes = new Set(["audio/webm;codecs=opus", "audio/webm"]);
    FakeMediaRecorder.nextChunks = [new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])];

    storageFromMock.mockImplementation(() => ({
      upload: storageUploadMock,
      createSignedUrl: storageCreateSignedUrlMock,
      getPublicUrl: storageGetPublicUrlMock,
    }));

    storageUploadMock.mockImplementation(async (objectPath: string) => ({
      data: { path: objectPath },
      error: null,
    }));
    storageCreateSignedUrlMock.mockImplementation(async (objectPath: string) => ({
      data: {
        signedUrl: `https://exlttyafomvqfwgzzjrm.supabase.co/storage/v1/object/sign/dm-attachments/${objectPath}?token=sig-1`,
      },
      error: null,
    }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.MediaRecorder = originalMediaRecorder;
    Object.defineProperty(navigator, "mediaDevices", {
      value: originalMediaDevices,
      configurable: true,
      writable: true,
    });
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.useRealTimers();
  });

  it("1. uses non-deprecated Camera.chooseFromGallery() on native for photo, video, and multi-select (never Camera.getPhoto())", async () => {
    isNativePlatformMock.mockReturnValue(true);
    cameraMocks.checkPermissions.mockResolvedValue({ photos: "granted", camera: "granted" });
    cameraMocks.chooseFromGallery.mockResolvedValue({
      results: [
        {
          type: MediaType.Photo,
          saved: false,
          webPath: "capacitor://localhost/photo_1.png",
          uri: "file:///storage/emulated/0/DCIM/sunset.png",
          metadata: { format: "png" },
        },
        {
          type: MediaType.Video,
          saved: false,
          webPath: "capacitor://localhost/clip_2.mp4",
          uri: "file:///storage/emulated/0/DCIM/launch_demo.mp4",
          metadata: { format: "mp4" },
        },
      ] satisfies MediaResult[],
    });

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      status: 200,
      blob: async () =>
        new Blob([new Uint8Array([10, 20, 30, 40])], {
          type: url.endsWith(".mp4") ? "video/mp4" : "image/png",
        }),
    })) as unknown as typeof fetch;

    const outcome = await pickMediaFromGallery({ mediaType: "all", multiple: true, limit: 10 });

    expect(cameraMocks.getPhoto).not.toHaveBeenCalled();
    expect(cameraMocks.chooseFromGallery).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaType: MediaTypeSelection.All,
        allowMultipleSelection: true,
        limit: 10,
      }),
    );
    expect(outcome.cancelled).toBe(false);
    expect(outcome.permissionDenied).toBe(false);
    expect(outcome.files).toHaveLength(2);
    expect(outcome.files[0]?.name).toBe("sunset.png");
    expect(outcome.files[0]?.type).toBe("image/png");
    expect(outcome.files[1]?.name).toBe("launch_demo.mp4");
    expect(outcome.files[1]?.type).toBe("video/mp4");

    // Verify neither media-picker.ts nor native.ts calls deprecated Camera.getPhoto() in executable code
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(stripComments(readRel("src/lib/media-picker.ts"))).not.toContain("Camera.getPhoto(");
    expect(stripComments(readRel("src/lib/native.ts"))).not.toContain("Camera.getPhoto(");
  });

  it("2. uses Camera.takePhoto() and Camera.recordVideo() on native and handles cancellation & permission denial cleanly", async () => {
    isNativePlatformMock.mockReturnValue(true);
    cameraMocks.checkPermissions.mockResolvedValue({ photos: "denied", camera: "granted" });

    const deniedOutcome = await pickMediaFromGallery({ mediaType: "photo" });
    expect(deniedOutcome.permissionDenied).toBe(true);
    expect(deniedOutcome.files).toEqual([]);
    expect(cameraMocks.chooseFromGallery).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(expect.stringMatching(/Photo library access/i));

    cameraMocks.checkPermissions.mockResolvedValue({ photos: "granted", camera: "granted" });
    cameraMocks.chooseFromGallery.mockRejectedValue({
      code: CameraErrorCode.ChooseMediaCancelled,
      message: "User cancelled",
    });
    const cancelledOutcome = await pickMediaFromGallery({ mediaType: "all" });
    expect(cancelledOutcome.cancelled).toBe(true);
    expect(cancelledOutcome.permissionDenied).toBe(false);
    expect(cancelledOutcome.files).toEqual([]);

    cameraMocks.takePhoto.mockResolvedValue({
      type: MediaType.Photo,
      saved: false,
      webPath: "capacitor://localhost/captured.jpg",
      metadata: { format: "jpeg" },
    });
    cameraMocks.recordVideo.mockResolvedValue({
      type: MediaType.Video,
      saved: false,
      webPath: "capacitor://localhost/recorded.mov",
      metadata: { format: "mov" },
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "application/octet-stream" }),
    }) as unknown as typeof fetch;

    const photoOut = await capturePhotoWithCamera();
    expect(cameraMocks.takePhoto).toHaveBeenCalled();
    expect(photoOut.files[0]?.type).toBe("image/jpeg");
    expect(photoOut.files[0]?.name.endsWith(".jpg")).toBe(true);

    const videoOut = await captureVideoWithCamera();
    expect(cameraMocks.recordVideo).toHaveBeenCalled();
    expect(videoOut.files[0]?.type).toBe("video/quicktime");
    expect(videoOut.files[0]?.name.endsWith(".mov")).toBe(true);
  });

  it("3. retains HTML <input type='file'> fallback on Web/PWA and converts mediaResultToFile() preserving MIME, filename & extension", async () => {
    isNativePlatformMock.mockReturnValue(false);

    // Provided input ref fallback (MomentComposer web path)
    const hiddenInput = document.createElement("input");
    hiddenInput.type = "file";
    const clickSpy = vi.spyOn(hiddenInput, "click").mockImplementation(() => {});
    const refOutcome = await pickMediaFromGallery({
      mediaType: "all",
      multiple: true,
      webFallbackInput: hiddenInput,
    });
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(refOutcome.cancelled).toBe(false);

    // mediaResultToFile conversion preserving HEIC/JPEG/MP4 metadata & rejecting 0-byte blobs
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      blob: async () => new Blob([new Uint8Array([9, 8, 7])], { type: "image/webp" }),
    }) as unknown as typeof fetch;
    const converted = await mediaResultToFile({
      type: MediaType.Photo,
      saved: false,
      webPath: "capacitor://localhost/gallery/founder-shot.webp",
      metadata: { format: "webp" },
    });
    expect(converted.name).toBe("founder-shot.webp");
    expect(converted.type).toBe("image/webp");
    expect(converted.size).toBe(3);

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      blob: async () => new Blob([], { type: "image/jpeg" }),
    }) as unknown as typeof fetch;
    await expect(
      mediaResultToFile({
        type: MediaType.Photo,
        saved: false,
        webPath: "capacitor://localhost/empty.jpg",
      }),
    ).rejects.toThrow(/empty \(0 bytes\)/i);
  });

  it("4. validates MIME types, file sizes, and negotiates audio/webm, audio/mp4, and audio/ogg cleanly", () => {
    // WebM Opus priority (Chrome / Android WebView)
    const webmChoice = selectSupportedAudioMimeType({
      isTypeSupported: (t) => t === "audio/webm;codecs=opus",
    });
    expect(webmChoice).toEqual({
      recorderMimeType: "audio/webm;codecs=opus",
      baseMimeType: "audio/webm",
      extension: "webm",
    });

    // MP4 fallback (Safari / iOS WebKit)
    const mp4Choice = selectSupportedAudioMimeType({
      isTypeSupported: (t) => t === "audio/mp4",
    });
    expect(mp4Choice).toEqual({
      recorderMimeType: "audio/mp4",
      baseMimeType: "audio/mp4",
      extension: "m4a",
    });

    // OGG fallback (Firefox)
    const oggChoice = selectSupportedAudioMimeType({
      isTypeSupported: (t) => t === "audio/ogg;codecs=opus",
    });
    expect(oggChoice).toEqual({
      recorderMimeType: "audio/ogg;codecs=opus",
      baseMimeType: "audio/ogg",
      extension: "ogg",
    });

    expect(formatVoiceDuration(0)).toBe("0:00");
    expect(formatVoiceDuration(75)).toBe("1:15");
    expect(
      formatMicrophoneError(Object.assign(new Error("denied"), { name: "NotAllowedError" })),
    ).toMatch(/permission denied/i);
    expect(
      formatMicrophoneError(Object.assign(new Error("none"), { name: "NotFoundError" })),
    ).toMatch(/no microphone/i);

    const emptyVoice = buildVoiceNoteFile([], "audio/webm", webmChoice);
    expect("error" in emptyVoice).toBe(true);

    // Shield media upload validation
    expect(
      validateMediaUpload({ type: "audio/ogg", size: 4096, name: "vn.ogg" }, "audio").valid,
    ).toBe(true);
    expect(
      validateMediaUpload({ type: "audio/mp4", size: 30 * 1024 * 1024, name: "big.m4a" }, "audio")
        .valid,
    ).toBe(false);
    expect(
      validateMediaUpload({ type: "application/x-msdownload", size: 100, name: "bad.exe" }, "audio")
        .valid,
    ).toBe(false);
  });

  it("5. records voice note, shows playback preview before sending, retries on upload error, and cleans up tracks & object URLs on send/discard/conversation switch/unmount", async () => {
    const { stream, track, stopTrack } = makeFakeStream();
    const getUserMediaMock = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: getUserMediaMock },
      configurable: true,
      writable: true,
    });
    globalThis.MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder;

    const createUrlMock = vi.fn(() => "blob:voice-preview-1");
    const revokeUrlMock = vi.fn();
    URL.createObjectURL = createUrlMock;
    URL.revokeObjectURL = revokeUrlMock;

    let attempts = 0;
    const onSendVoiceNote = vi.fn(async (_file: File) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("Transient upload failure");
      }
    });

    const { rerender, unmount } = render(
      <VoiceNoteButton conversationId="conv-1" onSendVoiceNote={onSendVoiceNote} />,
    );

    // Start recording
    fireEvent.click(screen.getByRole("button", { name: /record voice note/i }));
    await waitFor(() => expect(screen.getByTestId("voice-note-recording")).toBeInTheDocument());
    expect(getUserMediaMock).toHaveBeenCalledWith({ audio: true });

    // Stop recording -> transitions to playback preview with <audio controls> (does NOT auto-send!)
    fireEvent.click(screen.getByRole("button", { name: /stop recording to preview/i }));
    await waitFor(() => expect(screen.getByTestId("voice-note-preview")).toBeInTheDocument());
    expect(stopTrack).toHaveBeenCalled();
    expect(onSendVoiceNote).not.toHaveBeenCalled();

    const previewAudio = screen.getByLabelText(/voice note preview/i) as HTMLAudioElement;
    expect(previewAudio.tagName).toBe("AUDIO");
    expect(previewAudio.controls).toBe(true);
    expect(previewAudio.getAttribute("src")).toBe("blob:voice-preview-1");

    // Attempt 1 fails -> keeps preview and offers Retry button
    fireEvent.click(screen.getByRole("button", { name: /send voice note/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /retry sending voice note/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/Transient upload failure/i);

    // Attempt 2 succeeds -> revokes object URL and returns to idle
    fireEvent.click(screen.getByRole("button", { name: /retry sending voice note/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /record voice note/i })).toBeInTheDocument(),
    );
    expect(onSendVoiceNote).toHaveBeenCalledTimes(2);
    expect(revokeUrlMock).toHaveBeenCalledWith("blob:voice-preview-1");

    // Start a new recording and simulate OS interruption (track.onended) -> preview kept cleanly
    fireEvent.click(screen.getByRole("button", { name: /record voice note/i }));
    await waitFor(() => expect(screen.getByTestId("voice-note-recording")).toBeInTheDocument());
    act(() => {
      track.onended?.();
    });
    await waitFor(() => expect(screen.getByTestId("voice-note-preview")).toBeInTheDocument());

    // Switching conversations discards unsent preview and revokes object URL
    rerender(<VoiceNoteButton conversationId="conv-2" onSendVoiceNote={onSendVoiceNote} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /record voice note/i })).toBeInTheDocument(),
    );
    expect(revokeUrlMock).toHaveBeenCalledTimes(2);

    // Unmount during active recording stops tracks cleanly
    stopTrack.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /record voice note/i }));
    await waitFor(() => expect(screen.getByTestId("voice-note-recording")).toBeInTheDocument());
    unmount();
    expect(stopTrack).toHaveBeenCalled();
  });

  it("6. handles microphone permission denial, unsupported MediaRecorder, and empty 0-byte voice notes gracefully", async () => {
    // Unsupported runtime
    globalThis.MediaRecorder = undefined as unknown as typeof MediaRecorder;
    const { unmount } = render(<VoiceNoteButton conversationId="conv-x" />);
    fireEvent.click(screen.getByRole("button", { name: /record voice note/i }));
    expect(toastErrorMock).toHaveBeenCalledWith(
      expect.stringMatching(/not supported|isn't supported/i),
    );
    unmount();

    // Permission denied
    toastErrorMock.mockClear();
    globalThis.MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder;
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error("Permission denied"), { name: "NotAllowedError" }),
          ),
      },
      configurable: true,
      writable: true,
    });
    const view2 = render(<VoiceNoteButton conversationId="conv-y" />);
    fireEvent.click(screen.getByRole("button", { name: /record voice note/i }));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        expect.stringMatching(/Microphone permission denied/i),
      ),
    );
    view2.unmount();

    // Empty 0-byte recording
    toastErrorMock.mockClear();
    const { stream } = makeFakeStream();
    FakeMediaRecorder.nextChunks = [];
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
      configurable: true,
      writable: true,
    });
    render(<VoiceNoteButton conversationId="conv-z" />);
    fireEvent.click(screen.getByRole("button", { name: /record voice note/i }));
    await waitFor(() => expect(screen.getByTestId("voice-note-recording")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /stop recording to preview/i }));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(expect.stringMatching(/empty \(0 bytes\)/i)),
    );
  });

  it("7. uploads private DM voice/media strictly to 'dm-attachments' under {conv}/{sender}/{file} (never 'media' or public URL) and refreshes expired signed URLs", async () => {
    const convId = "11111111-1111-4111-8111-111111111111";
    const senderId = "22222222-2222-4222-8222-222222222222";
    const pathBuilt = buildDmAttachmentPath(convId, senderId, "voice-note-123.webm", "webm");
    expect(pathBuilt).toMatch(new RegExp(`^${convId}/${senderId}/\\d+-[a-z0-9-]+\\.webm$`, "i"));

    const voiceFile = new File([new Uint8Array([1, 2, 3, 4])], "voice-note-123.webm", {
      type: "audio/webm",
    });
    const uploaded = await uploadPrivateDmMedia(pathBuilt, voiceFile, voiceFile.name);

    expect(storageFromMock).toHaveBeenCalledWith(DM_MEDIA_BUCKET);
    expect(storageFromMock).not.toHaveBeenCalledWith(MEDIA_BUCKET);
    expect(storageGetPublicUrlMock).not.toHaveBeenCalled();
    expect(uploaded.storagePath).toBe(pathBuilt);
    expect(uploaded.storagePath).not.toMatch(/^https?:\/\//i);
    expect(isPrivateDmMediaRef(uploaded.storagePath)).toBe(true);
    expect(extractPrivateDmMediaPath(uploaded.storagePath)).toBe(pathBuilt);

    // Legacy absolute URLs remain untouched for backward compatibility
    const legacyUrl =
      "https://exlttyafomvqfwgzzjrm.supabase.co/storage/v1/object/public/media/old.jpg";
    expect(isPrivateDmMediaRef(legacyUrl)).toBe(false);
    expect(await createPrivateDmSignedUrl(legacyUrl)).toBe(legacyUrl);

    // Cached signed URL reused without extra call until forceRefresh is requested
    storageCreateSignedUrlMock.mockClear();
    const cachedUrl = await createPrivateDmSignedUrl(pathBuilt);
    expect(cachedUrl).toContain("token=sig-1");
    expect(storageCreateSignedUrlMock).not.toHaveBeenCalled();

    storageCreateSignedUrlMock.mockResolvedValueOnce({
      data: {
        signedUrl: `https://exlttyafomvqfwgzzjrm.supabase.co/storage/v1/object/sign/dm-attachments/${pathBuilt}?token=sig-2`,
      },
      error: null,
    });
    const refreshedUrl = await createPrivateDmSignedUrl(pathBuilt, { forceRefresh: true });
    expect(refreshedUrl).toContain("token=sig-2");
    expect(storageCreateSignedUrlMock).toHaveBeenCalledTimes(1);

    // Missing bucket error explicitly references dm-attachments and migrations 0027 / 0036
    expect(
      formatStorageUploadError(new Error("Bucket not found"), "fail", DM_MEDIA_BUCKET),
    ).toContain("0036");
  });

  it("8. renders distinct Voice message <audio controls> player, auto-refreshes signed URL on error, and normalizes ConversationList preview to 'Voice message'", async () => {
    const objectPath = "conv-1/user-1/voice-note-99.webm";
    storageCreateSignedUrlMock
      .mockResolvedValueOnce({
        data: { signedUrl: "https://exlttyafomvqfwgzzjrm.supabase.co/signed/v1?token=expired" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { signedUrl: "https://exlttyafomvqfwgzzjrm.supabase.co/signed/v2?token=fresh" },
        error: null,
      });

    render(<ResolvedChatMedia mediaUrl={objectPath} mediaType="audio" isOwnMessage={true} />);

    const player = await screen.findByTestId("voice-note-player");
    expect(player).toHaveTextContent("Voice message");

    const audioEl = screen.getByLabelText(/voice message playback/i) as HTMLAudioElement;
    expect(audioEl.controls).toBe(true);
    expect(audioEl.getAttribute("src")).toContain("token=expired");

    // Simulate expired signed URL error -> automatically refreshes with forceRefresh=true
    fireEvent.error(audioEl);
    await waitFor(() =>
      expect(screen.getByLabelText(/voice message playback/i).getAttribute("src")).toContain(
        "token=fresh",
      ),
    );

    // Conversation preview normalization
    expect(formatConversationPreview("Voice message")).toBe("Voice message");
    expect(formatConversationPreview("🎵 Audio message")).toBe("Voice message");
    expect(formatConversationPreview("Hello founder")).toBe("Hello founder");
    expect(formatConversationPreview(null)).toBe("No messages yet");
  });

  it("9. verifies MomentComposer & DirectMessageChat wiring, Migration 0036 strict DM RLS policies, and migrate-remote two-account Storage RLS checks", () => {
    // MomentComposer uses reusable gallery picker + camera helpers
    const momentSrc = readRel("src/components/moments/MomentComposer.tsx");
    expect(momentSrc).toContain("pickMediaFromGallery");
    expect(momentSrc).toContain("handleChooseFromGallery");
    expect(momentSrc).toContain("capturePhotoWithCamera");
    expect(momentSrc).toContain("captureVideoWithCamera");

    // DirectMessageChat uses canonical path builder, raw storagePath, VoiceNoteButton w/ conversationId & audio RPC
    const dmSrc = readRel("src/components/messages/DirectMessageChat.tsx");
    expect(dmSrc).toContain("buildDmAttachmentPath");
    expect(dmSrc).toContain("uploadPrivateDmMedia");
    expect(dmSrc).toContain("handleSendVoiceNote");
    expect(dmSrc).toContain('mediaType: "audio"');
    expect(dmSrc).toContain("conversationId={conversation.id}");

    // Migration 0036 registered in _journal.json with strict Storage RLS and 'Voice message' preview
    const journal = JSON.parse(readRel("drizzle/migrations/meta/_journal.json"));
    expect(
      (journal.entries as Array<{ idx: number; tag: string }>).some(
        (e) => e.idx === 36 && e.tag === "0036_storage_buckets_dm_rls_and_voice_preview",
      ),
    ).toBe(true);

    const sql0036 = readRel("drizzle/migrations/0036_storage_buckets_dm_rls_and_voice_preview.sql");
    expect(sql0036).toContain("'media'");
    expect(sql0036).toContain("'dm-attachments'");
    expect(sql0036).toContain("false,");
    expect(sql0036).toContain("cm.conversation_id::text = (storage.foldername(name))[1]");
    expect(sql0036).toContain("(storage.foldername(name))[2] = (select auth.uid())::text");
    expect(sql0036).toContain("v_preview := 'Voice message'");
    expect(sql0036).not.toMatch(/USING\s*\(\s*true\s*\)/i);
    expect(sql0036).not.toMatch(/DROP\s+POLICY\s+IF\s+EXISTS\s+"[^"]+"\s+ON\s+\S+\s+FOR\s+/i);

    // Remote migration runner verifies both buckets + two-account DM storage RLS
    const runnerSrc = readRel("scripts/migrate-remote.mjs");
    expect(runnerSrc).toContain("dm_bucket_private");
    expect(runnerSrc).toContain("Private DM Storage RLS & Voice preview (0036)");
    expect(runnerSrc).toContain("member uploading into another member's sender folder");
    expect(runnerSrc).toContain("non-member uploading into private DM conversation bucket path");
  });

  it("10. sends uploaded voice note via send_private_message RPC with media_type='audio' and raw private storage path", async () => {
    const convId = "33333333-3333-4333-8333-333333333333";
    const senderId = "44444444-4444-4444-8444-444444444444";
    const pathBuilt = buildDmAttachmentPath(convId, senderId, "voice-note.m4a", "m4a");
    const voiceFile = new File([new Uint8Array([7, 8, 9, 10])], "voice-note.m4a", {
      type: "audio/mp4",
    });

    const uploaded = await uploadPrivateDmMedia(pathBuilt, voiceFile, voiceFile.name);
    rpcMock.mockResolvedValueOnce({
      data: {
        id: "msg-voice-1",
        conversation_id: convId,
        sender_id: senderId,
        content: "",
        media_url: uploaded.storagePath,
        media_type: "audio",
        status: "sent",
        created_at: new Date().toISOString(),
      },
      error: null,
    });

    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useSendPrivateMessage(), { wrapper });
    const sent = await result.current.mutateAsync({
      conversationId: convId,
      content: "",
      mediaUrl: uploaded.storagePath,
      mediaType: "audio",
    });

    expect(rpcMock).toHaveBeenCalledWith("send_private_message", {
      p_conversation_id: convId,
      p_content: "",
      p_media_url: uploaded.storagePath,
      p_media_type: "audio",
    });
    expect(sent.media_type).toBe("audio");
    expect(sent.media_url).toBe(uploaded.storagePath);
    expect(sent.media_url).not.toMatch(/^https?:\/\//i);
  });
});
