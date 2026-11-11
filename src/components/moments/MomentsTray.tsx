import { useState } from "react";
import { Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { activeMomentsTrayQuery, type CreatorMomentsSequence } from "@/lib/moments";
import { FounderAvatar } from "@/components/ping/Avatar";
import { MomentViewerModal } from "./MomentViewerModal";
import { MomentComposer } from "./MomentComposer";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export function MomentsTray({ className }: { className?: string }) {
  const { user, profile } = useAuth();
  const { data: sequences = [], isLoading } = useQuery(activeMomentsTrayQuery(user?.id));

  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedSeqIdx, setSelectedSeqIdx] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);

  // Check if current user has an active sequence in the tray
  const mySequenceIdx = sequences.findIndex((s) => s.author.id === user?.id);
  const mySequence = mySequenceIdx !== -1 ? sequences[mySequenceIdx] : null;

  const handleOpenSequence = (idx: number) => {
    setSelectedSeqIdx(idx);
    setViewerOpen(true);
  };

  const handleAddMoment = () => {
    setComposerOpen(true);
  };

  return (
    <section aria-label="Moments" className={cn("relative", className)}>
      <div className="-mx-4 flex items-center gap-3 overflow-x-auto px-4 py-2 scrollbar-none sm:-mx-0 sm:px-0">
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
                    : "border-2 border-border/80"
                  : "border-2 border-dashed border-border/80 hover:border-primary",
              )}
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
            >
              <Plus className="size-3 stroke-[3]" />
            </button>
          </div>
          <span className="w-16 truncate text-center text-[11px] font-medium text-muted-foreground">
            {mySequence ? "Your story" : "Add moment"}
          </span>
        </div>

        {/* Other Creators' Active Moments */}
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5 shrink-0 animate-pulse">
                <div className="size-16 rounded-full bg-muted" />
                <div className="h-2 w-12 rounded bg-muted" />
              </div>
            ))
          : sequences
              .map((seq, origIdx) => ({ seq, origIdx }))
              .filter(({ seq }) => seq.author.id !== user?.id)
              .map(({ seq, origIdx }) => {
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
                          ? "bg-gradient-to-tr from-lime via-primary to-accent p-0.5 shadow-sm ring-2 ring-primary/20"
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
              })}
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
