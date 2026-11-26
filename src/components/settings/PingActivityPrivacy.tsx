import { useState } from "react";
import { toast } from "sonner";
import { Eye, Shield, Activity, Clock, MessageSquareLock, Timer } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useUserPrivacy, type DmPermission } from "@/lib/privacy";
import {
  CHAT_RETENTION_POLICIES,
  formatStorageBytes,
  isPolicyAllowedByMax,
  useMyChatRetentionEntitlement,
  useSetDefaultChatRetention,
  type ChatRetentionPolicy,
} from "@/lib/chat-retention";
import { cn } from "@/lib/utils";

interface PingActivityPrivacyProps {
  userId: string;
}

const DM_PERMISSION_OPTIONS: Array<{
  value: DmPermission;
  label: string;
  description: string;
}> = [
  {
    value: "requests",
    label: "Message requests (Recommended)",
    description:
      "Mutual connections message freely. Others can send a single text-only request for you to accept, decline, or block.",
  },
  {
    value: "mutual_follows",
    label: "Mutual connections only",
    description: "Only people you follow back can start a direct conversation with you.",
  },
  {
    value: "everyone",
    label: "Everyone (public profile)",
    description: "Anyone on Ping can message you directly unless your profile is set to Private.",
  },
  {
    value: "nobody",
    label: "No new direct messages",
    description: "Pause new unsolicited conversations. Mutual connections can still message you.",
  },
];

