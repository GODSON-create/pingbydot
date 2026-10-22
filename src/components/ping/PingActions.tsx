import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, Share2, Link2, MessageCircle, Flag, MoreHorizontal, Pencil, Trash2, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { likeCount, myLikesQuery, pingUrl, type Ping } from "@/lib/pings";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";

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
      if (next) {
        const { error } = await supabase.from("likes").insert({ user_id: user!.id, ping_id: ping.id });
        if (error && error.code !== "23505") throw error;
      } else {
        const { error } = await supabase.from("likes").delete().eq("user_id", user!.id).eq("ping_id", ping.id);
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
      toast("Sign in to like Pings", { action: { label: "Log in", onClick: () => navigate({ to: "/login" }) } });
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
        shownLiked ? "bg-blush text-blush-foreground" : "text-muted-foreground hover:bg-blush/60 hover:text-blush-foreground",
      )}
    >
      <span className="relative inline-flex">
        {anim > 0 && shownLiked && <span key={anim} className="absolute inset-0 rounded-full bg-blush-foreground/40 animate-burst" aria-hidden />}
        <Heart key={`h${anim}`} className={cn("size-4", shownLiked && "fill-current animate-pop")} />
      </span>
      <span className="tabular-nums">{count}</span>
    </button>
  );
}

export function ShareMenu({ ping, variant = "ghost" }: { ping: Ping; variant?: "ghost" | "outline" }) {
  const [copied, setCopied] = useState(false);
  const url = pingUrl(ping.id);
  const text = `${ping.author?.display_name || "A founder"} shared a Ping: ${ping.content.slice(0, 100)}${ping.content.length > 100 ? "…" : ""}`;

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
    } catch {
      /* user cancelled */
    }
  };
  const canNative = typeof navigator !== "undefined" && "share" in navigator;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size="sm" className="h-9 text-muted-foreground" aria-label="Share this Ping">
          {copied ? <Check /> : <Share2 />} Reping
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 rounded-2xl">
        {canNative && <DropdownMenuItem onSelect={native}><Share2 /> Share…</DropdownMenuItem>}
        <DropdownMenuItem asChild>
          <a href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`} target="_blank" rel="noopener noreferrer">
            <MessageCircle /> Share on WhatsApp
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={copy}><Link2 /> Copy link</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const REASONS = [
  { v: "spam", l: "Spam or scam" },
  { v: "harassment", l: "Harassment or hate" },
  { v: "misleading", l: "Misleading claims" },
  { v: "inappropriate", l: "Inappropriate content" },
  { v: "other", l: "Something else" },
] as const;

export function PingMenu({ ping, onDeleted }: { ping: Ping; onDeleted?: () => void }) {
  const { user } = useAuth();
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
      const { error } = await supabase.from("reports").insert({ ping_id: ping.id, reporter_id: user!.id, reason, details: details.trim() || null });
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-9 text-muted-foreground" aria-label="More actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48 rounded-2xl">
          {isOwner && (
            <>
              <DropdownMenuItem asChild>
                <Link to="/edit/$id" params={{ id: ping.id }}><Pencil /> Edit</Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDeleteOpen(true)} className="text-destructive focus:text-destructive"><Trash2 /> Delete</DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {!isOwner && (
            <DropdownMenuItem
              onSelect={() => {
                if (!user) {
                  toast("Sign in to report a Ping", { action: { label: "Log in", onClick: () => navigate({ to: "/login" }) } });
                  return;
                }
                setReported(false);
                setReportOpen(true);
              }}
            >
              <Flag /> Report
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="rounded-3xl">
          {reported ? (
            <div className="py-4 text-center">
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-lime"><Check className="size-6" /></div>
              <DialogTitle className="mt-4 font-display text-xl">Thanks for letting us know</DialogTitle>
              <DialogDescription className="mt-2">Your report was received. We review reports and act on content that breaks the rules.</DialogDescription>
              <Button className="mt-6" onClick={() => setReportOpen(false)}>Done</Button>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="font-display">Report this Ping</DialogTitle>
                <DialogDescription>Reports are private. The author won't see who reported.</DialogDescription>
              </DialogHeader>
              <fieldset className="grid gap-2">
                <legend className="sr-only">Reason</legend>
                {REASONS.map((r) => (
                  <label key={r.v} className={cn("flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition-colors", reason === r.v ? "border-primary bg-accent" : "hover:bg-secondary")}>
                    <input type="radio" name="reason" value={r.v} checked={reason === r.v} onChange={() => setReason(r.v)} className="accent-[var(--primary)]" />
                    {r.l}
                  </label>
                ))}
              </fieldset>
              <label className="text-sm font-medium" htmlFor="report-details">Details (optional)</label>
              <Textarea id="report-details" value={details} onChange={(e) => setDetails(e.target.value.slice(0, 500))} rows={3} className="rounded-2xl" />
              <DialogFooter>
                <Button variant="outline" onClick={() => setReportOpen(false)}>Cancel</Button>
                <Button onClick={() => report.mutate()} disabled={report.isPending}>{report.isPending ? "Sending…" : "Send report"}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Delete this Ping?</AlertDialogTitle>
            <AlertDialogDescription>Its link will stop working and its likes will be removed. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Keep it</AlertDialogCancel>
            <AlertDialogAction className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => del.mutate()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
