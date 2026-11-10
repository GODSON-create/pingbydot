import { useState } from "react";
import { Copy, Check, Share2, UserPlus, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { siteUrl } from "@/lib/site";
import type { Hub } from "@/lib/hubs";
import { hubError } from "@/lib/hub-queries";

export function HubShareModal({
  hub,
  open,
  onClose,
}: {
  hub: Hub;
  open: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviting, setInviting] = useState(false);
  const [showQr, setShowQr] = useState(false);

  const inviteUrl = siteUrl(`/hubs/${encodeURIComponent(hub.slug)}?ref=invite`);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      toast.success("Invite link copied!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy link. Please copy it manually.");
    }
  };

  const handleNativeShare = async () => {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({
          title: `${hub.name} on Ping`,
          text: `Join ${hub.name} on Ping — built for founders and creators to build in public!`,
          url: inviteUrl,
        });
      } catch {
        // User canceled or failed
      }
    }
  };

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUsername = inviteUsername.trim().replace(/^@/, "").toLowerCase();
    if (!cleanUsername) return;
    setInviting(true);
    try {
      const { error } = await supabase.rpc("invite_to_hub", {
        _hub: hub.id,
        _username: cleanUsername,
      });
      if (error) {
        toast.error(hubError(error, "Couldn't send invite. Try again."));
      } else {
        toast.success(`Invited @${cleanUsername} to ${hub.name}!`);
        setInviteUsername("");
      }
    } catch (err) {
      toast.error(hubError(err, "Couldn't send invite."));
    } finally {
      setInviting(false);
    }
  };

  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(inviteUrl)}`;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl font-bold">
            Share & Invite to {hub.name}
          </DialogTitle>
          <DialogDescription>
            Invite collaborators, students, or team members to build in public here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Copy invite link */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Direct Invite Link
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <Input
                readOnly
                value={inviteUrl}
                className="rounded-2xl text-xs font-mono select-all"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={copy}
                className="size-10 shrink-0 rounded-2xl"
                aria-label="Copy invite link"
              >
                {copied ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </div>

          {/* Native mobile share */}
          {canShare && (
            <Button
              type="button"
              variant="secondary"
              className="w-full rounded-2xl"
              onClick={handleNativeShare}
            >
              <Share2 className="size-4" /> Share via…
            </Button>
          )}

          {/* Invite existing Ping user by username */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Invite by Ping Handle
            </label>
            <form onSubmit={handleInviteUser} className="mt-1.5 flex items-center gap-2">
              <Input
                placeholder="@username"
                value={inviteUsername}
                onChange={(e) => setInviteUsername(e.target.value)}
                className="rounded-2xl"
              />
              <Button
                type="submit"
                variant="hero"
                size="sm"
                disabled={inviting || !inviteUsername.trim()}
                className="rounded-2xl shrink-0"
              >
                <UserPlus className="size-4" /> {inviting ? "Inviting…" : "Invite"}
              </Button>
            </form>
          </div>

          {/* QR code toggle for campus / meetup onboarding */}
          <div className="rounded-2xl border border-dashed border-border p-4 text-center">
            <button
              type="button"
              onClick={() => setShowQr(!showQr)}
              className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <QrCode className="size-4" />
              {showQr ? "Hide QR Code" : "Show QR Code for In-Person Onboarding"}
            </button>
            {showQr && (
              <div className="mt-3 flex flex-col items-center">
                <img
                  src={qrCodeUrl}
                  alt={`QR code for ${hub.name}`}
                  className="size-48 rounded-xl border border-border shadow-sm"
                  loading="lazy"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Scan to open the hub invite link instantly.
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
