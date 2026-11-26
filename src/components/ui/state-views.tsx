import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared design-system empty state card (Section 9 & 10).
 * Keeps empty states visually calm, actionable, and consistent across all Ping surfaces.
 */
export function EmptyStateCard({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "surface-card rounded-3xl p-8 sm:p-10 text-center flex flex-col items-center justify-center border border-border/70",
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-3.5">
        {icon}
      </div>
      <h3 className="font-display text-base sm:text-lg font-bold text-foreground">{title}</h3>
      <p className="mt-1 max-w-sm text-xs sm:text-sm text-muted-foreground leading-relaxed">
        {description}
      </p>
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/**
 * Shared loading skeleton stack for lists, feeds, and dashboards.
 */
export function LoadingSkeletonStack({
  rows = 3,
  heightClass = "h-24",
  label = "Loading content",
}: {
  rows?: number;
  heightClass?: string;
  label?: string;
}) {
  return (
    <div className="space-y-3" role="status" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "w-full animate-pulse rounded-3xl border border-border/50 bg-secondary/55",
            heightClass,
          )}
        />
      ))}
    </div>
  );
}
