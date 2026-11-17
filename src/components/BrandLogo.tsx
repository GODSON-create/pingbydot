import { useState } from "react";
import { BRAND_MARK_PNGS, BRAND_MARK_SVGS, type BrandVariant } from "@/lib/brand";
import { cn } from "@/lib/utils";

const SIZE_CLASSES = {
  xs: "size-5.5 rounded-md",
  sm: "size-7 rounded-lg",
  md: "size-9 rounded-xl",
  lg: "size-12 rounded-2xl",
  xl: "size-16 rounded-3xl",
  "2xl": "size-24 rounded-[1.75rem]",
} as const;

export function PingMark({
  variant = "lime",
  size = "md",
  className,
  alt = "PING official mark",
}: {
  variant?: BrandVariant;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
  alt?: string;
}) {
  const [useFallbackSvg, setUseFallbackSvg] = useState(false);
  const src = useFallbackSvg ? BRAND_MARK_SVGS[variant] : BRAND_MARK_PNGS[variant];

  return (
    <img
      src={src}
      alt={alt}
      onError={() => {
        if (!useFallbackSvg) setUseFallbackSvg(true);
      }}
      className={cn("shrink-0 object-contain select-none shadow-sm", SIZE_CLASSES[size], className)}
    />
  );
}

export function BrandLogo({
  className,
  compact = false,
  variant = "lime",
}: {
  className?: string;
  compact?: boolean;
  variant?: BrandVariant;
}) {
  if (compact) {
    return (
      <span className={cn("inline-flex items-center justify-center", className)}>
        <PingMark variant={variant} size="md" alt="Ping by DOT" />
      </span>
    );
  }

  const subColor =
    variant === "gold"
      ? "text-gold"
      : variant === "silver"
        ? "text-muted-foreground"
        : "text-primary";

  return (
    <span className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <PingMark variant={variant} size="md" alt="Ping by DOT" />
      <span className="inline-flex items-baseline gap-1.5">
        <span className="font-display text-xl font-extrabold tracking-tight text-foreground">
          Ping
        </span>
        <span className={cn("text-[10px] font-bold uppercase tracking-widest", subColor)}>
          BY DOT
        </span>
      </span>
    </span>
  );
}
