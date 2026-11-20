import { useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bookmark,
  Captions,
  Clapperboard,
  Eye,
  Flag,
  Heart,
  Loader2,
  MessageCircle,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Share2,
  Sparkles,
  Upload,
  UserCheck,
  UserPlus,
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
  recordObservedClipView,
  usePostClipReply,
  usePublishClip,
  useReportClip,
  useToggleClipLike,
  useToggleClipSave,
  type ClipVisibility,
  type PingClip,
} from "@/lib/clips";
import { userActiveMomentsQuery } from "@/lib/moments";
import { useGetOrCreateDirectConversation } from "@/lib/messages";
import { probeVideoFile, validateVideoFileMeta } from "@/lib/media-pipeline";
import { validateMediaUpload } from "@/lib/shield";
import { FounderAvatar } from "@/components/ping/Avatar";
import { AccountStatusBadges } from "@/components/badges/AccountStatusBadges";
import { RichPingText } from "@/components/ping/RichPingText";
import { UniversalShareDialog } from "@/components/sharing/UniversalShareDialog";
import { MomentToClipDialog } from "@/components/clips/MomentToClipDialog";
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
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/clips")({
  staticData: { sitemap: true },
  head: () =>
    pageHead({
      title: "Ping Clips — Short-Form Vertical Founder Videos",
      description:
        "Discover persistent short-form vertical videos from founders, creators, and Ping Spotlight honorees.",
      path: "/clips",
    }),
  component: PingClipsPage,
});

