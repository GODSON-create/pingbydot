import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  AlertTriangle,
  Bookmark,
  Captions,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Database,
  Eye,
  Flag,
  Globe,
  Heart,
  Loader2,
  MessageCircle,
  MessageSquare,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Share2,
  Sparkles,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { pageHead } from "@/lib/site";
import { useAuth } from "@/lib/auth";
import { CURATED_DOT_TAGS } from "@/lib/dot-tags";
import {
  clipRepliesQuery,
  clipsFeedQuery,
  recordObservedClipShare,
  recordObservedClipView,
  useDeleteClip,
  useDeleteClipReply,
  usePostClipReply,
  useReportClip,
  useToggleClipLike,
  useToggleClipSave,
  useUpdateClipVisibility,
  viewerClipInteractionsQuery,
  type ClipFeedSort,
  type ClipVisibility,
  type PingClip,
} from "@/lib/clips";
import { useGetOrCreateDirectConversation } from "@/lib/messages";
import { useResolvedMediaUrl } from "@/components/media/ResolvedPrivateMedia";
import { ClipComposerDialog } from "@/components/clips/ClipComposerDialog";
import { FounderAvatar } from "@/components/ping/Avatar";
import { AccountStatusBadges } from "@/components/badges/AccountStatusBadges";
import { RichPingText } from "@/components/ping/RichPingText";
import { UniversalShareDialog } from "@/components/sharing/UniversalShareDialog";
import { QueryErrorCard } from "@/components/QueryErrorCard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/clips")({
  staticData: { sitemap: true },
  validateSearch: z.object({
    clip: z.string().trim().max(120).optional(),
    tag: z.string().trim().max(64).optional(),
    compose: z.union([z.boolean(), z.literal("1"), z.literal("true")]).optional(),
  }),
  head: () =>
    pageHead({
      title: "Clips — Ping Persistent Short-Form Video",
      description:
        "Swipe through full-screen vertical short-form videos from creators across Ping.",
      path: "/clips",
    }),
  component: PingClipsPage,
});

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);
  return reduced;
}

function useSaveDataPreference(): boolean {
  const [saveData, setSaveData] = useState(false);
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) setSaveData(true);
  }, []);
  return saveData;
}

interface VerticalClipSlideProps {
  clip: PingClip;
  isActive: boolean;
  muted: boolean;
  onToggleMute: () => void;
  reducedMotion: boolean;
  saveData: boolean;
  initialLiked: boolean;
  initialSaved: boolean;
  initialFollowing: boolean;
  onDeleted?: () => void;
}

