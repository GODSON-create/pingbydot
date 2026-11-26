import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, Loader2, Music, Play, Search, Square, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getMusicCatalogStatus,
  musicCatalogQuery,
  useRegisterOriginalAudioTrack,
  type MusicTrack,
} from "@/lib/music";
import { useAuth } from "@/lib/auth";
import { validateMediaUpload } from "@/lib/shield";
import { cn } from "@/lib/utils";

export interface SelectedMusicDraft {
  track: MusicTrack;
  clipStartSec: number;
  clipDurationSec: number;
}

export function MusicAttachmentPicker({
  value,
  onChange,
  compact = false,
}: {
  value: SelectedMusicDraft | null;
  onChange: (next: SelectedMusicDraft | null) => void;
  compact?: boolean | undefined;
}) {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [origTitle, setOrigTitle] = useState("");
  const [origArtist, setOrigArtist] = useState("");
  const [ownershipDeclared, setOwnershipDeclared] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const catalogStatus = getMusicCatalogStatus();
  const { data: tracks = [], isLoading } = useQuery(musicCatalogQuery(search));
  const registerTrack = useRegisterOriginalAudioTrack(user?.id);

  const stopPreview = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingId(null);
  };

  const togglePreview = (track: MusicTrack) => {
    if (playingId === track.id) {
      stopPreview();
      return;
    }
    stopPreview();

    if (track.preview_url && typeof Audio !== "undefined") {
      const audio = new Audio(track.preview_url);
      audio.onended = () => setPlayingId(null);
      audioRef.current = audio;
      setPlayingId(track.id);
      audio.play().catch(() => {
        setPlayingId(null);
        toast.info("Audio preview blocked by browser autoplay rules.");
      });
      return;
    }

    // Gentle Web Audio preview chime for Ping CC0 starter stems when no hosted file URL is attached
    if (typeof window !== "undefined" && "AudioContext" in window) {
      try {
        const ctx = new window.AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 392;
        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 1.2);
        setPlayingId(track.id);
        setTimeout(() => {
          setPlayingId((curr) => (curr === track.id ? null : curr));
          void ctx.close().catch(() => {});
        }, 1250);
      } catch {
        toast.info(`Previewing "${track.title}"`);
      }
    }
  };

  const handleUploadOriginalAudio = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    if (!ownershipDeclared) {
      toast.error("Please confirm ownership/rights before uploading original audio.");
      return;
    }
    if (origTitle.trim().length < 2) {
      toast.error("Enter a track title before uploading.");
      return;
    }

    const check = validateMediaUpload(
      { type: file.type, size: file.size, name: file.name },
      "audio",
    );
    if (!check.valid) {
      toast.error(check.error || "Unsupported audio file.");
      return;
    }

    try {
      setIsUploading(true);
      const { buildPublicMediaPath, uploadUserMedia } = await import("@/lib/storage");
      const path = buildPublicMediaPath(user.id, "audio", file.name, "mp3");
      const publicUrl = await uploadUserMedia(path, file, {
        cacheControl: "31536000",
        upsert: false,
        ownerId: user.id,
      });

      const created = await registerTrack.mutateAsync({
        title: origTitle.trim(),
        artist: origArtist.trim() || "Original Creator",
        durationSec: 45,
        previewUrl: publicUrl,
        ownershipDeclared: true,
      });

      onChange({
        track: created,
        clipStartSec: 0,
        clipDurationSec: Math.min(30, created.duration_sec),
      });
      toast.success(`Attached original audio "${created.title}"`);
      setOrigTitle("");
      setOrigArtist("");
      setOwnershipDeclared(false);
      setShowUpload(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload original audio.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/70 bg-secondary/40 space-y-3",
        compact ? "p-3" : "p-4",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Music className="size-4 text-primary" /> Music &amp; Audio Attachment
        </span>
        {value && (
          <button
            type="button"
            onClick={() => {
              stopPreview();
              onChange(null);
            }}
            className="inline-flex items-center gap-1 text-xs text-destructive hover:underline"
          >
            <Trash2 className="size-3" /> Remove
          </button>
        )}
      </div>

      {/* Selected Track Preview & Segment Controls */}
      {value && (
        <div className="rounded-xl border border-primary/35 bg-primary/10 p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-bold text-foreground truncate">{value.track.title}</p>
              <p className="text-[11px] text-muted-foreground truncate">
                {value.track.artist} · {value.track.attribution}
              </p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="size-7 rounded-full shrink-0"
              onClick={() => togglePreview(value.track)}
              aria-label={playingId === value.track.id ? "Stop preview" : "Preview track"}
            >
              {playingId === value.track.id ? (
                <Square className="size-3" />
              ) : (
                <Play className="size-3" />
              )}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-[11px]">
            <label className="space-y-1">
              <span className="text-muted-foreground">Start offset ({value.clipStartSec}s)</span>
              <input
                type="range"
                min={0}
                max={Math.max(0, value.track.duration_sec - 10)}
                value={value.clipStartSec}
                onChange={(e) => onChange({ ...value, clipStartSec: Number(e.target.value) })}
                className="w-full accent-primary"
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground">Clip length ({value.clipDurationSec}s)</span>
              <input
                type="range"
                min={10}
                max={Math.min(60, value.track.duration_sec)}
                value={value.clipDurationSec}
                onChange={(e) => onChange({ ...value, clipDurationSec: Number(e.target.value) })}
                className="w-full accent-primary"
              />
            </label>
          </div>
        </div>
      )}

      {/* Search & Track Selector */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Ping Originals & cleared audio…"
            className="h-8 pl-8 rounded-xl bg-card text-xs"
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 rounded-xl text-xs gap-1 shrink-0"
          onClick={() => setShowUpload((prev) => !prev)}
        >
          <Upload className="size-3" /> Original Audio
        </Button>
      </div>

      {/* Original Audio Upload with Mandatory Ownership Declaration */}
      {showUpload && (
        <div className="rounded-xl border border-border bg-card p-3 space-y-2.5">
          <p className="text-xs font-semibold text-foreground">Upload Original Audio</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor="orig-audio-title" className="text-[11px]">
                Track title
              </Label>
              <Input
                id="orig-audio-title"
                value={origTitle}
                onChange={(e) => setOrigTitle(e.target.value)}
                placeholder="My Original Beat"
                className="mt-1 h-8 rounded-lg text-xs"
                maxLength={140}
              />
            </div>
            <div>
              <Label htmlFor="orig-audio-artist" className="text-[11px]">
                Artist / Creator credit
              </Label>
              <Input
                id="orig-audio-artist"
                value={origArtist}
                onChange={(e) => setOrigArtist(e.target.value)}
                placeholder="Your artist name"
                className="mt-1 h-8 rounded-lg text-xs"
                maxLength={140}
              />
            </div>
          </div>
          <label className="flex items-start gap-2 text-[11px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={ownershipDeclared}
              onChange={(e) => setOwnershipDeclared(e.target.checked)}
              className="mt-0.5 rounded border-border"
            />
            <span>
              I declare that I own or hold full legal rights to distribute this audio on Ping, and
              it does not infringe third-party copyrights.
            </span>
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/mpeg,audio/mp4,audio/wav,audio/webm,audio/ogg,.mp3,.m4a,.wav,.webm"
            className="hidden"
            onChange={handleUploadOriginalAudio}
          />
          <Button
            type="button"
            size="sm"
            variant="hero"
            disabled={!ownershipDeclared || isUploading || origTitle.trim().length < 2}
            onClick={() => fileInputRef.current?.click()}
            className="h-8 rounded-full text-xs gap-1.5"
          >
            {isUploading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )}
            {isUploading ? "Uploading audio…" : "Choose audio file"}
          </Button>
        </div>
      )}

      {/* Track List */}
      <div className="max-h-40 overflow-y-auto space-y-1.5 pr-0.5">
        {isLoading ? (
          <p className="py-3 text-center text-xs text-muted-foreground">Loading audio library…</p>
        ) : tracks.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground">
            No matching cleared tracks found.
          </p>
        ) : (
          tracks.map((track) => {
            const selected = value?.track.id === track.id;
            return (
              <div
                key={track.id}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-xl border px-2.5 py-2 text-xs transition-colors",
                  selected
                    ? "border-primary bg-primary/10"
                    : "border-border/60 bg-card/80 hover:bg-card",
                )}
              >
                <button
                  type="button"
                  onClick={() => togglePreview(track)}
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground hover:bg-primary hover:text-primary-foreground transition-colors"
                  aria-label={
                    playingId === track.id ? `Stop ${track.title}` : `Preview ${track.title}`
                  }
                >
                  {playingId === track.id ? (
                    <Square className="size-3" />
                  ) : (
                    <Play className="size-3" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground truncate">{track.title}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {track.artist} · {track.duration_sec}s{track.mood ? ` · ${track.mood}` : ""}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={selected ? "secondary" : "outline"}
                  className="h-7 rounded-full text-[11px] shrink-0"
                  onClick={() =>
                    onChange({
                      track,
                      clipStartSec: 0,
                      clipDurationSec: Math.min(30, track.duration_sec),
                    })
                  }
                >
                  {selected ? "Selected" : "Attach"}
                </Button>
              </div>
            );
          })
        )}
      </div>

      {/* Transparent Licensing Notice */}
      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground leading-relaxed">
        <Info className="size-3.5 shrink-0 mt-0.5 text-primary" />
        <span>{catalogStatus.notice}</span>
      </p>
    </div>
  );
}
