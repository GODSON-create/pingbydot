import { useState } from "react";
import { toast } from "sonner";
import { Repeat2, Lock, ShieldAlert, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FounderAvatar } from "@/components/ping/Avatar";
import { useRePingMoment, type Moment } from "@/lib/moments";

interface RePingModalProps {
  moment: Moment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function RePingModal({ moment, open, onOpenChange, onSuccess }: RePingModalProps) {
  const [caption, setCaption] = useState("");
  const isFollowersOnly = moment?.audience === "followers";
  const [audience, setAudience] = useState<"public" | "followers">(
    isFollowersOnly ? "followers" : "public",
  );
  const repingMutation = useRePingMoment();

  if (!moment) return null;

  const isRestricted = moment.audience === "hub" || moment.audience === "close_circle";
  const disallowsReping = !moment.allow_repings;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isRestricted) {
      toast.error("Private Hub and Close Circle moments cannot be re-pinged publicly.");
      return;
    }

    if (disallowsReping) {
      toast.error("The creator has disabled re-pings for this moment.");
      return;
    }

    const finalAudience = isFollowersOnly ? "followers" : audience;
    try {
      await repingMutation.mutateAsync({
        momentId: moment.id,
        ...(caption.trim() ? { caption: caption.trim() } : {}),
        audience: finalAudience,
      });

      toast.success("Moment re-pinged to your network!");
      setCaption("");
      onOpenChange(false);
      onSuccess?.();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to re-ping moment.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-3xl p-6">
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary font-bold text-sm">
            <Repeat2 className="size-4" />
            <span>Re-Ping Moment</span>
          </div>
          <DialogTitle className="font-display text-xl">Share across your network</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Travel this moment to your network while preserving original creator attribution.
          </DialogDescription>
        </DialogHeader>

        {isRestricted ? (
          <div className="mt-4 rounded-2xl bg-destructive/10 p-4 border border-destructive/20 text-xs text-destructive flex items-start gap-3">
            <ShieldAlert className="size-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Distribution Restricted</p>
              <p className="mt-0.5 text-muted-foreground">
                This Moment belongs to a{" "}
                <strong>{moment.audience === "hub" ? "private Hub" : "Close Circle"}</strong>. To
                preserve community privacy, it cannot be re-pinged.
              </p>
            </div>
          </div>
        ) : disallowsReping ? (
          <div className="mt-4 rounded-2xl bg-muted p-4 text-xs text-muted-foreground flex items-start gap-3">
            <Lock className="size-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-foreground">Sharing Disabled</p>
              <p className="mt-0.5">The creator has disabled re-pings on this Moment.</p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            {/* Original Creator Attribution Card */}
            <div className="rounded-2xl border border-border/60 bg-secondary/40 p-3.5 flex items-center gap-3">
              <FounderAvatar
                name={moment.author?.display_name || moment.author?.username || "Founder"}
                src={moment.author?.avatar_url}
                size="md"
              />
              <div className="min-w-0 flex-1 text-xs">
                <p className="font-semibold text-foreground truncate">
                  Original moment by @{moment.author?.username}
                </p>
                {moment.caption && (
                  <p className="text-muted-foreground line-clamp-1 italic mt-0.5">
                    "{moment.caption}"
                  </p>
                )}
              </div>
            </div>

            {/* Optional Commentary */}
            <div>
              <label htmlFor="reping-commentary" className="text-xs font-semibold">
                Add your thoughts (optional)
              </label>
              <Textarea
                id="reping-commentary"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="What resonates with you about this milestone?…"
                rows={3}
                className="mt-1 rounded-2xl resize-none text-sm"
              />
            </div>

            {/* Re-Ping Audience */}
            <div>
              <label className="text-xs font-semibold">Re-Ping Audience</label>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={isFollowersOnly}
                  onClick={() => setAudience("public")}
                  className={`rounded-xl border p-2 text-xs font-semibold transition-all ${
                    isFollowersOnly
                      ? "border-border/40 opacity-40 cursor-not-allowed text-muted-foreground"
                      : audience === "public"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted/50"
                  }`}
                  title={
                    isFollowersOnly
                      ? "Original moment is Followers-only; cannot expand to Public"
                      : undefined
                  }
                >
                  🌍 Public Network
                </button>
                <button
                  type="button"
                  onClick={() => setAudience("followers")}
                  className={`rounded-xl border p-2 text-xs font-semibold transition-all ${
                    audience === "followers"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  👥 Followers Only
                </button>
              </div>
              {isFollowersOnly && (
                <p className="mt-1.5 text-[11px] text-amber-500 font-medium flex items-center gap-1">
                  <Lock className="size-3 shrink-0" /> Original moment is Followers Only. Audience
                  cannot be expanded to Public.
                </p>
              )}
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="rounded-xl"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="hero"
                disabled={repingMutation.isPending}
                className="rounded-xl gap-1.5"
              >
                <Repeat2 className="size-4" />
                {repingMutation.isPending ? "Re-Pinging…" : "Re-Ping Moment"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
