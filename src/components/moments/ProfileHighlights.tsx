import { useState } from "react";
import { Plus, Sparkles, FolderPlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import {
  userHighlightsQuery,
  highlightMomentsQuery,
  useCreateHighlight,
  useDeleteHighlight,
  type Highlight,
  type CreatorMomentsSequence,
} from "@/lib/moments";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MomentViewerModal } from "./MomentViewerModal";
import type { Profile } from "@/lib/pings";

interface ProfileHighlightsProps {
  profile: Profile;
  isMe: boolean;
}

export function ProfileHighlights({ profile, isMe }: ProfileHighlightsProps) {
  const { data: highlights = [] } = useQuery(userHighlightsQuery(profile.id));
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCover, setNewCover] = useState("");

  const createMutation = useCreateHighlight();
  const deleteMutation = useDeleteHighlight();

  // When a highlight is tapped, fetch its moments
  const { data: activeMoments = [] } = useQuery(
    highlightMomentsQuery(activeHighlightId || ""),
  );

  const activeSequence: CreatorMomentsSequence[] = activeMoments.length > 0
    ? [
        {
          author: profile,
          moments: activeMoments,
          hasUnseen: false,
          latestCreatedAt: activeMoments[0]?.created_at || new Date().toISOString(),
        },
      ]
    : [];

  const handleCreateHighlight = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      toast.error("Please enter a title for your Highlight.");
      return;
    }

    try {
      await createMutation.mutateAsync({
        title: newTitle.trim(),
        ...(newCover.trim() ? { cover_url: newCover.trim() } : {}),
      });

      toast.success("Highlight collection created!");
      setNewTitle("");
      setNewCover("");
      setCreateDialogOpen(false);
    } catch {
      toast.error("Failed to create Highlight.");
    }
  };

  const handleDeleteHighlight = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await deleteMutation.mutateAsync(id);
      toast.success("Highlight deleted.");
    } catch {
      toast.error("Failed to delete Highlight.");
    }
  };

  if (highlights.length === 0 && !isMe) return null;

  return (
    <div className="mt-8 border-t border-border/60 pt-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-sm font-bold tracking-tight text-foreground flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-primary" />
          <span>Highlights</span>
        </h2>
        {isMe && (
          <button
            type="button"
            onClick={() => setCreateDialogOpen(true)}
            className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
          >
            <Plus className="size-3" /> New
          </button>
        )}
      </div>

      <div className="flex items-center gap-4 overflow-x-auto pb-2 scrollbar-none">
        {/* Creator's New Highlight Button */}
        {isMe && (
          <button
            type="button"
            onClick={() => setCreateDialogOpen(true)}
            className="flex flex-col items-center gap-1.5 shrink-0 transition-transform active:scale-95 group"
          >
            <div className="flex size-16 items-center justify-center rounded-full border-2 border-dashed border-border/80 text-muted-foreground group-hover:border-primary group-hover:text-primary transition-colors bg-secondary/30">
              <Plus className="size-6" />
            </div>
            <span className="w-16 truncate text-center text-[11px] font-medium text-muted-foreground">
              New
            </span>
          </button>
        )}

        {/* Existing Highlight Circles */}
        {highlights.map((h) => (
          <div
            key={h.id}
            onClick={() => setActiveHighlightId(h.id)}
            className="group relative flex flex-col items-center gap-1.5 shrink-0 cursor-pointer select-none transition-transform active:scale-95"
          >
            <div className="relative flex size-16 items-center justify-center rounded-full border-2 border-border/80 p-0.5 group-hover:border-primary transition-colors bg-card overflow-hidden shadow-sm">
              {h.cover_url ? (
                <img
                  src={h.cover_url}
                  alt={h.title}
                  className="size-full rounded-full object-cover"
                />
              ) : (
                <div className="flex size-full items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">
                  {h.title.slice(0, 2).toUpperCase()}
                </div>
              )}
            </div>

            <span className="w-16 truncate text-center text-[11px] font-medium text-foreground group-hover:text-primary transition-colors">
              {h.title}
            </span>

            {/* Delete button if isMe */}
            {isMe && (
              <button
                type="button"
                onClick={(e) => handleDeleteHighlight(e, h.id)}
                className="absolute -top-1 -right-1 hidden group-hover:flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm hover:scale-110 transition-transform"
                title="Delete Highlight"
              >
                <Trash2 className="size-3" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Highlight Viewer Modal */}
      {activeSequence.length > 0 && (
        <MomentViewerModal
          sequences={activeSequence}
          initialSequenceIndex={0}
          open={Boolean(activeHighlightId)}
          onOpenChange={(open) => {
            if (!open) setActiveHighlightId(null);
          }}
        />
      )}

      {/* Create Highlight Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-md rounded-3xl p-6">
          <DialogHeader>
            <div className="flex items-center gap-2 text-primary font-bold text-sm">
              <FolderPlus className="size-4" />
              <span>Create Highlight</span>
            </div>
            <DialogTitle className="font-display text-xl">Save Moments Permanently</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCreateHighlight} className="mt-4 space-y-4">
            <div>
              <Label className="text-xs font-semibold">Highlight Title</Label>
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. My Journey, Launch Week, Product"
                className="mt-1 rounded-xl"
                required
              />
            </div>

            <div>
              <Label className="text-xs font-semibold">Optional Cover Image URL</Label>
              <Input
                value={newCover}
                onChange={(e) => setNewCover(e.target.value)}
                placeholder="https://…/cover.png"
                className="mt-1 rounded-xl"
              />
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
                className="rounded-xl"
              >
                Cancel
              </Button>
              <Button type="submit" variant="hero" className="rounded-xl">
                Create Highlight
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
