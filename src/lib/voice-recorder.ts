/**
 * Ping by DOT — Voice Note Recording & MIME Negotiation Utilities
 *
 * Negotiates supported MediaRecorder formats cleanly across Chrome, Android WebView,
 * Safari/iOS WebKit, and Firefox (`audio/webm;codecs=opus`, `audio/mp4`, `audio/ogg`),
 * maps microphone hardware/permission failures clearly, and builds valid audio `File`s.
 */

export const VOICE_NOTE_MAX_DURATION_SEC = 180;

export const PREFERRED_VOICE_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
] as const;

export interface NegotiatedVoiceFormat {
  recorderMimeType: string;
  baseMimeType: string;
  extension: "webm" | "m4a" | "ogg";
}

export function isVoiceRecordingSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined"
  );
}

/**
 * Selects the highest-priority audio MIME type supported by the current runtime's
 * `MediaRecorder`. Returns `null` when `MediaRecorder` is unavailable or none of the
 * candidate formats are reported as supported.
 */
export function selectSupportedAudioMimeType(
  mediaRecorderCtor:
    Pick<typeof MediaRecorder, "isTypeSupported"> | undefined = typeof MediaRecorder !== "undefined"
    ? MediaRecorder
    : undefined,
): NegotiatedVoiceFormat | null {
  if (!mediaRecorderCtor || typeof mediaRecorderCtor.isTypeSupported !== "function") {
    return null;
  }

  for (const candidate of PREFERRED_VOICE_MIME_TYPES) {
    try {
      if (mediaRecorderCtor.isTypeSupported(candidate)) {
        const base = candidate.split(";")[0]?.trim().toLowerCase() || "audio/webm";
        const extension: "webm" | "m4a" | "ogg" = base.includes("mp4")
          ? "m4a"
          : base.includes("ogg")
            ? "ogg"
            : "webm";
        return {
          recorderMimeType: candidate,
          baseMimeType: base,
          extension,
        };
      }
    } catch {
      // Ignore browser-specific isTypeSupported exceptions
    }
  }

  return null;
}

export function formatVoiceDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = String(safe % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

export function formatMicrophoneError(err: unknown): string {
  const name = err instanceof Error ? err.name : String((err as { name?: unknown })?.name ?? "");
  const message =
    err instanceof Error ? err.message : String((err as { message?: unknown })?.message ?? "");

  if (
    name === "NotAllowedError" ||
    name === "PermissionDeniedError" ||
    /denied|notallowed|permission/i.test(message)
  ) {
    return "Microphone permission denied. Allow microphone access in your browser or device Settings.";
  }

  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    /no microphone|requested device not found|notfound/i.test(message)
  ) {
    return "No microphone was detected on this device.";
  }

  if (
    name === "NotReadableError" ||
    name === "TrackStartError" ||
    name === "AbortError" ||
    /busy|in use|interrupted/i.test(message)
  ) {
    return "Microphone is busy or interrupted by another app. Close other audio apps and retry.";
  }

  if (name === "NotSupportedError" || /unsupported|mediarecorder/i.test(message)) {
    return "Voice recording format is not supported on this device.";
  }

  return message || "Couldn't access microphone.";
}

export function buildVoiceNoteFile(
  chunks: BlobPart[],
  recorderMimeType: string | undefined,
  negotiated: NegotiatedVoiceFormat | null,
): { file: File; mimeType: string } | { error: string } {
  const rawMime =
    (recorderMimeType || negotiated?.baseMimeType || "audio/webm")
      .split(";")[0]
      ?.trim()
      .toLowerCase() || "audio/webm";
  const blob = new Blob(chunks, { type: rawMime });
  if (blob.size <= 0) {
    return { error: "Recording was empty (0 bytes). Speak clearly and try again." };
  }

  const ext = rawMime.includes("mp4")
    ? "m4a"
    : rawMime.includes("ogg")
      ? "ogg"
      : (negotiated?.extension ?? "webm");
  const file = new File([blob], `voice-note-${Date.now()}.${ext}`, {
    type: rawMime,
    lastModified: Date.now(),
  });
  return { file, mimeType: rawMime };
}
