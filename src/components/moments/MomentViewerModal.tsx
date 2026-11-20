import { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  Heart,
  Send,
  Repeat2,
  Share2,
  Volume2,
  VolumeX,
  MoreVertical,
  Plus,
  Trash2,
  Sparkles,
  Lock,
  Globe,
  Users,
  Eye,
  Flag,
  MessageSquare,
  ArrowLeft,
  Pause,
  Play,
  ChevronUp,
  ChevronDown,
  Clapperboard,
  Megaphone,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FounderAvatar } from "@/components/ping/Avatar";
import { VerificationBadge } from "@/components/verification/VerificationBadge";
import { BoostContentDialog, PromotedBadge } from "@/components/boost/BoostContentDialog";
import { MomentToClipDialog } from "@/components/clips/MomentToClipDialog";
import { activeBoostsMapQuery } from "@/lib/boosts";
import {
  useViewMoment,
  useLikeMoment,
  useReplyMoment,
  useDeleteMoment,
  useAddMomentToHighlight,
  useRemoveMomentFromHighlight,
  userHighlightsQuery,
  useCreateHighlight,
  momentActivityQuery,
  type CreatorMomentsSequence,
  type Moment,
} from "@/lib/moments";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { RePingModal } from "./RePingModal";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

interface MomentViewerModalProps {
  sequences: CreatorMomentsSequence[];
  initialSequenceIndex?: number;
  initialMomentIndex?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  highlightId?: string | undefined;
}

