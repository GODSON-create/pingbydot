import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Plus, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { activeMomentsTrayQuery } from "@/lib/moments";
import { FounderAvatar } from "@/components/ping/Avatar";
import { MomentViewerModal } from "./MomentViewerModal";
import { MomentComposer } from "./MomentComposer";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export function MomentsTray({ className }: { className?: string }) {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { data: sequences = [], isLoading } = useQuery(activeMomentsTrayQuery(user?.id));

  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedSeqIdx, setSelectedSeqIdx] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);

  const mySequenceIdx = sequences.findIndex((s) => s.author.id === user?.id);
  const mySequence = mySequenceIdx !== -1 ? sequences[mySequenceIdx] : null;
  const otherSequences = sequences
    .map((seq, origIdx) => ({ seq, origIdx }))
    .filter(({ seq }) => seq.author.id !== user?.id);

  const handleOpenSequence = (idx: number) => {
    setSelectedSeqIdx(idx);
    setViewerOpen(true);
  };

  const handleAddMoment = () => {
    if (!user) {
      toast("Sign in to share a 24-hour Moment", {
        action: { label: "Log in", onClick: () => navigate({ to: "/login" }) },
      });
      return;
    }
    setComposerOpen(true);
  };

  return (
    <section aria-label="Moments" className={cn("relative", className)}>
      <div className="-mx-4 flex items-center gap-3.5 overflow-x-auto px-4 py-2 scrollbar-none sm:-mx-0 sm:px-0">
        {/* User's own Story Item */}
        <div className="flex flex-col items-center gap-1.5 shrink-0 select-none">
          <div className="relative">
            <button
              type="button"
              onClick={mySequence ? () => handleOpenSequence(mySequenceIdx) : handleAddMoment}
              className={cn(
                "relative flex size-16 items-center justify-center rounded-full p-0.5 transition-transform active:scale-95",
                mySequence
                  ? mySequence.hasUnseen
                    ? "bg-gradient-to-tr from-lime to-primary p-0.5"
                    : "border-2 border-primary/60"
                  : "border-2 border-dashed border-border/80 hover:border-primary",
              )}
              aria-label={mySequence ? "View your Moments" : "Add Moment"}
            >
              <FounderAvatar
                name={profile?.display_name || profile?.username || "You"}
                src={profile?.avatar_url}
                size="lg"
                className="size-full rounded-full border-2 border-background object-cover"
              />
            </button>

            {/* Plus Button Overlay */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleAddMoment();
              }}
              className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm ring-2 ring-background hover:scale-110 transition-transform"
              title="Add Moment"
              aria-label="Add Moment"
            >
              <Plus className="size-3 stroke-[3]" />
            </button>
          </div>
          <span className="w-16 truncate text-center text-[11px] font-medium text-muted-foreground">
            {mySequence ? "Your story" : "Add moment"}
          </span>
        </div>

        {/* Other Creators' Active Moments */}
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-1.5 shrink-0 animate-pulse">
              <div className="size-16 rounded-full bg-muted" />
              <div className="h-2 w-12 rounded bg-muted" />
            </div>
          ))
        ) : otherSequences.length === 0 ? (
          <button
            type="button"
            onClick={handleAddMoment}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-dashed border-border/70 bg-secondary/30 px-3.5 py-3 text-left transition-colors hover:border-primary/50 hover:bg-secondary/50"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">
                {mySequence
                  ? "Your Moment is live for 24 hours"
                  : "Share a quick build-in-public Moment"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Post photos or short clips with audience controls &amp; Highlights.
              </p>
            </div>
          </button>
        ) : (
          otherSequences.map(({ seq, origIdx }) => {
            const name = seq.author.display_name || seq.author.username;
            return (
              <button
                key={seq.author.id}
                type="button"
                onClick={() => handleOpenSequence(origIdx)}
                className="flex flex-col items-center gap-1.5 shrink-0 transition-transform active:scale-95 group focus:outline-none"
              >
                <div
                  className={cn(
                    "flex size-16 items-center justify-center rounded-full p-0.5 transition-all",
                    seq.hasUnseen
                      ? "bg-gradient-to-tr from-lime via-primary to-gold p-0.5 shadow-sm ring-2 ring-primary/20"
                      : "border-2 border-border/80 opacity-80",
                  )}
                >
                  <FounderAvatar
                    name={name}
                    src={seq.author.avatar_url}
                    size="lg"
                    className="size-full rounded-full border-2 border-background object-cover"
                  />
                </div>
                <span className="w-16 truncate text-center text-[11px] font-medium text-foreground group-hover:text-primary transition-colors">
                  {name}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Viewer Modal */}
      {sequences.length > 0 && (
        <MomentViewerModal
          sequences={sequences}
          initialSequenceIndex={selectedSeqIdx}
          open={viewerOpen}
          onOpenChange={setViewerOpen}
        />
      )}

      {/* Creator Composer Modal */}
      <MomentComposer open={composerOpen} onOpenChange={setComposerOpen} />
    </section>
  );
}