function VerticalClipSlide({
  clip,
  isActive,
  muted,
  onToggleMute,
  reducedMotion,
  saveData,
  initialLiked,
  initialSaved,
  initialFollowing,
  onDeleted,
}: VerticalClipSlideProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewLoggedRef = useRef(false);

  const {
    resolvedUrl: resolvedVideoUrl,
    loading: videoUrlLoading,
    failed: videoUrlFailed,
    handleMediaError: handleVideoUrlError,
    retry: retryVideoUrl,
  } = useResolvedMediaUrl(clip.video_url);
  const { resolvedUrl: resolvedPosterUrl } = useResolvedMediaUrl(clip.poster_url);

  const [playing, setPlaying] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const [showCaptions, setShowCaptions] = useState(true);
  const [liked, setLiked] = useState(initialLiked);
  const [likeDelta, setLikeDelta] = useState(0);
  const [saved, setSaved] = useState(initialSaved);
  const [followingCreator, setFollowingCreator] = useState(initialFollowing);
  const [followPending, setFollowPending] = useState(false);
  const [views, setViews] = useState(clip.views_count);
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [replyDraft, setReplyDraft] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Sync hydrated server state when viewer interactions load
  useEffect(() => {
    setLiked(initialLiked);
    setLikeDelta(0);
  }, [initialLiked, clip.id]);

  useEffect(() => {
    setSaved(initialSaved);
  }, [initialSaved, clip.id]);

  useEffect(() => {
    setFollowingCreator(initialFollowing);
  }, [initialFollowing, clip.id]);

  useEffect(() => {
    setViews(clip.views_count);
  }, [clip.views_count, clip.id]);

  const toggleLike = useToggleClipLike(user?.id);
  const toggleSave = useToggleClipSave(user?.id);
  const postReply = usePostClipReply(user?.id);
  const deleteReply = useDeleteClipReply(user?.id);
  const reportClip = useReportClip(user?.id);
  const updateVisibility = useUpdateClipVisibility(user?.id);
  const deleteClip = useDeleteClip(user?.id);
  const startChat = useGetOrCreateDirectConversation();
  const {
    data: replies = [],
    isLoading: repliesLoading,
  } = useQuery(clipRepliesQuery(repliesOpen ? clip.id : undefined));

  const creatorName = clip.creator?.display_name || clip.creator?.username || "Creator";
  const isOwner = Boolean(user?.id && user.id === clip.creator_id);
  const hasMediaError = videoUrlFailed || playbackError;

  const logObservedView = useCallback(() => {
    if (viewLoggedRef.current) return;
    viewLoggedRef.current = true;
    void recordObservedClipView(clip.id).then((ok) => {
      if (ok) {
        setViews((v) => v + 1);
      }
    });
  }, [clip.id]);

  // Sensible autoplay/pause when clip enters/leaves active viewport
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    if (!isActive) {
      if (!el.paused) el.pause();
      setPlaying(false);
      setBuffering(false);
      return;
    }

    // Respect reduced-motion, data-saver, and explicit user pause
    if (reducedMotion || saveData || userPaused || !resolvedVideoUrl || hasMediaError) {
      return;
    }

    el.muted = muted;
    const playPromise = el.play?.();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise
        .then(() => {
          setPlaying(true);
          logObservedView();
        })
        .catch(() => {
          // Browser blocked autoplay; user can tap Play directly
          setPlaying(false);
        });
    }
  }, [isActive, muted, reducedMotion, saveData, userPaused, resolvedVideoUrl, hasMediaError, logObservedView]);

  // Keep DOM muted state synced
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = muted;
    }
  }, [muted]);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el || hasMediaError) return;
    if (el.paused) {
      setUserPaused(false);
      const p = el.play?.();
      if (p && typeof p.then === "function") {
        p.then(() => {
          setPlaying(true);
          logObservedView();
        }).catch(() => {
          setPlaying(false);
        });
      } else {
        setPlaying(true);
        logObservedView();
      }
    } else {
      setUserPaused(true);
      el.pause();
      setPlaying(false);
    }
  }, [hasMediaError, logObservedView]);

  const handleRetryVideo = useCallback(async () => {
    setPlaybackError(false);
    setBuffering(true);
    await retryVideoUrl();
    if (videoRef.current) {
      videoRef.current.load();
    }
    setBuffering(false);
  }, [retryVideoUrl]);

  const displayedLikeCount = Math.max(0, clip.likes_count + likeDelta);
  const displayedReplyCount = repliesOpen
    ? Math.max(clip.replies_count, replies.length)
    : clip.replies_count;

  return (
    <article
      data-testid={`clip-card-${clip.id}`}
      data-active-clip={isActive ? "true" : "false"}
      className="relative flex h-full w-full max-w-[430px] flex-col overflow-hidden rounded-3xl border border-border/60 bg-black shadow-lift"
    >
      {/* Full-bleed Vertical 9:16 Video Stage */}
      <div className="relative flex-1 w-full h-full flex items-center justify-center overflow-hidden bg-black">
        {resolvedVideoUrl && !hasMediaError ? (
          <video
            ref={videoRef}
            src={resolvedVideoUrl}
            poster={resolvedPosterUrl ?? undefined}
            muted={muted}
            playsInline
            loop
            preload={isActive ? "metadata" : "none"}
            onClick={togglePlay}
            onLoadStart={() => isActive && setBuffering(true)}
            onWaiting={() => setBuffering(true)}
            onCanPlay={() => setBuffering(false)}
            onLoadedData={() => setBuffering(false)}
            onPlaying={() => {
              setBuffering(false);
              setPlaying(true);
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() => {
              setBuffering(false);
              setPlaying(false);
              void handleVideoUrlError();
            }}
            className="h-full w-full object-cover cursor-pointer"
          />
        ) : null}

        {/* Loading / Buffering Overlay */}
        {(videoUrlLoading || (buffering && !hasMediaError)) && (
          <div
            role="status"
            aria-label="Loading Clip video"
            className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 backdrop-blur-[1px]"
          >
            <div className="flex items-center gap-2 rounded-full bg-black/75 px-3.5 py-2 text-xs font-semibold text-white">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span>Loading video…</span>
            </div>
          </div>
        )}

        {/* Video Error Fallback with Retry */}
        {hasMediaError && (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-950/95 p-6 text-center text-white"
          >
            <AlertTriangle className="size-9 text-amber-400" />
            <div>
              <p className="font-display text-base font-bold">This Clip video couldn&apos;t load</p>
              <p className="mt-1 text-xs text-white/70">
                Check your connection or retry loading the video stream.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="hero"
              onClick={() => void handleRetryVideo()}
              className="rounded-full gap-1.5"
            >
              <RefreshCw className="size-3.5" /> Retry video
            </Button>
          </div>
        )}

        {/* Center Play Indicator when paused & ready */}
        {!playing && !hasMediaError && !videoUrlLoading && !buffering && (
          <button
            type="button"
            onClick={togglePlay}
            aria-label="Play Clip"
            className="absolute inset-0 m-auto flex size-16 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Play className="size-7 fill-current translate-x-0.5" />
          </button>
        )}

        {/* Top Badges Row */}
        <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {clip.source_moment_id && (
              <span className="inline-flex items-center gap-1 rounded-full bg-black/65 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
                <Sparkles className="size-3 text-lime" /> Republished from Moment
              </span>
            )}
            {clip.visibility === "followers" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-black/65 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
                <Users className="size-3 text-primary" /> Followers only
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {clip.duration_sec && (
              <span className="rounded-full bg-black/65 px-2 py-1 text-[10px] font-mono text-white backdrop-blur-sm">
                {clip.duration_sec}s
              </span>
            )}
            <span
              className="inline-flex items-center gap-1 rounded-full bg-black/65 px-2.5 py-1 text-[10px] font-semibold text-white tabular-nums backdrop-blur-sm"
              title="Recorded Clip views"
            >
              <Eye className="size-3" /> {views}
            </span>
          </div>
        </div>

        {/* Accessible On-screen Captions Overlay */}
        {showCaptions && clip.captions_text && !hasMediaError && (
          <div className="pointer-events-none absolute inset-x-4 bottom-44 flex justify-center">
            <p className="rounded-xl bg-black/75 px-3 py-1.5 text-center text-xs text-white backdrop-blur-sm">
              {clip.captions_text}
            </p>
          </div>
        )}

        {/* Bottom Scrim Gradient for Readability */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/90 via-black/45 to-transparent" />

        {/* Right-Side Vertical Reels Action Rail */}
        <div
          aria-label="Clip actions"
          className="absolute right-2.5 bottom-4 z-10 flex flex-col items-center gap-2.5"
        >
          {/* Like */}
          <button
            type="button"
            onClick={() => {
              if (!user) {
                toast.info("Sign in to like Clips");
                return;
              }
              const prevLiked = liked;
              setLiked(!prevLiked);
              setLikeDelta((d) => d + (prevLiked ? -1 : 1));
              toggleLike.mutate(
                { clipId: clip.id, liked: prevLiked },
                {
                  onError: (err) => {
                    setLiked(prevLiked);
                    setLikeDelta((d) => d + (prevLiked ? 1 : -1));
                    toast.error(err instanceof Error ? err.message : "Could not update like.");
                  },
                },
              );
            }}
            aria-label={liked ? "Unlike Clip" : "Like Clip"}
            aria-pressed={liked}
            className="flex flex-col items-center gap-0.5 text-white"
          >
            <span
              className={cn(
                "flex size-10 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm transition-colors hover:bg-black/80",
                liked && "text-red-500",
              )}
            >
              <Heart className={cn("size-5", liked && "fill-current")} />
            </span>
            <span className="text-[11px] font-bold tabular-nums drop-shadow">
              {displayedLikeCount}
            </span>
          </button>

          {/* Comments / Replies */}
          <button
            type="button"
            onClick={() => setRepliesOpen(true)}
            aria-label="Reply to Clip"
            className="flex flex-col items-center gap-0.5 text-white"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm transition-colors hover:bg-black/80">
              <MessageCircle className="size-5" />
            </span>
            <span className="text-[11px] font-bold tabular-nums drop-shadow">
              {displayedReplyCount}
            </span>
          </button>

          {/* Save */}
          <button
            type="button"
            onClick={() => {
              if (!user) {
                toast.info("Sign in to save Clips");
                return;
              }
              const prevSaved = saved;
              setSaved(!prevSaved);
              toggleSave.mutate(
                { clipId: clip.id, saved: prevSaved },
                {
                  onSuccess: (s) => toast.success(s ? "Clip saved" : "Removed from saved"),
                  onError: (err) => {
                    setSaved(prevSaved);
                    toast.error(err instanceof Error ? err.message : "Could not update save.");
                  },
                },
              );
            }}
            aria-label={saved ? "Unsave Clip" : "Save Clip"}
            aria-pressed={saved}
            className="flex flex-col items-center gap-0.5 text-white"
          >
            <span
              className={cn(
                "flex size-10 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm transition-colors hover:bg-black/80",
                saved && "text-primary",
              )}
            >
              <Bookmark className={cn("size-5", saved && "fill-current")} />
            </span>
            <span className="text-[10px] font-semibold drop-shadow">
              {saved ? "Saved" : "Save"}
            </span>
          </button>

          {/* Share */}
          <button
            type="button"
            onClick={() => {
              setShareOpen(true);
              void recordObservedClipShare(clip.id);
            }}
            aria-label="Share Clip"
            className="flex flex-col items-center gap-0.5 text-white"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm transition-colors hover:bg-black/80">
              <Share2 className="size-5" />
            </span>
            <span className="text-[10px] font-semibold drop-shadow">Share</span>
          </button>

          {/* Playback & Accessibility Quick Toggles */}
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? "Pause Clip" : "Play Clip"}
            className="flex size-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80"
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>

          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? "Unmute Clip" : "Mute Clip"}
            className="flex size-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80"
          >
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>

          {clip.captions_text && (
            <button
              type="button"
              onClick={() => setShowCaptions((c) => !c)}
              aria-label={showCaptions ? "Hide captions" : "Show captions"}
              className="flex size-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80"
            >
              <Captions className={cn("size-4", showCaptions && "text-primary")} />
            </button>
          )}

          {/* Owner Controls or Report */}
          {isOwner ? (
            <>
              <button
                type="button"
                disabled={updateVisibility.isPending}
                onClick={() => {
                  const nextVis: ClipVisibility =
                    clip.visibility === "public" ? "followers" : "public";
                  updateVisibility.mutate(
                    { clipId: clip.id, visibility: nextVis },
                    {
                      onSuccess: () =>
                        toast.success(
                          nextVis === "public"
                            ? "Clip visibility set to Public"
                            : "Clip visibility set to Followers Only",
                        ),
                      onError: (err) =>
                        toast.error(
                          err instanceof Error ? err.message : "Could not update visibility.",
                        ),
                    },
                  );
                }}
                aria-label={`Change visibility (currently ${clip.visibility})`}
                title={
                  clip.visibility === "public"
                    ? "Public — click to restrict to Followers"
                    : "Followers only — click to make Public"
                }
                className="flex size-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80"
              >
                {clip.visibility === "public" ? (
                  <Globe className="size-4 text-primary" />
                ) : (
                  <Users className="size-4 text-amber-300" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setDeleteConfirmOpen(true)}
                aria-label="Delete Clip"
                title="Delete Clip"
                className="flex size-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-destructive/80"
              >
                <Trash2 className="size-4" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              aria-label="Report Clip"
              className="flex size-9 items-center justify-center rounded-full bg-black/60 text-white/80 backdrop-blur-sm hover:bg-black/80 hover:text-red-400"
            >
              <Flag className="size-3.5" />
            </button>
          )}
        </div>

        {/* Bottom-Left Creator Attribution, Follow/Connect & Caption */}
        <div className="absolute inset-x-3.5 bottom-4 pr-14 z-10 text-white space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {clip.creator?.username ? (
              <Link
                to="/@{$username}"
                params={{ username: clip.creator.username }}
                className="flex items-center gap-2 min-w-0 group"
              >
                <FounderAvatar name={creatorName} src={clip.creator.avatar_url} size="sm" />
                <div className="min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-bold text-white truncate group-hover:underline drop-shadow">
                      {creatorName}
                    </span>
                    <AccountStatusBadges userId={clip.creator_id} compact />
                  </div>
                  <p className="text-[11px] text-white/75 truncate">@{clip.creator.username}</p>
                </div>
              </Link>
            ) : (
              <span className="text-xs font-bold">{creatorName}</span>
            )}

            {!isOwner && user && (
              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  type="button"
                  size="sm"
                  variant={followingCreator ? "secondary" : "hero"}
                  disabled={followPending}
                  className="h-7 rounded-full text-[11px] gap-1 px-2.5"
                  onClick={async () => {
                    try {
                      setFollowPending(true);
                      if (followingCreator) {
                        const { error } = await supabase
                          .from("follows")
                          .delete()
                          .eq("follower_id", user.id)
                          .eq("following_id", clip.creator_id);
                        if (error) throw error;
                        setFollowingCreator(false);
                        toast.success(`Unfollowed ${creatorName}`);
                      } else {
                        const { error } = await supabase
                          .from("follows")
                          .insert({ follower_id: user.id, following_id: clip.creator_id });
                        if (error && error.code !== "23505") throw error;
                        setFollowingCreator(true);
                        toast.success(`Following ${creatorName}`);
                      }
                      void qc.invalidateQueries({ queryKey: ["clip-viewer-interactions"] });
                    } catch {
                      toast.error("Couldn't update follow status.");
                    } finally {
                      setFollowPending(false);
                    }
                  }}
                >
                  {followingCreator ? (
                    <>
                      <UserCheck className="size-3" /> Following
                    </>
                  ) : (
                    <>
                      <UserPlus className="size-3" /> Follow
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-full text-[11px] gap-1 px-2.5 border-white/30 bg-black/45 text-white hover:bg-black/70 hover:text-white"
                  onClick={async () => {
                    try {
                      const convId = await startChat.mutateAsync(clip.creator_id);
                      navigate({ to: "/messages", search: { conversationId: convId } });
                    } catch {
                      toast.error("Couldn't open chat with creator.");
                    }
                  }}
                >
                  <MessageSquare className="size-3" /> Connect
                </Button>
              </div>
            )}
          </div>

          {clip.caption && (
            <p className="text-xs leading-relaxed text-white/95 line-clamp-3 drop-shadow">
              <RichPingText text={clip.caption} />
            </p>
          )}

          {clip.dot_tags && clip.dot_tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {clip.dot_tags.slice(0, 4).map((tag) => (
                <Link
                  key={tag}
                  to="/tag/$slug"
                  params={{ slug: tag }}
                  className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-lime backdrop-blur-sm hover:bg-white/25"
                >
                  .{tag}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Replies / Comments Dialog */}
      <Dialog open={repliesOpen} onOpenChange={setRepliesOpen}>
        <DialogContent className="sm:max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-lg">Clip Comments</DialogTitle>
            <DialogDescription className="text-xs">
              Join the conversation around @{clip.creator?.username ?? "creator"}&apos;s Clip.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 max-h-60 overflow-y-auto space-y-2">
            {repliesLoading ? (
              <div className="py-6 flex justify-center">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : replies.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                No comments yet. Start the conversation.
              </p>
            ) : (
              replies.map((r) => (
                <div
                  key={r.id}
                  className="rounded-2xl bg-secondary/40 p-3 text-xs flex items-start justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="font-bold">
                      {r.author?.display_name || `@${r.author?.username || "member"}`}
                    </p>
                    <p className="mt-0.5 text-foreground/90 break-words">{r.content}</p>
                  </div>
                  {user?.id === r.user_id && (
                    <button
                      type="button"
                      onClick={() =>
                        deleteReply.mutate(
                          { replyId: r.id, clipId: clip.id },
                          {
                            onSuccess: () => toast.success("Comment deleted"),
                            onError: (err) =>
                              toast.error(
                                err instanceof Error ? err.message : "Could not delete comment.",
                              ),
                          },
                        )
                      }
                      aria-label="Delete comment"
                      className="shrink-0 rounded-full p-1 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
          {user ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!replyDraft.trim()) return;
                try {
                  await postReply.mutateAsync({ clipId: clip.id, content: replyDraft });
                  setReplyDraft("");
                  toast.success("Comment posted");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Could not post comment.");
                }
              }}
              className="mt-3 flex gap-2"
            >
              <Input
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
                placeholder="Write a comment…"
                className="rounded-full text-xs flex-1"
              />
              <Button
                type="submit"
                size="sm"
                variant="hero"
                disabled={postReply.isPending}
                className="rounded-full text-xs"
              >
                Send
              </Button>
            </form>
          ) : (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              <Link to="/login" className="font-semibold text-primary hover:underline">
                Sign in
              </Link>{" "}
              to comment on Clips.
            </p>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Clip Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-sm rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-lg">Delete this Clip?</DialogTitle>
            <DialogDescription className="text-xs">
              This permanently removes your Clip from Ping Clips and your profile.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteConfirmOpen(false)}
              className="rounded-full text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deleteClip.isPending}
              onClick={async () => {
                try {
                  await deleteClip.mutateAsync(clip.id);
                  toast.success("Clip deleted");
                  setDeleteConfirmOpen(false);
                  onDeleted?.();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Could not delete Clip.");
                }
              }}
              className="rounded-full text-xs"
            >
              {deleteClip.isPending ? "Deleting…" : "Delete Clip"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Report Clip Dialog */}
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="sm:max-w-sm rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-lg">Report Clip</DialogTitle>
            <DialogDescription className="text-xs">
              Flag policy, safety, or copyright concerns for moderation review.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (reportReason.trim().length < 3) return;
              try {
                await reportClip.mutateAsync({ clipId: clip.id, reason: reportReason });
                toast.success("Clip reported for moderation review.");
                setReportReason("");
                setReportOpen(false);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Could not submit report.");
              }
            }}
            className="space-y-3 mt-2"
          >
            <Input
              required
              minLength={3}
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              placeholder="Reason for report…"
              className="rounded-xl text-xs"
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setReportOpen(false)}
                className="rounded-full text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                className="rounded-full text-xs"
              >
                Submit Report
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <UniversalShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        payload={{
          targetType: "ping",
          targetId: clip.id,
          title: `Ping Clip by ${creatorName}`,
          description: clip.caption || "Watch this persistent short-form Clip on Ping.",
          path: `/clips?clip=${encodeURIComponent(clip.id)}`,
        }}
      />
    </article>
  );
}

function PingClipsPage() {
  const { user } = useAuth();
  const search: { clip?: string; tag?: string; compose?: boolean | "1" | "true" } =
    typeof Route.useSearch === "function" ? Route.useSearch() : {};
  const reducedMotion = usePrefersReducedMotion();
  const saveData = useSaveDataPreference();

  const [activeTag, setActiveTag] = useState(search.tag || "all");
  const [sortMode, setSortMode] = useState<ClipFeedSort>("recent");
  const [composeOpen, setComposeOpen] = useState(Boolean(search.compose));
  const [muted, setMuted] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);

  const feedScrollRef = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);

  const {
    data: feedState,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery(clipsFeedQuery(activeTag, sortMode));

  // If a deep link `?clip=<id>` is requested, prioritize it cleanly at the top of the vertical feed
  const clips = useMemo(() => {
    const raw = feedState?.clips ?? [];
    if (!search.clip) return raw;
    const targetIdx = raw.findIndex((c) => c.id === search.clip);
    if (targetIdx <= 0) return raw;
    const copy = [...raw];
    const [picked] = copy.splice(targetIdx, 1);
    return picked ? [picked, ...copy] : raw;
  }, [feedState?.clips, search.clip]);

  const clipIds = useMemo(() => clips.map((c) => c.id), [clips]);
  const creatorIds = useMemo(() => clips.map((c) => c.creator_id), [clips]);

  const { data: viewerInteractions } = useQuery(
    viewerClipInteractionsQuery(clipIds, creatorIds, user?.id),
  );

  // Reset active index when filter/sort changes
  useEffect(() => {
    setActiveIndex(0);
    if (feedScrollRef.current && typeof feedScrollRef.current.scrollTo === "function") {
      feedScrollRef.current.scrollTo({ top: 0, behavior: "auto" });
    }
  }, [activeTag, sortMode, search.clip]);

  // Observe which vertical Clip slide is primarily in view
  useEffect(() => {
    const root = feedScrollRef.current;
    if (!root || clips.length === 0 || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        let bestIdx = -1;
        let bestRatio = 0;
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > bestRatio) {
            const idxAttr = entry.target.getAttribute("data-clip-index");
            const idx = idxAttr ? Number(idxAttr) : -1;
            if (idx >= 0) {
              bestRatio = entry.intersectionRatio;
              bestIdx = idx;
            }
          }
        }
        if (bestIdx >= 0) {
          setActiveIndex(bestIdx);
        }
      },
      { root, threshold: [0.5, 0.75] },
    );

    slideRefs.current.forEach((node) => {
      if (node) observer.observe(node);
    });

    return () => observer.disconnect();
  }, [clips]);

  const scrollToClip = useCallback(
    (nextIndex: number) => {
      const clamped = Math.max(0, Math.min(clips.length - 1, nextIndex));
      setActiveIndex(clamped);
      const targetNode = slideRefs.current[clamped];
      if (targetNode && typeof targetNode.scrollIntoView === "function") {
        targetNode.scrollIntoView({
          behavior: reducedMotion ? "auto" : "smooth",
          block: "start",
        });
      }
    },
    [clips.length, reducedMotion],
  );

  // Keyboard vertical browsing (ArrowDown / ArrowUp / M to mute)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el?.getAttribute("contenteditable") === "true" ||
        composeOpen
      ) {
        return;
      }
      if (e.key === "ArrowDown" && clips.length > 1) {
        e.preventDefault();
        scrollToClip(activeIndex + 1);
      } else if (e.key === "ArrowUp" && clips.length > 1) {
        e.preventDefault();
        scrollToClip(activeIndex - 1);
      } else if (e.key === "m" || e.key === "M") {
        setMuted((m) => !m);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, clips.length, composeOpen, scrollToClip]);

  const unmigrated = feedState?.migrated === false;

  return (
    <div
      data-clips-feed="vertical-reels"
      className="flex h-[calc(100dvh-5.25rem)] md:h-[calc(100dvh-4.5rem)] lg:h-[100dvh] w-full flex-col overflow-hidden bg-background"
    >
      {/* Compact Top Clips Header & Topic Filter Bar */}
      <header className="shrink-0 border-b border-border/60 bg-background/90 backdrop-blur-xl px-3 sm:px-5 py-2.5 z-20">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-bold text-primary shrink-0">
              <Clapperboard className="size-3.5" /> Clips
            </span>
            <h1 className="sr-only">Ping Clips — Persistent Short-Form Video</h1>
            <span className="hidden sm:inline text-xs text-muted-foreground truncate">
              Persistent short-form videos · Swipe or scroll vertically
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div
              className="hidden sm:inline-flex items-center rounded-full border border-border bg-card p-0.5 text-[11px]"
              role="group"
              aria-label="Sort Clips"
            >
              {(
                [
                  { id: "recent", label: "Latest" },
                  { id: "popular", label: "Popular" },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSortMode(m.id)}
                  className={cn(
                    "rounded-full px-2.5 py-1 font-semibold transition-colors",
                    sortMode === m.id
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <Button
              type="button"
              variant="hero"
              size="sm"
              onClick={() => {
                if (!user) {
                  toast.info("Sign in to publish a Ping Clip.");
                  return;
                }
                setComposeOpen(true);
              }}
              className="rounded-full gap-1.5 h-8 px-3.5 text-xs"
            >
              <Plus className="size-3.5" /> Publish Clip
            </Button>
          </div>
        </div>

        {/* DOT Tag Discovery Strip */}
        <nav
          aria-label="Filter Clips by DOT Tag"
          className="mx-auto mt-2 flex max-w-5xl items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none"
        >
          <button
            type="button"
            onClick={() => setActiveTag("all")}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors",
              activeTag === "all"
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-foreground hover:bg-secondary",
            )}
          >
            All Clips
          </button>
          {CURATED_DOT_TAGS.slice(0, 10).map((tag) => (
            <button
              key={tag.slug}
              type="button"
              onClick={() => setActiveTag(tag.slug)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors",
                activeTag === tag.slug
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              .{tag.slug}
            </button>
          ))}
        </nav>
      </header>

      {/* Main Full-Screen Vertical Feed Stage */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        {isLoading ? (
          <div
            role="status"
            aria-label="Loading Clips feed"
            className="flex h-full w-full items-center justify-center p-4"
          >
            <div className="flex h-full w-full max-w-[430px] flex-col items-center justify-center gap-3 rounded-3xl border border-border/60 bg-secondary/40 animate-pulse">
              <Loader2 className="size-7 animate-spin text-primary" />
              <p className="text-xs font-medium text-muted-foreground">Loading Clips…</p>
            </div>
          </div>
        ) : isError ? (
          <div className="flex h-full items-center justify-center p-4">
            <div className="w-full max-w-md">
              <QueryErrorCard
                title="Couldn't load Ping Clips"
                error={error}
                onRetry={() => void refetch()}
              />
            </div>
          </div>
        ) : unmigrated ? (
          <div
            data-clips-unmigrated="true"
            className="flex h-full items-center justify-center p-4"
          >
            <div className="surface-card max-w-md rounded-3xl border border-amber-500/30 p-7 text-center space-y-3">
              <Database className="mx-auto size-10 text-amber-500" />
              <h2 className="font-display text-lg font-bold">Clips Backend Migration Pending</h2>
              <p className="text-xs leading-relaxed text-muted-foreground">
                The Clips experience is ready, but the remote database has not yet applied{" "}
                <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px]">
                  0034_ping_learn_spotlight_and_clips.sql
                </code>
                . Once applied, persistent short-form Clips, likes, saves, and comments will go live
                automatically.
              </p>
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                <Button asChild size="sm" variant="hero" className="rounded-full">
                  <Link to="/explore">Explore Ping</Link>
                </Button>
                <Button asChild size="sm" variant="outline" className="rounded-full">
                  <Link to="/inbox" search={{}}>
                    Open Inbox
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        ) : clips.length === 0 ? (
          <div className="flex h-full items-center justify-center p-4">
            <div className="surface-card max-w-md rounded-3xl border border-border/70 p-8 text-center space-y-3">
              <Clapperboard className="mx-auto size-10 text-primary/70" />
              <h2 className="font-display text-lg font-bold">
                {activeTag === "all"
                  ? "No Ping Clips published yet"
                  : `No Clips tagged .${activeTag} yet`}
              </h2>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Clips are persistent short-form videos for discovery — separate from temporary
                Moments. Publish the first Clip or try another topic tag.
              </p>
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                {activeTag !== "all" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setActiveTag("all")}
                    className="rounded-full"
                  >
                    Show All Clips
                  </Button>
                )}
                <Button
                  type="button"
                  variant="hero"
                  size="sm"
                  onClick={() => {
                    if (!user) {
                      toast.info("Sign in to publish your first Clip.");
                      return;
                    }
                    setComposeOpen(true);
                  }}
                  className="rounded-full gap-1.5"
                >
                  <Plus className="size-4" /> Publish First Clip
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div
              ref={feedScrollRef}
              aria-label="Vertical Clips feed"
              className="h-full w-full overflow-y-auto snap-y snap-mandatory scroll-smooth scrollbar-none"
            >
              {clips.map((clip, idx) => (
                <div
                  key={clip.id}
                  ref={(node) => {
                    slideRefs.current[idx] = node;
                  }}
                  data-clip-index={idx}
                  className="flex h-full min-h-full w-full snap-start snap-always items-center justify-center p-2 sm:p-4"
                >
                  <VerticalClipSlide
                    clip={clip}
                    isActive={idx === activeIndex}
                    muted={muted}
                    onToggleMute={() => setMuted((m) => !m)}
                    reducedMotion={reducedMotion}
                    saveData={saveData}
                    initialLiked={viewerInteractions?.likedIds.has(clip.id) ?? false}
                    initialSaved={viewerInteractions?.savedIds.has(clip.id) ?? false}
                    initialFollowing={
                      viewerInteractions?.followedCreatorIds.has(clip.creator_id) ?? false
                    }
                    onDeleted={() => {
                      setActiveIndex((prev) => Math.max(0, prev - 1));
                    }}
                  />
                </div>
              ))}
            </div>

            {/* Desktop Vertical Navigation Controls & Position Pill */}
            {clips.length > 1 && (
              <div className="hidden md:flex flex-col items-center gap-2 fixed right-6 top-1/2 -translate-y-1/2 z-20">
                <button
                  type="button"
                  disabled={activeIndex <= 0}
                  onClick={() => scrollToClip(activeIndex - 1)}
                  aria-label="Previous Clip"
                  className="flex size-10 items-center justify-center rounded-full border border-border bg-card/90 text-foreground shadow-soft backdrop-blur-md transition-colors hover:bg-secondary disabled:opacity-35"
                >
                  <ChevronUp className="size-5" />
                </button>
                <span className="rounded-full border border-border bg-card/90 px-2.5 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">
                  {activeIndex + 1} / {clips.length}
                </span>
                <button
                  type="button"
                  disabled={activeIndex >= clips.length - 1}
                  onClick={() => scrollToClip(activeIndex + 1)}
                  aria-label="Next Clip"
                  className="flex size-10 items-center justify-center rounded-full border border-border bg-card/90 text-foreground shadow-soft backdrop-blur-md transition-colors hover:bg-secondary disabled:opacity-35"
                >
                  <ChevronDown className="size-5" />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Shared Publish Clip Dialog */}
      <ClipComposerDialog open={composeOpen} onOpenChange={setComposeOpen} />
    </div>
  );
}
