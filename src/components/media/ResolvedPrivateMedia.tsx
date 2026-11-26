import { useCallback, useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { extractSupabasePublicMediaPath } from "@/lib/media-provider";
import {
  createAuthorizedMediaReadUrl,
  createSupabaseMediaBucketFallbackSignedUrl,
  DEFAULT_DM_SIGNED_URL_TTL_SEC,
  isPrivateMediaRef,
} from "@/lib/storage";

/**
 * Resolves any stored Ping media ref (public `https://`, private `storage://private-moments/...`,
 * `storage://hub-attachments/...`, DM paths, or `r2://...`) into a usable browser URL, with:
 * - cached + deduplicated authorized signing (avoids re-signing on every render)
 * - automatic renewal before TTL expiry
 * - automatic forced refresh retry on playback/load error (including signed fallback for
 *   Supabase public `media` bucket URLs when an environment has not yet flipped `media.public = true`)
 * - explicit `loading`, `failed`, and `retry()` controls for rich UI states
 */
export function useResolvedMediaUrl(mediaUrl: string | null | undefined) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(() => {
    if (!mediaUrl) return null;
    return isPrivateMediaRef(mediaUrl) ? null : mediaUrl;
  });
  const [loading, setLoading] = useState<boolean>(() =>
    Boolean(mediaUrl && isPrivateMediaRef(mediaUrl)),
  );
  const [failed, setFailed] = useState(false);
  const retriedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    let renewTimer: ReturnType<typeof setTimeout> | null = null;
    setFailed(false);
    retriedRef.current = false;

    if (!mediaUrl) {
      setResolvedUrl(null);
      setLoading(false);
      return;
    }

    if (!isPrivateMediaRef(mediaUrl)) {
      setResolvedUrl(mediaUrl);
      setLoading(false);
      return;
    }

    setResolvedUrl(null);
    setLoading(true);

    const load = async (forceRefresh: boolean) => {
      const next = await createAuthorizedMediaReadUrl(mediaUrl, { forceRefresh });
      if (!active) return;
      setLoading(false);
      if (!next) {
        setResolvedUrl(null);
        setFailed(true);
        return;
      }
      setFailed(false);
      setResolvedUrl(next);

      const renewDelayMs = Math.max(60_000, (DEFAULT_DM_SIGNED_URL_TTL_SEC - 90) * 1000);
      renewTimer = setTimeout(() => {
        if (active) void load(true);
      }, renewDelayMs);
    };

    void load(false);
    return () => {
      active = false;
      if (renewTimer) clearTimeout(renewTimer);
    };
  }, [mediaUrl]);

  const handleMediaError = useCallback(async () => {
    if (!mediaUrl || retriedRef.current) {
      setFailed(true);
      setLoading(false);
      return;
    }

    if (isPrivateMediaRef(mediaUrl)) {
      retriedRef.current = true;
      const fresh = await createAuthorizedMediaReadUrl(mediaUrl, { forceRefresh: true });
      if (!mountedRef.current) return;
      if (fresh) {
        setFailed(false);
        setResolvedUrl(fresh);
      } else {
        setFailed(true);
      }
      return;
    }

    // Public `media` bucket fallback if direct `/object/public/media/...` returned 400/403/404
    if (extractSupabasePublicMediaPath(mediaUrl)) {
      retriedRef.current = true;
      const fallbackSigned = await createSupabaseMediaBucketFallbackSignedUrl(mediaUrl, {
        forceRefresh: true,
      });
      if (!mountedRef.current) return;
      if (fallbackSigned) {
        setFailed(false);
        setResolvedUrl(fallbackSigned);
        return;
      }
    }

    setFailed(true);
    setLoading(false);
  }, [mediaUrl]);

  const retry = useCallback(async () => {
    if (!mediaUrl) return;
    retriedRef.current = false;
    setFailed(false);
    setLoading(true);

    if (isPrivateMediaRef(mediaUrl)) {
      const fresh = await createAuthorizedMediaReadUrl(mediaUrl, { forceRefresh: true });
      if (!mountedRef.current) return;
      setLoading(false);
      if (fresh) {
        setResolvedUrl(fresh);
      } else {
        setResolvedUrl(null);
        setFailed(true);
      }
      return;
    }

    if (extractSupabasePublicMediaPath(mediaUrl)) {
      const fallbackSigned = await createSupabaseMediaBucketFallbackSignedUrl(mediaUrl, {
        forceRefresh: true,
      });
      if (!mountedRef.current) return;
      setLoading(false);
      if (fallbackSigned) {
        setResolvedUrl(fallbackSigned);
        return;
      }
    }

    setLoading(false);
    setResolvedUrl(mediaUrl);
  }, [mediaUrl]);

  return { resolvedUrl, loading, failed, handleMediaError, retry };
}

export function ResolvedMomentThumb({
  mediaUrl,
  mediaType,
  alt,
  className,
  fallback,
}: {
  mediaUrl: string;
  mediaType: "image" | "video" | string;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const { resolvedUrl, loading, failed, handleMediaError } = useResolvedMediaUrl(mediaUrl);

  if (loading) {
    return (
      <div
        className={`animate-pulse bg-secondary/70 ${className ?? "h-full w-full"}`}
        aria-label={`Loading ${alt}`}
      />
    );
  }

  if (failed || !resolvedUrl) {
    if (fallback) return <>{fallback}</>;
    return (
      <div
        className={`flex items-center justify-center bg-secondary/70 text-muted-foreground ${className ?? "h-full w-full"}`}
        aria-label={alt}
      >
        <Lock className="size-4 opacity-70" />
      </div>
    );
  }

  if (mediaType === "video") {
    return (
      <video
        src={resolvedUrl}
        muted
        playsInline
        preload="metadata"
        onError={() => void handleMediaError()}
        className={className}
      />
    );
  }

  return (
    <img
      src={resolvedUrl}
      alt={alt}
      loading="lazy"
      onError={() => void handleMediaError()}
      className={className}
    />
  );
}
