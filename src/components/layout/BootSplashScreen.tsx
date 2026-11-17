import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { PingMark } from "@/components/BrandLogo";
import { cn } from "@/lib/utils";

/**
 * Official PING Boot / Splash Screen.
 * Showcases the three official PING color marks (Lime primary, Gold & Silver accents)
 * during initial client boot and authentication hydration, then smoothly fades out.
 */
export function BootSplashScreen() {
  const { ready } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(
      () => {
        setFadingOut(true);
      },
      ready ? 320 : 650,
    );

    const removeTimer = setTimeout(
      () => {
        setDismissed(true);
      },
      ready ? 580 : 900,
    );

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, [ready]);

  if (dismissed) return null;

  return (
    <div
      role="status"
      aria-label="Loading PING"
      data-boot-screen="true"
      className={cn(
        "fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#090b0a] text-[#f4f2e9] transition-opacity duration-300 pointer-events-none",
        fadingOut ? "opacity-0" : "opacity-100",
      )}
    >
      {/* Ambient Emerald & Gold Glow */}
      <div className="absolute size-72 rounded-full bg-[#c7f36b]/15 blur-3xl" aria-hidden />

      <div className="relative flex flex-col items-center">
        {/* Official PING Colorway Triad: Silver · Primary Lime · Gold */}
        <div className="flex items-end gap-4">
          <PingMark
            variant="silver"
            size="md"
            alt="PING Silver Mark"
            className="opacity-75 -rotate-6 transition-transform"
          />
          <PingMark
            variant="lime"
            size="2xl"
            alt="PING Official Mark"
            className="ring-2 ring-[#c7f36b]/35 shadow-lift"
          />
          <PingMark
            variant="gold"
            size="md"
            alt="PING Gold Mark"
            className="opacity-85 rotate-6 transition-transform"
          />
        </div>

        <div className="mt-5 flex items-baseline gap-2">
          <span className="font-display text-3xl font-extrabold tracking-tight text-[#f4f2e9]">
            Ping
          </span>
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-[#c7f36b]">
            BY DOT
          </span>
        </div>

        <p className="mt-1.5 text-xs font-medium tracking-wide text-[#9da49a]">
          People · Intent · Discovery · Coordination
        </p>

        {/* Animated Boot Progress Indicator */}
        <div className="mt-6 h-1 w-28 overflow-hidden rounded-full bg-[#171b18]">
          <div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-[#c7f36b] via-[#d8b66a] to-[#c7f36b]" />
        </div>
      </div>
    </div>
  );
}
