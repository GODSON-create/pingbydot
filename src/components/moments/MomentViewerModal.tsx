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
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FounderAvatar } from "@/components/ping/Avatar";
import {
  useViewMoment,
  useLikeMoment,
  useReplyMoment,
  useDeleteMoment,
  useAddMomentToHighlight,
  type CreatorMomentsSequence,
  type Moment,
} from "@/lib/moments";
import { useAuth } from "@/lib/auth";
import { RePingModal } from "./RePingModal";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

interface MomentViewerModalProps {
  sequences: CreatorMomentsSequence[];
  initialSequenceIndex?: number;
  initialMomentIndex?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MomentViewerModal({
  sequences,
  initialSequenceIndex = 0,
  initialMomentIndex = 0,
  open,
  onOpenChange,
}: MomentViewerModalProps) {
  const { user } = useAuth();
  const [seqIdx, setSeqIdx] = useState(initialSequenceIndex);
  const [momentIdx, setMomentIdx] = useState(initialMomentIndex);
  const [progress, setProgress] = useState(0); // 0 to 100
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [replyText, setReplyText] = useState("");
  const [repingModalOpen, setRepingModalOpen] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewMutation = useViewMoment();
  const likeMutation = useLikeMoment();
  const replyMutation = useReplyMoment();
  const deleteMutation = useDeleteMoment();

  const currentSequence = sequences[seqIdx];
  const currentMoment: Moment | undefined = currentSequence?.moments[momentIdx];

  // Sync initial indices when opened
  useEffect(() => {
    if (open) {
      setSeqIdx(initialSequenceIndex);
      setMomentIdx(initialMomentIndex);
      setProgress(0);
      setIsPaused(false);
    }
  }, [open, initialSequenceIndex, initialMomentIndex]);

  // Record view
  useEffect(() => {
    if (open && currentMoment && user && currentMoment.author_id !== user.id) {
      viewMutation.mutate(currentMoment.id);
    }
  }, [open, currentMoment?.id, user]);

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
      // Completed all moments
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
    if (!open || !currentMoment || isPaused || repingModalOpen) return;

    const durationSeconds = currentMoment.duration || 5;
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
  }, [open, currentMoment, isPaused, repingModalOpen, advanceNext]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") advanceNext();
      if (e.key === "ArrowLeft") stepBack();
      if (e.key === "Escape") onOpenChange(false);
      if (e.key === " ") setIsPaused((p) => !p);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, advanceNext, stepBack, onOpenChange]);

  if (!currentSequence || !currentMoment) return null;

  const isOwner = user?.id === currentMoment.author_id;

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
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      toast.success("Moment link copied to clipboard");
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="fixed inset-0 z-50 flex h-full w-full max-w-none items-center justify-center border-none bg-black/95 p-0 sm:max-w-md sm:h-[90vh] sm:rounded-3xl sm:border sm:border-white/10 sm:overflow-hidden">
        <div className="relative flex h-full w-full flex-col justify-between overflow-hidden bg-black select-none">
          {/* Progress Bars for Creator's Moments */}
          <div className="absolute top-0 inset-x-0 z-30 flex items-center gap-1.5 p-3">
            {currentSequence.moments.map((m, idx) => {
              const isPassed = idx < momentIdx;
              const isCurrent = idx === momentIdx;
              return (
                <div
                  key={m.id}
                  className="h-1 flex-1 overflow-hidden rounded-full bg-white/25"
                >
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

          {/* Top Header: Creator Profile & Close */}
          <header className="absolute top-5 inset-x-0 z-30 flex items-center justify-between px-4 text-white">
            <div className="flex items-center gap-2.5">
              <FounderAvatar
                name={currentSequence.author.display_name || currentSequence.author.username}
                src={currentSequence.author.avatar_url}
                size="sm"
              />
              <div className="text-xs">
                <Link
                  to="/@{$username}"
                  params={{ username: currentSequence.author.username }}
                  className="font-bold text-white hover:underline flex items-center gap-1"
                >
                  {currentSequence.author.display_name || currentSequence.author.username}
                  <span className="font-normal text-white/70">@{currentSequence.author.username}</span>
                </Link>

                <div className="flex items-center gap-1.5 text-[10px] text-white/60">
                  {currentMoment.audience === "hub" ? (
                    <span className="inline-flex items-center gap-0.5 rounded bg-white/20 px-1 py-0.2">
                      <Users className="size-2.5" />
                      {currentMoment.hub?.name || "Hub Moment"}
                    </span>
                  ) : currentMoment.audience === "close_circle" ? (
                    <span className="inline-flex items-center gap-0.5 rounded bg-primary/40 px-1 py-0.2 text-primary-foreground font-semibold">
                      <Lock className="size-2.5" /> Close Circle
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5">
                      <Globe className="size-2.5" /> Public
                    </span>
                  )}
                  {currentMoment.location && (
                    <>
                      <span>•</span>
                      <span>{currentMoment.location}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {currentMoment.media_type === "video" && (
                <button
                  type="button"
                  onClick={() => setIsMuted((m) => !m)}
                  className="rounded-full bg-black/40 p-2 text-white/90 hover:bg-black/60 transition-colors"
                >
                  {isMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                </button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger className="rounded-full bg-black/40 p-2 text-white/90 hover:bg-black/60 focus:outline-none">
                  <MoreVertical className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 rounded-2xl bg-neutral-900 border-white/10 text-white">
                  <DropdownMenuItem onClick={handleShare}>
                    <Share2 className="size-4 mr-2" /> Share Moment
                  </DropdownMenuItem>
                  {isOwner && (
                    <DropdownMenuItem onClick={handleDelete} className="text-destructive">
                      <Trash2 className="size-4 mr-2" /> Delete Moment
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-full bg-black/40 p-2 text-white/90 hover:bg-black/60 transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>
          </header>

          {/* Media Container & Gesture Layer */}
          <div
            className="relative flex-1 flex items-center justify-center overflow-hidden"
            onMouseDown={() => setIsPaused(true)}
            onMouseUp={() => setIsPaused(false)}
            onTouchStart={() => setIsPaused(true)}
            onTouchEnd={() => setIsPaused(false)}
          >
            {/* Left Tap Zone */}
            <div
              className="absolute left-0 inset-y-0 w-1/3 z-20 cursor-pointer"
              onClick={stepBack}
            />
            {/* Right Tap Zone */}
            <div
              className="absolute right-0 inset-y-0 w-1/3 z-20 cursor-pointer"
              onClick={advanceNext}
            />

            {/* Media Rendering */}
            {currentMoment.media_type === "video" ? (
              <video
                ref={videoRef}
                src={currentMoment.media_url}
                autoPlay
                playsInline
                muted={isMuted}
                loop
                className="h-full w-full object-contain"
              />
            ) : (
              <img
                src={currentMoment.media_url}
                alt="Moment content"
                className="h-full w-full object-contain"
              />
            )}

            {/* Overlays / Stickers */}
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

          {/* Captions & Mentions Banner */}
          {currentMoment.caption && (
            <div className="absolute bottom-20 inset-x-0 z-20 px-4 py-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent text-white">
              <p className="text-sm font-medium leading-relaxed drop-shadow-sm">
                {currentMoment.caption}
              </p>
              {currentMoment.mentions && currentMoment.mentions.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1 text-xs text-primary font-semibold">
                  {currentMoment.mentions.map((m) => (
                    <span key={m}>@{m}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Bottom Action Controls */}
          <footer className="relative z-30 flex items-center gap-2 p-3 bg-black/60 backdrop-blur-md border-t border-white/10 text-white">
            {/* Private Reply */}
            {currentMoment.allow_comments && !isOwner && (
              <form onSubmit={handleSendReply} className="flex-1 flex items-center gap-2">
                <Input
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onFocus={() => setIsPaused(true)}
                  onBlur={() => setIsPaused(false)}
                  placeholder={`Reply to @${currentSequence.author.username}…`}
                  className="h-9 rounded-full bg-white/15 border-none text-xs text-white placeholder:text-white/50 focus-visible:ring-1 focus-visible:ring-primary"
                />
                <Button
                  type="submit"
                  size="icon"
                  variant="ghost"
                  disabled={!replyText.trim()}
                  className="size-8 rounded-full text-white hover:bg-white/20 shrink-0"
                >
                  <Send className="size-3.5" />
                </Button>
              </form>
            )}

            {/* Like Action */}
            <button
              type="button"
              onClick={handleLike}
              className="flex items-center gap-1 rounded-full bg-white/15 px-3 py-1.5 text-xs text-white hover:bg-white/25 transition-colors"
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

        {/* Re-Ping Dialog */}
        <RePingModal
          moment={currentMoment}
          open={repingModalOpen}
          onOpenChange={setRepingModalOpen}
        />
      </DialogContent>
    </Dialog>
  );
}
