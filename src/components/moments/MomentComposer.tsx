import { useState, useRef, useEffect } from "react";
import {
  Camera,
  Upload,
  Plus,
  Smile,
  MapPin,
  Globe,
  Users,
  Lock,
  Sparkles,
  ArrowRight,
  Trash2,
  AtSign,
  Clock,
  Settings2,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ensureClientProfileRow } from "@/lib/ensure-profile";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { myHubsQuery } from "@/lib/hub-queries";
import {
  closeCircleQuery,
  type MomentAudience,
  type MomentMediaType,
  type MomentSticker,
} from "@/lib/moments";
import {
  checkShieldRateLimit,
  detectMediaKind,
  sanitizeUserText,
  validateMediaUpload,
} from "@/lib/shield";
import { CloseCircleDialog } from "./CloseCircleDialog";

interface MomentDraft {
  mediaFile: File | null;
  mediaUrl: string;
  mediaType: MomentMediaType;
  caption: string;
  overlayText: string;
  stickers: MomentSticker[];
  mentionsText: string;
  location: string;
  duration: number;
  audience: MomentAudience;
  hubId: string | null;
  isDiscoverable: boolean;
  allowComments: boolean;
  allowSharing: boolean;
  allowRepings: boolean;
}

const EMOJI_STICKERS = ["🔥", "🚀", "💡", "💯", "✨", "🙌", "🛠️", "🎯", "📈", "❤️"];

interface MomentComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPublished?: () => void;
}