function VerticalClipCard({ clip }: { clip: PingClip }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewLoggedRef = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [showCaptions, setShowCaptions] = useState(true);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [followingCreator, setFollowingCreator] = useState(false);
  const [followPending, setFollowPending] = useState(false);
  const [views, setViews] = useState(clip.views_count);
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [replyDraft, setReplyDraft] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");

  const toggleLike = useToggleClipLike(user?.id);
  const toggleSave = useToggleClipSave(user?.id);
  const postReply = usePostClipReply(user?.id);
  const reportClip = useReportClip(user?.id);
  const startChat = useGetOrCreateDirectConversation();
  const { data: replies = [] } = useQuery(clipRepliesQuery(repliesOpen ? clip.id : undefined));

  const creatorName = clip.creator?.display_name || clip.creator?.username || "Founder";
  const isOwner = Boolean(user?.id && user.id === clip.creator_id);

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      el.play()
        .then(() => {
          setPlaying(true);
          if (!viewLoggedRef.current) {
            viewLoggedRef.current = true;
            setViews((v) => v + 1);
            void recordObservedClipView(clip.id);
          }
        })
        .catch(() => setPlaying(false));
    } else {
      el.pause();
      setPlaying(false);
    }
  };

  return (
    <article
      data-testid={`clip-card-${clip.id}`}
      className="surface-card rounded-3xl overflow-hidden border border-border/70 flex flex-col"
    >
      {/* Vertical 9:16 Video Stage */}
      <div className="relative bg-black aspect-[9/16] max-h-[68dvh] w-full flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          src={clip.video_url}
          poster={clip.poster_url ?? undefined}
          muted={muted}
          playsInline
          loop
          preload="metadata"
          onClick={togglePlay}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          className="h-full w-full object-cover cursor-pointer"
        />

        {/* Source Moment Attribution Pill (if converted from a Moment) */}
        {clip.source_moment_id && (
          <span className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-black/65 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
            <Sparkles className="size-3 text-lime" /> Republished from Moment
          </span>
        )}

        {/* Views counter */}
        <span className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-black/65 px-2.5 py-1 text-[10px] font-semibold text-white tabular-nums backdrop-blur-sm">
          <Eye className="size-3" /> {views}
        </span>

        {/* Captions Overlay */}
        {showCaptions && clip.captions_text && (
          <div className="pointer-events-none absolute inset-x-4 bottom-16 flex justify-center">
            <p className="rounded-xl bg-black/75 px-3 py-1.5 text-center text-xs text-white backdrop-blur-sm">
              {clip.captions_text}
            </p>
          </div>
        )}

        {/* Playback Controls Bar */}
        <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? "Pause Clip" : "Play Clip"}
              className="flex size-9 items-center justify-center rounded-full bg-black/65 text-white hover:bg-black/85 backdrop-blur-sm"
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </button>
            <button
              type="button"
              onClick={() => {
                if (videoRef.current) {
                  videoRef.current.muted = !muted;
                }
                setMuted((m) => !m);
              }}
              aria-label={muted ? "Unmute Clip" : "Mute Clip"}
              className="flex size-9 items-center justify-center rounded-full bg-black/65 text-white hover:bg-black/85 backdrop-blur-sm"
            >
              {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </button>
            <button
              type="button"
              onClick={() => setShowCaptions((c) => !c)}
              aria-label={showCaptions ? "Hide captions" : "Show captions"}
              className="flex size-9 items-center justify-center rounded-full bg-black/65 text-white hover:bg-black/85 backdrop-blur-sm"
            >
              <Captions className={showCaptions ? "size-4 text-primary" : "size-4"} />
            </button>
          </div>
          {clip.duration_sec && (
            <span className="rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-mono text-white">
              {clip.duration_sec}s
            </span>
          )}
        </div>
      </div>

      {/* Creator Attribution & Interactive Footer */}
      <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            {clip.creator?.username ? (
              <Link
                to="/@{$username}"
                params={{ username: clip.creator.username }}
                className="flex items-center gap-2.5 min-w-0"
              >
                <FounderAvatar name={creatorName} src={clip.creator.avatar_url} size="sm" />
                <div className="min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-bold text-foreground truncate hover:underline">
                      {creatorName}
                    </span>
                    <AccountStatusBadges userId={clip.creator_id} compact />
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">
                    @{clip.creator.username}
                  </p>
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
                  variant={followingCreator ? "secondary" : "default"}
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
                  className="h-7 rounded-full text-[11px] gap-1 px-2.5"
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
            <p className="text-xs leading-relaxed text-foreground/90">
              <RichPingText text={clip.caption} />
            </p>
          )}
        </div>

        <div className="pt-2.5 border-t border-border/60 flex items-center justify-between gap-1 text-xs">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                if (!user) {
                  toast.info("Sign in to like Clips");
                  return;
                }
                const next = !liked;
                setLiked(next);
                toggleLike.mutate({ clipId: clip.id, liked });
              }}
              aria-label="Like Clip"
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition-colors hover:bg-secondary",
                liked ? "text-red-500 font-bold" : "text-muted-foreground",
              )}
            >
              <Heart className={cn("size-4", liked && "fill-current")} />
              <span className="tabular-nums">{clip.likes_count + (liked ? 1 : 0)}</span>
            </button>

            <button
              type="button"
              onClick={() => setRepliesOpen(true)}
              aria-label="Reply to Clip"
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <MessageCircle className="size-4" />
              <span className="tabular-nums">{clip.replies_count}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (!user) {
                  toast.info("Sign in to save Clips");
                  return;
                }
                const next = !saved;
                setSaved(next);
                toggleSave.mutate(
                  { clipId: clip.id, saved },
                  { onSuccess: (s) => toast.success(s ? "Clip saved" : "Removed from saved") },
                );
              }}
              aria-label="Save Clip"
              className={cn(
                "inline-flex items-center justify-center rounded-full p-1.5 transition-colors hover:bg-secondary",
                saved ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Bookmark className={cn("size-4", saved && "fill-current")} />
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              aria-label="Share Clip"
              className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <Share2 className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              aria-label="Report Clip"
              className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-destructive"
            >
              <Flag className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Replies Dialog */}
      <Dialog open={repliesOpen} onOpenChange={setRepliesOpen}>
        <DialogContent className="sm:max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-lg">Clip Replies</DialogTitle>
            <DialogDescription className="text-xs">
              Join the conversation around @{clip.creator?.username ?? "founder"}&apos;s Clip.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 max-h-56 overflow-y-auto space-y-2">
            {replies.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No replies yet.</p>
            ) : (
              replies.map((r) => (
                <div key={r.id} className="rounded-2xl bg-secondary/40 p-3 text-xs">
                  <p className="font-bold">
                    {r.author?.display_name || `@${r.author?.username || "member"}`}
                  </p>
                  <p className="mt-0.5 text-foreground/90">{r.content}</p>
                </div>
              ))
            )}
          </div>
          {user && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!replyDraft.trim()) return;
                await postReply.mutateAsync({ clipId: clip.id, content: replyDraft });
                setReplyDraft("");
                toast.success("Reply posted");
              }}
              className="mt-3 flex gap-2"
            >
              <Input
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
                placeholder="Write a reply…"
                className="rounded-full text-xs flex-1"
              />
              <Button type="submit" size="sm" variant="hero" className="rounded-full text-xs">
                Send
              </Button>
            </form>
          )}
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
          description: clip.caption || "Watch this short-form founder Clip on Ping.",
          path: "/clips",
        }}
      />
    </article>
  );
}

