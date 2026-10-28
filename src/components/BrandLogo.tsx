import { useState } from "react";
import { getBrandLogo } from "@/lib/brand";
import { cn } from "@/lib/utils";

export function BrandLogo({ className }: { className?: string }) {
  const logo = getBrandLogo();
  const [failed, setFailed] = useState(false);
  return <span className={cn("inline-flex h-8 w-36 items-center", className)}>
    {logo && !failed ? <picture className="flex h-full w-full items-center">
      {logo.darkSrc && <source media="(prefers-color-scheme: dark)" srcSet={logo.darkSrc} />}
      <img src={logo.src} alt="Ping by DOT" width={logo.width} height={logo.height} onError={() => setFailed(true)} className="max-h-full max-w-full object-contain" />
    </picture> : <span className="inline-flex items-baseline gap-1.5 font-display text-2xl font-extrabold text-foreground">
      Ping <span className="text-xs font-medium">by DOT</span>
    </span>}
  </span>;
}