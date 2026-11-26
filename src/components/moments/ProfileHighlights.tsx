import { useState } from "react";
import { Plus, Sparkles, FolderPlus, Trash2, Pencil, Lock } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import {
  userHighlightsQuery,
  highlightMomentsQuery,
  useCreateHighlight,
  useDeleteHighlight,
  useUpdateHighlight,
  type Highlight,
  type CreatorMomentsSequence,
} from "@/lib/moments";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ResolvedMomentThumb } from "@/components/media/ResolvedPrivateMedia";
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
  const [newPrivate, setNewPrivate] = useState(false);

  const createMutation = useCreateHighlight();
  const deleteMutation = useDeleteHighlight();
  const updateMutation = useUpdateHighlight();
  const [editingHighlight, setEditingHighlight] = useState<Highlight | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCover, setEditCover] = useState("");
  const [editPrivate, setEditPrivate] = useState(false);

  const { data: activeMoments = [] } = useQuery(highlightMomentsQuery(activeHighlightId || ""));

  const activeSequence: CreatorMomentsSequence[] =
    activeMoments.length > 0
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
        is_private: newPrivate,
      });

      toast.success("Highlight collection created!");
      setNewTitle("");
      setNewCover("");
      setNewPrivate(false);
      setCreateDialogOpen(false);
    } catch {
      toast.error("Failed to create Highlight.");
    }
  };

  const handleOpenEdit = (e: React.MouseEvent, h: Highlight) => {
    e.stopPropagation();
    setEditingHighlight(h);
    setEditTitle(h.title);
    setEditCover(h.cover_url || "");
    setEditPrivate(h.is_private);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingHighlight || !editTitle.trim()) return;

    try {
      await updateMutation.mutateAsync({
        highlightId: editingHighlight.id,
        title: editTitle.trim(),
        cover_url: editCover.trim(),
        is_private: editPrivate,
      });
      toast.success("Highlight updated!");
      setEditingHighlight(null);
    } catch {
      toast.error("Failed to update highlight.");
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

  const handleHighlightClick = (h: Highlight) => {
    if ((h.moments_count ?? 0) === 0) {
      toast.info(
        "This Highlight has no saved Moments yet. Open a Moment and tap 'Add to Highlights'.",
      );
      return;
    }
    setActiveHighlightId(h.id);
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

        {highlights.map((h) => (
          <div
            key={h.id}
            onClick={() => handleHighlightClick(h)}
            className="group relative flex flex-col items-center gap-1.5 shrink-0 cursor-pointer select-none transition-transform active:scale-95"
          >
            <div className="relative flex size-16 items-center justify-center rounded-full border-2 border-border/80 p-0.5 group-hover:border-primary transition-colors bg-card overflow-hidden shadow-sm">
              {h.cover_url ? (
                <ResolvedMomentThumb
                  mediaUrl={h.cover_url}
                  mediaType="image"
                  alt={h.title}
                  className="size-full rounded-full object-cover"
                  fallback={
                    <div className="flex size-full items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">
                      {h.title.slice(0, 2).toUpperCase()}
                    </div>
                  }
                />
              ) : (
                <div className="flex size-full items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">
                  {h.title.slice(0, 2).toUpperCase()}
                </div>
              )}
              {h.is_private && (
                <span
                  title="Private Highlight"
                  className="absolute bottom-0 right-0 flex size-4 items-center justify-center rounded-full bg-card border border-border text-muted-foreground"
                >
                  <Lock className="size-2.5" />
                </span>
              )}
            </div>

            <span className="w-16 truncate text-center text-[11px] font-medium text-foreground group-hover:text-primary transition-colors">
              {h.title}
            </span>

            {/* Always visible on mobile touchscreens, reveal cleanly on desktop */}
            {isMe && (
              <div className="absolute -top-1 -right-1 flex sm:hidden sm:group-hover:flex items-center gap-1 z-10">
                <button
                  type="button"
                  onClick={(e) => handleOpenEdit(e, h)}
                  className="size-5 flex items-center justify-center rounded-full bg-card border border-border text-foreground shadow-sm hover:scale-110 transition-transform"
                  title="Edit Highlight"
                  aria-label={`Edit ${h.title}`}
                >
                  <Pencil className="size-2.5 text-primary" />
                </button>
                <button
                  type="button"
                  onClick={(e) => handleDeleteHighlight(e, h.id)}
                  className="size-5 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm hover:scale-110 transition-transform"
                  title="Delete Highlight"
                  aria-label={`Delete ${h.title}`}
                >
                  <Trash2 className="size-2.5" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Highlight Viewer Modal */}
      {activeSequence.length > 0 && (
        <MomentViewerModal
          sequences={activeSequence}
          initialSequenceIndex={0}
          highlightId={activeHighlightId || undefined}
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
            <DialogDescription className="text-xs text-muted-foreground">
              Curate your top build-in-public Moments on your profile.
            </DialogDescription>
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

            <div className="flex items-center justify-between rounded-xl bg-secondary/40 p-3 border border-border/50">
              <div>
                <Label htmlFor="hl-new-private" className="text-xs font-semibold cursor-pointer">
                  Private Highlight
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Only visible to you on your profile.
                </p>
              </div>
              <Switch id="hl-new-private" checked={newPrivate} onCheckedChange={setNewPrivate} />
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

      {/* Edit Highlight Dialog */}
      <Dialog
        open={Boolean(editingHighlight)}
        onOpenChange={(open) => !open && setEditingHighlight(null)}
      >
        <DialogContent className="sm:max-w-md rounded-3xl p-6">
          <DialogHeader>
            <div className="flex items-center gap-2 text-primary font-bold text-sm">
              <Pencil className="size-4" />
              <span>Edit Highlight Collection</span>
            </div>
            <DialogTitle className="font-display text-xl">Collection Settings</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Update title, cover, or visibility for this Highlight.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEditSubmit} className="mt-4 space-y-4">
            <div>
              <Label className="text-xs font-semibold">Highlight Title</Label>
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="mt-1 rounded-xl"
                required
              />
            </div>

            <div>
              <Label className="text-xs font-semibold">Cover Image URL</Label>
              <Input
                value={editCover}
                onChange={(e) => setEditCover(e.target.value)}
                placeholder="https://…/cover.png"
                className="mt-1 rounded-xl"
              />
            </div>

            <div className="flex items-center justify-between rounded-xl bg-secondary/40 p-3 border border-border/50">
              <div>
                <Label htmlFor="hl-edit-private" className="text-xs font-semibold cursor-pointer">
                  Private Highlight
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Only visible to you on your profile.
                </p>
              </div>
              <Switch id="hl-edit-private" checked={editPrivate} onCheckedChange={setEditPrivate} />
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingHighlight(null)}
                className="rounded-xl"
              >
                Cancel
              </Button>
              <Button type="submit" variant="hero" className="rounded-xl">
                Save Changes
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
