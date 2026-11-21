/**
 * Ping by DOT — Reusable Native & Web Media Selection Utility
 *
 * Uses `@capacitor/camera` v8.2+ non-deprecated APIs on native Android & iOS:
 *   - `Camera.chooseFromGallery()` for single/multiple photo & video library selection
 *   - `Camera.takePhoto()` for explicit camera photo capture
 *   - `Camera.recordVideo()` for explicit camera video capture
 *
 * Retains standard HTML `<input type="file">` fallback on Web & PWA with full
 * image/video and multi-selection support.
 */
import { Capacitor } from "@capacitor/core";
import {
  Camera,
  CameraErrorCode,
  MediaType,
  MediaTypeSelection,
  type MediaResult,
} from "@capacitor/camera";
import { toast } from "sonner";

export type GalleryMediaFilter = "photo" | "video" | "all";

export interface PickGalleryOptions {
  mediaType?: GalleryMediaFilter;
  multiple?: boolean;
  limit?: number;
  /** Custom HTML accept string for Web/PWA fallback (e.g. documents or specific image/video types). */
  accept?: string;
  /** Optional existing `<input type="file">` ref on Web/PWA (if omitted, creates an ephemeral input). */
  webFallbackInput?: HTMLInputElement | null;
  /** Suppress automatic error toast when caller handles error messaging directly. */
  silent?: boolean;
}

export interface PickMediaOutcome {
  files: File[];
  cancelled: boolean;
  permissionDenied: boolean;
  error?: string;
}

const FORMAT_TO_MIME_EXT: Record<string, { mime: string; ext: string }> = {
  jpg: { mime: "image/jpeg", ext: "jpg" },
  jpeg: { mime: "image/jpeg", ext: "jpg" },
  png: { mime: "image/png", ext: "png" },
  webp: { mime: "image/webp", ext: "webp" },
  gif: { mime: "image/gif", ext: "gif" },
  heic: { mime: "image/heic", ext: "heic" },
  heif: { mime: "image/heif", ext: "heif" },
  mp4: { mime: "video/mp4", ext: "mp4" },
  m4v: { mime: "video/mp4", ext: "mp4" },
  mov: { mime: "video/quicktime", ext: "mov" },
  quicktime: { mime: "video/quicktime", ext: "mov" },
  webm: { mime: "video/webm", ext: "webm" },
};

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

function getErrorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    return String((err as { code?: unknown }).code ?? "");
  }
  return "";
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message?: unknown }).message ?? "");
  }
  return "";
}

export function isCameraCancellationError(err: unknown): boolean {
  const code = getErrorCode(err);
  const msg = getErrorMessage(err);
  return (
    code === CameraErrorCode.ChooseMediaCancelled ||
    code === CameraErrorCode.TakePhotoCancelled ||
    code === CameraErrorCode.RecordVideoCancelled ||
    code === CameraErrorCode.EditPhotoCancelled ||
    /cancel|dismiss|no image|no media|aborted/i.test(msg)
  );
}

export function isCameraPermissionError(err: unknown): boolean {
  const code = getErrorCode(err);
  const msg = getErrorMessage(err);
  return (
    code === CameraErrorCode.CameraPermissionDenied ||
    code === CameraErrorCode.GalleryPermissionDenied ||
    /permission|denied|not authorized|unauthorized/i.test(msg)
  );
}

function extractFileNameFromPath(pathOrUrl?: string): string | null {
  if (!pathOrUrl) return null;
  try {
    const clean = pathOrUrl.split("?")[0]?.split("#")[0] ?? "";
    const segment = clean.split("/").pop()?.trim() ?? "";
    if (!segment || segment.length > 140) return null;
    return decodeURIComponent(segment).replace(/[^a-zA-Z0-9._-]/g, "_");
  } catch {
    return null;
  }
}

/**
 * Converts a Capacitor Camera `MediaResult` (from `chooseFromGallery`, `takePhoto`, or
 * `recordVideo`) into a standard browser `File` object, preserving MIME type, filename,
 * and file extension.
 */