function PingClipsPage() {
  const { user, profile } = useAuth();
  const [activeTag, setActiveTag] = useState("all");
  const [composeOpen, setComposeOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [caption, setCaption] = useState("");
  const [captionsText, setCaptionsText] = useState("");
  const [visibility, setVisibility] = useState<ClipVisibility>("public");
  const [uploading, setUploading] = useState(false);
  const [momentToConvert, setMomentToConvert] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const { data: feedState, isLoading } = useQuery(clipsFeedQuery(activeTag));
  const { data: myMoments = [] } = useQuery(userActiveMomentsQuery(user?.id ?? "", user?.id));
  const publishClip = usePublishClip(
    user?.id,
    profile
      ? {
          id: profile.id,
          username: profile.username,
          display_name: profile.display_name,
          avatar_url: profile.avatar_url,
        }
      : null,
  );

  const clips = feedState?.clips ?? [];
  const eligibleVideoMoments = myMoments.filter((m) => m.media_type === "video");

  const handleVideoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    const valid = validateMediaUpload(file, "video");
    if (!valid.valid) {
      toast.error(valid.error || "Unsupported video file");
      return;
    }
    try {
      setUploading(true);
      const probe = await probeVideoFile(file);
      const meta = validateVideoFileMeta({
        size: file.size,
        type: file.type,
        name: file.name,
        durationSec: probe.durationSec,
      });
      if (!meta.valid) {
        toast.error(meta.error || "Video failed validation.");
        return;
      }
      const { uploadUserMedia } = await import("@/lib/storage");
      const ext = file.name.split(".").pop()?.toLowerCase() || "mp4";
      const uploaded = await uploadUserMedia(`${user.id}/clips/${Date.now()}.${ext}`, file, {
        cacheControl: "3600",
        upsert: false,
      });
      setVideoUrl(uploaded);
      setDurationSec(probe.durationSec ? Math.round(probe.durationSec) : null);
      if (probe.posterBlob) {
        try {
          const pFile = new File([probe.posterBlob], `clip-poster-${Date.now()}.jpg`, {
            type: "image/jpeg",
          });
          const pUrl = await uploadUserMedia(`${user.id}/clips/posters/${Date.now()}.jpg`, pFile, {
            cacheControl: "3600",
            upsert: false,
          });
          setPosterUrl(pUrl);
        } catch {
          // non-blocking poster upload failure
        }
      }
      toast.success("Clip video uploaded and ready");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload Clip video.");
    } finally {
      setUploading(false);
    }
  };

  const handlePublishClip = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoUrl.trim()) {
      toast.error("Upload or paste a valid video URL first.");
      return;
    }
    try {
      await publishClip.mutateAsync({
        videoUrl,
        posterUrl,
        caption,
        captionsText,
        durationSec,
        visibility,
      });
      toast.success("Your Ping Clip is live!");
      setComposeOpen(false);
      setVideoUrl("");
      setPosterUrl(null);
      setCaption("");
      setCaptionsText("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not publish Clip.");
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 pb-24 space-y-6">
      {/* Header */}
      <header className="surface-card rounded-3xl p-6 sm:p-8 border border-border/70 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-bold text-primary">
              <Clapperboard className="size-3.5" /> Ping Clips · Persistent Short-Form Video
            </span>
            <h1 className="mt-2.5 font-display text-3xl sm:text-4xl font-extrabold tracking-tight">
              Watch &amp; Publish Ping Clips
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Persistent vertical video discovery for builders, creators, and Spotlight stories.
              Temporary updates stay in <strong>Moments</strong>; publish your best videos here as{" "}
              <strong>Clips</strong>.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm" className="rounded-full text-xs">
              <Link to="/spotlight">Ping Spotlight</Link>
            </Button>
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
              className="rounded-full gap-1.5"
            >
              <Plus className="size-4" /> Publish Clip
            </Button>
          </div>
        </div>

        {/* DOT Tag Discovery Filter Bar */}
        <nav
          aria-label="Filter Clips by DOT Tag"
          className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none pt-3 border-t border-border/60"
        >
          <button
            type="button"
            onClick={() => setActiveTag("all")}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
              activeTag === "all"
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card hover:bg-secondary",
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
                "shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
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

      {/* Clips Vertical Discovery Grid */}
      {isLoading ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-[28rem] animate-pulse rounded-3xl bg-secondary/50" />
          ))}
        </div>
      ) : clips.length === 0 ? (
        <div className="surface-card rounded-3xl p-10 text-center border border-border/70 space-y-3">
          <Clapperboard className="mx-auto size-10 text-muted-foreground/50" />
          <h2 className="font-display text-lg font-bold">
            {activeTag === "all"
              ? "No Ping Clips published yet"
              : `No Clips tagged .${activeTag} yet`}
          </h2>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Upload a short vertical video directly or republish an eligible video Moment as a
            persistent Ping Clip with DOT Tags.
          </p>
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
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 items-start">
          {clips.map((clip) => (
            <VerticalClipCard key={clip.id} clip={clip} />
          ))}
        </div>
      )}

      {/* Publish Clip Dialog (Direct Upload + Eligible Moment Conversion) */}
      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="sm:max-w-lg rounded-3xl p-6 max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <Clapperboard className="size-5 text-primary" /> Publish a Ping Clip
            </DialogTitle>
            <DialogDescription className="text-xs">
              Upload a short-form vertical video (MP4/WebM/MOV) or explicitly convert an eligible
              video Moment.
            </DialogDescription>
          </DialogHeader>

          {eligibleVideoMoments.length > 0 && (
            <div className="rounded-2xl border border-primary/25 bg-primary/10 p-3.5 space-y-2">
              <p className="text-xs font-bold text-foreground">
                Or republish an active video Moment ({eligibleVideoMoments.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {eligibleVideoMoments.slice(0, 4).map((m) => (
                  <Button
                    key={m.id}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-full text-[11px] h-7"
                    onClick={() => {
                      setComposeOpen(false);
                      setMomentToConvert(m);
                    }}
                  >
                    Convert &ldquo;{(m.caption || "Video Moment").slice(0, 24)}&rdquo;
                  </Button>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={handlePublishClip} className="space-y-3 mt-2">
            <div>
              <Label htmlFor="clip-video-url" className="text-xs">
                Video Source (Upload or HTTPS MP4/WebM)
              </Label>
              <div className="mt-1 flex gap-2">
                <Input
                  id="clip-video-url"
                  type="url"
                  required
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://…/clip.mp4"
                  className="rounded-xl text-xs flex-1"
                />
                <input
                  ref={fileRef}
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime"
                  className="hidden"
                  onChange={handleVideoFile}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                  className="rounded-xl text-xs gap-1 shrink-0"
                >
                  {uploading ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Upload className="size-3.5" />
                  )}
                  {uploading ? "Uploading…" : "Upload"}
                </Button>
              </div>
            </div>

            <div>
              <Label htmlFor="clip-caption" className="text-xs">
                Caption &amp; DOT Tags
              </Label>
              <Textarea
                id="clip-caption"
                rows={3}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Demoing our solar pay-as-you-go controller in Lagos .startups .africa .technology"
                className="mt-1 rounded-xl text-xs"
              />
            </div>

            <div>
              <Label htmlFor="clip-subs" className="text-xs">
                On-screen Captions / Subtitles (optional)
              </Label>
              <Input
                id="clip-subs"
                value={captionsText}
                onChange={(e) => setCaptionsText(e.target.value)}
                placeholder="Accessible caption summary for muted playback…"
                className="mt-1 rounded-xl text-xs"
              />
            </div>

            <div>
              <Label htmlFor="clip-vis" className="text-xs">
                Visibility
              </Label>
              <select
                id="clip-vis"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as ClipVisibility)}
                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs"
              >
                <option value="public">Public Discovery</option>
                <option value="followers">Followers Only</option>
                <option value="hub">Hub Only</option>
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setComposeOpen(false)}
                className="rounded-full"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="hero"
                size="sm"
                disabled={publishClip.isPending || uploading}
                className="rounded-full font-bold"
              >
                {publishClip.isPending ? "Publishing…" : "Publish Clip"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <MomentToClipDialog
        moment={momentToConvert}
        open={Boolean(momentToConvert)}
        onOpenChange={(o) => !o && setMomentToConvert(null)}
      />
    </div>
  );
}
