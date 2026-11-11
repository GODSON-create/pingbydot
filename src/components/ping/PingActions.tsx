import { useState } from "react";
import { Link, useNavigate, useHydrated } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Heart,
  Share2,
  Link2,
  MessageCircle,
  Flag,
  LayoutGrid,
  Pencil,
  Trash2,
  Check,
  Image as ImageIcon,
  Building2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { likeCount, myLikesQuery, pingUrl, type Ping } from "@/lib/pings";
import { myHubsQuery } from "@/lib/hub-queries";
import { HUB_INTENTS, type HubIntent } from "@/lib/hubs";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ShareCardDialog } from "./ShareCardDialog";
import { shareMessage, shareExcerpt } from "@/lib/sharing/card";

export function LikeButton({ ping }: { ping: Ping }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: liked } = useQuery(myLikesQuery(user?.id));
  const isLiked = liked?.has(ping.id) ?? false;
  const [optimistic, setOptimistic] = useState<{ liked: boolean; count: number } | null>(null);
  const [anim, setAnim] = useState(0);
  const shownLiked = optimistic?.liked ?? isLiked;
  const count = optimistic?.count ?? likeCount(ping);

  const m = useMutation({
    mutationFn: async (next: boolean) => {
      if (!user) throw new Error("Please sign in again.");
      if (next) {
        const { error } = await supabase
          .from("likes")
          .insert({ user_id: user.id, ping_id: ping.id });
        if (error && error.code !== "23505") throw error;
      } else {
        const { error } = await supabase
          .from("likes")
          .delete()
          .eq("user_id", user.id)
          .eq("ping_id", ping.id);
        if (error) throw error;
      }
    },
    onError: () => {
      setOptimistic(null);
      toast.error("Couldn't update your like. Try again.");
    },
    onSettled: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["my-likes"] }),
        qc.invalidateQueries({ queryKey: ["feed"] }),
        qc.invalidateQueries({ queryKey: ["ping", ping.id] }),
        qc.invalidateQueries({ queryKey: ["profile"] }),
      ]);
      setOptimistic(null);
    },
  });

  const onClick = () => {
    if (!user) {
      toast("Sign in to like Pings", {
        action: { label: "Log in", onClick: () => navigate({ to: "/login" }) },
      });
      return;
    }
    const next = !shownLiked;
    setOptimistic({ liked: next, count: count + (next ? 1 : -1) });
    if (next) setAnim((a) => a + 1);
    m.mutate(next);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={shownLiked}
      aria-label={shownLiked ? "Unlike this Ping" : "Like this Ping"}
      className={cn(
        "group relative inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold transition-colors",
        shownLiked
          ? "bg-blush text-blush-foreground"
          : "text-muted-foreground hover:bg-blush/60 hover:text-blush-foreground",
      )}
    >
      <span className="relative inline-flex">
        {anim > 0 && shownLiked && (
          <span
            key={anim}
            className="absolute inset-0 rounded-full bg-blush-foreground/40 animate-burst"
            aria-hidden
          />
        )}
        <Heart
          key={`h${anim}`}
          className={cn("size-4", shownLiked && "fill-current animate-pop")}
        />
      </span>
      <span className="tabular-nums">{count}</span>
    </button>
  );
}

export function ShareMenu({
  ping,
  variant = "ghost",
}: {
  ping: Ping;
  variant?: "ghost" | "outline";
}) {
  const [copied, setCopied] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [hubOpen, setHubOpen] = useState(false);
  const hydrated = useHydrated();
  const url = pingUrl(ping.id);
  const text = shareExcerpt(ping.content);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy. You can copy the link from the address bar.");
    }
  };
  const native = async () => {
    try {
      await navigator.share({ title: "A Ping", text, url });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        toast.error("Couldn't share. Try copying the link.");
    }
  };
  const canNative = hydrated && typeof navigator.share === "function";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size="sm"
            className="h-9 text-muted-foreground"
            aria-label="Share this Ping"
          >
            {copied ? <Check /> : <Share2 />} Reping
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52 rounded-2xl">
          <DropdownMenuItem onSelect={() => setCardOpen(true)}>
            <ImageIcon /> Share card preview
          </DropdownMenuItem>
          {canNative && (
            <DropdownMenuItem onSelect={native}>
              <Share2 /> Share…
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(shareMessage(ping))}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle /> Share on WhatsApp
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setHubOpen(true)}>
            <Building2 /> Share to Hub
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={copy}>
            <Link2 /> Copy link
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ShareCardDialog ping={ping} open={cardOpen} onOpenChange={setCardOpen} />
      <SharePingToHubDialog ping={ping} open={hubOpen} onOpenChange={setHubOpen} />
    </>
  );
}

