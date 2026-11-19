import { useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { FounderAvatar } from "@/components/ping/Avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useCreateGroupConversation } from "@/lib/messages";
import type { Profile } from "@/lib/pings";
import { cn } from "@/lib/utils";

export function NewGroupChatDialog({
  open,
  onOpenChange,
  currentUserId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUserId?: string | undefined;
  onCreated: (conversationId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [onlyAdminsCanPost, setOnlyAdminsCanPost] = useState(false);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const createGroup = useCreateGroupConversation();

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ["group-member-candidates", deferredSearch, currentUserId],
    enabled: open && Boolean(currentUserId),
    queryFn: async (): Promise<Profile[]> => {
      const term = deferredSearch.replace(/[%_,()*@]/g, "").trim();
      let q = supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url, bio, created_at")
        .neq("id", currentUserId ?? "")
        .limit(16);
      if (term) {
        q = q.or(`username.ilike.%${term}%,display_name.ilike.%${term}%`);
      } else {
        q = q.order("created_at", { ascending: false });
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
  });

  const toggleMember = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 2) {
      toast.error("Enter a group name (at least 2 characters).");
      return;
    }
    try {
      const convId = await createGroup.mutateAsync({
        title,
        description,
        memberIds: selectedIds,
        onlyAdminsCanPost,
      });
      toast.success(`Group "${title.trim()}" created`);
      setTitle("");
      setDescription("");
      setOnlyAdminsCanPost(false);
      setSelectedIds([]);
      setSearch("");
      onOpenChange(false);
      onCreated(convId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create group conversation");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-3xl p-6 max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <Users className="size-5 text-primary" /> New Group Conversation
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Create a private group chat for your team, collaborators, or friends.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-3 space-y-3.5">
          <div>
            <Label htmlFor="group-title" className="text-xs">
              Group name
            </Label>
            <Input
              id="group-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Product Launch Crew"
              minLength={2}
              maxLength={80}
              required
              className="mt-1 rounded-xl"
            />
          </div>

          <div>
            <Label htmlFor="group-desc" className="text-xs">
              Description (optional)
            </Label>
            <Input
              id="group-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Weekly updates & coordination"
              maxLength={160}
              className="mt-1 rounded-xl"
            />
          </div>

          <label className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-secondary/35 px-3 py-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={onlyAdminsCanPost}
              onChange={(e) => setOnlyAdminsCanPost(e.target.checked)}
              className="rounded border-border"
            />
            <span>Announcement mode (only admins can post messages)</span>
          </label>

          <div>
            <Label className="text-xs">Add participants ({selectedIds.length} selected)</Label>
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search people by @username or name…"
                className="pl-8 rounded-xl h-9 text-xs"
              />
            </div>

            <div className="mt-2 max-h-48 overflow-y-auto space-y-1.5 pr-1">
              {isLoading ? (
                <p className="py-4 text-center text-xs text-muted-foreground">Loading people…</p>
              ) : candidates.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  No matching people.
                </p>
              ) : (
                candidates.map((p) => {
                  const chosen = selectedIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleMember(p.id)}
                      className={cn(
                        "w-full flex items-center justify-between gap-2 rounded-xl border p-2 text-left transition-colors",
                        chosen
                          ? "border-primary bg-primary/10"
                          : "border-border/60 bg-secondary/30 hover:bg-secondary/60",
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FounderAvatar
                          name={p.display_name || p.username}
                          src={p.avatar_url}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-bold truncate">
                            {p.display_name || p.username}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            @{p.username}
                          </p>
                        </div>
                      </div>
                      <span
                        className={cn(
                          "size-5 rounded-full border flex items-center justify-center shrink-0",
                          chosen
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-card",
                        )}
                      >
                        {chosen && <Check className="size-3" />}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="hero"
              className="rounded-full"
              disabled={createGroup.isPending || title.trim().length < 2}
            >
              {createGroup.isPending ? "Creating…" : "Create Group"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
