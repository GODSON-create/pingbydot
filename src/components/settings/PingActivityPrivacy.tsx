import { useState } from "react";
import { toast } from "sonner";
import { Eye, Shield, Activity, Clock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useUserPrivacy } from "@/lib/privacy";

interface PingActivityPrivacyProps {
  userId: string;
}

export function PingActivityPrivacy({ userId }: PingActivityPrivacyProps) {
  const { preferences, updatePrivacy, isLoading } = useUserPrivacy(userId);
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
    } catch (e) {
      toast.error("Failed to update privacy settings. Please try again.");
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
          <h2 className="font-display text-lg font-bold">Privacy → Ping Activity</h2>
          <p className="text-sm text-muted-foreground">
            Control your read receipts, live presence, and visibility in Hubs.
          </p>
        </div>
      </div>

      <div className="mt-6 divide-y divide-border/60">
        {/* Read Receipts */}
        <div className="flex items-start justify-between py-4 gap-4">
          <div className="flex items-start gap-3">
            <Eye className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <Label htmlFor="read-receipts" className="text-base font-semibold cursor-pointer">
                Read Receipts
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Shows when you have opened and read Pings in Hubs (solid green dot). When disabled,
                others cannot see when you read their messages, and you cannot see who read yours.
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
      </div>

      <div className="mt-4 rounded-xl bg-muted/40 p-3.5 text-xs text-muted-foreground flex items-center gap-2">
        <Shield className="h-4 w-4 shrink-0 text-primary" />
        <span>
          <strong>Reciprocal Privacy:</strong> Ping strictly enforces mutual visibility. If you
          turn off read receipts or active status, you will not receive those indicators from other
          builders.
        </span>
      </div>
    </div>
  );
}
