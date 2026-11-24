import { useEffect, useRef, useState } from "react";
import {
  createAuthorizedMediaReadUrl,
  DEFAULT_DM_SIGNED_URL_TTL_SEC,
  isPrivateMediaRef,
} from "@/lib/storage";

/**
 * Resolves any stored Ping media ref (public `https://`, private `storage://private-moments/...`,
 * `storage://hub-attachments/...`, DM paths, or `r2://...`) into a usable browser URL, with
 * automatic renewal before TTL expiry and forced refresh retry on playback/load error.
 */
export function useResolvedMediaUrl(mediaUrl: string | null | undefined) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(() => {
    if (!mediaUrl) return null;
    return isPrivateMediaRef(mediaUrl) ? null : mediaUrl;
  });
  const [failed, setFailed] = useState(false);
  const retriedRef = useRef(false);

  useEffect(() => {
    let active = true;
    let renewTimer: ReturnType<typeof setTimeout> | null = null;
    setFailed(false);
    retriedRef.current = false;

    if (!mediaUrl) {
      setResolvedUrl(null);
      return;
    }

    if (!isPrivateMediaRef(mediaUrl)) {
      setResolvedUrl(mediaUrl);
      return;
    }

    const load = async (forceRefresh: boolean) => {
      const next = await createAuthorizedMediaReadUrl(mediaUrl, { forceRefresh });
      if (!active) return;
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

  const handleMediaError = async () => {
    if (!mediaUrl || !isPrivateMediaRef(mediaUrl) || retriedRef.current) {
      setFailed(true);
      return;
    }
    retriedRef.current = true;
    const fresh = await createAuthorizedMediaReadUrl(mediaUrl, { forceRefresh: true });
    if (fresh) {
      setFailed(false);
      setResolvedUrl(fresh);
    } else {
      setFailed(true);
    }
  };

  return { resolvedUrl, failed, handleMediaError };
}

export function ResolvedMomentThumb({
  mediaUrl,
  mediaType,
  alt,
  className,
}: {
  mediaUrl: string;
  mediaType: "image" | "video" | string;
  alt: string;
  className?: string;
}) {
  const { resolvedUrl, failed, handleMediaError } = useResolvedMediaUrl(mediaUrl);

  if (failed || !resolvedUrl) {
    return <div className={`bg-secondary/60 ${className ?? "h-full w-full"}`} aria-label={alt} />;
  }

  if (mediaType === "video") {
    return (
      <video
        src={resolvedUrl}
        muted
        playsInline
        onError={() => void handleMediaError()}
        className={className}
      />
    );
  }

  return (
    <img
      src={resolvedUrl}
      alt={alt}
      onError={() => void handleMediaError()}
      className={className}
    />
  );
}
