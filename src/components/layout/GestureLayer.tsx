import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { classifySwipe, isExemptTarget, isTopLevel, neighbourPath, shouldRefresh, PULL_TRIGGER_PX } from "@/lib/gestures";

/** Touch-only gesture shortcuts. Every action here also has a visible control (bottom nav, back links, refresh). */
export function GestureLayer() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const router = useRouter();
  const qc = useQueryClient();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    let start: { x: number; y: number; t: number; exempt: boolean; pulling: boolean } | null = null;
    let pullDist = 0;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { start = null; return; }
      const t = e.touches[0];
      const exempt = isExemptTarget(e.target as Element) || document.body.hasAttribute("data-scroll-locked");
      start = { x: t.clientX, y: t.clientY, t: performance.now(), exempt, pulling: window.scrollY <= 0 && isTopLevel(pathRef.current) };
      pullDist = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!start || start.exempt || !start.pulling) return;
      const t = e.touches[0];
      const dy = t.clientY - start.y;
      if (dy > 0 && Math.abs(t.clientX - start.x) < dy && window.scrollY <= 0) {
        pullDist = Math.min(dy * 0.5, PULL_TRIGGER_PX * 1.4);
        setPull(pullDist);
      } else if (pullDist) { pullDist = 0; setPull(0); }
    };
    const onEnd = async (e: TouchEvent) => {
      const s = start; start = null;
      if (!s || s.exempt) return;
      const t = e.changedTouches[0];
      const selection = window.getSelection()?.toString();
      if (pullDist) {
        const go = shouldRefresh(window.scrollY, pullDist, pathRef.current);
        setPull(0); pullDist = 0;
        if (go) {
          setRefreshing(true);
          try { await qc.invalidateQueries(); await router.invalidate(); } finally { setRefreshing(false); }
        }
        return;
      }
      if (selection) return;
      const r = classifySwipe({ startX: s.x, dx: t.clientX - s.x, dy: t.clientY - s.y, dt: performance.now() - s.t, width: window.innerWidth, pathname: pathRef.current });
      if (r === "back") { if (window.history.length > 1) router.history.back(); else navigate({ to: "/explore" }); }
      else if (r) { const to = neighbourPath(pathRef.current, r); if (to) navigate({ to }); }
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", () => { start = null; setPull(0); }, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [navigate, qc, router]);

  if (!pull && !refreshing) return null;
  const ready = pull >= PULL_TRIGGER_PX;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-20 z-40 flex justify-center" style={{ transform: `translateY(${refreshing ? 8 : pull / 2}px)` }}>
      <span className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium">
        <RefreshCw className={refreshing ? "size-4 motion-safe:animate-spin" : "size-4"} style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }} />
        {refreshing ? "Refreshing…" : ready ? "Release to refresh" : "Pull to refresh"}
      </span>
    </div>
  );
}
