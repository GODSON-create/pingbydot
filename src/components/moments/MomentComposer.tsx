import { useState, useRef } from "react";
import {
  Camera,
  Upload,
  Video,
  X,
  Plus,
  Smile,
  MapPin,
  Globe,
  Users,
  Lock,
  Sparkles,
  ArrowRight,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { myHubsQuery } from "@/lib/hub-queries";
import type { MomentAudience, MomentMediaType, MomentSticker } from "@/lib/moments";

interface MomentDraft {
  mediaFile: File | null;
  mediaUrl: string;
  mediaType: MomentMediaType;
  caption: string;
  overlayText: string;
  stickers: MomentSticker[];
  mentions: string[];
  location: string;
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

  const [drafts, setDrafts] = useState<MomentDraft[]>([]);
  const [activeDraftIdx, setActiveDraftIdx] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const activeDraft: MomentDraft | undefined = drafts[activeDraftIdx];

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newDrafts: MomentDraft[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;
      if (file.size > 25 * 1024 * 1024) {
        toast.error(`File ${file.name} exceeds 25MB limit.`);
        continue;
      }

      const isVideo = file.type.startsWith("video/");
      const isImage = file.type.startsWith("image/");
      if (!isVideo && !isImage) {
        toast.error(`Unsupported file type: ${file.type}`);
        continue;
      }

      const previewUrl = URL.createObjectURL(file);
      newDrafts.push({
        mediaFile: file,
        mediaUrl: previewUrl,
        mediaType: isVideo ? "video" : "image",
        caption: "",
        overlayText: "",
        stickers: [],
        mentions: [],
        location: "",
        audience: "public",
        hubId: null,
        isDiscoverable: true,
        allowComments: true,
        allowSharing: true,
        allowRepings: true,
      });
    }

    if (newDrafts.length > 0) {
      setDrafts((prev) => [...prev, ...newDrafts]);
      setActiveDraftIdx(drafts.length);
    }
  };

  const updateActiveDraft = (patch: Partial<MomentDraft>) => {
    setDrafts((prev) =>
      prev.map((d, idx) => (idx === activeDraftIdx ? { ...d, ...patch } : d)),
    );
  };

  const addSticker = (emoji: string) => {
    if (!activeDraft) return;
    const newSticker: MomentSticker = {
      id: Math.random().toString(),
      emoji,
      x: 50,
      y: 50,
      scale: 1,
    };
    updateActiveDraft({ stickers: [...activeDraft.stickers, newSticker] });
  };

  const removeSticker = (id: string) => {
    if (!activeDraft) return;
    updateActiveDraft({
      stickers: activeDraft.stickers.filter((s) => s.id !== id),
    });
  };

  const removeDraft = (idx: number) => {
    setDrafts((prev) => {
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

    setIsUploading(true);
    setUploadProgress(10);

    try {
      for (let i = 0; i < drafts.length; i++) {
        const d = drafts[i];
        if (!d) continue;
        let uploadedUrl = d.mediaUrl;

        // If it's a real file, upload to Supabase Storage
        if (d.mediaFile) {
          const ext = d.mediaFile.name.split(".").pop() || (d.mediaType === "video" ? "mp4" : "jpg");
          const path = `${user.id}/moments/${Date.now()}_${i}.${ext}`;

          const { data: uploadRes, error: uploadErr } = await supabase.storage
            .from("media")
            .upload(path, d.mediaFile, {
              cacheControl: "3600",
              upsert: false,
            });

          if (uploadErr) {
            console.warn("Storage upload fallback:", uploadErr);
          } else if (uploadRes) {
            const { data: publicUrlData } = supabase.storage
              .from("media")
              .getPublicUrl(uploadRes.path);
            uploadedUrl = publicUrlData.publicUrl;
          }
        }

        setUploadProgress(Math.round(((i + 1) / drafts.length) * 80));

        // Insert Moment record
        const { error: insertErr } = await supabase.from("moments").insert({
          author_id: user.id,
          media_url: uploadedUrl,
          media_type: d.mediaType,
          caption: d.caption.trim() || null,
          overlay_text: d.overlayText.trim() || null,
          stickers: d.stickers as any,
          mentions: d.mentions as any,
          location: d.location.trim() || null,
          audience: d.audience,
          hub_id: d.audience === "hub" ? d.hubId : null,
          is_discoverable: d.audience === "public" ? d.isDiscoverable : false,
          allow_comments: d.allowComments,
          allow_sharing: d.allowSharing,
          allow_repings: d.allowRepings,
        });

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

      setDrafts([]);
      onOpenChange(false);
      onPublished?.();
    } catch (err: unknown) {
      console.error("Publish moment error:", err);
      toast.error(err instanceof Error ? err.message : "Failed to publish Moment.");
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl rounded-3xl p-6 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary font-bold text-sm">
            <Sparkles className="size-4" />
            <span>Moments Composer</span>
          </div>
          <DialogTitle className="font-display text-2xl">Share a Moment</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Fast, lightweight status updates that travel across your network for 24 hours.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />

        {drafts.length === 0 ? (
          /* Empty Initial State: Camera / Upload */
          <div className="mt-6 flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-border/80 p-10 text-center bg-card/40">
            <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Camera className="size-8" />
            </div>
            <h3 className="mt-4 font-display text-lg font-bold">Capture or upload media</h3>
            <p className="mt-1 text-xs text-muted-foreground max-w-xs">
              Upload photos or short vertical videos up to 25MB. Add captions, overlays, stickers, and tags.
            </p>
            <div className="mt-6 flex gap-3">
              <Button
                type="button"
                variant="hero"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-2xl gap-2"
              >
                <Upload className="size-4" /> Choose from files
              </Button>
            </div>
          </div>
        ) : (
          /* Active Draft Preview & Editor */
          <div className="mt-4 space-y-5">
            {/* Sequence Selector Pill Bar */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
              {drafts.map((d, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setActiveDraftIdx(idx)}
                  className={`relative shrink-0 size-14 rounded-xl overflow-hidden border-2 transition-all ${
                    idx === activeDraftIdx ? "border-primary ring-2 ring-primary/30" : "border-border opacity-70"
                  }`}
                >
                  {d.mediaType === "video" ? (
                    <video src={d.mediaUrl} className="h-full w-full object-cover" />
                  ) : (
                    <img src={d.mediaUrl} alt="Thumbnail" className="h-full w-full object-cover" />
                  )}
                  <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[9px] text-white text-center font-bold">
                    #{idx + 1}
                  </span>
                </button>
              ))}

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="size-14 rounded-xl border border-dashed border-border flex items-center justify-center text-muted-foreground hover:bg-muted/40 transition-colors shrink-0"
                title="Add another moment to sequence"
              >
                <Plus className="size-5" />
              </button>
            </div>

            {/* Media Canvas Preview */}
            {activeDraft && (
              <div className="relative aspect-[9/14] w-full max-h-72 rounded-2xl overflow-hidden bg-black flex items-center justify-center shadow-inner">
                {activeDraft.mediaType === "video" ? (
                  <video src={activeDraft.mediaUrl} controls className="h-full w-full object-contain" />
                ) : (
                  <img src={activeDraft.mediaUrl} alt="Preview" className="h-full w-full object-contain" />
                )}

                {activeDraft.overlayText && (
                  <div className="absolute inset-x-4 top-1/3 text-center pointer-events-none">
                    <span className="inline-block rounded-xl bg-black/70 px-3 py-1.5 font-display text-sm font-bold text-white backdrop-blur-sm">
                      {activeDraft.overlayText}
                    </span>
                  </div>
                )}

                {activeDraft.stickers.map((s) => (
                  <div
                    key={s.id}
                    className="absolute text-2xl cursor-pointer hover:scale-125 transition-transform"
                    style={{ left: `${s.x}%`, top: `${s.y}%` }}
                    onClick={() => removeSticker(s.id)}
                    title="Tap to remove sticker"
                  >
                    {s.emoji}
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => removeDraft(activeDraftIdx)}
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
                    placeholder="e.g. Day 1 of YC / Shipped v2.0"
                    className="mt-1 rounded-xl h-10"
                  />
                </div>

                {/* Stickers */}
                <div>
                  <Label className="text-xs font-semibold flex items-center gap-1.5">
                    <Smile className="size-3.5" /> Stickers
                  </Label>
                  <div className="mt-1.5 flex items-center gap-2 overflow-x-auto pb-1">
                    {EMOJI_STICKERS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => addSticker(emoji)}
                        className="flex size-8 items-center justify-center rounded-lg bg-secondary/80 text-lg hover:scale-110 transition-transform"
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
                    className="mt-1 rounded-xl resize-none text-sm"
                  />
                </div>

                {/* Audience Selection */}
                <div>
                  <Label className="text-xs font-semibold">Audience & Privacy</Label>
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
                      <Lock className="size-3.5" /> Close Circle
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

                {/* For You Discovery Opt-In (Only for public moments) */}
                {activeDraft.audience === "public" && (
                  <div className="flex items-center justify-between rounded-xl bg-secondary/50 p-3 border border-border/50">
                    <div>
                      <Label htmlFor="discoverable-toggle" className="text-xs font-semibold cursor-pointer">
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
                onClick={() => fileInputRef.current?.click()}
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
  );
}
