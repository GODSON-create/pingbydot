import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Captions,
  Eye,
  Flag,
  MessageCircle,
  Pause,
  Play,
  Repeat2,
  Share2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { toast } from "sonner";
import { FounderAvatar } from "@/components/ping/Avatar";
import { LikeButton } from "@/components/ping/PingActions";
import { PingReactionBar } from "@/components/ping/PingReactionBar";
import { MusicAttachmentBar } from "@/components/music/MusicAttachmentBar";
import { UniversalShareDialog } from "@/components/sharing/UniversalShareDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { replyCount, type Ping } from "@/lib/pings";
import {
  collectPingMediaUrls,
  isVideoMediaUrl,
  readLocalVideoViewCount,
  recordPingVideoView,
  useSubmitCopyrightReport,
  type CopyrightClaimType,
} from "@/lib/media-pipeline";
import { parseStructuredPing } from "@/lib/validation";

export function VideoFeedPlayer({
  ping,
  autoplay,
}: {
  ping: Ping & { poster_url?: string | null; captions_text?: string | null };
  autoplay: boolean;
}) {
  const { user } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [showCaptions, setShowCaptions] = useState(true);
  const [views, setViews] = useState(() => readLocalVideoViewCount(ping.id));
  const [shareOpen, setShareOpen] = useState(false);
  const [copyrightOpen, setCopyrightOpen] = useState(false);
  const [claimType, setClaimType] = useState<CopyrightClaimType>("copyright");
  const [rightsOwner, setRightsOwner] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [claimDetails, setClaimDetails] = useState("");

  const viewRecordedRef = useRef(false);
  const submitCopyright = useSubmitCopyrightReport(user?.id);

  const mediaUrls = collectPingMediaUrls(ping);
  const videoUrl = mediaUrls.find((u) => isVideoMediaUrl(u));
  const structured = parseStructuredPing(ping);
  const authorName = ping.author?.display_name || ping.author?.username || "Creator";

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (autoplay) {
      el.muted = true;
      el.play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    }
  }, [autoplay]);

  if (!videoUrl) return null;

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      el.play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    } else {
      el.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = () => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  };

  const handlePlayStarted = () => {
    setIsPlaying(true);
    if (!viewRecordedRef.current) {
      viewRecordedRef.current = true;
      void recordPingVideoView({ pingId: ping.id, watchSeconds: 3, completed: false })
        .then((nextCount) => setViews(nextCount))
        .catch(() => {});
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    const dur = videoRef.current?.duration;
    void recordPingVideoView({
      pingId: ping.id,
      watchSeconds: Number.isFinite(dur) ? Math.round(dur!) : 10,
      completed: true,
    })
      .then((nextCount) => setViews(nextCount))
      .catch(() => {});
  };

  const handleCopyrightSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      toast.error("Sign in to submit a copyright or ownership report.");
      return;
    }
    try {
      await submitCopyright.mutateAsync({
        targetType: "ping",
        targetId: ping.id,
        claimType,
        rightsOwnerName: rightsOwner,
        evidenceUrl: evidenceUrl || undefined,
        details: claimDetails,
      });
      toast.success("Copyright / ownership report submitted for review.");
      setCopyrightOpen(false);
      setRightsOwner("");
      setEvidenceUrl("");
      setClaimDetails("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit report.");
    }
  };

  return (
    <article className="surface-card rounded-3xl overflow-hidden border border-border/70">
      {/* Immersive Video Stage */}
      <div className="relative bg-black aspect-[9/12] sm:aspect-video max-h-[70dvh] w-full flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          src={videoUrl}
          poster={ping.poster_url ?? undefined}
          muted={muted}
          playsInline
          loop={false}
          preload="metadata"
          onPlay={handlePlayStarted}
          onPause={() => setIsPlaying(false)}
          onEnded={handleEnded}
          onClick={togglePlay}
          className="h-full w-full object-contain cursor-pointer"
        />

        {/* Captions Overlay */}
        {showCaptions && (ping.captions_text || structured.headline) && (
          <div className="pointer-events-none absolute inset-x-4 bottom-14 flex justify-center">
            <p className="rounded-xl bg-black/75 px-3 py-1.5 text-center text-xs text-white max-w-md backdrop-blur-sm">
              {ping.captions_text || structured.headline}
            </p>
          </div>
        )}

        {/* Controls Strip */}
        <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={isPlaying ? "Pause video" : "Play video"}
              className="flex size-9 items-center justify-center rounded-full bg-black/65 text-white hover:bg-black/85 backdrop-blur-sm"
            >
              {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
            </button>
            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? "Unmute video" : "Mute video"}
              className="flex size-9 items-center justify-center rounded-full bg-black/65 text-white hover:bg-black/85 backdrop-blur-sm"
            >
              {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </button>
            <button
              type="button"
              onClick={() => setShowCaptions((prev) => !prev)}
              aria-label={showCaptions ? "Hide captions" : "Show captions"}
              className="flex size-9 items-center justify-center rounded-full bg-black/65 text-white hover:bg-black/85 backdrop-blur-sm"
            >
              <Captions className={showCaptions ? "size-4 text-primary" : "size-4"} />
            </button>
          </div>

          <span className="inline-flex items-center gap-1 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
            <Eye className="size-3.5" /> {views} {views === 1 ? "view" : "views"}
          </span>
        </div>
      </div>

      {/* Creator & Engagement Panel */}
      <div className="p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          {ping.author ? (
            <Link
              to="/@{$username}"
              params={{ username: ping.author.username }}
              className="flex items-center gap-2.5 min-w-0"
            >
              <FounderAvatar name={authorName} src={ping.author.avatar_url} size="sm" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground truncate hover:underline">
                  {authorName}
                </p>
                <p className="text-xs text-muted-foreground truncate">@{ping.author.username}</p>
              </div>
            </Link>
          ) : (
            <span className="text-sm font-bold">{authorName}</span>
          )}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 rounded-full text-xs text-muted-foreground gap-1"
            onClick={() => setCopyrightOpen(true)}
            title="Report copyright or ownership issue"
          >
            <Flag className="size-3.5" /> Rights
          </Button>
        </div>

        <p className="text-sm text-foreground/95 leading-relaxed line-clamp-3">{structured.body}</p>

        <MusicAttachmentBar targetType="ping" targetId={ping.id} />
        <PingReactionBar pingId={ping.id} />

        <div className="pt-2 border-t border-border/60 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <LikeButton ping={ping} />
            <Link
              to="/p/$id"
              params={{ id: ping.id }}
              hash="replies-title"
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <MessageCircle className="size-4" />
              <span>{replyCount(ping)}</span>
            </Link>
            <Link
              to="/create"
              search={{
                quote: `@${ping.author?.username ?? "creator"}: "${structured.body.slice(0, 100)}"`,
              }}
              className="inline-flex items-center justify-center rounded-full p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Re-ping video"
            >
              <Repeat2 className="size-4" />
            </Link>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-full text-xs gap-1.5"
            onClick={() => setShareOpen(true)}
          >
            <Share2 className="size-3.5" /> Share
          </Button>
        </div>
      </div>

      <UniversalShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        payload={{
          targetType: "ping",
          targetId: ping.id,
          title: structured.headline || `${authorName} on Ping`,
          description: structured.body.slice(0, 160),
          path: `/p/${ping.id}`,
        }}
      />

      {/* Copyright & Ownership Report Dialog */}
      <Dialog open={copyrightOpen} onOpenChange={setCopyrightOpen}>
        <DialogContent className="sm:max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-lg">
              Copyright &amp; Ownership Report
            </DialogTitle>
            <DialogDescription className="text-xs">
              Report unauthorized video, audio, or trademark usage for moderation review.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCopyrightSubmit} className="space-y-3 mt-2">
            <div>
              <Label htmlFor="cr-type" className="text-xs">
                Claim type
              </Label>
              <select
                id="cr-type"
                value={claimType}
                onChange={(e) => setClaimType(e.target.value as CopyrightClaimType)}
                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs"
              >
                <option value="copyright">Copyright infringement</option>
                <option value="unauthorized_audio">Unauthorized audio / music</option>
                <option value="trademark">Trademark violation</option>
                <option value="impersonation">Ownership / impersonation</option>
              </select>
            </div>
            <div>
              <Label htmlFor="cr-owner" className="text-xs">
                Rights holder / organization name
              </Label>
              <Input
                id="cr-owner"
                value={rightsOwner}
                onChange={(e) => setRightsOwner(e.target.value)}
                required
                minLength={2}
                className="mt-1 rounded-xl"
              />
            </div>
            <div>
              <Label htmlFor="cr-url" className="text-xs">
                Reference / proof URL (optional)
              </Label>
              <Input
                id="cr-url"
                type="url"
                value={evidenceUrl}
                onChange={(e) => setEvidenceUrl(e.target.value)}
                placeholder="https://…"
                className="mt-1 rounded-xl"
              />
            </div>
            <div>
              <Label htmlFor="cr-details" className="text-xs">
                Details
              </Label>
              <Textarea
                id="cr-details"
                rows={3}
                value={claimDetails}
                onChange={(e) => setClaimDetails(e.target.value)}
                required
                minLength={10}
                placeholder="Describe the original work and the unauthorized segment…"
                className="mt-1 rounded-xl"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => setCopyrightOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                className="rounded-full"
                disabled={submitCopyright.isPending}
              >
                {submitCopyright.isPending ? "Submitting…" : "Submit Report"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </article>
  );
}
