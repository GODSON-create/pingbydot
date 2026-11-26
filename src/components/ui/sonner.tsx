import { useEffect, useState } from "react";
import { Toaster as Sonner } from "sonner";
import { useTheme } from "@/lib/theme";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const MOBILE_TOAST_OFFSET = {
  top: "calc(env(safe-area-inset-top, 0px) + 4.5rem)",
  left: 16,
  right: 16,
} as const;

const DESKTOP_TOAST_OFFSET = {
  top: 20,
  right: 20,
} as const;

function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);

  return isMobile;
}

const Toaster = ({ position, offset, mobileOffset, ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme();
  const isMobile = useIsMobileViewport();
  const resolvedPosition = position ?? (isMobile ? "top-center" : "top-right");

  return (
    <Sonner
      theme={resolvedTheme}
      position={resolvedPosition}
      offset={offset ?? DESKTOP_TOAST_OFFSET}
      mobileOffset={mobileOffset ?? MOBILE_TOAST_OFFSET}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
