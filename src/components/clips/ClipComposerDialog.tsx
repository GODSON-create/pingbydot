import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  CheckCircle2,
  Clapperboard,
  Globe,
  Loader2,
  Upload,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { extractDotTags } from "@/lib/dot-tags";
import { ensureClientProfileRow } from "@/lib/ensure-profile";
import {
  MAX_CLIP_DURATION_SEC,
  MAX_CLIP_SIZE_BYTES,
  usePublishClip,
  type ClipVisibility,
  type PingClip,
} from "@/lib/clips";
import { userActiveMomentsQuery, type Moment } from "@/lib/moments";
import { probeVideoFile, validateVideoFileMeta } from "@/lib/media-pipeline";
import { validateMediaUpload } from "@/lib/shield";
import { buildPublicMediaPath, isPrivateMediaRef, uploadUserMedia } from "@/lib/storage";
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

interface ClipComposerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPublished?: (clip: PingClip) => void;
  navigateToClipOnSuccess?: boolean;
}

/**
 * Shared Clip publishing dialog reused across:
 * - Central Create (+) modal (`CreateStackModal`)
 * - Dedicated `/clips` feed ("Publish Clip")
 * - Creator Profile Clips tab
 *
 * Reuses Ping's existing `uploadUserMedia`, `validateMediaUpload`, and `probeVideoFile`
 * pipeline with live upload progress, format/size/duration validation, and honest error reporting.
 */
