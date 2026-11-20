import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  applyPendingPwaUpdate,
  initializePwaRuntime,
  subscribePwaUpdateAvailability,
} from "@/lib/pwa";

export function PwaInstallAndUpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    initializePwaRuntime();
    return subscribePwaUpdateAvailability(setUpdateAvailable);
  }, []);

  if (!updateAvailable) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-50 border-b border-primary/30 bg-card/95 backdrop-blur px-4 py-2.5"
    >
      <div className="mx-auto max-w-6xl flex flex-wrap items-center justify-between gap-3 text-xs">
        <p className="font-medium text-foreground">
          A new version of Ping is ready. Refresh to load the latest update cleanly.
        </p>
        <Button
          type="button"
          size="sm"
          variant="hero"
          className="h-7 rounded-full text-xs gap-1.5"
          onClick={() => applyPendingPwaUpdate()}
        >
          <RefreshCw className="size-3.5" /> Refresh Ping
        </Button>
      </div>
    </div>
  );
}
