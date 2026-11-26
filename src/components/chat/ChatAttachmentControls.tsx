import { useEffect, useRef, useState } from "react";
import {
  Camera,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  Paperclip,
  RotateCcw,
  Send,
  Smile,
  Square,
  Trash2,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  capturePhotoWithCamera,
  captureVideoWithCamera,
  pickMediaFromGallery,
} from "@/lib/media-picker";
import {
  createAuthorizedMediaReadUrl,
  DEFAULT_DM_SIGNED_URL_TTL_SEC,
  isPrivateMediaRef,
} from "@/lib/storage";
import {
  buildMediaRecorderOptions,
  buildVoiceNoteFile,
  formatMicrophoneError,
  formatVoiceDuration,
  isVoiceRecordingSupported,
  selectSupportedAudioMimeType,
  VOICE_NOTE_MAX_DURATION_SEC,
  type NegotiatedVoiceFormat,
} from "@/lib/voice-recorder";
import { cn } from "@/lib/utils";

export interface PingStickerItem {
  id: string;
  emoji: string;
  label: string;
  tone: string;
}

export const PING_STICKER_PACK: readonly PingStickerItem[] = [
  {
    id: "lime-rocket",
    emoji: "🚀",
    label: "Shipped",
    tone: "bg-lime/20 border-lime/40 text-foreground",
  },
  {
    id: "gold-deal",
    emoji: "🤝",
    label: "Let's Build",
    tone: "bg-gold/15 border-gold/40 text-foreground",
  },
  {
    id: "signal-live",
    emoji: "📡",
    label: "Live Signal",
    tone: "bg-primary/15 border-primary/40 text-foreground",
  },
  {
    id: "flame-focus",
    emoji: "🔥",
    label: "Locked In",
    tone: "bg-orange-500/15 border-orange-500/35 text-foreground",
  },
  {
    id: "spark-idea",
    emoji: "💡",
    label: "Big Idea",
    tone: "bg-yellow-500/15 border-yellow-500/35 text-foreground",
  },
  {
    id: "coffee-sync",
    emoji: "☕",
    label: "Coffee Sync?",
    tone: "bg-secondary border-border text-foreground",
  },
  {
    id: "clap-win",
    emoji: "🎉",
    label: "Milestone!",
    tone: "bg-emerald-500/15 border-emerald-500/35 text-foreground",
  },
  {
    id: "salute-respect",
    emoji: "🫡",
    label: "Respect",
    tone: "bg-primary/10 border-primary/30 text-foreground",
  },
] as const;

const STICKER_BY_ID = new Map(PING_STICKER_PACK.map((s) => [s.id, s]));

export function formatStickerToken(sticker: PingStickerItem): string {
  return `[sticker:${sticker.id}] ${sticker.emoji} ${sticker.label}`;
}

export function parseStickerMessage(content: string | null | undefined): PingStickerItem | null {
  if (!content) return null;
  const match = content.trim().match(/^\[sticker:([a-z0-9-]+)\](?:\s+.*)?$/i);
  if (!match?.[1]) return null;
  return STICKER_BY_ID.get(match[1]) ?? null;
}

export function ChatStickerBubble({ sticker }: { sticker: PingStickerItem }) {
  return (
    <div
      className={`inline-flex flex-col items-center gap-1 rounded-2xl border px-4 py-2.5 shadow-soft ${sticker.tone}`}
    >
      <span className="text-3xl leading-none" role="img" aria-label={sticker.label}>
        {sticker.emoji}
      </span>
      <span className="text-[11px] font-bold tracking-tight">{sticker.label}</span>
    </div>
  );
}