export function SharePingToHubDialog({
  ping,
  open,
  onOpenChange,
}: {
  ping: Ping;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: myHubs = [], isLoading } = useQuery(myHubsQuery(user?.id));
  const [selectedHub, setSelectedHub] = useState("");
  const [selectedIntent, setSelectedIntent] = useState<HubIntent | "">("");

  const shareMutation = useMutation({
    mutationFn: async () => {
      if (!selectedHub) throw new Error("Select a hub to share to.");
      const { error } = await supabase.rpc("share_ping_to_hub", {
        _hub: selectedHub,
        _ping: ping.id,
        ...(selectedIntent ? { _intent: selectedIntent } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ping shared to Hub!");
      qc.invalidateQueries({ queryKey: ["hub"] });
      qc.invalidateQueries({ queryKey: ["hubs"] });
      onOpenChange(false);
    },
    onError: (e: any) => {
      toast.error(e.message || "Failed to share Ping to hub.");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl p-6">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <Building2 className="size-5 text-primary" /> Share to a Hub
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Feature this update inside one of the community Hubs you belong to.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            shareMutation.mutate();
          }}
          className="mt-4 space-y-4"
        >
          <div>
            <Label className="text-xs font-semibold">Choose Hub</Label>
            {isLoading ? (
              <p className="mt-2 text-xs text-muted-foreground">Loading your hubs…</p>
            ) : myHubs.length === 0 ? (
              <div className="mt-2 rounded-2xl bg-secondary/50 p-4 text-center text-xs text-muted-foreground border border-border">
                You haven't joined any Hubs yet. Browse and join a Hub first!
              </div>
            ) : (
              <select
                value={selectedHub}
                onChange={(e) => setSelectedHub(e.target.value)}
                className="mt-1 flex h-10 w-full rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                required
              >
                <option value="">Select a Hub…</option>
                {myHubs.map((h) => (
                  <option key={h.hub.id} value={h.hub.id}>
                    {h.hub.name} ({h.role})
                  </option>
                ))}
              </select>
            )}
          </div>

          {myHubs.length > 0 && (
            <div>
              <Label className="text-xs font-semibold">Hub Tag / Intent (Optional)</Label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {HUB_INTENTS.map((intent) => (
                  <button
                    key={intent.value}
                    type="button"
                    onClick={() =>
                      setSelectedIntent(selectedIntent === intent.value ? "" : intent.value)
                    }
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      selectedIntent === intent.value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card hover:bg-secondary text-muted-foreground",
                    )}
                  >
                    <span>{intent.emoji}</span> {intent.label}
                  </button>
                ))}
              </div>
            </div>
          )}

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
              disabled={!selectedHub || shareMutation.isPending}
              className="rounded-xl"
            >
              {shareMutation.isPending ? "Sharing…" : "Share Ping"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const REASONS = [
  { v: "spam", l: "Spam or scam" },
  { v: "harassment", l: "Harassment or hate" },
  { v: "misleading", l: "Misleading claims" },
  { v: "inappropriate", l: "Inappropriate content" },
  { v: "other", l: "Something else" },
] as const;

const ROW =
  "flex min-h-12 w-full items-center gap-3 rounded-2xl px-4 py-3 text-left font-medium hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function PingMenu({
  ping,
  onDeleted,
  open,
  onOpenChange,
}: {
  ping: Ping;
  onDeleted?: () => void;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const { user } = useAuth();
  const [innerPanel, setInnerPanel] = useState(false);
  const panel = open ?? innerPanel;
  const setPanel = (o: boolean) => {
    setInnerPanel(o);
    onOpenChange?.(o);
  };
  const [cardOpen, setCardOpen] = useState(false);
  const [hubOpen, setHubOpen] = useState(false);
  const hydrated = useHydrated();
  const canNative = hydrated && typeof navigator.share === "function";
  const url = pingUrl(ping.id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [reportOpen, setReportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number]["v"]>("spam");
  const [details, setDetails] = useState("");
  const [reported, setReported] = useState(false);
  const isOwner = user?.id === ping.user_id;

  const report = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Please sign in again.");
      const { error } = await supabase.from("reports").insert({
        ping_id: ping.id,
        reporter_id: user.id,
        reason,
        details: details.trim() || null,
      });
      if (error && error.code !== "23505") throw error;
    },
    onSuccess: () => setReported(true),
    onError: () => toast.error("Couldn't send the report. Try again."),
  });

  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("pings").delete().eq("id", ping.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ping deleted");
      qc.invalidateQueries();
      onDeleted?.();
    },
    onError: () => toast.error("Couldn't delete this Ping."),
  });

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-9 text-muted-foreground"
        aria-label="Ping actions"
        aria-haspopup="dialog"
        onClick={() => setPanel(true)}
      >
        <LayoutGrid /> <span className="sr-only sm:not-sr-only">Actions</span>
      </Button>
      <Sheet open={panel} onOpenChange={setPanel}>
        <SheetContent
          side="bottom"
          className="mx-auto max-w-lg rounded-t-3xl pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="text-left">
            <SheetTitle className="font-display">Ping actions</SheetTitle>
            <SheetDescription className="line-clamp-2">
              {shareExcerpt(ping.content)}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-2 grid gap-1">
            <button
              type="button"
              className={ROW}
              onClick={() => {
                setPanel(false);
                setCardOpen(true);
              }}
            >
              <ImageIcon className="size-5" /> Share card preview
            </button>
            {canNative && (
              <button
                type="button"
                className={ROW}
                onClick={async () => {
                  setPanel(false);
                  try {
                    await navigator.share({
                      title: "A Ping",
                      text: shareExcerpt(ping.content),
                      url,
                    });
                  } catch (e) {
                    if (!(e instanceof DOMException && e.name === "AbortError"))
                      toast.error("Couldn't share. Try copying the link.");
                  }
                }}
              >
                <Share2 className="size-5" /> Share…
              </button>
            )}
            <a
              className={ROW}
              href={`https://wa.me/?text=${encodeURIComponent(shareMessage(ping))}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setPanel(false)}
            >
              <MessageCircle className="size-5" /> Share link on WhatsApp
            </a>
            <button
              type="button"
              className={ROW}
              onClick={() => {
                setPanel(false);
                setHubOpen(true);
              }}
            >
              <Building2 className="size-5" /> Share to Hub
            </button>
            <button
              type="button"
              className={ROW}
              onClick={async () => {
                setPanel(false);
                try {
                  await navigator.clipboard.writeText(url);
                  toast.success("Link copied");
                } catch {
                  toast.error("Couldn't copy. You can copy the link from the address bar.");
                }
              }}
            >
              <Link2 className="size-5" /> Copy link
            </button>
            {isOwner ? (
              <>
                <Link to="/edit/$id" params={{ id: ping.id }} className={ROW}>
                  <Pencil className="size-5" /> Edit
                </Link>
                <button
                  type="button"
                  className={cn(ROW, "text-destructive")}
                  onClick={() => {
                    setPanel(false);
                    setDeleteOpen(true);
                  }}
                >
                  <Trash2 className="size-5" /> Delete
                </button>
              </>
            ) : (
              <button
                type="button"
                className={ROW}
                onClick={() => {
                  setPanel(false);
                  if (!user) {
                    toast("Sign in to report a Ping", {
                      action: { label: "Log in", onClick: () => navigate({ to: "/login" }) },
                    });
                    return;
                  }
                  setReported(false);
                  setReportOpen(true);
                }}
              >
                <Flag className="size-5" /> Report
              </button>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <ShareCardDialog ping={ping} open={cardOpen} onOpenChange={setCardOpen} />
      <SharePingToHubDialog ping={ping} open={hubOpen} onOpenChange={setHubOpen} />

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="rounded-3xl">
          {reported ? (
            <div className="py-4 text-center">
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-lime">
                <Check className="size-6" />
              </div>
              <DialogTitle className="mt-4 font-display text-xl">
                Thanks for letting us know
              </DialogTitle>
              <DialogDescription className="mt-2">
                Your report was received. We review reports and act on content that breaks the
                rules.
              </DialogDescription>
              <Button className="mt-6" onClick={() => setReportOpen(false)}>
                Done
              </Button>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="font-display">Report this Ping</DialogTitle>
                <DialogDescription>
                  Reports are private. The author won't see who reported.
                </DialogDescription>
              </DialogHeader>
              <fieldset className="grid gap-2">
                <legend className="sr-only">Reason</legend>
                {REASONS.map((r) => (
                  <label
                    key={r.v}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition-colors",
                      reason === r.v ? "border-primary bg-accent" : "hover:bg-secondary",
                    )}
                  >
                    <input
                      type="radio"
                      name="reason"
                      value={r.v}
                      checked={reason === r.v}
                      onChange={() => setReason(r.v)}
                      className="accent-[var(--primary)]"
                    />
                    {r.l}
                  </label>
                ))}
              </fieldset>
              <label className="text-sm font-medium" htmlFor="report-details">
                Details (optional)
              </label>
              <Textarea
                id="report-details"
                value={details}
                onChange={(e) => setDetails(e.target.value.slice(0, 500))}
                rows={3}
                className="rounded-2xl"
              />
              <DialogFooter>
                <Button variant="outline" onClick={() => setReportOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => report.mutate()} disabled={report.isPending}>
                  {report.isPending ? "Sending…" : "Send report"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Delete this Ping?</AlertDialogTitle>
            <AlertDialogDescription>
              Its link will stop working and its likes will be removed. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => del.mutate()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
