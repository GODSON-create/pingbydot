import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { PingMark } from "@/components/BrandLogo";
import { cn } from "@/lib/utils";

const BOOT_SHOWN_KEY = "ping_boot_shown_v1";
const SKIP_BOOT_PREFIXES = ["/login", "/signup", "/forgot-password", "/reset-password", "/welcome"];

const useSafeLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Official PING Boot / Splash Screen.
 * Showcases the three official PING color marks (Lime primary, Gold & Silver accents)
 * once per browser session on non-auth entry routes, then smoothly fades out.
 */
export function BootSplashScreen() {
  const { ready } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAuthOrOnboarding = SKIP_BOOT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  // Dismiss immediately during SSR or auth routes so login/signup forms are never covered.
  const [dismissed, setDismissed] = useState(isAuthOrOnboarding);
  const [fadingOut, setFadingOut] = useState(false);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  useSafeLayoutEffect(() => {
    if (isAuthOrOnboarding) {
      setDismissed(true);
      return;
    }
    try {
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const alreadyShown = window.sessionStorage.getItem(BOOT_SHOWN_KEY) === "1";
      if (alreadyShown || reducedMotion) {
        window.sessionStorage.setItem(BOOT_SHOWN_KEY, "1");
        setDismissed(true);
      }
    } catch {
      // Ignore storage access restrictions in hardened webviews
    }
  }, [isAuthOrOnboarding]);

  useEffect(() => {
    if (dismissed || isAuthOrOnboarding) return;
    try {
      window.sessionStorage.setItem(BOOT_SHOWN_KEY, "1");
    } catch {
      // Ignore storage errors
    }

    const fadeDelay = readyRef.current ? 180 : 320;
    const removeDelay = readyRef.current ? 360 : 520;

    const fadeTimer = setTimeout(() => {
      setFadingOut(true);
    }, fadeDelay);

    const removeTimer = setTimeout(() => {
      setDismissed(true);
    }, removeDelay);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, [dismissed, isAuthOrOnboarding]);

  if (dismissed || isAuthOrOnboarding) return null;

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