export function ChatStickerPicker({
  onSelect,
  disabled,
}: {
  onSelect: (sticker: PingStickerItem) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          className="size-9 rounded-full shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Send sticker"
          title="Stickers"
        >
          <Smile className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-64 rounded-2xl p-2.5">
        <p className="px-1.5 pb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          PING Stickers
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {PING_STICKER_PACK.map((sticker) => (
            <button
              key={sticker.id}
              type="button"
              onClick={() => {
                setOpen(false);
                onSelect(sticker);
              }}
              className="flex items-center gap-2 rounded-xl border border-border/60 bg-secondary/40 px-2.5 py-2 text-left text-xs font-semibold hover:bg-secondary transition-colors"
            >
              <span className="text-lg leading-none">{sticker.emoji}</span>
              <span className="truncate">{sticker.label}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

type VoiceStage = "idle" | "recording" | "preview" | "uploading";

export interface VoiceNoteButtonProps {
  /** Active conversation/hub ID — changing conversations cancels active recording & revokes previews. */
  conversationId?: string;
  /** Primary voice-note send handler (uploads audio & sends immediately; throws on failure for retry). */
  onSendVoiceNote?: (file: File) => Promise<void>;
  /** Backward-compatible fallback (attaches voice note to composer). */
  onRecorded?: (file: File) => void | Promise<void>;
  disabled?: boolean;
}

export function VoiceNoteButton({
  conversationId,
  onSendVoiceNote,
  onRecorded,
  disabled,
}: VoiceNoteButtonProps) {
  const [stage, setStage] = useState<VoiceStage>("idle");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [recordedFile, setRecordedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canceledRef = useRef(false);
  const negotiatedRef = useRef<NegotiatedVoiceFormat | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const prevConvIdRef = useRef<string | undefined>(conversationId);

  const stopTracks = (stream?: MediaStream | null) => {
    stream?.getTracks().forEach((track) => {
      try {
        track.onended = null;
        track.stop();
      } catch {
        // Ignore already-stopped tracks
      }
    });
  };

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const revokePreviewUrl = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  };

  const teardownRecording = (cancel: boolean) => {
    clearTimer();
    canceledRef.current = cancel;
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    } catch {
      // Ignore teardown errors
    }
    recorderRef.current = null;
    stopTracks(streamRef.current);
    streamRef.current = null;
  };

  const discardPreview = () => {
    revokePreviewUrl();
    setPreviewUrl(null);
    setRecordedFile(null);
    setSendError(null);
    setElapsedSec(0);
    setStage("idle");
  };

  // Cleanup microphone tracks and object URLs on unmount
  useEffect(() => {
    return () => {
      teardownRecording(true);
      revokePreviewUrl();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cancel active recording and discard unsent preview when switching conversations
  useEffect(() => {
    if (prevConvIdRef.current !== conversationId) {
      prevConvIdRef.current = conversationId;
      teardownRecording(true);
      discardPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  const startRecording = async () => {
    if (!isVoiceRecordingSupported()) {
      toast.error("Voice recording isn't supported in this browser or device.");
      return;
    }

    discardPreview();

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const negotiated = selectSupportedAudioMimeType();
      negotiatedRef.current = negotiated;

      const recorder = new MediaRecorder(stream, buildMediaRecorderOptions(negotiated));

      chunksRef.current = [];
      canceledRef.current = false;
      recorderRef.current = recorder;

      // Handle unexpected hardware/OS interruption while recording
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          if (recorderRef.current?.state === "recording") {
            toast.error("Voice recording was interrupted by another audio source.");
            try {
              recorderRef.current.stop();
            } catch {
              teardownRecording(true);
              setStage("idle");
            }
          }
        };
      });

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data);
        }
      };

      recorder.onerror = () => {
        clearTimer();
        stopTracks(streamRef.current);
        streamRef.current = null;
        recorderRef.current = null;
        setStage("idle");
        setElapsedSec(0);
        toast.error("Voice recording failed unexpectedly. Please try again.");
      };

      recorder.onstop = () => {
        clearTimer();
        stopTracks(stream);
        if (streamRef.current === stream) {
          streamRef.current = null;
        }
        if (recorderRef.current === recorder) {
          recorderRef.current = null;
        }

        if (canceledRef.current) {
          chunksRef.current = [];
          setStage("idle");
          setElapsedSec(0);
          return;
        }

        const built = buildVoiceNoteFile(
          chunksRef.current,
          recorder.mimeType,
          negotiatedRef.current,
        );
        chunksRef.current = [];

        if ("error" in built) {
          toast.error(built.error);
          setStage("idle");
          setElapsedSec(0);
          return;
        }

        revokePreviewUrl();
        const url = URL.createObjectURL(built.file);
        previewUrlRef.current = url;
        setRecordedFile(built.file);
        setPreviewUrl(url);
        setSendError(null);
        setStage("preview");
      };

      recorder.start();
      setStage("recording");
      setElapsedSec(0);

      timerRef.current = setInterval(() => {
        setElapsedSec((prev) => {
          if (prev >= VOICE_NOTE_MAX_DURATION_SEC - 1) {
            try {
              if (recorder.state === "recording") {
                recorder.stop();
              }
            } catch {
              // Ignore stop race
            }
            return VOICE_NOTE_MAX_DURATION_SEC;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err) {
      stopTracks(stream);
      streamRef.current = null;
      recorderRef.current = null;
      setStage("idle");
      toast.error(formatMicrophoneError(err));
    }
  };

  const finishRecording = (cancel: boolean) => {
    canceledRef.current = cancel;
    clearTimer();
    try {
      if (recorderRef.current && recorderRef.current.state === "recording") {
        recorderRef.current.stop();
      } else {
        stopTracks(streamRef.current);
        streamRef.current = null;
        setStage("idle");
        setElapsedSec(0);
      }
    } catch {
      stopTracks(streamRef.current);
      streamRef.current = null;
      setStage("idle");
      setElapsedSec(0);
    }
  };

  const handleSendRecorded = async () => {
    if (!recordedFile || stage === "uploading") return;
    setStage("uploading");
    setSendError(null);

    try {
      if (onSendVoiceNote) {
        await onSendVoiceNote(recordedFile);
      } else if (onRecorded) {
        await onRecorded(recordedFile);
      }
      discardPreview();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Voice note upload failed. Tap retry to send.";
      setSendError(msg);
      setStage("preview");
    }
  };

  if (stage === "recording") {
    return (
      <div
        data-testid="voice-note-recording"
        className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive shrink-0"
      >
        <span className="size-2 rounded-full bg-destructive animate-pulse" aria-hidden />
        <span className="tabular-nums font-mono">{formatVoiceDuration(elapsedSec)}</span>
        <button
          type="button"
          onClick={() => finishRecording(false)}
          aria-label="Stop recording to preview"
          className="rounded-full p-1 hover:bg-destructive/20 transition-colors"
          title="Stop & preview voice note"
        >
          <Square className="size-3.5 fill-current" />
        </button>
        <button
          type="button"
          onClick={() => finishRecording(true)}
          aria-label="Cancel voice recording"
          className="rounded-full p-1 text-muted-foreground hover:text-foreground transition-colors"
          title="Discard recording"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    );
  }

  if ((stage === "preview" || stage === "uploading") && previewUrl && recordedFile) {
    const isUploading = stage === "uploading";
    return (
      <div
        data-testid="voice-note-preview"
        className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-primary/35 bg-primary/10 px-2.5 py-1.5 text-xs max-w-full shrink-0"
      >
        <audio
          src={previewUrl}
          controls
          preload="metadata"
          aria-label="Voice note preview"
          className="h-8 w-36 sm:w-44 max-w-full"
        />
        <span className="tabular-nums font-mono text-[11px] font-semibold text-primary">
          {formatVoiceDuration(elapsedSec)}
        </span>
        <button
          type="button"
          disabled={isUploading}
          onClick={() => void handleSendRecorded()}
          aria-label={sendError ? "Retry sending voice note" : "Send voice note"}
          title={sendError ? `Retry: ${sendError}` : "Send voice note"}
          className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground hover:opacity-90 disabled:opacity-60 transition-opacity"
        >
          {isUploading ? (
            <>
              <Loader2 className="size-3 animate-spin" />
              <span>Sending…</span>
            </>
          ) : sendError ? (
            <>
              <RotateCcw className="size-3" />
              <span>Retry</span>
            </>
          ) : (
            <>
              <Send className="size-3" />
              <span>Send</span>
            </>
          )}
        </button>
        <button
          type="button"
          disabled={isUploading}
          onClick={discardPreview}
          aria-label="Discard voice note"
          title="Discard voice note"
          className="rounded-full p-1 text-muted-foreground hover:text-destructive disabled:opacity-50 transition-colors"
        >
          <Trash2 className="size-3.5" />
        </button>
        {sendError && (
          <span role="alert" className="w-full text-[11px] text-destructive truncate">
            {sendError}
          </span>
        )}
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={disabled}
      onClick={() => void startRecording()}
      className="size-9 rounded-full shrink-0 text-muted-foreground hover:text-foreground"
      aria-label="Record voice note"
      title="Record voice note"
    >
      <Mic className="size-4" />
    </Button>
  );
}

export function ChatAttachmentMenu({
  onFileSelected,
  onFilesSelected,
  disabled,
  loading,
}: {
  onFileSelected: (file: File) => void | Promise<void>;
  onFilesSelected?: (files: File[]) => void | Promise<void>;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled || loading}
          className="size-9 rounded-full shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Attach photo, video, or document"
          title="Attach media or document"
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin text-primary" />
          ) : (
            <Paperclip className="size-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-52 rounded-2xl p-1.5">
        <DropdownMenuItem
          className="rounded-xl cursor-pointer gap-2"
          onClick={() => {
            void capturePhotoWithCamera().then((outcome) => {
              const first = outcome.files[0];
              if (first) return onFileSelected(first);
            });
          }}
        >
          <Camera className="size-4 text-primary" /> Take Photo
        </DropdownMenuItem>
        <DropdownMenuItem
          className="rounded-xl cursor-pointer gap-2"
          onClick={() => {
            void captureVideoWithCamera().then((outcome) => {
              const first = outcome.files[0];
              if (first) return onFileSelected(first);
            });
          }}
        >
          <Video className="size-4 text-primary" /> Record Video
        </DropdownMenuItem>
        <DropdownMenuItem
          className="rounded-xl cursor-pointer gap-2"
          onClick={() => {
            void pickMediaFromGallery({
              mediaType: "all",
              multiple: Boolean(onFilesSelected),
              limit: 5,
            }).then((outcome) => {
              if (outcome.files.length === 0) return;
              if (onFilesSelected && outcome.files.length > 1) {
                return onFilesSelected(outcome.files);
              }
              const first = outcome.files[0];
              if (first) return onFileSelected(first);
            });
          }}
        >
          <ImageIcon className="size-4 text-primary" /> Photo / Video Library
        </DropdownMenuItem>
        <DropdownMenuItem
          className="rounded-xl cursor-pointer gap-2"
          onClick={() => {
            void pickMediaFromGallery({
              accept: ".pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,application/pdf",
              multiple: false,
            }).then((outcome) => {
              const first = outcome.files[0];
              if (first) return onFileSelected(first);
            });
          }}
        >
          <FileText className="size-4 text-gold" /> Document / File
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ResolvedChatMedia({
  mediaUrl,
  mediaType,
  isOwnMessage = false,
}: {
  mediaUrl: string;
  mediaType?: "image" | "video" | "audio" | "document" | null;
  isOwnMessage?: boolean;
}) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(() =>
    isPrivateMediaRef(mediaUrl) ? null : mediaUrl,
  );
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const retryCountRef = useRef(0);

  useEffect(() => {
    let active = true;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    setFailed(false);
    setRefreshing(false);
    retryCountRef.current = 0;

    if (!isPrivateMediaRef(mediaUrl)) {
      setResolvedUrl(mediaUrl);
      return;
    }

    const fetchSigned = async (forceRefresh: boolean) => {
      const url = await createAuthorizedMediaReadUrl(mediaUrl, { forceRefresh });
      if (!active) return;
      if (!url) {
        setFailed(true);
        setResolvedUrl(null);
        return;
      }
      setFailed(false);
      setResolvedUrl(url);

      // Proactively renew short-lived signed URLs before expiry while chat stays open
      const renewDelayMs = Math.max(60_000, (DEFAULT_DM_SIGNED_URL_TTL_SEC - 90) * 1000);
      refreshTimer = setTimeout(() => {
        if (active) void fetchSigned(true);
      }, renewDelayMs);
    };

    void fetchSigned(false);
    return () => {
      active = false;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [mediaUrl]);

  const handleMediaLoadError = async () => {
    if (isPrivateMediaRef(mediaUrl) && retryCountRef.current < 1) {
      retryCountRef.current += 1;
      setRefreshing(true);
      const freshUrl = await createAuthorizedMediaReadUrl(mediaUrl, { forceRefresh: true });
      setRefreshing(false);
      if (freshUrl) {
        setFailed(false);
        setResolvedUrl(freshUrl);
        return;
      }
    }
    setFailed(true);
  };

  const handleManualRefresh = async () => {
    setFailed(false);
    if (!isPrivateMediaRef(mediaUrl)) {
      setResolvedUrl(mediaUrl);
      return;
    }
    setRefreshing(true);
    const freshUrl = await createAuthorizedMediaReadUrl(mediaUrl, { forceRefresh: true });
    setRefreshing(false);
    if (freshUrl) {
      setResolvedUrl(freshUrl);
    } else {
      setFailed(true);
    }
  };

  if (failed) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl bg-background/40 px-3 py-2 text-xs text-muted-foreground">
        <span>Attachment unavailable</span>
        {isPrivateMediaRef(mediaUrl) && (
          <button
            type="button"
            onClick={() => void handleManualRefresh()}
            className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
            aria-label="Retry loading attachment"
          >
            <RotateCcw className="size-3" /> Retry
          </button>
        )}
      </div>
    );
  }

  if (!resolvedUrl || refreshing) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-background/30 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Loading attachment…
      </div>
    );
  }

  const isVoiceNotePath =
    /voice-note-.*\.(webm|ogg|mp4|m4a)(\?|$)/i.test(mediaUrl) ||
    /voice-note-.*\.(webm|ogg|mp4|m4a)(\?|$)/i.test(resolvedUrl);

  const inferredType =
    mediaType ??
    (isVoiceNotePath || /\.(mp3|m4a|ogg|wav|aac)(\?|$)/i.test(resolvedUrl)
      ? "audio"
      : /\.(mp4|webm|mov)(\?|$)/i.test(resolvedUrl)
        ? "video"
        : /\.(pdf|txt|csv|doc|docx|xls|xlsx|ppt|pptx|zip)(\?|$)/i.test(resolvedUrl)
          ? "document"
          : "image");

  if (inferredType === "image") {
    return (
      <img
        src={resolvedUrl}
        alt="Attachment"
        onError={() => void handleMediaLoadError()}
        className="max-h-60 rounded-lg object-cover"
        loading="lazy"
      />
    );
  }

  if (inferredType === "video") {
    return (
      <video
        src={resolvedUrl}
        controls
        playsInline
        preload="metadata"
        onError={() => void handleMediaLoadError()}
        className="max-h-60 rounded-lg"
      />
    );
  }

  if (inferredType === "audio") {
    return (
      <div
        data-testid="voice-note-player"
        className={cn(
          "flex flex-col gap-1.5 rounded-xl px-2.5 py-2 min-w-[220px] max-w-full",
          isOwnMessage
            ? "bg-primary-foreground/15 text-primary-foreground"
            : "bg-background/70 text-foreground border border-border/50",
        )}
      >
        <div className="flex items-center gap-1.5 text-[11px] font-semibold">
          <span
            className={cn(
              "inline-flex size-5 items-center justify-center rounded-full shrink-0",
              isOwnMessage ? "bg-primary-foreground/20" : "bg-primary/15 text-primary",
            )}
          >
            <Mic className="size-3" />
          </span>
          <span>Voice message</span>
        </div>
        <audio
          src={resolvedUrl}
          controls
          preload="metadata"
          onError={() => void handleMediaLoadError()}
          className="h-9 w-full max-w-[260px]"
          aria-label="Voice message playback"
        />
      </div>
    );
  }

  return (
    <a
      href={resolvedUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 p-2.5 bg-background/60 rounded-xl text-xs underline font-medium hover:bg-background/80 transition-colors"
    >
      <FileText className="size-4 shrink-0" /> Open Document Attachment
    </a>
  );
}
