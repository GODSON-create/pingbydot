import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sanitizeErrorMessage } from "@/lib/error-diagnostics";
import { cn } from "@/lib/utils";

export function QueryErrorCard({
  title = "Couldn't load this section",
  description = "A connection issue prevented loading live records. Try refreshing below.",
  error,
  onRetry,
  compact = false,
  className,
}: {
  title?: string;
  description?: string;
  error?: unknown;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
}) {
  const devDetail = import.meta.env.DEV && error ? sanitizeErrorMessage(error) : null;

  return (
    <div
      role="alert"
      className={cn(
        "surface-card rounded-3xl border border-destructive/25 text-center",
        compact ? "rounded-2xl p-5" : "p-8 sm:p-10",
        className,
      )}
    >
      <AlertCircle className={cn("mx-auto text-destructive", compact ? "size-7" : "size-10")} />
      <h3
        className={cn(
          "mt-3 font-display font-bold text-foreground",
          compact ? "text-sm" : "text-lg",
        )}
      >
        {title}
      </h3>
      <p
        className={cn(
          "mt-1 text-muted-foreground mx-auto max-w-sm",
          compact ? "text-xs" : "text-xs sm:text-sm",
        )}
      >
        {description}
      </p>
      {devDetail && (
        <p className="mt-2 mx-auto max-w-md rounded-xl bg-secondary/70 px-3 py-1.5 font-mono text-[11px] text-destructive break-words">
          {devDetail}
        </p>
      )}
      {onRetry && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          className={cn("rounded-full", compact ? "mt-3 h-7 text-xs px-3" : "mt-5")}
        >
          <RefreshCw className="size-3.5" />
          Try again
        </Button>
      )}
    </div>
  );
}
