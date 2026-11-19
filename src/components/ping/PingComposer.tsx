import { useEffect, useRef, useState } from "react";
import {
  BarChart2,
  Building2,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Eye,
  Image as ImageIcon,
  Link2,
  Loader2,
  MapPin,
  Music,
  Plus,
  RotateCcw,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  INTENT_FORMATS,
  PING_MAX,
  pingSchema,
  serializeStructuredPing,
  type Category,
} from "@/lib/validation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import {
  clearPingComposerDraft,
  getPingComposerDraft,
  savePingComposerDraft,
} from "@/lib/draft-store";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { myHubsQuery } from "@/lib/hub-queries";
import { HUB_INTENTS, type HubIntent } from "@/lib/hubs";
import {
  IMAGE_GALLERY_MAX,
  isVideoMediaUrl,
  probeVideoFile,
  validateVideoFileMeta,
  type PingContentFormat,
} from "@/lib/media-pipeline";
import { validateMediaUpload } from "@/lib/shield";
import {
  MusicAttachmentPicker,
  type SelectedMusicDraft,
} from "@/components/music/MusicAttachmentPicker";

export type PingDraft = {
  category: Category;
  content: string;
  cta_url: string;
  cta_label: string;
  image_url?: string | null;
  media_urls?: string[] | null;
  content_format?: PingContentFormat;
  poster_url?: string | null;
  captions_text?: string | null;
  media_duration_sec?: number | null;
  location_tag?: string | null;
  imported_source_url?: string | null;
  imported_source_platform?: string | null;
  headline?: string | null;
  needs?: string[];
  offers?: string[];
  desired_outcome?: string | null;
  hub_id?: string | null;
  hub_intent?: HubIntent | null;
  scheduled_for?: string | null;
  poll?: {
    question: string;
    options: string[];
    expires_at?: string | null;
  } | null;
  music?: SelectedMusicDraft | null;
};

