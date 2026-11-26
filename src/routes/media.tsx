import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FileText, Film, Image as ImageIcon, Plus, Sparkles, Video } from "lucide-react";
import { z } from "zod";
import { pageHead } from "@/lib/site";
import { feedQuery, type Ping } from "@/lib/pings";
import {
  classifyPingFormat,
  collectPingMediaUrls,
  getActiveVideoProvider,
} from "@/lib/media-pipeline";
import { PingCard, PingCardSkeleton } from "@/components/ping/PingCard";
import { VideoFeedPlayer } from "@/components/media/VideoFeedPlayer";
import { MomentsTray } from "@/components/moments/MomentsTray";
import { DiscoverableMomentsFeed } from "@/components/moments/DiscoverableMomentsFeed";
import { QueryErrorCard } from "@/components/QueryErrorCard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type MediaFormatTab = "video" | "image" | "text" | "moments";

export const Route = createFileRoute("/media")({
  staticData: { sitemap: true },
  validateSearch: z.object({
    format: z.enum(["video", "image", "text", "moments"]).optional(),
  }),
  head: () =>
    pageHead({
      title: "Multimedia Feeds — Video, Images, Text & Moments on Ping",
      description:
        "Browse dedicated Video, Image gallery, Text discussion, and Moments feeds powered by Ping's unified content architecture.",
      path: "/media",
    }),
  component: MediaFeedsPage,
});

