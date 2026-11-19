import { useEffect, useRef, useState } from "react";
import {
  Camera,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  Paperclip,
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
import { chooseFromGallery, recordVideo, takePhoto } from "@/lib/native";
import { createPrivateDmSignedUrl, isPrivateDmMediaRef } from "@/lib/storage";

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

export function VoiceNoteButton({
  onRecorded,
  disabled,
}: {
  onRecorded: (file: File) => void | Promise<void>;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canceledRef = useRef(false);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      try {
        if (recorderRef.current?.state === "recording") {
          canceledRef.current = true;
          recorderRef.current.stop();
        }
      } catch {
        // Ignore teardown errors
      }
    };
  }, []);

  const stopTracks = (stream?: MediaStream | null) => {
    stream?.getTracks().forEach((t) => t.stop());
  };

  const startRecording = async () => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      toast.error("Voice recording isn't supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const recorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      canceledRef.current = false;
      recorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        stopTracks(stream);
        setRecording(false);
        setElapsedSec(0);

        if (canceledRef.current) return;
        const mime = recorder.mimeType?.split(";")[0] || preferredMime || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mime });
        if (blob.size <= 0) {
          toast.error("Recording was empty. Hold a little longer and retry.");
          return;
        }
        const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
        const file = new File([blob], `voice-note-${Date.now()}.${ext}`, { type: mime });
        void onRecorded(file);
      };

      recorder.start();
      setRecording(true);
      setElapsedSec(0);
      timerRef.current = setInterval(() => {
        setElapsedSec((prev) => {
          if (prev >= 179) {
            recorder.stop();
            return 180;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (/denied|notallowed/i.test(msg)) {
        toast.error("Microphone permission denied. Allow microphone access in Settings.");
      } else {
        toast.error("Couldn't access microphone.");
      }
    }
  };

  const finishRecording = (cancel: boolean) => {
    canceledRef.current = cancel;
    try {
      if (recorderRef.current && recorderRef.current.state === "recording") {
        recorderRef.current.stop();
      } else {
        setRecording(false);
      }
    } catch {
      setRecording(false);
    }
  };

  if (recording) {
    const mins = Math.floor(elapsedSec / 60);
    const secs = String(elapsedSec % 60).padStart(2, "0");
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive shrink-0">
        <span className="size-2 rounded-full bg-destructive animate-pulse" aria-hidden />
        <span className="tabular-nums font-mono">{`${mins}:${secs}`}</span>
        <button
          type="button"
          onClick={() => finishRecording(false)}
          aria-label="Stop and attach voice note"
          className="rounded-full p-1 hover:bg-destructive/20 transition-colors"
          title="Attach voice note"
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
  disabled,
  loading,
}: {
  onFileSelected: (file: File) => void | Promise<void>;
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
            void takePhoto().then((file) => {
              if (file) return onFileSelected(file);
            });
          }}
        >
          <Camera className="size-4 text-primary" /> Take Photo
        </DropdownMenuItem>
        <DropdownMenuItem
          className="rounded-xl cursor-pointer gap-2"
          onClick={() => {
            void recordVideo().then((file) => {
              if (file) return onFileSelected(file);
            });
          }}
        >
          <Video className="size-4 text-primary" /> Record Video
        </DropdownMenuItem>
        <DropdownMenuItem
          className="rounded-xl cursor-pointer gap-2"
          onClick={() => {
            void chooseFromGallery("image/*,video/*").then((file) => {
              if (file) return onFileSelected(file);
            });
          }}
        >
          <ImageIcon className="size-4 text-primary" /> Photo / Video Library
        </DropdownMenuItem>
        <DropdownMenuItem
          className="rounded-xl cursor-pointer gap-2"
          onClick={() => {
            void chooseFromGallery(
              ".pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,application/pdf",
            ).then((file) => {
              if (file) return onFileSelected(file);
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
}: {
  mediaUrl: string;
  mediaType?: "image" | "video" | "audio" | "document" | null;
}) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(() =>
    isPrivateDmMediaRef(mediaUrl) ? null : mediaUrl,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    if (!isPrivateDmMediaRef(mediaUrl)) {
      setResolvedUrl(mediaUrl);
      return;
    }
    void createPrivateDmSignedUrl(mediaUrl).then((url) => {
      if (!active) return;
      if (!url) setFailed(true);
      setResolvedUrl(url);
    });
    return () => {
      active = false;
    };
  }, [mediaUrl]);

  if (failed) {
    return (
      <div className="rounded-xl bg-background/40 px-3 py-2 text-xs text-muted-foreground">
        Attachment unavailable
      </div>
    );
  }

  if (!resolvedUrl) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-background/30 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Loading attachment…
      </div>
    );
  }

  const inferredType =
    mediaType ??
    (/\.(mp4|webm|mov)(\?|$)/i.test(resolvedUrl)
      ? "video"
      : /\.(mp3|m4a|ogg|wav|aac|webm)(\?|$)/i.test(resolvedUrl)
        ? "audio"
        : /\.(pdf|txt|csv|doc|docx|xls|xlsx|ppt|pptx|zip)(\?|$)/i.test(resolvedUrl)
          ? "document"
          : "image");

  if (inferredType === "image") {
    return (
      <img
        src={resolvedUrl}
        alt="Attachment"
        onError={() => setFailed(true)}
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
        onError={() => setFailed(true)}
        className="max-h-60 rounded-lg"
      />
    );
  }

  if (inferredType === "audio") {
    return (
      <audio
        src={resolvedUrl}
        controls
        preload="metadata"
        onError={() => setFailed(true)}
        className="h-10 max-w-full"
      />
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
