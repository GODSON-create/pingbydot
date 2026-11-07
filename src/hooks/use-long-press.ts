import { useEffect, useRef } from "react";
import { isExemptTarget, LONG_PRESS_MS, LONG_PRESS_SLOP_PX } from "@/lib/gestures";

/** Touch long-press shortcut. Cancels on movement (scrolling) or text selection; swallows the click that follows. */
export function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return {
    onPointerDown: (e: React.PointerEvent) => {
      fired.current = false;
      clear();
      if (e.pointerType !== "touch" || isExemptTarget(e.target as Element)) return;
      const t = e.target as Element;
      if (t.closest("button,[role=button],[role=menuitem]")) return; // controls keep their own taps
      origin.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = setTimeout(() => {
        if (window.getSelection()?.toString()) return;
        fired.current = true;
        navigator.vibrate?.(10);
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const o = origin.current;
      if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > LONG_PRESS_SLOP_PX) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onContextMenu: (e: React.MouseEvent) => { if (fired.current) e.preventDefault(); },
    onClickCapture: (e: React.MouseEvent) => {
      if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false; }
    },
  };
}