export function PingComposer({
  initial,
  draftKey,
  submitLabel,
  pending,
  onSubmit,
}: {
  initial?: Partial<PingDraft> | undefined;
  draftKey?: string | undefined;
  submitLabel: string;
  pending: boolean;
  onSubmit: (d: PingDraft) => void;
}) {
  const { user } = useAuth();
  const persistDrafts = Boolean(draftKey && isFeatureEnabled("ping_composer_drafts"));
  const storedDraft = persistDrafts && draftKey ? getPingComposerDraft(draftKey) : null;
  const [restoredDraft, setRestoredDraft] = useState(Boolean(storedDraft));

  const [d, setD] = useState<PingDraft>({
    category: (storedDraft?.category as Category | undefined) ?? "progress",
    content: storedDraft?.content ?? "",
    cta_url: storedDraft?.cta_url ?? "",
    cta_label: storedDraft?.cta_label ?? "",
    image_url: storedDraft?.mediaUrl ?? null,
    hub_id: storedDraft?.hub_id ?? null,
    hub_intent: (storedDraft?.hub_intent as HubIntent | null | undefined) ?? null,
    ...initial,
  });

  // Structured intent coordination fields (progressive disclosure)
  const [headline, setHeadline] = useState(initial?.headline ?? storedDraft?.headline ?? "");
  const [needsInput, setNeedsInput] = useState(
    initial?.needs?.length ? initial.needs.join(", ") : (storedDraft?.needsInput ?? ""),
  );
  const [offersInput, setOffersInput] = useState(
    initial?.offers?.length ? initial.offers.join(", ") : (storedDraft?.offersInput ?? ""),
  );
  const [desiredOutcome, setDesiredOutcome] = useState(
    initial?.desired_outcome ?? storedDraft?.desiredOutcome ?? "",
  );
  const [mediaUrl, setMediaUrl] = useState(initial?.image_url ?? storedDraft?.mediaUrl ?? "");
  const [galleryUrls, setGalleryUrls] = useState<string[]>(
    initial?.media_urls && initial.media_urls.length > 0
      ? initial.media_urls
      : initial?.image_url
        ? [initial.image_url]
        : storedDraft?.mediaUrl
          ? [storedDraft.mediaUrl]
          : [],
  );
  const [posterUrl, setPosterUrl] = useState<string | null>(initial?.poster_url ?? null);
  const [mediaDurationSec, setMediaDurationSec] = useState<number | null>(
    initial?.media_duration_sec ?? null,
  );
  const [captionsText, setCaptionsText] = useState(initial?.captions_text ?? "");
  const [locationTag, setLocationTag] = useState(initial?.location_tag ?? "");
  const [musicDraft, setMusicDraft] = useState<SelectedMusicDraft | null>(initial?.music ?? null);
  const [showMusic, setShowMusic] = useState(Boolean(initial?.music));
  const [showPreview, setShowPreview] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [failedMediaFile, setFailedMediaFile] = useState<File | null>(null);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const mediaFileInputRef = useRef<HTMLInputElement | null>(null);
  const [showCoordinationDetails, setShowCoordinationDetails] = useState(
    Boolean(
      (initial?.needs && initial.needs.length > 0) ||
      (initial?.offers && initial.offers.length > 0) ||
      initial?.desired_outcome ||
      initial?.image_url ||
      storedDraft?.needsInput ||
      storedDraft?.offersInput ||
      storedDraft?.desiredOutcome ||
      storedDraft?.mediaUrl,
    ),
  );

  // Persist unfinished Ping drafts across navigation when draftKey is enabled
  useEffect(() => {
    if (!persistDrafts || !draftKey) return;
    savePingComposerDraft(
      {
        category: d.category,
        headline,
        content: d.content,
        needsInput,
        offersInput,
        desiredOutcome,
        mediaUrl,
        cta_url: d.cta_url,
        cta_label: d.cta_label,
        hub_id: d.hub_id ?? null,
        hub_intent: d.hub_intent ?? null,
      },
      draftKey,
    );
  }, [
    persistDrafts,
    draftKey,
    d.category,
    d.content,
    d.cta_url,
    d.cta_label,
    d.hub_id,
    d.hub_intent,
    headline,
    needsInput,
    offersInput,
    desiredOutcome,
    mediaUrl,
  ]);

  const discardDraft = () => {
    if (draftKey) clearPingComposerDraft(draftKey);
    setD({
      category: initial?.category ?? "progress",
      content: initial?.content ?? "",
      cta_url: initial?.cta_url ?? "",
      cta_label: initial?.cta_label ?? "",
      image_url: initial?.image_url ?? null,
      hub_id: initial?.hub_id ?? null,
      hub_intent: initial?.hub_intent ?? null,
    });
    setHeadline(initial?.headline ?? "");
    setNeedsInput((initial?.needs ?? []).join(", "));
    setOffersInput((initial?.offers ?? []).join(", "));
    setDesiredOutcome(initial?.desired_outcome ?? "");
    setMediaUrl(initial?.image_url ?? "");
    setRestoredDraft(false);
    toast.success("Draft cleared");
  };

  const uploadPingMediaFile = async (file: File) => {
    if (!user) {
      toast.error("Sign in before uploading media.");
      return;
    }
    const mediaKind = file.type.startsWith("video/") ? "video" : "image";
    const validation = validateMediaUpload(file, mediaKind);
    if (!validation.valid) {
      toast.error(validation.error || "Unsupported media file");
      return;
    }
    if (mediaKind === "image" && galleryUrls.length >= IMAGE_GALLERY_MAX) {
      toast.error(`You can attach up to ${IMAGE_GALLERY_MAX} images per Ping.`);
      return;
    }
    try {
      setIsUploadingMedia(true);
      setFailedMediaFile(null);
      setUploadProgress(15);

      let durationSec: number | null = null;
      let posterBlob: Blob | null = null;
      if (mediaKind === "video") {
        const probe = await probeVideoFile(file);
        durationSec = probe.durationSec;
        posterBlob = probe.posterBlob;
        const videoCheck = validateVideoFileMeta({
          size: file.size,
          type: file.type,
          name: file.name,
          durationSec,
        });
        if (!videoCheck.valid) {
          toast.error(videoCheck.error || "Video failed validation.");
          return;
        }
      }

      setUploadProgress(45);
      const { uploadUserMedia } = await import("@/lib/storage");
      const ext =
        file.name.split(".").pop()?.toLowerCase() || (mediaKind === "video" ? "mp4" : "png");
      const path = `${user.id}/pings/${Date.now()}.${ext}`;
      const publicUrl = await uploadUserMedia(path, file, { cacheControl: "3600", upsert: false });

      setUploadProgress(80);
      if (posterBlob) {
        try {
          const posterFile = new File([posterBlob], `poster-${Date.now()}.jpg`, {
            type: "image/jpeg",
          });
          const uploadedPoster = await uploadUserMedia(
            `${user.id}/pings/posters/${Date.now()}.jpg`,
            posterFile,
            { cacheControl: "3600", upsert: false },
          );
          setPosterUrl(uploadedPoster);
        } catch {
          // non-blocking poster upload failure
        }
      }

      if (mediaKind === "video") {
        setMediaUrl(publicUrl);
        setGalleryUrls([publicUrl]);
        setMediaDurationSec(durationSec);
      } else {
        setGalleryUrls((prev) => {
          const filtered = prev.filter((u) => !isVideoMediaUrl(u));
          const next = [...filtered, publicUrl].slice(0, IMAGE_GALLERY_MAX);
          setMediaUrl(next[0] ?? publicUrl);
          return next;
        });
        setPosterUrl(null);
        setMediaDurationSec(null);
      }
      setUploadProgress(100);
      setShowCoordinationDetails(true);
      toast.success(mediaKind === "video" ? "Video uploaded" : "Image added");
    } catch (err) {
      setFailedMediaFile(file);
      const { formatStorageUploadError } = await import("@/lib/storage");
      toast.error(formatStorageUploadError(err, "Media upload failed"));
    } finally {
      setIsUploadingMedia(false);
      setTimeout(() => setUploadProgress(null), 600);
    }
  };

  const handleMediaFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    for (const file of files.slice(0, IMAGE_GALLERY_MAX)) {
      await uploadPingMediaFile(file);
    }
  };

  const handlePingMediaClick = async () => {
    const { pickOrCaptureImage } = await import("@/lib/native");
    await pickOrCaptureImage(mediaFileInputRef.current, uploadPingMediaFile);
  };

  const [errors, setErrors] = useState<Partial<Record<keyof PingDraft, string>>>({});
  const [showCta, setShowCta] = useState(Boolean(initial?.cta_url || storedDraft?.cta_url));
  const [showPoll, setShowPoll] = useState(Boolean(initial?.poll));
  const [pollQuestion, setPollQuestion] = useState(initial?.poll?.question ?? "");
  const [pollOptions, setPollOptions] = useState<string[]>(
    initial?.poll?.options && initial.poll.options.length >= 2 ? initial.poll.options : ["", ""],
  );
  const [pollDurationHours, setPollDurationHours] = useState<number>(24);
  const [showSchedule, setShowSchedule] = useState(Boolean(initial?.scheduled_for));
  const [scheduledFor, setScheduledFor] = useState(initial?.scheduled_for ?? "");

  const { data: myHubs } = useQuery(myHubsQuery(user?.id));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();

    const needsList = needsInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const offersList = offersInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const hasStructuredExtras =
      Boolean(headline.trim()) ||
      needsList.length > 0 ||
      offersList.length > 0 ||
      Boolean(desiredOutcome.trim()) ||
      (d.category !== "progress" &&
        d.category !== "idea" &&
        d.category !== "question" &&
        d.category !== "opportunity" &&
        d.category !== "launch" &&
        d.category !== "milestone");

    const finalContent = hasStructuredExtras
      ? serializeStructuredPing({
          intentFormat: d.category,
          headline,
          description: d.content,
          needs: needsList,
          offers: offersList,
          desiredOutcome,
        })
      : d.content;

    const selectedIntentMeta = INTENT_FORMATS.find((f) => f.value === d.category);
    const dbCompatibleCategory: Category = selectedIntentMeta
      ? selectedIntentMeta.dbCategory
      : d.category;

    const r = pingSchema.safeParse(
      showCta
        ? { ...d, category: dbCompatibleCategory, content: finalContent }
        : {
            ...d,
            category: dbCompatibleCategory,
            content: finalContent,
            cta_url: "",
            cta_label: "",
          },
    );

    if (!r.success) {
      const errs: Record<string, string> = {};
      r.error.issues.forEach((i) => (errs[String(i.path[0])] ??= i.message));
      setErrors(errs);
      return;
    }
    setErrors({});
    const cleanPollOptions = pollOptions.map((o) => o.trim()).filter(Boolean);
    const pollPayload =
      showPoll && pollQuestion.trim().length >= 3 && cleanPollOptions.length >= 2
        ? {
            question: pollQuestion.trim(),
            options: cleanPollOptions.slice(0, 4),
            expires_at: new Date(Date.now() + pollDurationHours * 3_600_000).toISOString(),
          }
        : null;

    const mergedMediaUrls = Array.from(
      new Set([...galleryUrls, ...(mediaUrl.trim() ? [mediaUrl.trim()] : [])]),
    ).slice(0, IMAGE_GALLERY_MAX);
    const hasVideo = mergedMediaUrls.some((u) => isVideoMediaUrl(u));
    const derivedFormat: PingContentFormat = hasVideo
      ? "video"
      : mergedMediaUrls.length > 0
        ? "image"
        : "text";

    onSubmit({
      ...(r.data as PingDraft),
      headline: headline.trim() || null,
      needs: needsList,
      offers: offersList,
      desired_outcome: desiredOutcome.trim() || null,
      image_url: mergedMediaUrls[0] ?? null,
      media_urls: mergedMediaUrls.length > 0 ? mergedMediaUrls : null,
      content_format: derivedFormat,
      poster_url: hasVideo ? posterUrl : null,
      captions_text: hasVideo && captionsText.trim() ? captionsText.trim() : null,
      media_duration_sec: hasVideo ? mediaDurationSec : null,
      location_tag: locationTag.trim() || null,
      imported_source_url: initial?.imported_source_url ?? null,
      imported_source_platform: initial?.imported_source_platform ?? null,
      hub_id: d.hub_id || null,
      hub_intent: d.hub_id ? d.hub_intent || null : null,
      scheduled_for: showSchedule && scheduledFor ? new Date(scheduledFor).toISOString() : null,
      poll: pollPayload,
      music: musicDraft,
    });
  };

  const left = PING_MAX - d.content.length;

  return (
    <form onSubmit={submit} className="surface-card rounded-3xl p-5 sm:p-7" noValidate>
      {restoredDraft && (
        <div
          role="status"
          className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-primary/25 bg-primary/10 px-4 py-2.5 text-xs"
        >
          <span className="font-medium text-foreground">
            Unfinished Ping draft restored automatically.
          </span>
          <button
            type="button"
            onClick={discardDraft}
            className="font-semibold text-primary hover:underline shrink-0"
          >
            Discard draft
          </button>
        </div>
      )}
      {/* 1. Intent Type Selector */}
      <fieldset>
        <legend className="text-sm font-semibold text-foreground">Intent type</legend>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Choose the intention behind your Ping so the right people can coordinate with you.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {INTENT_FORMATS.map((c) => {
            const selected = d.category === c.value;
            return (
              <button
                type="button"
                key={c.value}
                onClick={() => setD({ ...d, category: c.value })}
                aria-pressed={selected}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all active:scale-95",
                  selected
                    ? "border-primary bg-lime text-lime-foreground shadow-sm"
                    : "border-border bg-card text-foreground hover:bg-secondary",
                )}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* 2. Objective / Intent Headline (Optional, lightweight) */}
      <div className="mt-5">
        <Label htmlFor="ping-headline" className="text-sm font-semibold">
          Objective / Headline <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="ping-headline"
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          placeholder="e.g. Looking for a design partner for our clinical AI workflow"
          maxLength={110}
          className="mt-1.5 rounded-2xl bg-card"
        />
      </div>

      {/* 3. Natural-Language Description */}
      <div className="mt-5">
        <Label htmlFor="content" className="text-sm font-semibold">
          Description
        </Label>
        <Textarea
          id="content"
          value={d.content}
          onChange={(e) => setD({ ...d, content: e.target.value })}
          rows={6}
          placeholder="Share what you're building, what you need, or how others can collaborate with you…"
          className="mt-1.5 resize-y rounded-2xl text-base leading-relaxed"
          aria-invalid={!!errors.content}
          aria-describedby="content-help"
        />
        <div id="content-help" className="mt-1.5 flex justify-between text-xs">
          <span className="text-destructive">{errors.content}</span>
          <span
            className={cn("tabular-nums", left < 0 ? "text-destructive" : "text-muted-foreground")}
          >
            {left}
          </span>
        </div>
      </div>

      {/* 4. Progressive Disclosure: Needs, Offers, Media & Desired Outcome */}
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setShowCoordinationDetails((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-3.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-secondary"
        >
          <Sparkles className="size-3.5 text-primary" />
          <span>Add needs, offers, media & desired outcome</span>
          {showCoordinationDetails ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </button>

        {showCoordinationDetails && (
          <div className="mt-3 grid gap-4 rounded-2xl border border-border/70 bg-secondary/30 p-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ping-needs" className="text-xs font-semibold">
                Skills or resources needed
              </Label>
              <Input
                id="ping-needs"
                value={needsInput}
                onChange={(e) => setNeedsInput(e.target.value)}
                placeholder="e.g. Rust engineer, Beta testers, Seed intro"
                className="mt-1 rounded-xl bg-card text-xs"
              />
            </div>

            <div>
              <Label htmlFor="ping-offers" className="text-xs font-semibold">
                Contributions or value offered
              </Label>
              <Input
                id="ping-offers"
                value={offersInput}
                onChange={(e) => setOffersInput(e.target.value)}
                placeholder="e.g. Equity, Early API access, Paid contract"
                className="mt-1 rounded-xl bg-card text-xs"
              />
            </div>

            <div>
              <Label htmlFor="ping-outcome" className="text-xs font-semibold">
                Desired outcome
              </Label>
              <Input
                id="ping-outcome"
                value={desiredOutcome}
                onChange={(e) => setDesiredOutcome(e.target.value)}
                placeholder="e.g. Onboard 5 pilot teams by Friday"
                className="mt-1 rounded-xl bg-card text-xs"
              />
            </div>

            <div>
              <Label
                htmlFor="ping-location"
                className="text-xs font-semibold flex items-center gap-1"
              >
                <MapPin className="size-3 text-primary" /> Location tag (optional)
              </Label>
              <Input
                id="ping-location"
                value={locationTag}
                onChange={(e) => setLocationTag(e.target.value)}
                placeholder="e.g. Lagos, Nairobi, London"
                maxLength={80}
                className="mt-1 rounded-xl bg-card text-xs"
              />
            </div>

            <div className="sm:col-span-2 space-y-2">
              <Label htmlFor="ping-media" className="text-xs font-semibold flex items-center gap-1">
                <ImageIcon className="size-3.5 text-primary" /> Photos (up to {IMAGE_GALLERY_MAX})
                or Video (MP4/WebM/MOV)
              </Label>
              <div className="mt-1 flex flex-col sm:flex-row gap-2">
                <Input
                  id="ping-media"
                  type="url"
                  value={mediaUrl}
                  onChange={(e) => {
                    const next = e.target.value;
                    setMediaUrl(next);
                    if (next.trim() && !galleryUrls.includes(next.trim())) {
                      setGalleryUrls((prev) =>
                        [next.trim(), ...prev.filter((u) => u !== mediaUrl)].slice(
                          0,
                          IMAGE_GALLERY_MAX,
                        ),
                      );
                    }
                  }}
                  placeholder="https://…/preview.png or upload from device"
                  className="rounded-xl bg-card text-xs flex-1"
                />
                <input
                  ref={mediaFileInputRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
                  className="hidden"
                  onChange={handleMediaFileUpload}
                />
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isUploadingMedia || !user}
                    onClick={() => void handlePingMediaClick()}
                    className="rounded-xl text-xs gap-1.5 shrink-0"
                  >
                    {isUploadingMedia ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Upload className="size-3.5" />
                    )}
                    {isUploadingMedia ? `Uploading ${uploadProgress ?? 50}%…` : "Upload media"}
                  </Button>
                  {failedMediaFile && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void uploadPingMediaFile(failedMediaFile)}
                      className="rounded-xl text-xs gap-1 text-destructive border-destructive/40"
                    >
                      <RotateCcw className="size-3" /> Retry
                    </Button>
                  )}
                  {(mediaUrl || galleryUrls.length > 0) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Clear media attachment"
                      onClick={() => {
                        setMediaUrl("");
                        setGalleryUrls([]);
                        setPosterUrl(null);
                        setMediaDurationSec(null);
                        setCaptionsText("");
                      }}
                      className="size-8 rounded-xl"
                    >
                      <X className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              {galleryUrls.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                  {galleryUrls.map((u) => (
                    <div
                      key={u}
                      className="relative aspect-square rounded-xl overflow-hidden border border-border/70 bg-black/20"
                    >
                      {isVideoMediaUrl(u) ? (
                        <video
                          src={u}
                          poster={posterUrl ?? undefined}
                          muted
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <img src={u} alt="Attached media" className="h-full w-full object-cover" />
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const next = galleryUrls.filter((x) => x !== u);
                          setGalleryUrls(next);
                          setMediaUrl(next[0] ?? "");
                        }}
                        aria-label="Remove media item"
                        className="absolute top-1 right-1 size-6 rounded-full bg-black/70 text-white flex items-center justify-center"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {galleryUrls.some((u) => isVideoMediaUrl(u)) && (
                <div className="pt-1">
                  <Label htmlFor="video-captions" className="text-xs font-semibold">
                    Video captions / subtitles (optional)
                  </Label>
                  <Input
                    id="video-captions"
                    value={captionsText}
                    onChange={(e) => setCaptionsText(e.target.value)}
                    placeholder="Add caption text or transcript summary for viewers watching muted…"
                    maxLength={300}
                    className="mt-1 rounded-xl bg-card text-xs"
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 5. Visibility / Community Hub Selector */}
      {myHubs && myHubs.length > 0 && (
        <div className="mt-5 rounded-2xl bg-secondary/40 p-4 border border-border/70">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <Building2 className="size-4 text-primary" />
            <span>Visibility & Community Hub</span>
          </div>

          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setD({ ...d, hub_id: null, hub_intent: null })}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold transition-all",
                !d.hub_id
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card hover:bg-secondary",
              )}
            >
              Public Feed
            </button>
            {myHubs.map((h) => (
              <button
                type="button"
                key={h.hub.id}
                onClick={() => setD({ ...d, hub_id: h.hub.id })}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold transition-all",
                  d.hub_id === h.hub.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:bg-secondary",
                )}
              >
                {h.hub.name}
              </button>
            ))}
          </div>

          {d.hub_id && (
            <div className="mt-3 pt-3 border-t border-border/60">
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Hub discussion tag:
              </label>
              <div className="flex flex-wrap gap-1.5">
                {HUB_INTENTS.map((intent) => (
                  <button
                    type="button"
                    key={intent.value}
                    onClick={() =>
                      setD({
                        ...d,
                        hub_intent: d.hub_intent === intent.value ? null : intent.value,
                      })
                    }
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs font-medium transition-all",
                      d.hub_intent === intent.value
                        ? "border-foreground bg-lime text-lime-foreground font-bold"
                        : "border-border bg-card hover:bg-secondary",
                    )}
                  >
                    #{intent.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 6. Optional Poll, Schedule & CTA Link */}
      {showPoll && (
        <div className="mt-4 space-y-3 rounded-2xl border border-border/70 bg-secondary/45 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <BarChart2 className="size-4 text-primary" /> Interactive Poll
            </span>
            <button
              type="button"
              onClick={() => {
                setShowPoll(false);
                setPollQuestion("");
                setPollOptions(["", ""]);
              }}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              Remove poll
            </button>
          </div>
          <div>
            <Label htmlFor="poll-question" className="text-xs">
              Poll question
            </Label>
            <Input
              id="poll-question"
              value={pollQuestion}
              onChange={(e) => setPollQuestion(e.target.value)}
              placeholder="What should we build or prioritise next?"
              maxLength={240}
              className="mt-1 rounded-xl bg-card"
            />
          </div>
          <div className="space-y-2">
            {pollOptions.map((opt, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  value={opt}
                  onChange={(e) => {
                    const next = [...pollOptions];
                    next[idx] = e.target.value;
                    setPollOptions(next);
                  }}
                  placeholder={`Option ${idx + 1}`}
                  maxLength={120}
                  className="rounded-xl bg-card text-sm"
                />
                {pollOptions.length > 2 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-xl shrink-0"
                    onClick={() => setPollOptions(pollOptions.filter((_, i) => i !== idx))}
                    aria-label={`Remove option ${idx + 1}`}
                  >
                    <X className="size-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {pollOptions.length < 4 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full text-xs gap-1"
                onClick={() => setPollOptions([...pollOptions, ""])}
              >
                <Plus className="size-3.5" /> Add option
              </Button>
            ) : (
              <span className="text-[11px] text-muted-foreground">Max 4 options</span>
            )}
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Duration:
              <select
                value={pollDurationHours}
                onChange={(e) => setPollDurationHours(Number(e.target.value))}
                className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground"
              >
                <option value={24}>24 hours</option>
                <option value={72}>3 days</option>
                <option value={168}>7 days</option>
              </select>
            </label>
          </div>
        </div>
      )}

      {showSchedule && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-secondary/45 p-4">
          <div className="flex-1 min-w-[200px]">
            <Label htmlFor="schedule-for" className="text-xs flex items-center gap-1.5">
              <CalendarClock className="size-3.5 text-primary" /> Schedule publication time
            </Label>
            <Input
              id="schedule-for"
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              className="mt-1.5 rounded-xl bg-card"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setShowSchedule(false);
              setScheduledFor("");
            }}
            className="text-xs text-muted-foreground underline"
          >
            Publish immediately
          </button>
        </div>
      )}

      {showCta ? (
        <div className="mt-4 grid gap-4 rounded-2xl bg-secondary/50 p-4 sm:grid-cols-[2fr_1fr]">
          <div>
            <Label htmlFor="cta_url">Link</Label>
            <Input
              id="cta_url"
              type="url"
              inputMode="url"
              placeholder="https://yourproduct.com/waitlist"
              value={d.cta_url}
              onChange={(e) => setD({ ...d, cta_url: e.target.value })}
              className="mt-1.5 rounded-xl bg-card"
              aria-invalid={!!errors.cta_url}
            />
            {errors.cta_url && <p className="mt-1 text-xs text-destructive">{errors.cta_url}</p>}
          </div>
          <div>
            <Label htmlFor="cta_label">Button label</Label>
            <Input
              id="cta_label"
              placeholder="Join the waitlist"
              value={d.cta_label}
              onChange={(e) => setD({ ...d, cta_label: e.target.value })}
              className="mt-1.5 rounded-xl bg-card"
              maxLength={40}
            />
            {errors.cta_label && (
              <p className="mt-1 text-xs text-destructive">{errors.cta_label}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setShowCta(false);
              setD({ ...d, cta_url: "", cta_label: "" });
            }}
            className="justify-self-start text-xs text-muted-foreground underline"
          >
            Remove link
          </button>
        </div>
      ) : null}

      {showMusic && (
        <div className="mt-4">
          <MusicAttachmentPicker value={musicDraft} onChange={setMusicDraft} />
        </div>
      )}

      {showPreview && (
        <div className="mt-4 rounded-2xl border border-primary/30 bg-card p-4 space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-primary flex items-center gap-1">
            <Eye className="size-3.5" /> Pre-Publish Preview
          </p>
          {headline.trim() && (
            <h3 className="font-display text-base font-bold text-foreground">{headline.trim()}</h3>
          )}
          <p className="text-sm whitespace-pre-line text-foreground/95">
            {d.content.trim() || "Write your Ping content to preview…"}
          </p>
          {locationTag.trim() && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <MapPin className="size-3 text-primary" /> {locationTag.trim()}
            </p>
          )}
          {musicDraft && (
            <p className="text-xs text-primary flex items-center gap-1">
              <Music className="size-3" /> {musicDraft.track.title} — {musicDraft.track.artist} (
              {musicDraft.clipDurationSec}s)
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!showCta && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full text-xs gap-1.5"
            onClick={() => setShowCta(true)}
          >
            <Link2 className="size-3.5" /> Add link
          </Button>
        )}
        {!showMusic && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full text-xs gap-1.5"
            onClick={() => setShowMusic(true)}
          >
            <Music className="size-3.5" /> Add music
          </Button>
        )}
        {!showPoll && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full text-xs gap-1.5"
            onClick={() => setShowPoll(true)}
          >
            <BarChart2 className="size-3.5" /> Add poll
          </Button>
        )}
        {!showSchedule && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full text-xs gap-1.5"
            onClick={() => setShowSchedule(true)}
          >
            <CalendarClock className="size-3.5" /> Schedule
          </Button>
        )}
        <Button
          type="button"
          variant={showPreview ? "secondary" : "ghost"}
          size="sm"
          className="rounded-full text-xs gap-1.5 ml-auto"
          onClick={() => setShowPreview((prev) => !prev)}
        >
          <Eye className="size-3.5" /> {showPreview ? "Hide preview" : "Preview"}
        </Button>
      </div>

      <div className="mt-6 flex items-center justify-end gap-3">
        <Button type="submit" variant="hero" size="lg" disabled={pending} className="rounded-full">
          {pending ? "Publishing…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
