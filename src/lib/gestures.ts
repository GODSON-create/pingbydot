/** Pure gesture rules, kept separate from the DOM so boundaries are testable. */
export const TOP_LEVEL_PATHS = ["/", "/explore"] as const;

/** Native back/forward edge gestures (iOS Safari, Android) live in this outer strip; we never start there. */
export const SYSTEM_EDGE_PX = 20;
/** Our own edge-back zone sits just inside the system strip, only on non-top-level pages. */
export const EDGE_BACK_PX = 44;
export const SWIPE_MIN_PX = 80;
export const SWIPE_MAX_MS = 700;

export type SwipeInput = {
  startX: number;
  dx: number;
  dy: number;
  dt: number;
  width: number;
  pathname: string;
};
export type SwipeResult = "next" | "prev" | "back" | null;

export const isTopLevel = (pathname: string) =>
  (TOP_LEVEL_PATHS as readonly string[]).includes(pathname);

export function classifySwipe({ startX, dx, dy, dt, width, pathname }: SwipeInput): SwipeResult {
  if (dt > SWIPE_MAX_MS) return null;
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 2) return null; // vertical scroll wins
  if (startX < SYSTEM_EDGE_PX || startX > width - SYSTEM_EDGE_PX) return null; // leave to the OS
  if (isTopLevel(pathname)) return dx < 0 ? "next" : "prev";
  if (startX <= EDGE_BACK_PX && dx > 0) return "back";
  return null;
}

export function neighbourPath(pathname: string, dir: "next" | "prev"): string | null {
  const i = (TOP_LEVEL_PATHS as readonly string[]).indexOf(pathname);
  if (i < 0) return null;
  const j = dir === "next" ? i + 1 : i - 1;
  return TOP_LEVEL_PATHS[j] ?? null;
}

/** Elements where horizontal drags, long-presses or text selection belong to the content. */
export const GESTURE_EXEMPT =
  "input,textarea,select,button,a,[role=button],[role=menuitem],[contenteditable],[role=slider],[role=dialog],[data-no-gesture],video,audio,iframe,pre";

export function isExemptTarget(el: Element | null): boolean {
  if (!el) return true;
  if (el.closest(GESTURE_EXEMPT)) return true;
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === "auto" || ox === "scroll") return true;
    }
  }
  return false;
}

export const PULL_TRIGGER_PX = 72;
export function shouldRefresh(scrollY: number, pull: number, pathname: string) {
  return scrollY <= 0 && pull >= PULL_TRIGGER_PX && isTopLevel(pathname);
}

export const LONG_PRESS_MS = 500;
export const LONG_PRESS_SLOP_PX = 10;
