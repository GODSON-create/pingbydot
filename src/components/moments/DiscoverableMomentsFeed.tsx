import { useState } from "react";
import { Sparkles, Heart, Repeat2, Play, Flame } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  discoverableMomentsQuery,
  type Moment,
  type CreatorMomentsSequence,
} from "@/lib/moments";
import { FounderAvatar } from "@/components/ping/Avatar";
import { MomentViewerModal } from "./MomentViewerModal";
import { useAuth } from "@/lib/auth";
import { Link } from "@tanstack/react-router";

export function DiscoverableMomentsFeed() {
  const { user } = useAuth();
  const { data: moments = [], isLoading } = useQuery(discoverableMomentsQuery(user?.id));
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-[9/14] rounded-2xl bg-muted/40 animate-pulse" />
        ))}
      </div>
    );
  }

  if (moments.length === 0) return null;

  // Convert moments to sequence for viewer
  const sequences: CreatorMomentsSequence[] = moments.map((m) => ({
    author: m.author || {
      id: m.author_id,
      username: "founder",
      display_name: "Founder",
      avatar_url: null,
      bio: "",
      created_at: m.created_at,
    },
    moments: [m],
    hasUnseen: true,
    latestCreatedAt: m.created_at,
  }));

  return (
    <section className="mt-8 border-t border-border/60 pt-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-bold text-primary">
            <Flame className="size-4 text-orange-500 fill-orange-500" />
            <span>For You Moments</span>
          </div>
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground">
            Trending builder stories
          </h2>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
        {moments.slice(0, 6).map((m, idx) => (
          <article
            key={m.id}
            onClick={() => setSelectedIdx(idx)}
            className="group relative aspect-[9/14] rounded-2xl overflow-hidden bg-black cursor-pointer shadow-sm hover:scale-[1.02] transition-all"
          >
            {m.media_type === "video" ? (
              <video src={m.media_url} className="h-full w-full object-cover opacity-90 group-hover:opacity-100" />
            ) : (
              <img src={m.media_url} alt="Discoverable moment" className="h-full w-full object-cover opacity-90 group-hover:opacity-100" />
            )}

            {/* Gradient Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30 pointer-events-none" />

            {/* Top Creator Info */}
            <div className="absolute top-2 left-2 right-2 flex items-center gap-1.5 z-10">
              <FounderAvatar
                name={m.author?.display_name || m.author?.username || "Builder"}
                src={m.author?.avatar_url}
                size="sm"
              />
              <span className="truncate text-[11px] font-semibold text-white drop-shadow">
                @{m.author?.username}
              </span>
            </div>

            {/* Bottom Caption / Stats */}
            <div className="absolute bottom-2 left-2 right-2 z-10 text-white">
              {m.caption && (
                <p className="text-[11px] font-medium line-clamp-2 leading-tight drop-shadow">
                  {m.caption}
                </p>
              )}
              <div className="mt-1 flex items-center gap-2 text-[10px] text-white/80">
                <span className="flex items-center gap-0.5">
                  <Heart className="size-3 fill-red-500 text-red-500" /> {m.like_count}
                </span>
                {m.reping_count > 0 && (
                  <span className="flex items-center gap-0.5">
                    <Repeat2 className="size-3" /> {m.reping_count}
                  </span>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>

      {selectedIdx !== null && sequences.length > 0 && (
        <MomentViewerModal
          sequences={sequences}
          initialSequenceIndex={selectedIdx}
          open={selectedIdx !== null}
          onOpenChange={(open) => {
            if (!open) setSelectedIdx(null);
          }}
        />
      )}
    </section>
  );
}
