import { useEffect, useState } from "react";
import { useHydrated } from "@tanstack/react-router";
import { Download, Image as ImageIcon, Share2, MessageCircle, Link2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { pingUrl, type Ping } from "@/lib/pings";
import { shareExcerpt, shareMessage } from "@/lib/sharing/card";

export function ShareCardDialog({ ping, open, onOpenChange }: { ping: Ping; open: boolean; onOpenChange: (open: boolean) => void }) {
  const hydrated = useHydrated();
  const [card, setCard] = useState<{ file: File; url: string; imageOmitted: boolean } | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [sharing, setSharing] = useState(false);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    setCard(null);
    setError(false);
    import("@/lib/sharing/browser").then((m) => m.createCardPng(ping)).then(({ blob, imageOmitted }) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setCard({ file: new File([blob], `ping-${ping.id}.png`, { type: "image/png" }), url: objectUrl, imageOmitted });
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [open, ping, attempt]);

  const canNative = hydrated && typeof navigator.share === "function";
  const canFiles = canNative && card !== null && navigator.canShare?.({ files: [card.file] }) === true;
  const linkShare = async () => {
    if (!canNative) return;
    setSharing(true);
    try { await navigator.share({ title: "Ping by DOT", text: shareExcerpt(ping.content), url: pingUrl(ping.id) }); }
    catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) toast.error("Couldn't share the link. Try copying it instead."); }
    finally { setSharing(false); }
  };
  const imageShare = async () => {
    if (!card) return;
    if (canFiles) {
      setSharing(true);
      try { await navigator.share({ files: [card.file], title: "Ping by DOT" }); }
      catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) toast.error("Couldn't share the image. Try Download card."); }
      finally { setSharing(false); }
    } else {
      const { downloadCard } = await import("@/lib/sharing/browser");
      downloadCard(card.file);
    }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-3xl sm:max-w-xl">
      <DialogHeader>
        <DialogTitle className="font-display text-2xl">Share Ping</DialogTitle>
        <DialogDescription>Share your story, wherever your people are.</DialogDescription>
      </DialogHeader>
      <section aria-label="Share card preview" className="min-w-0">
        <h3 className="mb-3 text-sm font-semibold">Share card preview</h3>
        <div className="max-h-[45dvh] overflow-y-auto rounded-2xl border bg-secondary">
          {card ? <img src={card.url} alt={`Share card: ${ping.content}`} className="h-auto w-full" /> :
            <div className="flex min-h-64 items-center justify-center p-6 text-sm text-muted-foreground" role="status">
              {error ? <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}><RefreshCw /> Retry card</Button> : "Creating your card…"}
            </div>}
        </div>
        {card?.imageOmitted && <p className="mt-2 text-xs text-muted-foreground" role="status">The photo couldn't be included. Your full text is on the card.</p>}
        {error && <p className="mt-2 text-sm text-destructive" role="alert">Couldn't create the card. Link sharing is still available.</p>}
      </section>
      <div className="grid grid-cols-2 gap-2">
        {canNative && <Button onClick={linkShare} disabled={sharing} variant="outline"><Share2 /> Share Ping</Button>}
        <Button onClick={imageShare} disabled={!card || sharing}><ImageIcon />{canFiles ? "Share image" : "Download card"}</Button>
        {canFiles && <Button variant="outline" disabled={!card || sharing} onClick={() => { if (card) void import("@/lib/sharing/browser").then((m) => m.downloadCard(card.file)); }}><Download /> Download card</Button>}
        <Button asChild variant="outline"><a href={`https://wa.me/?text=${encodeURIComponent(shareMessage(ping))}`} target="_blank" rel="noopener noreferrer"><MessageCircle /> WhatsApp</a></Button>
        <Button variant="outline" onClick={async () => {
          try { await navigator.clipboard.writeText(pingUrl(ping.id)); toast.success("Link copied"); }
          catch { toast.error("Couldn't copy. Copy the link below instead."); }
        }}><Link2 /> Copy link</Button>
      </div>
      <a href={pingUrl(ping.id)} className="break-all text-center text-xs text-muted-foreground underline">{pingUrl(ping.id)}</a>
    </DialogContent>
  </Dialog>;
}

export function PingShareActions({ ping }: { ping: Ping }) {
  const [open, setOpen] = useState(false);
  return <>
    <section aria-label="Share this Ping" className="mt-6">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setOpen(true)}><Share2 /> Share Ping</Button>
        <Button variant="outline" onClick={() => setOpen(true)}><ImageIcon /> Share image</Button>
        <Button asChild variant="outline"><a href={`https://wa.me/?text=${encodeURIComponent(shareMessage(ping))}`} target="_blank" rel="noopener noreferrer"><MessageCircle /> Share on WhatsApp</a></Button>
        <Button variant="outline" onClick={async () => {
          try { await navigator.clipboard.writeText(pingUrl(ping.id)); toast.success("Link copied"); }
          catch { toast.error("Couldn't copy. Copy the public link below instead."); }
        }}><Link2 /> Copy link</Button>
      </div>
    </section>
    <ShareCardDialog ping={ping} open={open} onOpenChange={setOpen} />
  </>;
}