export function MomentComposer({ open, onOpenChange, onPublished }: MomentComposerProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { data: myHubs = [] } = useQuery(myHubsQuery(user?.id));
  const { data: closeCircle = [] } = useQuery(closeCircleQuery(user?.id));

  const [drafts, setDrafts] = useState<MomentDraft[]>([]);
  const draftsRef = useRef<MomentDraft[]>([]);
  draftsRef.current = drafts;
  const [activeDraftIdx, setActiveDraftIdx] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [closeCircleOpen, setCloseCircleOpen] = useState(false);

  const activeDraft: MomentDraft | undefined = drafts[activeDraftIdx];

  useEffect(() => {
    if (!open && draftsRef.current.length > 0) {
      draftsRef.current.forEach((d) => {
        if (d.mediaUrl.startsWith("blob:")) URL.revokeObjectURL(d.mediaUrl);
      });
      setDrafts([]);
      setActiveDraftIdx(0);
      setPublishError(null);
    }
  }, [open]);

  const appendFiles = (files: FileList | File[]) => {
    setPublishError(null);
    const newDrafts: MomentDraft[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;

      const mediaKind = detectMediaKind(file);
      if (mediaKind !== "video" && mediaKind !== "image") {
        toast.error(`Unsupported file type: ${file.type || file.name}. Choose a photo or video.`);
        continue;
      }

      const check = validateMediaUpload(
        { type: file.type, size: file.size, name: file.name },
        mediaKind,
      );
      if (!check.valid) {
        toast.error(check.error || "Invalid media file.");
        continue;
      }

      const previewUrl = URL.createObjectURL(file);
      newDrafts.push({
        mediaFile: file,
        mediaUrl: previewUrl,
        mediaType: mediaKind,
        caption: "",
        overlayText: "",
        stickers: [],
        mentionsText: "",
        location: "",
        duration: mediaKind === "video" ? 15 : 5,
        audience: "public",
        hubId: null,
        isDiscoverable: true,
        allowComments: true,
        allowSharing: true,
        allowRepings: true,
      });
    }

    if (newDrafts.length > 0) {
      setDrafts((prev) => {
        const next = [...prev, ...newDrafts];
        setActiveDraftIdx(prev.length);
        return next;
      });
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      appendFiles(files);
    }
    e.target.value = "";
  };

  const handleChooseFromGallery = async () => {
    const { pickMediaFromGallery } = await import("@/lib/media-picker");
    const outcome = await pickMediaFromGallery({
      mediaType: "all",
      multiple: true,
      limit: 10,
      webFallbackInput: fileInputRef.current,
    });
    if (outcome.files.length > 0) {
      appendFiles(outcome.files);
    }
  };

  const handleTakePhoto = async () => {
    const { capturePhotoWithCamera } = await import("@/lib/media-picker");
    const outcome = await capturePhotoWithCamera();
    if (outcome.files.length > 0) appendFiles(outcome.files);
  };

  const handleRecordVideo = async () => {
    const { captureVideoWithCamera } = await import("@/lib/media-picker");
    const outcome = await captureVideoWithCamera();
    if (outcome.files.length > 0) appendFiles(outcome.files);
  };

  const updateActiveDraft = (patch: Partial<MomentDraft>) => {
    setDrafts((prev) => prev.map((d, idx) => (idx === activeDraftIdx ? { ...d, ...patch } : d)));
  };

  const addSticker = (emoji: string) => {
    if (!activeDraft) return;
    const offset = (activeDraft.stickers.length * 9) % 36;
    const newSticker: MomentSticker = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      emoji,
      x: 24 + offset,
      y: 35 + (offset % 25),
      scale: 1,
    };
    updateActiveDraft({ stickers: [...activeDraft.stickers, newSticker] });
  };

  const handleCanvasStickerPlace = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeDraft || activeDraft.stickers.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(8, Math.min(88, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
    const y = Math.max(10, Math.min(85, Math.round(((e.clientY - rect.top) / rect.height) * 100)));
    const lastIdx = activeDraft.stickers.length - 1;
    updateActiveDraft({
      stickers: activeDraft.stickers.map((s, idx) => (idx === lastIdx ? { ...s, x, y } : s)),
    });
  };

  const removeSticker = (id: string) => {
    if (!activeDraft) return;
    updateActiveDraft({
      stickers: activeDraft.stickers.filter((s) => s.id !== id),
    });
  };

  const removeDraft = (idx: number) => {
    setDrafts((prev) => {
      const removed = prev[idx];
      if (removed?.mediaUrl.startsWith("blob:")) {
        URL.revokeObjectURL(removed.mediaUrl);
      }
      const next = prev.filter((_, i) => i !== idx);
      if (activeDraftIdx >= next.length) {
        setActiveDraftIdx(Math.max(0, next.length - 1));
      }
      return next;
    });
  };

  const handlePublishAll = async () => {
    if (!user) {
      toast.error("Please sign in to publish Moments.");
      return;
    }
    if (drafts.length === 0) {
      toast.error("Please add at least one photo or video.");
      return;
    }
    if (drafts.some((d) => d.audience === "hub" && !d.hubId)) {
      toast.error("Select a Hub before publishing a Hub Moment.");
      return;
    }

    const rateCheck = checkShieldRateLimit("create_moment", user.id);
    if (!rateCheck.allowed) {
      toast.error(rateCheck.reason || "Publishing too quickly. Please wait a moment.");
      return;
    }

    setIsUploading(true);
    setUploadProgress(10);
    setPublishError(null);

    try {
      for (let i = 0; i < drafts.length; i++) {
        const d = drafts[i];
        if (!d) continue;
        let uploadedUrl = d.mediaUrl;

        if (d.mediaFile) {
          const { uploadUserMedia } = await import("@/lib/storage");
          const ext =
            d.mediaFile.name.split(".").pop()?.toLowerCase() ||
            (d.mediaType === "video" ? "mp4" : "jpg");
          const path = `${user.id}/moments/${Date.now()}_${i}.${ext}`;
          uploadedUrl = await uploadUserMedia(path, d.mediaFile, {
            cacheControl: "3600",
            upsert: false,
          });
        }

        if (uploadedUrl.startsWith("blob:")) {
          throw new Error("Media upload did not return a persistent URL.");
        }

        const parsedMentions = Array.from(
          new Set(
            d.mentionsText
              .split(/[\s,]+/)
              .map((m) => m.replace(/^@/, "").trim().toLowerCase())
              .filter((m) => /^[a-z0-9_]{2,30}$/.test(m)),
          ),
        );

        setUploadProgress(Math.round(((i + 1) / drafts.length) * 80));

        const cleanCaption = sanitizeUserText(d.caption);
        const cleanOverlay = sanitizeUserText(d.overlayText);
        const cleanLocation = sanitizeUserText(d.location);

        const momentPayload = {
          author_id: user.id,
          media_url: uploadedUrl,
          media_type: d.mediaType,
          caption: cleanCaption || null,
          overlay_text: cleanOverlay || null,
          stickers: d.stickers as any,
          mentions: parsedMentions as any,
          location: cleanLocation || null,
          duration: d.duration,
          audience: d.audience,
          hub_id: d.audience === "hub" ? d.hubId : null,
          is_discoverable: d.audience === "public" ? d.isDiscoverable : false,
          allow_comments: d.allowComments,
          allow_sharing: d.allowSharing,
          allow_repings:
            d.audience === "public" || d.audience === "followers" ? d.allowRepings : false,
        };

        let { error: insertErr } = await supabase.from("moments").insert(momentPayload);

        if (insertErr && insertErr.code === "23503") {
          const recovered = await ensureClientProfileRow(user);
          if (recovered) {
            const retry = await supabase.from("moments").insert(momentPayload);
            insertErr = retry.error;
          }
        }

        if (insertErr) throw insertErr;
      }

      setUploadProgress(100);
      toast.success(
        drafts.length === 1
          ? "Moment shared across your network!"
          : `${drafts.length} Moments published in sequence!`,
      );

      qc.invalidateQueries({ queryKey: ["moments-tray"] });
      qc.invalidateQueries({ queryKey: ["discoverable-moments"] });
      qc.invalidateQueries({ queryKey: ["user-active-moments"] });

      drafts.forEach((d) => {
        if (d.mediaUrl.startsWith("blob:")) URL.revokeObjectURL(d.mediaUrl);
      });
      setDrafts([]);
      setPublishError(null);
      onOpenChange(false);
      onPublished?.();
    } catch (err: unknown) {
      console.error("Publish moment error:", err);
      const { formatStorageUploadError } = await import("@/lib/storage");
      const msg = formatStorageUploadError(err, "Failed to publish Moment.");
      setPublishError(msg);
      toast.error(msg);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl rounded-3xl p-6 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-2 text-primary font-bold text-sm">
              <Sparkles className="size-4" />
              <span>Moments Composer</span>
            </div>
            <DialogTitle className="font-display text-2xl">Create a Moment</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Share what's happening around you with photos, video clips, captions, and audience
              controls.
            </DialogDescription>
          </DialogHeader>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/heic,video/mp4,video/webm,video/quicktime"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />

          {drafts.length === 0 ? (
            <div className="mt-6 flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-border/80 p-10 text-center bg-card/40">
              <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Camera className="size-8" />
              </div>
              <h3 className="mt-4 font-display text-lg font-bold">Capture or upload media</h3>
              <p className="mt-1 text-xs text-muted-foreground max-w-xs">
                Upload photos (up to 10MB) or short vertical videos (up to 50MB). Add captions,
                overlays, stickers, locations, and audience controls.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2.5">
                <Button
                  type="button"
                  variant="hero"
                  onClick={() => void handleTakePhoto()}
                  className="rounded-2xl gap-2"
                >
                  <Camera className="size-4" /> Take Photo
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleRecordVideo()}
                  className="rounded-2xl gap-2"
                >
                  <Video className="size-4" /> Record Video
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleChooseFromGallery()}
                  className="rounded-2xl gap-2"
                >
                  <Upload className="size-4" /> Choose from Gallery
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-5">
              {/* Sequence Selector Pill Bar */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                {drafts.map((d, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActiveDraftIdx(idx)}
                    className={`relative shrink-0 size-14 rounded-xl overflow-hidden border-2 transition-all ${
                      idx === activeDraftIdx
                        ? "border-primary ring-2 ring-primary/30"
                        : "border-border opacity-70"
                    }`}
                  >
                    {d.mediaType === "video" ? (
                      <video src={d.mediaUrl} className="h-full w-full object-cover" />
                    ) : (
                      <img
                        src={d.mediaUrl}
                        alt="Thumbnail"
                        className="h-full w-full object-cover"
                      />
                    )}
                    <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[9px] text-white text-center font-bold">
                      #{idx + 1}
                    </span>
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => void handleChooseFromGallery()}
                  className="size-14 rounded-xl border border-dashed border-border flex items-center justify-center text-muted-foreground hover:bg-muted/40 transition-colors shrink-0"
                  title="Add another moment to sequence"
                >
                  <Plus className="size-5" />
                </button>
              </div>

              {/* Media Canvas Preview */}
              {activeDraft && (
                <div
                  onClick={handleCanvasStickerPlace}
                  className="relative aspect-[9/14] w-full max-h-72 rounded-2xl overflow-hidden bg-black flex items-center justify-center shadow-inner cursor-crosshair"
                  title={
                    activeDraft.stickers.length > 0
                      ? "Click anywhere on preview to move the latest sticker"
                      : undefined
                  }
                >
                  {activeDraft.mediaType === "video" ? (
                    <video
                      src={activeDraft.mediaUrl}
                      controls
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <img
                      src={activeDraft.mediaUrl}
                      alt="Preview"
                      className="h-full w-full object-contain"
                    />
                  )}

                  {activeDraft.overlayText && (
                    <div className="absolute inset-x-4 top-1/3 text-center pointer-events-none">
                      <span className="inline-block rounded-xl bg-black/70 px-3 py-1.5 font-display text-sm font-bold text-white backdrop-blur-sm">
                        {activeDraft.overlayText}
                      </span>
                    </div>
                  )}

                  {activeDraft.stickers.map((s) => (
                    <button
                      type="button"
                      key={s.id}
                      className="absolute text-2xl cursor-pointer hover:scale-125 transition-transform"
                      style={{ left: `${s.x}%`, top: `${s.y}%` }}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeSticker(s.id);
                      }}
                      title="Tap sticker to remove"
                    >
                      {s.emoji}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeDraft(activeDraftIdx);
                    }}
                    className="absolute top-2 right-2 rounded-full bg-black/60 p-1.5 text-white hover:bg-destructive transition-colors"
                    title="Remove this draft"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              )}

              {/* Editing Controls */}
              {activeDraft && (
                <div className="space-y-4">
                  {/* Text Overlay */}
                  <div>
                    <Label className="text-xs font-semibold">Banner Overlay Text (Optional)</Label>
                    <Input
                      value={activeDraft.overlayText}
                      onChange={(e) => updateActiveDraft({ overlayText: e.target.value })}
                      placeholder="e.g. Day 1 of Launch / Shipped v2.0"
                      className="mt-1 rounded-xl h-10"
                      maxLength={80}
                    />
                  </div>

                  {/* Stickers */}
                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold flex items-center gap-1.5">
                        <Smile className="size-3.5" /> Stickers
                      </Label>
                      {activeDraft.stickers.length > 0 && (
                        <span className="text-[11px] text-muted-foreground">
                          Tap preview to position · Tap sticker to remove
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 overflow-x-auto pb-1">
                      {EMOJI_STICKERS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => addSticker(emoji)}
                          className="flex size-8 items-center justify-center rounded-lg bg-secondary/80 text-lg hover:scale-110 transition-transform shrink-0"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Caption */}
                  <div>
                    <Label className="text-xs font-semibold">Caption</Label>
                    <Textarea
                      value={activeDraft.caption}
                      onChange={(e) => updateActiveDraft({ caption: e.target.value })}
                      placeholder="Tell your founders network what's happening…"
                      rows={2}
                      maxLength={400}
                      className="mt-1 rounded-xl resize-none text-sm"
                    />
                  </div>

                  {/* Location, Mentions & Duration */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <Label className="text-xs font-semibold flex items-center gap-1">
                        <MapPin className="size-3" /> Location
                      </Label>
                      <Input
                        value={activeDraft.location}
                        onChange={(e) => updateActiveDraft({ location: e.target.value })}
                        placeholder="San Francisco"
                        maxLength={60}
                        className="mt-1 rounded-xl h-9 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold flex items-center gap-1">
                        <AtSign className="size-3" /> Mentions
                      </Label>
                      <Input
                        value={activeDraft.mentionsText}
                        onChange={(e) => updateActiveDraft({ mentionsText: e.target.value })}
                        placeholder="@alice @bob"
                        maxLength={120}
                        className="mt-1 rounded-xl h-9 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold flex items-center gap-1">
                        <Clock className="size-3" /> Duration
                      </Label>
                      <select
                        value={activeDraft.duration}
                        onChange={(e) => updateActiveDraft({ duration: Number(e.target.value) })}
                        className="mt-1 h-9 w-full rounded-xl border border-input bg-card px-2.5 text-xs"
                      >
                        <option value={5}>5 seconds</option>
                        <option value={10}>10 seconds</option>
                        <option value={15}>15 seconds</option>
                      </select>
                    </div>
                  </div>

                  {/* Audience Selection */}
                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold">Audience &amp; Privacy</Label>
                      <button
                        type="button"
                        onClick={() => setCloseCircleOpen(true)}
                        className="text-[11px] font-semibold text-primary hover:underline flex items-center gap-1"
                      >
                        <Settings2 className="size-3" /> Manage Close Circle ({closeCircle.length})
                      </button>
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => updateActiveDraft({ audience: "public" })}
                        className={`rounded-xl border p-2 text-xs font-semibold flex items-center gap-2 ${
                          activeDraft.audience === "public"
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:bg-muted/50"
                        }`}
                      >
                        <Globe className="size-3.5" /> Public Network
                      </button>
                      <button
                        type="button"
                        onClick={() => updateActiveDraft({ audience: "followers" })}
                        className={`rounded-xl border p-2 text-xs font-semibold flex items-center gap-2 ${
                          activeDraft.audience === "followers"
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:bg-muted/50"
                        }`}
                      >
                        <Users className="size-3.5" /> Followers Only
                      </button>
                      <button
                        type="button"
                        onClick={() => updateActiveDraft({ audience: "close_circle" })}
                        className={`rounded-xl border p-2 text-xs font-semibold flex items-center gap-2 ${
                          activeDraft.audience === "close_circle"
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:bg-muted/50"
                        }`}
                      >
                        <Lock className="size-3.5" /> Close Circle ({closeCircle.length})
                      </button>
                      {myHubs.length > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            updateActiveDraft({
                              audience: "hub",
                              hubId: activeDraft.hubId ?? myHubs[0]?.hub.id ?? null,
                            })
                          }
                          className={`rounded-xl border p-2 text-xs font-semibold flex items-center gap-2 ${
                            activeDraft.audience === "hub"
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:bg-muted/50"
                          }`}
                        >
                          <Users className="size-3.5" /> Specific Hub
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Hub Selection Dropdown if audience === 'hub' */}
                  {activeDraft.audience === "hub" && myHubs.length > 0 && (
                    <div>
                      <Label className="text-xs font-semibold">Select Target Hub</Label>
                      <select
                        value={activeDraft.hubId || myHubs[0]?.hub.id}
                        onChange={(e) => updateActiveDraft({ hubId: e.target.value })}
                        className="mt-1 w-full rounded-xl border border-input bg-background p-2 text-xs"
                      >
                        {myHubs.map((h) => (
                          <option key={h.hub.id} value={h.hub.id}>
                            {h.hub.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Interaction Controls */}
                  <div className="space-y-2">
                    {activeDraft.audience === "public" && (
                      <div className="flex items-center justify-between rounded-xl bg-secondary/50 p-3 border border-border/50">
                        <div>
                          <Label
                            htmlFor="discoverable-toggle"
                            className="text-xs font-semibold cursor-pointer"
                          >
                            Opt into "For You" Feed
                          </Label>
                          <p className="text-[11px] text-muted-foreground">
                            Allow great moments to be discovered beyond your existing network.
                          </p>
                        </div>
                        <Switch
                          id="discoverable-toggle"
                          checked={activeDraft.isDiscoverable}
                          onCheckedChange={(c) => updateActiveDraft({ isDiscoverable: c })}
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="flex items-center justify-between rounded-xl bg-secondary/40 p-2.5 border border-border/40">
                        <Label
                          htmlFor="allow-replies-toggle"
                          className="text-xs font-medium cursor-pointer"
                        >
                          Allow private replies
                        </Label>
                        <Switch
                          id="allow-replies-toggle"
                          checked={activeDraft.allowComments}
                          onCheckedChange={(c) => updateActiveDraft({ allowComments: c })}
                        />
                      </div>

                      {(activeDraft.audience === "public" ||
                        activeDraft.audience === "followers") && (
                        <div className="flex items-center justify-between rounded-xl bg-secondary/40 p-2.5 border border-border/40">
                          <Label
                            htmlFor="allow-repings-toggle"
                            className="text-xs font-medium cursor-pointer"
                          >
                            Allow Re-Pings
                          </Label>
                          <Switch
                            id="allow-repings-toggle"
                            checked={activeDraft.allowRepings}
                            onCheckedChange={(c) => updateActiveDraft({ allowRepings: c })}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {publishError && (
                <div
                  role="alert"
                  className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive"
                >
                  <p className="font-semibold">Couldn&apos;t publish Moment</p>
                  <p className="mt-0.5 text-foreground/85">{publishError}</p>
                </div>
              )}

              {/* Publishing Progress Bar */}
              {isUploading && (
                <div className="mt-4 space-y-1">
                  <div className="flex justify-between text-xs font-semibold text-primary">
                    <span>Uploading Moments…</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Action Bar */}
              <div className="pt-3 border-t border-border flex items-center justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleChooseFromGallery()}
                  className="rounded-xl text-xs"
                >
                  + Add another
                </Button>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                    className="rounded-xl text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="hero"
                    disabled={isUploading}
                    onClick={handlePublishAll}
                    className="rounded-xl text-xs gap-1.5"
                  >
                    {isUploading ? "Publishing…" : `Publish Moment (${drafts.length})`}
                    <ArrowRight className="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <CloseCircleDialog open={closeCircleOpen} onOpenChange={setCloseCircleOpen} />
    </>
  );
}
