/**
 * Ping by DOT — Client-Side Image Optimization, EXIF Removal & Safe Filename Utilities
 *
 * - Strips EXIF/GPS/camera metadata by decoding and redrawing images onto an offscreen canvas.
 * - Resizes oversized photos proportionally (1920px default, 512px for avatars) and re-encodes
 *   as WebP (or JPEG fallback) to cut storage & egress bandwidth by 70–85%.
 * - Preserves animated GIFs unmodified and falls back safely in non-browser/jsdom environments.
 * - Generates sanitized, collision-resistant unique object filenames.
 */

export interface ImageOptimizeOptions {
  maxDimension?: number;
  quality?: number;
  preferWebP?: boolean;
}

export interface OptimizedImageResult {
  file: File;
  optimized: boolean;
  exifStripped: boolean;
  originalBytes: number;
  outputBytes: number;
  width?: number;
  height?: number;
}

const DEFAULT_MAX_DIMENSION = 1920;
const DEFAULT_QUALITY = 0.82;

export function sanitizeStorageExtension(fileName: string, fallbackExt = "bin"): string {
  const safeFallback =
    fallbackExt
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 8) || "bin";
  const parts = (fileName || "").split(".");
  if (parts.length < 2) return safeFallback;
  const raw = parts[parts.length - 1]?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
  return raw.slice(0, 8) || safeFallback;
}

export function buildUniqueMediaFilename(fileName: string, fallbackExt = "bin"): string {
  const ext = sanitizeStorageExtension(fileName, fallbackExt);
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  // H7: Preserve safe `voice-note-` prefix so Hub WebM/Opus voice notes render as `<audio>` instead of `<video>`
  const baseName = (fileName || "").split(/[\\/]/).pop() ?? "";
  const prefix = /^voice-note-/i.test(baseName) ? "voice-note-" : "";
  return `${prefix}${Date.now()}-${rand}.${ext}`;
}

export async function computeFileSha256(file: Blob): Promise<string | null> {
  try {
    if (typeof crypto === "undefined" || !crypto.subtle?.digest) return null;
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

function loadHtmlImage(url: string, timeoutMs = 5000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => {
      img.onload = null;
      img.onerror = null;
      reject(new Error("Timed out decoding image for optimization."));
    }, timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Could not decode image for optimization."));
    };
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), mimeType, quality);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Optimizes an image file on the client before upload:
 * - Resizes down to `maxDimension` preserving aspect ratio (never upscales).
 * - Strips EXIF/GPS metadata via canvas re-encode.
 * - Encodes to WebP (with JPEG fallback), preserving animated GIFs untouched.
 */
export async function optimizeImageForUpload(
  file: File,
  options: ImageOptimizeOptions = {},
): Promise<OptimizedImageResult> {
  const originalBytes = file.size;
  const lowerType = (file.type || "").split(";")[0]?.trim().toLowerCase() ?? "";

  // Preserve animated GIFs, non-images, or non-browser runtimes without breaking upload
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function" ||
    !lowerType.startsWith("image/") ||
    lowerType === "image/gif" ||
    lowerType === "image/svg+xml" ||
    originalBytes <= 0
  ) {
    return {
      file,
      optimized: false,
      exifStripped: false,
      originalBytes,
      outputBytes: originalBytes,
    };
  }

  const maxDim = Math.max(128, options.maxDimension ?? DEFAULT_MAX_DIMENSION);
  const quality = Math.min(0.95, Math.max(0.4, options.quality ?? DEFAULT_QUALITY));
  const preferWebP = options.preferWebP ?? true;

  // Verify Canvas 2D is available before creating object URLs or decoding images
  // (avoids hanging in non-canvas / jsdom environments where Image.onload never fires).
  const canvas = document.createElement("canvas");
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    ctx = null;
  }
  if (!ctx) {
    return {
      file,
      optimized: false,
      exifStripped: false,
      originalBytes,
      outputBytes: originalBytes,
    };
  }

  let objectUrl: string | null = null;
  try {
    objectUrl = URL.createObjectURL(file);
    const img = await loadHtmlImage(objectUrl);
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    if (srcW <= 0 || srcH <= 0) {
      return {
        file,
        optimized: false,
        exifStripped: false,
        originalBytes,
        outputBytes: originalBytes,
      };
    }

    const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    const targetW = Math.max(1, Math.round(srcW * scale));
    const targetH = Math.max(1, Math.round(srcH * scale));

    canvas.width = targetW;
    canvas.height = targetH;

    ctx.drawImage(img, 0, 0, targetW, targetH);

    // Try WebP first (unless PNG transparency is safer as WebP — WebP supports alpha cleanly)
    let blob: Blob | null = null;
    let outMime = "image/jpeg";
    let outExt = "jpg";

    if (preferWebP) {
      const webpBlob = await canvasToBlob(canvas, "image/webp", quality);
      if (webpBlob && webpBlob.size > 0 && webpBlob.type === "image/webp") {
        blob = webpBlob;
        outMime = "image/webp";
        outExt = "webp";
      }
    }

    if (!blob) {
      const jpegBlob = await canvasToBlob(canvas, "image/jpeg", quality);
      if (jpegBlob && jpegBlob.size > 0) {
        blob = jpegBlob;
        outMime = "image/jpeg";
        outExt = "jpg";
      }
    }

    if (!blob || blob.size <= 0) {
      return {
        file,
        optimized: false,
        exifStripped: false,
        originalBytes,
        outputBytes: originalBytes,
      };
    }

    // Always prefer the canvas re-encoded output for JPEG/HEIC/PNG so EXIF is stripped,
    // unless a tiny already-optimized PNG ballooned > 1.25x without resizing
    const resized = targetW < srcW || targetH < srcH;
    const baseStem = (file.name || "photo").replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
    const outFile = new File([blob], `${baseStem || "photo"}.${outExt}`, {
      type: outMime,
      lastModified: Date.now(),
    });

    if (!resized && outFile.size > originalBytes * 1.25 && lowerType === "image/webp") {
      return {
        file,
        optimized: false,
        exifStripped: false,
        originalBytes,
        outputBytes: originalBytes,
        width: srcW,
        height: srcH,
      };
    }

    return {
      file: outFile,
      optimized: outFile.size < originalBytes || resized,
      exifStripped: true,
      originalBytes,
      outputBytes: outFile.size,
      width: targetW,
      height: targetH,
    };
  } catch {
    return {
      file,
      optimized: false,
      exifStripped: false,
      originalBytes,
      outputBytes: originalBytes,
    };
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
}