export function PingActivityPrivacy({ userId }: PingActivityPrivacyProps) {
  const { preferences, updatePrivacy, isLoading } = useUserPrivacy(userId);
  const { data: retentionEntitlement } = useMyChatRetentionEntitlement(userId);
  const setDefaultRetention = useSetDefaultChatRetention(userId);
  const [updatingField, setUpdatingField] = useState<string | null>(null);

  const handleToggle = async (
    field: "read_receipts_enabled" | "active_presence_enabled" | "last_active_enabled",
    nextVal: boolean,
  ) => {
    try {
      setUpdatingField(field);
      await updatePrivacy({ [field]: nextVal });
      toast.success(
        field === "read_receipts_enabled"
          ? `Read receipts turned ${nextVal ? "ON" : "OFF"}`
          : field === "active_presence_enabled"
            ? `Active reading status turned ${nextVal ? "ON" : "OFF"}`
            : `Last active visibility turned ${nextVal ? "ON" : "OFF"}`,
      );
    } catch {
      toast.error("Failed to update privacy settings. Please try again.");
    } finally {
      setUpdatingField(null);
    }
  };

  const handleDmPermissionChange = async (nextPerm: DmPermission) => {
    try {
      setUpdatingField("dm_permission");
      await updatePrivacy({ dm_permission: nextPerm });
      toast.success("Direct message permissions updated");
    } catch {
      toast.error("Failed to update messaging permission. Please try again.");
    } finally {
      setUpdatingField(null);
    }
  };

  const handleDefaultRetentionChange = async (policy: ChatRetentionPolicy) => {
    try {
      setUpdatingField("chat_retention");
      await setDefaultRetention.mutateAsync(policy);
      toast.success("Default chat retention updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update default chat retention.");
    } finally {
      setUpdatingField(null);
    }
  };

  return (
    <div className="surface-card mt-6 rounded-3xl p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Shield className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-display text-lg font-bold">Privacy → Ping Activity & Messaging</h2>
          <p className="text-sm text-muted-foreground">
            Control message requests, read receipts, live presence, and visibility.
          </p>
        </div>
      </div>

      <div className="mt-6 divide-y divide-border/60">
        {/* Direct Message Request Permissions */}
        <div className="py-4 space-y-3">
          <div className="flex items-start gap-3">
            <MessageSquareLock className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <Label className="text-base font-semibold">Direct Message Permissions</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Enforced at the database layer. Private profiles always restrict unsolicited contact
                to mutual connections.
              </p>
            </div>
          </div>

          <div
            role="radiogroup"
            aria-label="Direct message permissions"
            className="grid gap-2 sm:grid-cols-2 pl-0 sm:pl-8"
          >
            {DM_PERMISSION_OPTIONS.map((opt) => {
              const selected = preferences.dm_permission === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={isLoading || updatingField === "dm_permission"}
                  onClick={() => void handleDmPermissionChange(opt.value)}
                  className={cn(
                    "rounded-2xl border p-3 text-left transition-colors",
                    selected
                      ? "border-primary bg-primary/10"
                      : "border-border/70 bg-secondary/30 hover:bg-secondary/60",
                  )}
                >
                  <p className="text-xs font-semibold text-foreground">{opt.label}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
                    {opt.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Read Receipts */}
        <div className="flex items-start justify-between py-4 gap-4">
          <div className="flex items-start gap-3">
            <Eye className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <Label htmlFor="read-receipts" className="text-base font-semibold cursor-pointer">
                Read Receipts
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Shows when you have opened and read messages or Hub Pings. When disabled, others
                cannot see when you read their messages, and you will not see read receipts from
                others.
              </p>
            </div>
          </div>
          <Switch
            id="read-receipts"
            checked={preferences.read_receipts_enabled}
            disabled={isLoading || updatingField === "read_receipts_enabled"}
            onCheckedChange={(checked) => handleToggle("read_receipts_enabled", checked)}
            className="data-[state=checked]:bg-primary"
          />
        </div>

        {/* Active Reading Status */}
        <div className="flex items-start justify-between py-4 gap-4">
          <div className="flex items-start gap-3">
            <Activity className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <Label htmlFor="active-presence" className="text-base font-semibold cursor-pointer">
                Active Reading Status
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Displays a breathing green dot when you currently have a Hub conversation open in an
                active foreground tab.
              </p>
            </div>
          </div>
          <Switch
            id="active-presence"
            checked={preferences.active_presence_enabled}
            disabled={isLoading || updatingField === "active_presence_enabled"}
            onCheckedChange={(checked) => handleToggle("active_presence_enabled", checked)}
            className="data-[state=checked]:bg-primary"
          />
        </div>

        {/* Last Active Visibility */}
        <div className="flex items-start justify-between py-4 gap-4">
          <div className="flex items-start gap-3">
            <Clock className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <Label htmlFor="last-active" className="text-base font-semibold cursor-pointer">
                Last Active Visibility
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Allows other hub members to see your approximate recent activity timestamp.
              </p>
            </div>
          </div>
          <Switch
            id="last-active"
            checked={preferences.last_active_enabled}
            disabled={isLoading || updatingField === "last_active_enabled"}
            onCheckedChange={(checked) => handleToggle("last_active_enabled", checked)}
            className="data-[state=checked]:bg-primary"
          />
        </div>

        {/* Default Private Chat Retention (Feature-Flagged) */}
        {retentionEntitlement?.feature_enabled && (
          <div className="py-4 space-y-3" data-testid="default-chat-retention-section">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <Timer className="h-5 w-5 mt-0.5 text-primary shrink-0" />
                <div>
                  <Label className="text-base font-semibold">Default Private Chat Retention</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Applies to new private messages and attachments (public Pings, profiles,
                    Moments, and Hubs are never affected). Saved-in-chat items survive automatic
                    expiry within your storage quota.
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                Saved: {formatStorageBytes(retentionEntitlement.saved_storage_used_bytes)} /{" "}
                {formatStorageBytes(retentionEntitlement.saved_storage_quota_bytes)}
              </span>
            </div>

            <div
              role="radiogroup"
              aria-label="Default private chat retention"
              className="grid gap-2 sm:grid-cols-2 pl-0 sm:pl-8"
            >
              {CHAT_RETENTION_POLICIES.map((opt) => {
                const allowed = isPolicyAllowedByMax(
                  opt.value,
                  retentionEntitlement.max_retention_policy,
                );
                const selected = retentionEntitlement.default_chat_retention_policy === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={!allowed || updatingField === "chat_retention"}
                    onClick={() => void handleDefaultRetentionChange(opt.value)}
                    className={cn(
                      "rounded-2xl border p-3 text-left transition-colors",
                      selected
                        ? "border-primary bg-primary/10"
                        : allowed
                          ? "border-border/70 bg-secondary/30 hover:bg-secondary/60"
                          : "border-border/40 bg-muted/30 opacity-60 cursor-not-allowed",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-foreground">{opt.label}</p>
                      {!allowed && (
                        <span className="text-[10px] font-medium text-muted-foreground">
                          {opt.requiredTierLabel}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
                      {opt.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 rounded-xl bg-muted/40 p-3.5 text-xs text-muted-foreground flex items-center gap-2">
        <Shield className="h-4 w-4 shrink-0 text-primary" />
        <span>
          <strong>Reciprocal Privacy:</strong> Ping strictly enforces mutual visibility. If you turn
          off read receipts or active status, you will not receive those indicators from other
          builders.
        </span>
      </div>
    </div>
  );
}
