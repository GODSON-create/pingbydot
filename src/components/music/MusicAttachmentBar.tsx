import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Music, Play, Square } from "lucide-react";
import { contentMusicAttachmentQuery, isTrackAvailableForViewer } from "@/lib/music";

export function MusicAttachmentBar({
  targetType,
  targetId,
  viewerRegion = "GLOBAL",
}: {
  targetType: "ping" | "moment";
  targetId: string;
  viewerRegion?: string | undefined;
}) {
  const { data: attachment } = useQuery(contentMusicAttachmentQuery(targetType, targetId));
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  if (!attachment) return null;

  const availability = isTrackAvailableForViewer(attachment, viewerRegion);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!availability.available) return;

    if (playing) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPlaying(false);
      return;
    }

    if (attachment.preview_url && typeof Audio !== "undefined") {
      const audio = new Audio(attachment.preview_url);
      if (attachment.clip_start_sec > 0) {
        audio.currentTime = attachment.clip_start_sec;
      }
      audio.onended = () => setPlaying(false);
      audioRef.current = audio;
      setPlaying(true);
      audio.play().catch(() => setPlaying(false));
      return;
    }

    // CC0 starter stem preview chime
    if (typeof window !== "undefined" && "AudioContext" in window) {
      try {
        const ctx = new window.AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = 440;
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 1.1);
        setPlaying(true);
        setTimeout(() => {
          setPlaying(false);
          void ctx.close().catch(() => {});
        }, 1150);
      } catch {
        setPlaying(false);
      }
    }
  };

  if (!availability.available) {
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 mt-3 flex items-center gap-2 rounded-2xl border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
      >
        <AlertCircle className="size-3.5 shrink-0 text-amber-500" />
        <span className="truncate">{availability.reason}</span>
      </div>
    );
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="relative z-10 mt-3 flex items-center justify-between gap-2.5 rounded-2xl border border-primary/25 bg-primary/8 px-3 py-2"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={
            playing ? `Pause ${attachment.track_title}` : `Play ${attachment.track_title}`
          }
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm"
        >
          {playing ? <Square className="size-3" /> : <Play className="size-3" />}
        </button>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground truncate flex items-center gap-1">
            <Music className="size-3 text-primary shrink-0" />
            <span className="truncate">{attachment.track_title}</span>
          </p>
          <p className="text-[11px] text-muted-foreground truncate">
            {attachment.track_artist} · {attachment.clip_duration_sec}s clip
            {attachment.attribution_text ? ` · ${attachment.attribution_text}` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