function MediaFeedsPage() {
  const { format: formatParam } = Route.useSearch();
  const [activeTab, setActiveTab] = useState<MediaFormatTab>(formatParam ?? "video");
  const [autoplay, setAutoplay] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; caption: string } | null>(null);

  const { data: pings = [], isLoading, isError, error, refetch } = useQuery(feedQuery(null, 0));

  const videoProvider = getActiveVideoProvider();

  const videoPings = pings.filter((p) => classifyPingFormat(p) === "video");
  const imagePings = pings.filter((p) => classifyPingFormat(p) === "image");
  const textPings = pings.filter((p) => classifyPingFormat(p) === "text");

  const tabs: Array<{ id: MediaFormatTab; label: string; count?: number; icon: React.ReactNode }> =
    [
      {
        id: "video",
        label: "Video Feed",
        count: videoPings.length,
        icon: <Film className="size-3.5" />,
      },
      {
        id: "image",
        label: "Image Feed",
        count: imagePings.length,
        icon: <ImageIcon className="size-3.5" />,
      },
      {
        id: "text",
        label: "Text Feed",
        count: textPings.length,
        icon: <FileText className="size-3.5" />,
      },
      { id: "moments", label: "Moments", icon: <Sparkles className="size-3.5" /> },
    ];

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 pb-24 space-y-6">
      {/* Header */}
      <header className="surface-card rounded-3xl p-6 sm:p-8 border border-border/70">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
              <Video className="size-3.5" /> Unified Multimedia Discovery
            </span>
            <h1 className="mt-3 font-display text-3xl sm:text-4xl font-extrabold tracking-tight">
              Watch, Browse &amp; Read
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Dedicated Video, Image Gallery, Text Discussion, and Moments feeds — all powered by
              Ping&apos;s single unified content architecture.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm" className="rounded-full text-xs">
              <Link to="/share-target">Import External Link</Link>
            </Button>
            <Button asChild variant="hero" size="sm" className="rounded-full gap-1.5">
              <Link to="/create">
                <Plus className="size-4" /> Create Multimedia Ping
              </Link>
            </Button>
          </div>
        </div>

        {/* Format Tabs */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-border/60">
          <nav
            aria-label="Multimedia feed formats"
            className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-0.5"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-pressed={activeTab === tab.id}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors",
                  activeTab === tab.id
                    ? "border-foreground bg-foreground text-background shadow-sm"
                    : "border-border bg-card text-foreground hover:bg-secondary",
                )}
              >
                {tab.icon}
                <span>{tab.label}</span>
                {typeof tab.count === "number" && <span className="opacity-75">({tab.count})</span>}
              </button>
            ))}
          </nav>

          {activeTab === "video" && (
            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={autoplay}
                onChange={(e) => setAutoplay(e.target.checked)}
                className="rounded border-border"
              />
              <span>Autoplay muted videos</span>
            </label>
          )}
        </div>
      </header>

      {isError && activeTab !== "moments" ? (
        <QueryErrorCard
          title="Couldn't load multimedia feed"
          error={error}
          onRetry={() => void refetch()}
        />
      ) : null}

      {/* VIDEO FEED */}
      {activeTab === "video" && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground px-1">
            <span>Video pipeline: {videoProvider.displayName}</span>
            <span>
              {videoProvider.supportsAdaptiveHls
                ? "Adaptive HLS active"
                : "Progressive playback active (Cloudflare Stream / Mux ready via env)"}
            </span>
          </div>

          {isLoading ? (
            <div className="grid gap-6 md:grid-cols-2">
              <PingCardSkeleton />
              <PingCardSkeleton />
            </div>
          ) : videoPings.length === 0 ? (
            <div className="surface-card rounded-3xl p-10 text-center border border-border/70">
              <Film className="mx-auto size-10 text-muted-foreground/45" />
              <h2 className="mt-3 font-display text-lg font-bold">No video Pings yet</h2>
              <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
                Upload a video (MP4, WebM, or MOV) with optional captions and music in the unified
                Ping Composer.
              </p>
              <Button asChild variant="hero" size="sm" className="mt-4 rounded-full gap-1.5">
                <Link to="/create">
                  <Plus className="size-3.5" /> Publish First Video
                </Link>
              </Button>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 items-start">
              {videoPings.map((ping) => (
                <VideoFeedPlayer key={ping.id} ping={ping as Ping} autoplay={autoplay} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* IMAGE GALLERY FEED */}
      {activeTab === "image" && (
        <section className="space-y-4">
          {isLoading ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <PingCardSkeleton key={i} />
              ))}
            </div>
          ) : imagePings.length === 0 ? (
            <div className="surface-card rounded-3xl p-10 text-center border border-border/70">
              <ImageIcon className="mx-auto size-10 text-muted-foreground/45" />
              <h2 className="mt-3 font-display text-lg font-bold">No image galleries yet</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Share single or multi-image galleries (up to 4 photos) from the Ping Composer.
              </p>
            </div>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 items-start">
              {imagePings.map((ping) => {
                const imgs = collectPingMediaUrls(ping);
                return (
                  <div key={ping.id} className="space-y-2">
                    <PingCard ping={ping} />
                    {imgs.length > 0 && (
                      <div className="flex items-center justify-end px-2">
                        <button
                          type="button"
                          onClick={() =>
                            setLightboxImage({
                              url: imgs[0]!,
                              caption: ping.content.slice(0, 140),
                            })
                          }
                          className="text-[11px] font-semibold text-primary hover:underline"
                        >
                          Inspect full image ({imgs.length} photo{imgs.length === 1 ? "" : "s"})
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* TEXT DISCUSSION FEED */}
      {activeTab === "text" && (
        <section className="mx-auto max-w-2xl space-y-4">
          {isLoading ? (
            <div className="space-y-4">
              <PingCardSkeleton />
              <PingCardSkeleton />
            </div>
          ) : textPings.length === 0 ? (
            <div className="surface-card rounded-3xl p-10 text-center border border-border/70">
              <FileText className="mx-auto size-10 text-muted-foreground/45" />
              <h2 className="mt-3 font-display text-lg font-bold">No written discussions yet</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Publish a text update, question, or idea to start a conversation.
              </p>
            </div>
          ) : (
            textPings.map((ping) => <PingCard key={ping.id} ping={ping} />)
          )}
        </section>
      )}

      {/* MOMENTS FEED */}
      {activeTab === "moments" && (
        <section className="surface-card rounded-3xl p-5 sm:p-6 border border-border/70 space-y-4">
          <MomentsTray />
          <DiscoverableMomentsFeed />
        </section>
      )}

      {/* Lightbox Dialog */}
      <Dialog open={Boolean(lightboxImage)} onOpenChange={(o) => !o && setLightboxImage(null)}>
        <DialogContent className="sm:max-w-3xl rounded-3xl p-4">
          <DialogHeader>
            <DialogTitle className="font-display text-sm truncate">
              {lightboxImage?.caption || "Image preview"}
            </DialogTitle>
          </DialogHeader>
          {lightboxImage && (
            <img
              src={lightboxImage.url}
              alt={lightboxImage.caption}
              className="max-h-[75dvh] w-full rounded-2xl object-contain bg-black/90"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
