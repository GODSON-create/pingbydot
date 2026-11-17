import { useState, useDeferredValue } from "react";
import { Search, UserPlus, UserMinus, Lock, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FounderAvatar } from "@/components/ping/Avatar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  closeCircleQuery,
  useAddCloseCircleMember,
  useRemoveCloseCircleMember,
} from "@/lib/moments";
import type { Profile } from "@/lib/pings";

export function CloseCircleDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());

  const { data: circle = [], isLoading } = useQuery(closeCircleQuery(user?.id));
  const addMutation = useAddCloseCircleMember();
  const removeMutation = useRemoveCloseCircleMember();

  const memberIds = new Set(circle.map((c) => c.member_id));

  const { data: candidates = [] } = useQuery({
    queryKey: ["close-circle-search", deferredSearch],
    enabled: open && Boolean(user) && deferredSearch.length >= 2,
    queryFn: async (): Promise<Profile[]> => {
      const term = deferredSearch.replace(/[%_,()*@]/g, "").trim();
      if (!term) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url, bio, created_at")
        .or(`username.ilike.%${term}%,display_name.ilike.%${term}%`)
        .limit(8);

      if (error || !data) return [];
      return (data as Profile[]).filter((p) => p.id !== user?.id);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-3xl p-6 max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary font-bold text-sm">
            <Lock className="size-4" />
            <span>Close Circle</span>
          </div>
          <DialogTitle className="font-display text-xl">Trusted Builders</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Only people in your Close Circle can view Moments shared with the Close Circle audience.
            This list is strictly private to you.
          </DialogDescription>
        </DialogHeader>

        {/* Search to add */}
        <div className="mt-3 relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search founders by @username to add…"
            className="pl-9 rounded-xl h-10 text-sm"
          />
        </div>

        {/* Search results */}
        {deferredSearch.length >= 2 && (
          <div className="mt-2 space-y-1.5 rounded-2xl border border-border/70 bg-secondary/30 p-2">
            {candidates.length === 0 ? (
              <p className="p-2 text-center text-xs text-muted-foreground">
                No builders found matching "{deferredSearch}".
              </p>
            ) : (
              candidates.map((p) => {
                const inCircle = memberIds.has(p.id);
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-xl bg-card p-2 border border-border/40"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FounderAvatar
                        name={p.display_name || p.username}
                        src={p.avatar_url}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate">{p.display_name || p.username}</p>
                        <p className="text-[11px] text-muted-foreground truncate">@{p.username}</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={inCircle ? "outline" : "hero"}
                      className="rounded-xl h-7 px-2.5 text-xs shrink-0"
                      disabled={addMutation.isPending || removeMutation.isPending}
                      onClick={async () => {
                        try {
                          if (inCircle) {
                            await removeMutation.mutateAsync(p.id);
                            toast.success(`Removed @${p.username} from Close Circle`);
                          } else {
                            await addMutation.mutateAsync(p.id);
                            toast.success(`Added @${p.username} to Close Circle`);
                          }
                        } catch (e: unknown) {
                          toast.error(
                            e instanceof Error ? e.message : "Could not update Close Circle",
                          );
                        }
                      }}
                    >
                      {inCircle ? (
                        <>
                          <UserMinus className="size-3.5" /> Remove
                        </>
                      ) : (
                        <>
                          <UserPlus className="size-3.5" /> Add
                        </>
                      )}
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Current Close Circle List */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground mb-2">
            <span className="flex items-center gap-1.5">
              <Users className="size-3.5 text-primary" /> Current Members
            </span>
            <span>{circle.length}</span>
          </div>

          {isLoading ? (
            <p className="py-4 text-center text-xs text-muted-foreground">Loading Close Circle…</p>
          ) : circle.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
              Your Close Circle is empty. Search above to add trusted founders.
            </div>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {circle.map((entry) => {
                const m = entry.member;
                const label = m?.display_name || m?.username || "Builder";
                return (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-2 rounded-2xl border border-border/60 bg-secondary/40 p-2.5"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FounderAvatar name={label} src={m?.avatar_url} size="sm" />
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate">{label}</p>
                        {m?.username && (
                          <p className="text-[11px] text-muted-foreground truncate">
                            @{m.username}
                          </p>
                        )}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={removeMutation.isPending}
                      onClick={async () => {
                        await removeMutation.mutateAsync(entry.member_id);
                        toast.success(`Removed @${m?.username || "member"}`);
                      }}
                      className="h-7 rounded-xl px-2 text-xs text-destructive hover:bg-destructive/10"
                    >
                      Remove
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