export function MomentViewerModal({
  sequences,
  initialSequenceIndex = 0,
  initialMomentIndex = 0,
  open,
  onOpenChange,
  highlightId,
}: MomentViewerModalProps) {
  const { user } = useAuth();
  const [seqIdx, setSeqIdx] = useState(initialSequenceIndex);
  const [momentIdx, setMomentIdx] = useState(initialMomentIndex);
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [videoDurationSec, setVideoDurationSec] = useState<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const replyInputRef = useRef<HTMLInputElement | null>(null);
  const [replyText, setReplyText] = useState("");
  const [repingModalOpen, setRepingModalOpen] = useState(false);
  const [highlightDialogOpen, setHighlightDialogOpen] = useState(false);
  const [activityDialogOpen, setActivityDialogOpen] = useState(false);
  const [boostDialogOpen, setBoostDialogOpen] = useState(false);
  const [clipDialogOpen, setClipDialogOpen] = useState(false);
  const [newHighlightTitle, setNewHighlightTitle] = useState("");

  const addHighlightItemMutation = useAddMomentToHighlight();
  const removeHighlightItemMutation = useRemoveMomentFromHighlight();
  const createHighlightMutation = useCreateHighlight();
  const { data: userHighlights = [] } = useQuery(userHighlightsQuery(user?.id ?? ""));
  const { data: activeBoostsMap } = useQuery(activeBoostsMapQuery());

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pointerDownAtRef = useRef<number>(0);
  const viewedIdsRef = useRef<Set<string>>(new Set());

  const { mutate: recordView } = useViewMoment();
  const likeMutation = useLikeMoment();
  const replyMutation = useReplyMoment();
  const deleteMutation = useDeleteMoment();

  const currentSequence = sequences[seqIdx];
  const currentMoment: Moment | undefined = currentSequence?.moments[momentIdx];
  const isOwner = Boolean(user?.id && currentMoment && user.id === currentMoment.author_id);
  const activeBoost = currentMoment ? activeBoostsMap?.[`moment:${currentMoment.id}`] : undefined;

  const { data: activity } = useQuery(
    momentActivityQuery(currentMoment?.id, open && isOwner && activityDialogOpen),
  );

  // Sync initial indices when opened
  useEffect(() => {
    if (open) {
      setSeqIdx(initialSequenceIndex);
      setMomentIdx(initialMomentIndex);
      setProgress(0);
      setIsPaused(false);
      setVideoDurationSec(null);
    }
  }, [open, initialSequenceIndex, initialMomentIndex]);

  // Reset video duration on slide change
  useEffect(() => {
    setVideoDurationSec(null);
  }, [currentMoment?.id]);

  // Sync HTML5 video play/pause with story pause state
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (
      isPaused ||
      repingModalOpen ||
      highlightDialogOpen ||
      activityDialogOpen ||
      boostDialogOpen ||
      clipDialogOpen
    ) {
      vid.pause();
    } else {
      void vid.play().catch(() => {});
    }
  }, [
    isPaused,
    repingModalOpen,
    highlightDialogOpen,
    activityDialogOpen,
    boostDialogOpen,
    clipDialogOpen,
    currentMoment?.id,
  ]);

  // Record view once per moment per session
  useEffect(() => {
    if (
      open &&
      currentMoment &&
      user &&
      currentMoment.author_id !== user.id &&
      !viewedIdsRef.current.has(currentMoment.id)
    ) {
      viewedIdsRef.current.add(currentMoment.id);
      recordView(currentMoment.id);
    }
  }, [open, currentMoment, user, recordView]);

  const advanceNext = useCallback(() => {
    if (!currentSequence) return;
    if (momentIdx < currentSequence.moments.length - 1) {
      setMomentIdx((prev) => prev + 1);
      setProgress(0);
    } else if (seqIdx < sequences.length - 1) {
      setSeqIdx((prev) => prev + 1);
      setMomentIdx(0);
      setProgress(0);
    } else {
      onOpenChange(false);
    }
  }, [currentSequence, momentIdx, seqIdx, sequences.length, onOpenChange]);

  const stepBack = useCallback(() => {
    if (momentIdx > 0) {
      setMomentIdx((prev) => prev - 1);
      setProgress(0);
    } else if (seqIdx > 0) {
      const prevSeq = sequences[seqIdx - 1];
      setSeqIdx((prev) => prev - 1);
      setMomentIdx(prevSeq ? prevSeq.moments.length - 1 : 0);
      setProgress(0);
    }
  }, [momentIdx, seqIdx, sequences]);

  // Timer progression for stories
  useEffect(() => {
    if (
      !open ||
      !currentMoment ||
      isPaused ||
      repingModalOpen ||
      highlightDialogOpen ||
      activityDialogOpen ||
      boostDialogOpen ||
      clipDialogOpen
    ) {
      return;
    }

    const durationSeconds =
      currentMoment.media_type === "video" && videoDurationSec
        ? Math.max(3, Math.min(60, videoDurationSec))
        : currentMoment.duration || 5;
    const intervalMs = 50;
    const step = 100 / ((durationSeconds * 1000) / intervalMs);

    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          advanceNext();
          return 0;
        }
        return prev + step;
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [
    open,
    currentMoment,
    isPaused,
    repingModalOpen,
    highlightDialogOpen,
    activityDialogOpen,
    boostDialogOpen,
    clipDialogOpen,
    videoDurationSec,
    advanceNext,
  ]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") advanceNext();
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") stepBack();
      if (e.key === "Escape") onOpenChange(false);
      if (e.key === " ") {
        e.preventDefault();
        setIsPaused((p) => !p);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, advanceNext, stepBack, onOpenChange]);

  if (!currentSequence || !currentMoment) return null;

  const handleLike = () => {
    if (!user) {
      toast.error("Sign in to like moments");
      return;
    }
    likeMutation.mutate({ momentId: currentMoment.id });
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    if (!user) {
      toast.error("Sign in to reply");
      return;
    }

    try {
      await replyMutation.mutateAsync({
        momentId: currentMoment.id,
        recipientId: currentMoment.author_id,
        message: replyText.trim(),
      });
      toast.success("Private reply sent to creator");
      setReplyText("");
    } catch {
      toast.error("Failed to send reply");
    }
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/@${currentMoment.author?.username}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Moment link copied to clipboard");
    } catch {
      toast.error("Couldn't copy link");
    }
  };

  const handleAddToHighlight = async (targetHighlightId: string) => {
    try {
      await addHighlightItemMutation.mutateAsync({
        highlightId: targetHighlightId,
        momentId: currentMoment.id,
      });
      toast.success("Moment saved to Highlight!");
      setHighlightDialogOpen(false);
    } catch {
      toast.error("Could not add moment to highlight.");
    }
  };

  const handleRemoveFromHighlight = async () => {
    if (!highlightId) return;
    try {
      await removeHighlightItemMutation.mutateAsync({
        highlightId,
        momentId: currentMoment.id,
      });
      toast.success("Removed moment from Highlight");
      advanceNext();
    } catch {
      toast.error("Could not remove moment from Highlight.");
    }
  };

  const handleCreateAndAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHighlightTitle.trim()) return;
    try {
      const newHl = await createHighlightMutation.mutateAsync({
        title: newHighlightTitle.trim(),
      });
      if (newHl?.id) {
        await addHighlightItemMutation.mutateAsync({
          highlightId: newHl.id,
          momentId: currentMoment.id,
        });
      }
      toast.success("Created highlight and saved moment!");
      setNewHighlightTitle("");
      setHighlightDialogOpen(false);
    } catch {
      toast.error("Failed to create highlight.");
    }
  };

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(currentMoment.id);
      toast.success("Moment deleted");
      advanceNext();
    } catch {
      toast.error("Failed to delete moment");
    }
  };

  const handleZoneTap = (direction: "prev" | "next") => {
    const heldMs = performance.now() - pointerDownAtRef.current;
    if (heldMs > 220) return; // Was a hold-to-pause gesture, do not skip slide
    if (direction === "prev") stepBack();
    else advanceNext();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="fixed inset-0 left-0 top-0 translate-x-0 translate-y-0 z-50 flex h-full w-full max-w-none items-center justify-center border-none bg-black/95 p-0 sm:left-[50%] sm:top-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:max-w-md sm:h-[90vh] sm:rounded-3xl sm:border sm:border-white/10 sm:overflow-hidden [&>button:last-child]:hidden">
        <DialogTitle className="sr-only">
          Moment by {currentSequence.author.display_name || currentSequence.author.username}
        </DialogTitle>
        <DialogDescription className="sr-only">Interactive 24-hour story viewer</DialogDescription>

        <div className="relative flex h-full w-full flex-col justify-between overflow-hidden bg-black select-none">
          {/* Progress Bars */}
          <div className="absolute top-0 inset-x-0 z-30 flex items-center gap-1.5 p-3">
            {currentSequence.moments.map((m, idx) => {
              const isPassed = idx < momentIdx;
              const isCurrent = idx === momentIdx;
              return (
                <div key={m.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
                  <div
                    className="h-full bg-white transition-all duration-75"
                    style={{
                      width: isPassed ? "100%" : isCurrent ? `${progress}%` : "0%",
                    }}
                  />
                </div>
              );
            })}
          </div>

          {/* Top Header */}
          <header className="absolute top-5 inset-x-0 z-30 flex items-center justify-between px-4 text-white">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-full bg-black/45 p-1.5 text-white/90 hover:bg-black/65 transition-colors shrink-0"
                aria-label="Back to previous screen"
              >
                <ArrowLeft className="size-4" />
              </button>
              <FounderAvatar
                name={currentSequence.author.display_name || currentSequence.author.username}
                src={currentSequence.author.avatar_url}
                size="sm"
              />
              <div className="text-xs min-w-0">
                <div className="flex items-center gap-1 min-w-0">
                  <Link
                    to="/@{$username}"
                    params={{ username: currentSequence.author.username }}
                    onClick={() => onOpenChange(false)}
                    className="font-bold text-white hover:underline flex items-center gap-1 truncate"
                  >
                    <span className="truncate">
                      {currentSequence.author.display_name || currentSequence.author.username}
                    </span>
                    <span className="font-normal text-white/70 shrink-0">
                      @{currentSequence.author.username}
                    </span>
                  </Link>
                  <VerificationBadge userId={currentMoment.author_id} size="xs" />
                </div>

                <div className="flex items-center gap-1.5 text-[10px] text-white/70">
                  {activeBoost && <PromotedBadge campaignId={activeBoost.id} />}
                  {currentMoment.audience === "hub" ? (
                    <span className="inline-flex items-center gap-0.5 rounded bg-white/20 px-1.5 py-0.5 text-white">
                      <Users className="size-2.5" />
                      {currentMoment.hub?.name || "Hub Moment"}
                    </span>
                  ) : currentMoment.audience === "close_circle" ? (
                    <span className="inline-flex items-center gap-0.5 rounded bg-black/65 border border-[#c7f36b]/40 px-1.5 py-0.5 text-[#c7f36b] font-semibold">
                      <Lock className="size-2.5" /> Close Circle
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5">
                      <Globe className="size-2.5" />{" "}
                      {currentMoment.audience === "followers" ? "Followers" : "Public"}
                    </span>
                  )}
                  {currentMoment.location && (
                    <>
                      <span>•</span>
                      <span className="truncate">{currentMoment.location}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsPaused((p) => !p)}
                className="rounded-full bg-black/45 p-2 text-white/90 hover:bg-black/65 transition-colors"
                aria-label={isPaused ? "Resume Moment" : "Pause Moment"}
              >
                {isPaused ? <Play className="size-4" /> : <Pause className="size-4" />}
              </button>

              {currentMoment.media_type === "video" && (
                <button
                  type="button"
                  onClick={() => setIsMuted((m) => !m)}
                  className="rounded-full bg-black/45 p-2 text-white/90 hover:bg-black/65 transition-colors"
                  aria-label={isMuted ? "Unmute video" : "Mute video"}
                >
                  {isMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                </button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger
                  className="rounded-full bg-black/45 p-2 text-white/90 hover:bg-black/65 focus:outline-none"
                  aria-label="Moment options"
                >
                  <MoreVertical className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-52 rounded-2xl bg-[#171b18] border-white/15 text-[#f4f2e9]"
                >
                  <DropdownMenuItem onClick={handleShare} className="rounded-xl">
                    <Share2 className="size-4 mr-2" /> Share Moment
                  </DropdownMenuItem>
                  {isOwner ? (
                    <>
                      <DropdownMenuItem
                        onClick={() => setActivityDialogOpen(true)}
                        className="rounded-xl"
                      >
                        <Eye className="size-4 mr-2 text-[#c7f36b]" /> Viewers &amp; Replies
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setHighlightDialogOpen(true)}
                        className="rounded-xl"
                      >
                        <Sparkles className="size-4 mr-2 text-[#c7f36b]" /> Add to Highlights
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setBoostDialogOpen(true)}
                        className="rounded-xl text-[#d8b66a]"
                      >
                        <Megaphone className="size-4 mr-2" /> Boost Moment with DOT
                      </DropdownMenuItem>
                      {currentMoment.media_type === "video" && (
                        <DropdownMenuItem
                          onClick={() => setClipDialogOpen(true)}
                          className="rounded-xl text-[#c7f36b]"
                        >
                          <Clapperboard className="size-4 mr-2" /> Republish as Ping Clip
                        </DropdownMenuItem>
                      )}
                      {highlightId && (
                        <DropdownMenuItem
                          onClick={handleRemoveFromHighlight}
                          className="rounded-xl text-amber-400"
                        >
                          <Trash2 className="size-4 mr-2" /> Remove from Highlight
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={handleDelete}
                        className="rounded-xl text-destructive focus:text-destructive"
                      >
                        <Trash2 className="size-4 mr-2" /> Delete Moment
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => {
                        toast.success(
                          "Moment flagged for moderation review. Thanks for keeping Ping safe.",
                        );
                      }}
                      className="rounded-xl text-destructive focus:text-destructive"
                    >
                      <Flag className="size-4 mr-2" /> Report Moment
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-full bg-black/45 p-2 text-white/90 hover:bg-black/65 transition-colors"
                aria-label="Close viewer"
              >
                <X className="size-4" />
              </button>
            </div>
          </header>

          {/* Media Container & Vertical + Horizontal Gesture Layer */}
          <div
            className="relative flex-1 flex items-center justify-center overflow-hidden"
            onPointerDown={() => {
              pointerDownAtRef.current = performance.now();
              setIsPaused(true);
            }}
            onPointerUp={() => setIsPaused(false)}
            onPointerCancel={() => setIsPaused(false)}
            onTouchStart={(e) => {
              touchStartYRef.current = e.touches[0]?.clientY ?? null;
            }}
            onTouchEnd={(e) => {
              const startY = touchStartYRef.current;
              const endY = e.changedTouches[0]?.clientY ?? null;
              touchStartYRef.current = null;
              if (startY !== null && endY !== null) {
                const dy = startY - endY;
                if (dy > 55) advanceNext();
                else if (dy < -55) stepBack();
              }
            }}
          >
            {/* Left Tap Zone */}
            <div
              className="absolute left-0 inset-y-0 w-1/3 z-20 cursor-pointer"
              onClick={() => handleZoneTap("prev")}
            />
            {/* Right Tap Zone */}
            <div
              className="absolute right-0 inset-y-0 w-1/3 z-20 cursor-pointer"
              onClick={() => handleZoneTap("next")}
            />

            {currentMoment.media_type === "video" ? (
              <video
                ref={videoRef}
                src={currentMoment.media_url}
                autoPlay
                playsInline
                muted={isMuted}
                loop={false}
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration;
                  if (Number.isFinite(d) && d > 0) setVideoDurationSec(d);
                }}
                onEnded={advanceNext}
                className="h-full w-full object-contain"
              />
            ) : (
              <img
                src={currentMoment.media_url}
                alt="Moment content"
                className="h-full w-full object-contain"
              />
            )}

            {currentMoment.overlay_text && (
              <div className="absolute inset-x-6 top-1/3 text-center pointer-events-none z-10">
                <span className="inline-block rounded-xl bg-black/60 px-4 py-2 font-display text-lg font-bold text-white shadow-lg backdrop-blur-sm">
                  {currentMoment.overlay_text}
                </span>
              </div>
            )}

            {currentMoment.stickers &&
              currentMoment.stickers.map((stk) => (
                <div
                  key={stk.id}
                  className="absolute pointer-events-none z-10 text-3xl select-none"
                  style={{
                    left: `${stk.x}%`,
                    top: `${stk.y}%`,
                    transform: `scale(${stk.scale || 1}) rotate(${stk.rotation || 0}deg)`,
                  }}
                >
                  {stk.emoji}
                </div>
              ))}
          </div>

          {/* Right-Side Vertical Interaction Rail (Reference Image 2) */}
          <div
            className="absolute right-3 bottom-24 z-30 flex flex-col items-center gap-3 text-white"
            aria-label="Moment actions"
          >
            <button
              type="button"
              onClick={stepBack}
              className="flex size-9 items-center justify-center rounded-full bg-black/50 text-white/80 backdrop-blur-md hover:bg-black/70"
              aria-label="Previous Moment"
            >
              <ChevronUp className="size-4" />
            </button>

            <button
              type="button"
              onClick={handleLike}
              className="flex flex-col items-center gap-0.5"
              aria-label="Like Moment"
            >
              <span className="flex size-11 items-center justify-center rounded-full bg-black/55 backdrop-blur-md hover:bg-black/75 transition-transform active:scale-95">
                <Heart
                  className={cn(
                    "size-5",
                    currentMoment.has_liked ? "fill-red-500 text-red-500" : "text-white",
                  )}
                />
              </span>
              <span className="text-[11px] font-bold tabular-nums drop-shadow">
                {currentMoment.like_count}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (isOwner) setActivityDialogOpen(true);
                else replyInputRef.current?.focus();
              }}
              className="flex flex-col items-center gap-0.5"
              aria-label="Comment on Moment"
            >
              <span className="flex size-11 items-center justify-center rounded-full bg-black/55 backdrop-blur-md hover:bg-black/75 transition-transform active:scale-95">
                <MessageSquare className="size-5 text-white" />
              </span>
              <span className="text-[11px] font-bold tabular-nums drop-shadow">
                {currentMoment.reply_count}
              </span>
            </button>

            {currentMoment.allow_repings && (
              <button
                type="button"
                onClick={() => setRepingModalOpen(true)}
                className="flex flex-col items-center gap-0.5"
                aria-label="Re-Ping Moment"
              >
                <span className="flex size-11 items-center justify-center rounded-full bg-black/55 backdrop-blur-md hover:bg-black/75 transition-transform active:scale-95">
                  <Repeat2 className="size-5 text-white" />
                </span>
                <span className="text-[11px] font-bold tabular-nums drop-shadow">
                  {currentMoment.reping_count}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={handleShare}
              className="flex flex-col items-center gap-0.5"
              aria-label="Share Moment"
            >
              <span className="flex size-11 items-center justify-center rounded-full bg-black/55 backdrop-blur-md hover:bg-black/75 transition-transform active:scale-95">
                <Share2 className="size-5 text-white" />
              </span>
              <span className="text-[10px] font-semibold drop-shadow">Share</span>
            </button>

            <button
              type="button"
              onClick={advanceNext}
              className="flex size-9 items-center justify-center rounded-full bg-black/50 text-white/80 backdrop-blur-md hover:bg-black/70"
              aria-label="Next Moment"
            >
              <ChevronDown className="size-4" />
            </button>
          </div>

          {/* Captions & Mentions Banner */}
          {(currentMoment.caption ||
            (currentMoment.mentions && currentMoment.mentions.length > 0)) && (
            <div className="absolute bottom-20 inset-x-0 z-20 pl-4 pr-16 py-2 bg-gradient-to-t from-black/85 via-black/45 to-transparent text-white">
              {currentMoment.caption && (
                <p className="text-sm font-medium leading-relaxed drop-shadow-sm">
                  {currentMoment.caption}
                </p>
              )}
              {currentMoment.mentions && currentMoment.mentions.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-[#c7f36b] font-semibold">
                  {currentMoment.mentions.map((m) => (
                    <Link
                      key={m}
                      to="/@{$username}"
                      params={{ username: m }}
                      onClick={() => onOpenChange(false)}
                      className="hover:underline"
                    >
                      @{m}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Bottom Action Controls */}
          <footer className="relative z-30 flex items-center gap-2 p-3 bg-black/70 backdrop-blur-md border-t border-white/10 text-white">
            {currentMoment.allow_comments && !isOwner && (
              <form onSubmit={handleSendReply} className="flex-1 flex items-center gap-2">
                <Input
                  ref={replyInputRef}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onFocus={() => setIsPaused(true)}
                  onBlur={() => setIsPaused(false)}
                  placeholder={`Reply to @${currentSequence.author.username}…`}
                  className="h-9 rounded-full !bg-white/15 !border-white/15 text-xs !text-white placeholder:!text-white/60 focus-visible:ring-1 focus-visible:ring-[#c7f36b]"
                />
                <Button
                  type="submit"
                  size="icon"
                  variant="ghost"
                  disabled={!replyText.trim() || replyMutation.isPending}
                  className="size-8 rounded-full text-white hover:bg-white/20 shrink-0"
                  aria-label="Send reply"
                >
                  <Send className="size-3.5" />
                </Button>
              </form>
            )}

            {isOwner && (
              <button
                type="button"
                onClick={() => setActivityDialogOpen(true)}
                className="flex-1 flex items-center gap-2 rounded-full bg-white/10 hover:bg-white/20 px-3.5 py-1.5 text-xs text-white transition-colors text-left"
              >
                <Eye className="size-4 text-[#c7f36b]" />
                <span>{currentMoment.view_count} views</span>
                <span className="text-white/40">·</span>
                <MessageSquare className="size-3.5" />
                <span>{currentMoment.reply_count} replies</span>
              </button>
            )}

            {/* Like Action */}
            <button
              type="button"
              onClick={handleLike}
              className="flex items-center gap-1 rounded-full bg-white/15 px-3 py-1.5 text-xs text-white hover:bg-white/25 transition-colors"
              aria-label="Like moment"
            >
              <Heart
                className={cn(
                  "size-4",
                  currentMoment.has_liked ? "fill-red-500 text-red-500" : "text-white",
                )}
              />
              <span>{currentMoment.like_count}</span>
            </button>

            {/* Re-Ping Action */}
            {currentMoment.allow_repings && (
              <button
                type="button"
                onClick={() => setRepingModalOpen(true)}
                className="flex items-center gap-1 rounded-full bg-white/15 px-3 py-1.5 text-xs text-white hover:bg-white/25 transition-colors"
                title="Re-Ping Moment"
              >
                <Repeat2 className="size-4" />
                {currentMoment.reping_count > 0 && <span>{currentMoment.reping_count}</span>}
              </button>
            )}

            {/* Share */}
            <button
              type="button"
              onClick={handleShare}
              className="rounded-full bg-white/15 p-2 text-white hover:bg-white/25 transition-colors"
              title="Share Moment"
            >
              <Share2 className="size-4" />
            </button>
          </footer>
        </div>

        {/* Add to Highlights Dialog */}
        <Dialog open={highlightDialogOpen} onOpenChange={setHighlightDialogOpen}>
          <DialogContent className="sm:max-w-md rounded-3xl p-6 bg-card text-card-foreground">
            <div className="flex items-center gap-2 text-primary font-bold text-sm">
              <Sparkles className="size-4" />
              <span>Save to Highlights</span>
            </div>
            <DialogTitle className="font-display text-lg font-bold mt-1">
              Keep this moment permanently
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Choose an existing Highlight or create a new collection.
            </DialogDescription>

            <div className="mt-4 space-y-2 max-h-48 overflow-y-auto">
              {userHighlights.map((hl) => (
                <button
                  key={hl.id}
                  type="button"
                  onClick={() => handleAddToHighlight(hl.id)}
                  className="w-full flex items-center justify-between p-3 rounded-2xl bg-secondary/50 hover:bg-secondary border border-border/50 text-xs font-semibold text-left transition-colors"
                >
                  <span className="truncate flex items-center gap-1.5">
                    {hl.is_private && <Lock className="size-3 text-muted-foreground" />}
                    {hl.title}
                  </span>
                  <Plus className="size-3.5 text-primary" />
                </button>
              ))}
            </div>

            <form
              onSubmit={handleCreateAndAdd}
              className="mt-4 pt-3 border-t border-border flex gap-2"
            >
              <Input
                value={newHighlightTitle}
                onChange={(e) => setNewHighlightTitle(e.target.value)}
                placeholder="New Highlight name…"
                className="h-9 rounded-xl text-xs flex-1"
              />
              <Button
                type="submit"
                size="sm"
                variant="hero"
                className="rounded-xl h-9 text-xs px-3"
              >
                Create &amp; Add
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        {/* Owner Moment Insights / Viewers & Replies Dialog */}
        <Dialog open={activityDialogOpen} onOpenChange={setActivityDialogOpen}>
          <DialogContent className="sm:max-w-md rounded-3xl p-6 bg-card text-card-foreground max-h-[80vh] overflow-y-auto">
            <DialogTitle className="font-display text-lg font-bold flex items-center gap-2">
              <Eye className="size-4 text-primary" /> Moment Activity
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Private viewers and replies on your Moment.
            </DialogDescription>

            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-2xl bg-secondary/50 p-3">
                <p className="font-display text-lg font-bold">{currentMoment.view_count}</p>
                <p className="text-[11px] text-muted-foreground">Views</p>
              </div>
              <div className="rounded-2xl bg-secondary/50 p-3">
                <p className="font-display text-lg font-bold">{currentMoment.like_count}</p>
                <p className="text-[11px] text-muted-foreground">Likes</p>
              </div>
              <div className="rounded-2xl bg-secondary/50 p-3">
                <p className="font-display text-lg font-bold">{currentMoment.reping_count}</p>
                <p className="text-[11px] text-muted-foreground">Re-Pings</p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Private Replies ({activity?.replies.length ?? 0})
              </h4>
              {activity && activity.replies.length > 0 ? (
                <div className="space-y-2">
                  {activity.replies.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-2xl border border-border/60 bg-secondary/30 p-3 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold">
                          {r.sender?.display_name || `@${r.sender?.username || "builder"}`}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatDistanceToNowStrict(new Date(r.created_at))} ago
                        </span>
                      </div>
                      <p className="mt-1 text-foreground">{r.message}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No private replies yet.</p>
              )}

              <h4 className="pt-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Viewers ({activity?.views.length ?? 0})
              </h4>
              {activity && activity.views.length > 0 ? (
                <div className="space-y-1.5">
                  {activity.views.map((v) => (
                    <Link
                      key={v.id}
                      to="/@{$username}"
                      params={{ username: v.viewer?.username ?? "" }}
                      onClick={() => {
                        setActivityDialogOpen(false);
                        onOpenChange(false);
                      }}
                      className="flex items-center justify-between rounded-xl p-2 hover:bg-secondary/50 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FounderAvatar
                          name={v.viewer?.display_name || v.viewer?.username || "Builder"}
                          src={v.viewer?.avatar_url}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate">
                            {v.viewer?.display_name || v.viewer?.username}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            @{v.viewer?.username}
                          </p>
                        </div>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {formatDistanceToNowStrict(new Date(v.viewed_at))} ago
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No recorded views yet.</p>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Re-Ping Dialog */}
        <RePingModal
          moment={currentMoment}
          open={repingModalOpen}
          onOpenChange={setRepingModalOpen}
        />

        {/* Boost Moment Dialog */}
        {isOwner && (
          <>
            <BoostContentDialog
              open={boostDialogOpen}
              onOpenChange={setBoostDialogOpen}
              target={{
                contentType: "moment",
                contentId: currentMoment.id,
                previewText:
                  currentMoment.caption ||
                  currentMoment.overlay_text ||
                  `Moment by @${currentSequence.author.username}`,
                momentExpiresAt: currentMoment.expires_at,
                momentAudience: currentMoment.audience,
              }}
            />
            <MomentToClipDialog
              moment={currentMoment}
              open={clipDialogOpen}
              onOpenChange={setClipDialogOpen}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
