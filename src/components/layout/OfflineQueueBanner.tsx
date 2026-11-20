import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CloudOff, RefreshCw, Trash2, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";
import { useNetworkStatus } from "@/lib/native";
import {
  clearOfflineQueue,
  flushOfflineQueue,
  resetFailedOfflineActions,
  useOfflineQueue,
} from "@/lib/offline-queue";

export function OfflineQueueBanner() {
  const { connected } = useNetworkStatus();
  const { t } = useLocale();
  const queue = useOfflineQueue();
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!connected || queue.length === 0) return;
    const hasPending = queue.some((item) => item.status === "pending");
    if (!hasPending) return;

    let cancelled = false;
    setSyncing(true);
    void flushOfflineQueue()
      .then((res) => {
        if (cancelled) return;
        if (res.synced > 0) {
          toast.success(`Synced ${res.synced} queued action${res.synced === 1 ? "" : "s"}`);
          void qc.invalidateQueries({ queryKey: ["feed"] });
          void qc.invalidateQueries({ queryKey: ["conversations"] });
        }
      })
      .finally(() => {
        if (!cancelled) setSyncing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [connected, queue, qc]);

  if (connected && queue.length === 0) return null;

  const failedCount = queue.filter((q) => q.status === "failed").length;

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      resetFailedOfflineActions();
      const res = await flushOfflineQueue();
      if (res.synced > 0) {
        toast.success(`Synced ${res.synced} queued action${res.synced === 1 ? "" : "s"}`);
        void qc.invalidateQueries({ queryKey: ["feed"] });
      } else if (res.failed > 0) {
        toast.error("Some queued actions could not sync yet. Check your connection.");
      }
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-queue-banner"
      className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-foreground"
    >
      <span className="inline-flex items-center gap-2 font-medium">
        {!connected ? (
          <>
            <WifiOff className="size-3.5 text-amber-500 shrink-0" />
            {t("offline.banner")}
          </>
        ) : (
          <>
            <CloudOff className="size-3.5 text-amber-500 shrink-0" />
            <span>
              {queue.length} {t("offline.queue_pending")}
              {failedCount > 0 ? ` (${failedCount} need retry)` : ""}
            </span>
          </>
        )}
      </span>

      <div className="flex items-center gap-2 shrink-0">
        {queue.length > 0 && connected && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={syncing}
            onClick={() => void handleManualSync()}
            className="h-7 rounded-full px-3 text-[11px] gap-1"
          >
            <RefreshCw className={`size-3 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing…" : t("offline.sync_now")}
          </Button>
        )}
        {queue.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              clearOfflineQueue();
              toast.info("Cleared offline queue");
            }}
            className="h-7 rounded-full px-2.5 text-[11px] text-muted-foreground"
            title="Clear queued actions"
          >
            <Trash2 className="size-3" />
          </Button>
        )}
        {!connected && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void qc.invalidateQueries()}
            className="h-7 rounded-full px-3 text-[11px]"
          >
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}