export async function mediaResultToFile(result: MediaResult, index = 0): Promise<File> {
  const fetchTarget = result.webPath || (result.uri ? Capacitor.convertFileSrc(result.uri) : "");
  if (!fetchTarget) {
    throw new Error("Selected media item did not provide a readable file path.");
  }

  const response = await fetch(fetchTarget);
  if (!response.ok) {
    throw new Error(`Could not read selected media file (HTTP ${response.status}).`);
  }

  const blob = await response.blob();
  if (blob.size <= 0) {
    throw new Error("Selected media file is empty (0 bytes).");
  }

  const isVideo = result.type === MediaType.Video;
  const rawFormat = (result.metadata?.format ?? "").trim().toLowerCase().replace(/^\./, "");
  const formatSpec = FORMAT_TO_MIME_EXT[rawFormat];

  const blobMime = (blob.type || "").split(";")[0]?.trim().toLowerCase() ?? "";
  const validBlobMime =
    blobMime &&
    blobMime !== "application/octet-stream" &&
    (blobMime.startsWith("image/") || blobMime.startsWith("video/"))
      ? blobMime === "image/jpg"
        ? "image/jpeg"
        : blobMime
      : "";

  const resolvedMime = validBlobMime || formatSpec?.mime || (isVideo ? "video/mp4" : "image/jpeg");

  const resolvedExt = formatSpec?.ext || MIME_TO_EXT[resolvedMime] || (isVideo ? "mp4" : "jpg");

  const rawName = extractFileNameFromPath(result.uri) || extractFileNameFromPath(result.webPath);
  const hasMatchingExt =
    rawName && /\.[a-z0-9]{2,5}$/i.test(rawName)
      ? rawName.toLowerCase().endsWith(`.${resolvedExt}`)
      : false;

  const baseName = rawName
    ? hasMatchingExt
      ? rawName
      : `${rawName.replace(/\.[^.]+$/, "")}.${resolvedExt}`
    : `ping-${isVideo ? "video" : "photo"}-${Date.now()}-${index}.${resolvedExt}`;

  return new File([blob], baseName, {
    type: resolvedMime,
    lastModified: Date.now(),
  });
}

function toAcceptString(mediaType: GalleryMediaFilter, customAccept?: string): string {
  if (customAccept) return customAccept;
  if (mediaType === "photo") {
    return "image/jpeg,image/png,image/webp,image/gif,image/heic,image/*";
  }
  if (mediaType === "video") {
    return "video/mp4,video/webm,video/quicktime,video/*";
  }
  return "image/jpeg,image/png,image/webp,image/gif,image/heic,video/mp4,video/webm,video/quicktime";
}

function pickFilesViaWebInput(options: {
  accept: string;
  multiple?: boolean;
  capture?: string;
}): Promise<PickMediaOutcome> {
  if (typeof document === "undefined") {
    return Promise.resolve({ files: [], cancelled: true, permissionDenied: false });
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = options.accept;
    input.multiple = Boolean(options.multiple);
    if (options.capture) {
      input.setAttribute("capture", options.capture);
    }

    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", handleFocus);
      input.remove();
      resolve({
        files,
        cancelled: files.length === 0,
        permissionDenied: false,
      });
    };

    const handleFocus = () => {
      setTimeout(() => {
        finish(input.files ? Array.from(input.files) : []);
      }, 350);
    };

    input.onchange = () => {
      finish(input.files ? Array.from(input.files) : []);
    };
    input.oncancel = () => finish([]);
    window.addEventListener("focus", handleFocus, { once: true });

    input.style.position = "fixed";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";
    document.body.appendChild(input);
    input.click();
  });
}

async function ensureNativePermission(
  permission: "photos" | "camera",
  silent?: boolean,
): Promise<boolean> {
  const perms = await Camera.checkPermissions().catch(() => null);
  const current = perms?.[permission];
  if (current === "granted" || current === "limited") return true;

  if (current === "denied") {
    if (!silent) {
      toast.error(
        permission === "photos"
          ? "Photo library access is denied. Enable Photos permission in your device Settings."
          : "Camera access is denied. Enable Camera permission in your device Settings.",
      );
    }
    return false;
  }

  const requested = await Camera.requestPermissions({ permissions: [permission] }).catch(
    () => null,
  );
  const nextState = requested?.[permission];
  if (nextState === "denied") {
    if (!silent) {
      toast.error(
        permission === "photos"
          ? "Gallery permission denied. Enable Photos access in device Settings to choose media."
          : "Camera permission denied. Enable Camera access in device Settings.",
      );
    }
    return false;
  }
  return true;
}

/**
 * Reusable media gallery picker for Ping (Moments, Direct Messages, Clips & Pings).
 *
 * - Native Android/iOS: calls `@capacitor/camera` `Camera.chooseFromGallery()` with full
 *   photo/video and multi-selection support and converts `webPath` entries to valid `File`s.
 * - Web/PWA: triggers the provided `<input type="file">` element or creates a clean file
 *   chooser supporting single/multiple photo & video selection.
 */
