import { useState } from "react";
import {
  Check,
  ExternalLink,
  Info,
  Link2,
  Mail,
  MessageCircle,
  MessageSquare,
  Send,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  buildShareDestinations,
  generateShareCode,
  readLocalShareCounts,
  recordShareEvent,
  type ShareDestinationId,
  type UniversalSharePayload,
} from "@/lib/sharing/universal";

export function UniversalShareDialog({
  payload,
  open,
  onOpenChange,
}: {
  payload: UniversalSharePayload;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [platformNotice, setPlatformNotice] = useState<string | null>(null);
  const shareCode = payload.shareCode ?? generateShareCode(payload.targetType, payload.targetId);
  const { url, destinations } = buildShareDestinations({ ...payload, shareCode });
  const localStats = readLocalShareCounts(payload.targetType, payload.targetId);

  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const track = (destination: ShareDestinationId) => {
    void recordShareEvent({
      targetType: payload.targetType,
      targetId: payload.targetId,
      eventKind: "share_initiated",
      destination,
      shareCode,
    }).catch(() => {});
  };

  const handleCopy = async (destination: ShareDestinationId = "copy_link") => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      track(destination);
      toast.success("Attributed share link copied");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy link automatically. Copy it from the field below.");
    }
  };

  const handleNative = async () => {
    if (!canNativeShare) return;
    try {
      await navigator.share({
        title: payload.title,
        text: payload.description,
        url,
      });
      track("native_share");
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        toast.error("Couldn't open native share sheet.");
      }
    }
  };

  const directDestinations = destinations.filter((d) => d.mode === "direct_url");
  const restrictedDestinations = destinations.filter((d) => d.mode === "card_or_sheet_fallback");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg rounded-3xl p-6 max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <Share2 className="size-5 text-primary" /> Share on Ping &amp; Beyond
          </DialogTitle>
          <DialogDescription className="text-xs">
            Share across messaging apps, social networks, email, or SMS with rich link previews and
            referral attribution.
          </DialogDescription>
        </DialogHeader>

        {/* Share Card Preview Summary */}
        <div className="mt-2 rounded-2xl border border-border/70 bg-secondary/40 p-4 space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
            Ping by DOT · {payload.targetType}
          </p>
          <p className="font-display text-sm font-bold text-foreground line-clamp-1">
            {payload.title}
          </p>
          <p className="text-xs text-muted-foreground line-clamp-2">{payload.description}</p>
        </div>

        {/* Primary Actions */}
        <div className="mt-3 flex flex-wrap gap-2">
          {canNativeShare && (
            <Button
              type="button"
              variant="hero"
              size="sm"
              className="rounded-full gap-1.5"
              onClick={handleNative}
            >
              <Share2 className="size-3.5" /> Device Share Sheet
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full gap-1.5"
            onClick={() => void handleCopy("copy_link")}
          >
            {copied ? <Check className="size-3.5 text-primary" /> : <Link2 className="size-3.5" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>

        {/* Direct URL Platforms */}
        <div className="mt-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
            Direct Share Destinations
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {directDestinations.map((dest) => (
              <Button
                key={dest.id}
                asChild
                variant="outline"
                size="sm"
                className="justify-start rounded-xl text-xs h-9"
              >
                <a
                  href={dest.href}
                  target={dest.id === "email" || dest.id === "sms" ? undefined : "_blank"}
                  rel="noopener noreferrer"
                  onClick={() => track(dest.id)}
                >
                  {dest.id === "whatsapp" ? (
                    <MessageCircle className="size-3.5 text-emerald-500" />
                  ) : dest.id === "email" ? (
                    <Mail className="size-3.5 text-primary" />
                  ) : dest.id === "sms" ? (
                    <MessageSquare className="size-3.5 text-primary" />
                  ) : dest.id === "telegram" ? (
                    <Send className="size-3.5 text-sky-500" />
                  ) : (
                    <ExternalLink className="size-3.5 text-muted-foreground" />
                  )}
                  <span className="truncate">{dest.label}</span>
                </a>
              </Button>
            ))}
          </div>
        </div>

        {/* Restricted Platforms (Honest Share-Sheet / Copy Fallback — Phase 3.8) */}
        <div className="mt-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
            Story &amp; Mobile Apps (Share Sheet / Link)
          </p>
          <div className="flex flex-wrap gap-2">
            {restrictedDestinations.map((dest) => (
              <Button
                key={dest.id}
                type="button"
                variant="secondary"
                size="sm"
                className="rounded-xl text-xs h-9"
                onClick={async () => {
                  setPlatformNotice(dest.restrictionNote ?? null);
                  await handleCopy(dest.id);
                }}
              >
                <Share2 className="size-3.5" /> {dest.label} (Copy / Sheet)
              </Button>
            ))}
          </div>
          {platformNotice && (
            <p className="mt-2 flex items-start gap-1.5 rounded-xl border border-border/70 bg-secondary/40 p-2.5 text-[11px] text-muted-foreground">
              <Info className="size-3.5 shrink-0 mt-0.5 text-primary" />
              <span>{platformNotice}</span>
            </p>
          )}
        </div>

        {/* Attributed Link & Honest Analytics Note */}
        <div className="mt-4 pt-3 border-t border-border/60 space-y-1.5">
          <p className="break-all text-[11px] font-mono text-muted-foreground bg-secondary/40 rounded-xl px-3 py-2">
            {url}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Shares initiated on this device: <strong>{localStats.initiated}</strong>. Ping tracks
            initiated shares and attributed link landings — external apps do not report private
            message completion.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