export function ClipComposerDialog({
  open,
  onOpenChange,
  onPublished,
  navigateToClipOnSuccess = false,
}: ClipComposerDialogProps) {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [videoUrl, setVideoUrl] = useState("");
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [captionsText, setCaptionsText] = useState("");
  const [visibility, setVisibility] = useState<ClipVisibility>("public");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [momentToConvert, setMomentToConvert] = useState<Moment | null>(null);

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

  // Only public-bucket video Moments are eligible for direct republishing without leaking private media
  const eligibleVideoMoments = myMoments.filter(
    (m) => m.media_type === "video" && !isPrivateMediaRef(m.media_url),
  );

  useEffect(() => {
    if (!open) {
      setFormError(null);
    }
  }, [open]);

  const parsedTags = extractDotTags(caption);

  const resetForm = () => {
    setVideoUrl("");
    setPosterUrl(null);
    setDurationSec(null);
    setSelectedFileName(null);
    setCaption("");
    setCaptionsText("");
    setVisibility("public");
    setUploadProgress(0);
    setFormError(null);
  };

  const handleVideoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    setFormError(null);

    const shieldCheck = validateMediaUpload(file, "video");
    if (!shieldCheck.valid) {
      const msg = shieldCheck.error || "Unsupported video file.";
      setFormError(msg);
      toast.error(msg);
      return;
    }

    if (file.size > MAX_CLIP_SIZE_BYTES) {
      const msg = `Clip videos must be ${Math.round(MAX_CLIP_SIZE_BYTES / (1024 * 1024))} MB or smaller.`;
      setFormError(msg);
      toast.error(msg);
      return;
    }

    try {
      setUploading(true);
      setUploadProgress(5);
      setSelectedFileName(file.name);

      const probe = await probeVideoFile(file);
      const meta = validateVideoFileMeta({
        size: file.size,
        type: file.type,
        name: file.name,
        durationSec: probe.durationSec,
      });
      if (!meta.valid) {
        const msg = meta.error || "Video failed validation.";
        setFormError(msg);
        toast.error(msg);
        return;
      }

      if (probe.durationSec && probe.durationSec > MAX_CLIP_DURATION_SEC) {
        const msg = `Clips must be ${MAX_CLIP_DURATION_SEC} seconds (3 minutes) or shorter.`;
        setFormError(msg);
        toast.error(msg);
        return;
      }

      await ensureClientProfileRow(user);
      setUploadProgress(15);

      const uploaded = await uploadUserMedia(
        buildPublicMediaPath(user.id, "clips", file.name, "mp4"),
        file,
        {
          cacheControl: "31536000",
          upsert: false,
          ownerId: user.id,
          onProgress: (pct) => {
            setUploadProgress(Math.max(15, Math.min(95, Math.round(pct))));
          },
        },
      );

      setVideoUrl(uploaded);
      setDurationSec(probe.durationSec ? Math.max(1, Math.round(probe.durationSec)) : null);

      if (probe.posterBlob) {
        try {
          const pFile = new File([probe.posterBlob], `clip-poster-${Date.now()}.jpg`, {
            type: "image/jpeg",
          });
          const pUrl = await uploadUserMedia(
            buildPublicMediaPath(user.id, "clips/posters", pFile.name, "jpg"),
            pFile,
            {
              cacheControl: "31536000",
              upsert: false,
              optimizeImage: false,
              ownerId: user.id,
            },
          );
          setPosterUrl(pUrl);
        } catch {
          // Non-blocking poster thumbnail failure
        }
      }

      setUploadProgress(100);
      toast.success("Clip video uploaded and ready to publish");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not upload Clip video.";
      setFormError(msg);
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  };

  const handlePublishClip = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!user) {
      toast.info("Sign in to publish a Ping Clip.");
      return;
    }
    if (!videoUrl.trim()) {
      setFormError("Upload a video file (MP4, WebM, MOV) or enter a valid HTTPS video URL first.");
      return;
    }
    try {
      await ensureClientProfileRow(user);
      const created = await publishClip.mutateAsync({
        videoUrl,
        posterUrl,
        caption,
        captionsText,
        durationSec,
        visibility,
      });
      toast.success("Your Ping Clip is live!");
      resetForm();
      onOpenChange(false);
      onPublished?.(created);
      if (navigateToClipOnSuccess) {
        navigate({ to: "/clips", search: { clip: created.id } });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not publish Clip.";
      setFormError(msg);
      toast.error(msg);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg rounded-3xl p-6 max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <Clapperboard className="size-5 text-primary" /> Publish a Ping Clip
            </DialogTitle>
            <DialogDescription className="text-xs">
              Publish a persistent vertical short-form video (MP4, WebM, or MOV · up to 50 MB and 3
              minutes). Clips remain available on your profile and in the Clips feed until you
              delete them or change visibility.
            </DialogDescription>
          </DialogHeader>

          {formError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
            >
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          {eligibleVideoMoments.length > 0 && (
            <div className="rounded-2xl border border-primary/25 bg-primary/10 p-3.5 space-y-2">
              <p className="text-xs font-bold text-foreground">
                Or republish a public video Moment as a persistent Clip (
                {eligibleVideoMoments.length})
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
                      onOpenChange(false);
                      setMomentToConvert(m);
                    }}
                  >
                    Convert &ldquo;{(m.caption || "Video Moment").slice(0, 24)}&rdquo;
                  </Button>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={handlePublishClip} className="space-y-3.5 mt-1">
            <div>
              <Label htmlFor="clip-video-url" className="text-xs font-semibold">
                Video File or Source URL (MP4 / WebM / MOV)
              </Label>
              <div className="mt-1.5 flex gap-2">
                <Input
                  id="clip-video-url"
                  type="url"
                  required
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="Upload a video or paste https://…/clip.mp4"
                  className="rounded-xl text-xs flex-1"
                />
                <input
                  ref={fileRef}
                  type="file"
                  aria-label="Upload Clip video file"
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
                  className="rounded-xl text-xs gap-1.5 shrink-0"
                >
                  {uploading ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Upload className="size-3.5" />
                  )}
                  {uploading ? `${uploadProgress}%` : "Upload"}
                </Button>
              </div>

              {/* Upload progress bar */}
              {uploading && (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="truncate">
                      Uploading {selectedFileName || "Clip video"}…
                    </span>
                    <span className="tabular-nums font-semibold">{uploadProgress}%</span>
                  </div>
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={uploadProgress}
                    aria-label="Clip video upload progress"
                    className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
                  >
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-200"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Ready video preview */}
              {!uploading && videoUrl && /^https?:\/\//i.test(videoUrl) && (
                <div className="mt-2.5 flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-2.5">
                  <video
                    src={videoUrl}
                    poster={posterUrl ?? undefined}
                    muted
                    playsInline
                    preload="metadata"
                    className="h-20 w-12 shrink-0 rounded-xl bg-black object-cover"
                  />
                  <div className="min-w-0 flex-1 text-xs">
                    <p className="font-semibold text-foreground flex items-center gap-1">
                      <CheckCircle2 className="size-3.5 text-primary shrink-0" />
                      Video ready to publish
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                      {selectedFileName || videoUrl}
                      {durationSec ? ` · ${durationSec}s` : ""}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="clip-caption" className="text-xs font-semibold">
                Caption &amp; Topic DOT Tags
              </Label>
              <Textarea
                id="clip-caption"
                rows={3}
                maxLength={1000}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Demoing our solar pay-as-you-go controller in Lagos .startups .africa .technology"
                className="mt-1 rounded-xl text-xs"
              />
              {parsedTags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {parsedTags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary"
                    >
                      .{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="clip-subs" className="text-xs font-semibold">
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
              <Label className="text-xs font-semibold">Visibility</Label>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {(
                  [
                    {
                      id: "public",
                      label: "Public Discovery",
                      desc: "Discoverable in Clips & Profile",
                      icon: Globe,
                    },
                    {
                      id: "followers",
                      label: "Followers Only",
                      desc: "Visible only to your followers & you",
                      icon: Users,
                    },
                  ] as const
                ).map((opt) => {
                  const Icon = opt.icon;
                  const active = visibility === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setVisibility(opt.id)}
                      aria-pressed={active}
                      className={cn(
                        "flex flex-col items-start gap-0.5 rounded-2xl border p-3 text-left transition-colors",
                        active
                          ? "border-primary bg-primary/15 text-foreground"
                          : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <span className="flex items-center gap-1.5 text-xs font-bold">
                        <Icon className={cn("size-3.5", active && "text-primary")} />
                        {opt.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{opt.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border/50">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
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
    </>
  );
}