export async function pickMediaFromGallery(
  options: PickGalleryOptions = {},
): Promise<PickMediaOutcome> {
  const mediaType = options.mediaType ?? "all";
  const multiple = Boolean(options.multiple);
  const isDocumentOnly = Boolean(
    options.accept && !options.accept.includes("image") && !options.accept.includes("video"),
  );

  // Native Android/iOS photo & video gallery via Capacitor Camera v8 `chooseFromGallery()`
  if (Capacitor.isNativePlatform() && !isDocumentOnly) {
    const allowed = await ensureNativePermission("photos", options.silent);
    if (!allowed) {
      return {
        files: [],
        cancelled: false,
        permissionDenied: true,
        error: "Photo library permission denied.",
      };
    }

    const nativeSelection =
      mediaType === "photo"
        ? MediaTypeSelection.Photo
        : mediaType === "video"
          ? MediaTypeSelection.Video
          : MediaTypeSelection.All;

    try {
      const response = await Camera.chooseFromGallery({
        mediaType: nativeSelection,
        allowMultipleSelection: multiple,
        limit: multiple ? (options.limit ?? 10) : 1,
        includeMetadata: true,
        quality: 88,
        correctOrientation: true,
      });

      const results = response?.results ?? [];
      if (results.length === 0) {
        return { files: [], cancelled: true, permissionDenied: false };
      }

      const files = await Promise.all(results.map((item, idx) => mediaResultToFile(item, idx)));
      return { files, cancelled: false, permissionDenied: false };
    } catch (err) {
      if (isCameraCancellationError(err)) {
        return { files: [], cancelled: true, permissionDenied: false };
      }
      if (isCameraPermissionError(err)) {
        const msg = "Photo library permission denied. Enable Photos access in device Settings.";
        if (!options.silent) toast.error(msg);
        return { files: [], cancelled: false, permissionDenied: true, error: msg };
      }
      const msg = getErrorMessage(err) || "Couldn't open device photo & video gallery.";
      if (!options.silent) toast.error(msg);
      return { files: [], cancelled: false, permissionDenied: false, error: msg };
    }
  }

  // Web/PWA fallback: use existing hidden <input type="file"> when provided so native onChange handles it
  if (options.webFallbackInput) {
    options.webFallbackInput.click();
    return { files: [], cancelled: false, permissionDenied: false };
  }

  return pickFilesViaWebInput({
    accept: toAcceptString(mediaType, options.accept),
    multiple,
  });
}

/**
 * Explicit camera photo capture using `@capacitor/camera` `Camera.takePhoto()` on native
 * Android/iOS (never deprecated `Camera.getPhoto()`), with web `capture="environment"` fallback.
 */
export async function capturePhotoWithCamera(options?: {
  silent?: boolean;
}): Promise<PickMediaOutcome> {
  if (Capacitor.isNativePlatform()) {
    const allowed = await ensureNativePermission("camera", options?.silent);
    if (!allowed) {
      return {
        files: [],
        cancelled: false,
        permissionDenied: true,
        error: "Camera permission denied.",
      };
    }

    try {
      const result = await Camera.takePhoto({
        quality: 88,
        correctOrientation: true,
        includeMetadata: true,
        saveToGallery: false,
      });
      const file = await mediaResultToFile(result, 0);
      return { files: [file], cancelled: false, permissionDenied: false };
    } catch (err) {
      if (isCameraCancellationError(err)) {
        return { files: [], cancelled: true, permissionDenied: false };
      }
      if (isCameraPermissionError(err)) {
        const msg = "Camera permission denied. Enable Camera access in device Settings.";
        if (!options?.silent) toast.error(msg);
        return { files: [], cancelled: false, permissionDenied: true, error: msg };
      }
      const msg =
        getErrorCode(err) === CameraErrorCode.NoCameraAvailable
          ? "No camera hardware is available on this device."
          : getErrorMessage(err) || "Couldn't capture photo.";
      if (!options?.silent) toast.error(msg);
      return { files: [], cancelled: false, permissionDenied: false, error: msg };
    }
  }

  return pickFilesViaWebInput({ accept: "image/*", capture: "environment" });
}

/**
 * Explicit video capture using `@capacitor/camera` `Camera.recordVideo()` on native
 * Android/iOS, with web `capture="camcorder"` fallback.
 */
export async function captureVideoWithCamera(options?: {
  silent?: boolean;
}): Promise<PickMediaOutcome> {
  if (Capacitor.isNativePlatform()) {
    const allowed = await ensureNativePermission("camera", options?.silent);
    if (!allowed) {
      return {
        files: [],
        cancelled: false,
        permissionDenied: true,
        error: "Camera permission denied.",
      };
    }

    try {
      const result = await Camera.recordVideo({
        saveToGallery: false,
        includeMetadata: true,
        isPersistent: false,
      });
      const file = await mediaResultToFile(result, 0);
      return { files: [file], cancelled: false, permissionDenied: false };
    } catch (err) {
      if (isCameraCancellationError(err)) {
        return { files: [], cancelled: true, permissionDenied: false };
      }
      if (isCameraPermissionError(err)) {
        const msg = "Camera permission denied. Enable Camera access in device Settings.";
        if (!options?.silent) toast.error(msg);
        return { files: [], cancelled: false, permissionDenied: true, error: msg };
      }
      const msg =
        getErrorCode(err) === CameraErrorCode.NoCameraAvailable
          ? "No camera hardware is available on this device."
          : getErrorMessage(err) || "Couldn't record video.";
      if (!options?.silent) toast.error(msg);
      return { files: [], cancelled: false, permissionDenied: false, error: msg };
    }
  }

  return pickFilesViaWebInput({
    accept: "video/mp4,video/webm,video/quicktime,video/*",
    capture: "camcorder",
  });
}
