import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Check, Share2, UserPlus, QrCode, Key, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { siteUrl } from "@/lib/site";
import { generateQrSvgPath } from "@/lib/qr-svg";
import type { Hub } from "@/lib/hubs";
import { hubError, hubInvitesQuery } from "@/lib/hub-queries";

export function HubShareModal({
  hub,
  open,
  onClose,
  isStaff = false,
}: {
  hub: Hub;
  open: boolean;
  onClose: () => void;
  isStaff?: boolean;
}) {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [generatingToken, setGeneratingToken] = useState(false);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviting, setInviting] = useState(false);
  const [showQr, setShowQr] = useState(false);

  const { data: activeInvites = [] } = useQuery(hubInvitesQuery(hub.id, open && isStaff));

  // Generate secure invite token on open if staff
  useEffect(() => {
    let active = true;
    if (open && isStaff && !inviteToken) {
      setGeneratingToken(true);
      (async () => {
        try {
          const { data, error } = await supabase.rpc("create_hub_invite", {
            _hub: hub.id,
            _days: 14,
          });
          if (!error && data && active) {
            setInviteToken(data);
          }
        } catch (err) {
          console.warn("Could not generate invite token:", err);
        } finally {
          if (active) setGeneratingToken(false);
        }
      })();
    }
    return () => {
      active = false;
    };
  }, [open, isStaff, hub.id, inviteToken]);

  const inviteUrl = inviteToken
    ? siteUrl(`/hubs/${encodeURIComponent(hub.slug)}?invite=${encodeURIComponent(inviteToken)}`)
    : siteUrl(`/hubs/${encodeURIComponent(hub.slug)}`);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      toast.success(inviteToken ? "Secure tokenized invite link copied!" : "Hub link copied!");
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
  const qrData = (() => {
    try {
      return generateQrSvgPath(inviteUrl);
    } catch {
      return null;
    }
  })();

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl font-bold flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            <span>Share & Invite to {hub.name}</span>
          </DialogTitle>
          <DialogDescription>
            {isStaff
              ? "Share your dedicated, cryptographic invite token with builders or campus collectives."
              : "Invite collaborators and friends to build in public in this Hub."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Direct link input */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                {inviteToken ? <Key className="size-3 text-primary" /> : null}
                <span>{inviteToken ? "Secure Tokenized Invite" : "Hub Link"}</span>
              </label>
              {inviteToken && (
                <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                  Valid 14 days
                </span>
              )}
            </div>

            <div className="mt-1.5 flex items-center gap-2">
              <Input
                readOnly
                value={generatingToken ? "Generating secure invite link…" : inviteUrl}
                className="rounded-2xl text-xs font-mono select-all"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={generatingToken}
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
              Direct Handle Invite
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

          {/* QR code toggle */}
          <div className="rounded-2xl border border-dashed border-border p-4 text-center">
            <button
              type="button"
              onClick={() => setShowQr(!showQr)}
              className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <QrCode className="size-4" />
              {showQr ? "Hide QR Code" : "Show QR Code for In-Person / Meetup Onboarding"}
            </button>
            {showQr && qrData && (
              <div className="mt-3 flex flex-col items-center">
                <svg
                  role="img"
                  aria-label={`QR code for ${hub.name}`}
                  viewBox={`0 0 ${qrData.viewBoxSize} ${qrData.viewBoxSize}`}
                  className="size-48 rounded-xl border border-border bg-white p-2 shadow-sm"
                  shapeRendering="crispEdges"
                >
                  <rect width={qrData.viewBoxSize} height={qrData.viewBoxSize} fill="#ffffff" />
                  <path d={qrData.path} fill="#090B0A" />
                </svg>
                <p className="mt-2 text-xs text-muted-foreground">
                  Scan to accept invite and join {hub.name} instantly.
                </p>
              </div>
            )}
          </div>

          {/* Active invites management for Hub staff */}
          {isStaff && activeInvites.length > 0 && (
            <div className="space-y-2 border-t border-border/60 pt-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Active Invite Tokens ({activeInvites.length})
              </p>
              <div className="max-h-32 space-y-1.5 overflow-y-auto pr-1">
                {activeInvites.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between gap-2 rounded-xl bg-secondary/40 px-3 py-1.5 text-xs border border-border/50"
                  >
                    <span className="font-mono truncate text-foreground">
                      …{inv.token.slice(-8)} · {inv.uses} uses
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-destructive hover:bg-destructive/10"
                      onClick={async () => {
                        const { error } = await supabase.rpc("revoke_hub_invite", {
                          _invite: inv.id,
                        });
                        if (error) {
                          toast.error("Could not revoke invite.");
                        } else {
                          toast.success("Invite token revoked");
                          qc.invalidateQueries({ queryKey: ["hub-invites", hub.id] });
                        }
                      }}
                    >
                      <Trash2 className="size-3 mr-1" /> Revoke
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
