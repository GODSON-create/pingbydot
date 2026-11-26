import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Clapperboard, Globe, Lock, Users } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import type { Moment } from "@/lib/moments";
import {
  usePublishMomentAsClip,
  validateMomentToClipConversion,
  type ClipVisibility,
} from "@/lib/clips";
import { cn } from "@/lib/utils";

/**
 * Explicit Moments-to-Clips Republishing Dialog (Addendum Section 15).
 *
 * - Never auto-converts Moments into Clips; creator explicitly chooses to publish.
 * - Preserves original creator attribution, editable caption, visibility choice,
 *   media permission boundaries (blocks Close Circle -> Public leaks), and Moment linkage.
 */
export function MomentToClipDialog({
  moment,
  open,
  onOpenChange,
}: {
  moment: Moment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState<ClipVisibility>("public");

  const publishFromMoment = usePublishMomentAsClip(
    user?.id,
    profile
      ? {
          id: profile.id,
          username: profile.username,
          display_name: profile.display_name,
          avatar_url: profile.avatar_url,
        }
      : null,
  );

  useEffect(() => {
    if (open && moment) {
      setCaption(moment.caption || moment.overlay_text || "");
      setVisibility(moment.audience === "close_circle" ? "followers" : "public");
    }
  }, [open, moment]);

  if (!moment) return null;

  const eligibility = validateMomentToClipConversion({
    moment,
    callerUserId: user?.id,
    targetVisibility: visibility,
  });

  const handleRepublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eligibility.eligible) {
      toast.error(eligibility.reason || "Cannot republish this Moment as a Clip.");
      return;
    }
    try {
      await publishFromMoment.mutateAsync({
        moment,
        caption,
        visibility,
      });
      toast.success("Moment republished as a persistent Ping Clip!", {
        action: { label: "View Clips", onClick: () => navigate({ to: "/clips" }) },
      });
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not republish Moment as Clip.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-3xl p-6 bg-card text-card-foreground">
        <DialogHeader>
          <DialogTitle className="font-display text-lg flex items-center gap-2">
            <Clapperboard className="size-5 text-primary" /> Republish Moment as Ping Clip
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Create a persistent short-form discovery Clip from this video Moment while keeping your
            original creator attribution and Moment linkage intact.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleRepublish} className="mt-2 space-y-4">
          {!eligibility.eligible && (
            <div className="flex items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <span>{eligibility.reason}</span>
            </div>
          )}

          <div>
            <Label htmlFor="clip-from-moment-caption" className="text-xs font-semibold">
              Clip Caption &amp; DOT Tags
            </Label>
            <Textarea
              id="clip-from-moment-caption"
              rows={3}
              maxLength={1000}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Refine your caption and add DOT Tags like .startups .africa .buildinpublic…"
              className="mt-1.5 rounded-2xl text-xs"
            />
          </div>

          <div>
            <Label className="text-xs font-semibold">Clip Visibility</Label>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {(
                [
                  { id: "public", label: "Public", icon: Globe },
                  { id: "followers", label: "Followers", icon: Users },
                  { id: "hub", label: "Hub Only", icon: Lock },
                ] as const
              ).map((opt) => {
                const Icon = opt.icon;
                const active = visibility === opt.id;
                const disabled = moment.audience === "close_circle" && opt.id === "public";
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => setVisibility(opt.id)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-semibold transition-colors",
                      active
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground",
                      disabled && "opacity-40 cursor-not-allowed",
                    )}
                  >
                    <Icon className="size-3.5" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Original attribution:{" "}
            <strong className="text-foreground">
              @{moment.author?.username ?? profile?.username ?? "you"}
            </strong>{" "}
            · Source Moment retained.
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="rounded-full"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="hero"
              size="sm"
              disabled={!eligibility.eligible || publishFromMoment.isPending}
              className="rounded-full font-bold"
            >
              {publishFromMoment.isPending ? "Publishing Clip…" : "Publish Persistent Clip"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
