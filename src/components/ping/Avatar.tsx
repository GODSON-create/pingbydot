import { cn } from "@/lib/utils";

const TONES = ["bg-lime text-lime-foreground", "bg-blush text-blush-foreground", "bg-sun text-foreground", "bg-primary text-primary-foreground"];

export function FounderAvatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string;
  src?: string | null | undefined;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
  const tone = TONES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length];
  const sz = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-14 text-lg", xl: "size-24 text-3xl" }[size];
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border-[1.5px] border-foreground font-display font-bold", tone, sz, className)}
      aria-hidden={!src}
    >
      {src ? <img src={src} alt={name} className="size-full object-cover" loading="lazy" /> : initials}
    </span>
  );
}
