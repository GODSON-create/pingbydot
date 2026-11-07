import { describe, expect, it } from "vitest";
import { classifySwipe, neighbourPath, shouldRefresh, isExemptTarget } from "./gestures";

describe("Gesture boundaries", () => {
  const swipe = { startX: 200, dx: -100, dy: 5, dt: 300, width: 390, pathname: "/" };
  it("switches only Home and Explore in the main context", () => {
    expect(classifySwipe(swipe)).toBe("next");
    expect(neighbourPath("/", "next")).toBe("/explore");
    expect(neighbourPath("/explore", "next")).toBeNull();
    expect(classifySwipe({ ...swipe, pathname: "/settings" })).toBeNull();
  });
  it("leaves system edges and vertical or slow motion alone", () => {
    expect(classifySwipe({ ...swipe, startX: 10 })).toBeNull();
    expect(classifySwipe({ ...swipe, startX: 380 })).toBeNull();
    expect(classifySwipe({ ...swipe, dy: 90 })).toBeNull();
    expect(classifySwipe({ ...swipe, dt: 701 })).toBeNull();
  });
  it("backs only inside the non-system left-edge zone on detail pages", () => {
    expect(classifySwipe({ ...swipe, pathname: "/p/abc", startX: 30, dx: 100 })).toBe("back");
    expect(classifySwipe({ ...swipe, pathname: "/p/abc", startX: 60, dx: 100 })).toBeNull();
  });
  it("refreshes only from the top at the trigger distance", () => {
    expect(shouldRefresh(0, 72, "/explore")).toBe(true);
    expect(shouldRefresh(1, 72, "/explore")).toBe(false);
    expect(shouldRefresh(0, 71, "/explore")).toBe(false);
    expect(shouldRefresh(0, 72, "/settings")).toBe(false);
  });
  it("exempts editors, controls and dialogs", () => {
    for (const tag of ["input", "textarea", "select", "button", "video"])
      expect(isExemptTarget(document.createElement(tag))).toBe(true);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const child = document.createElement("span");
    dialog.append(child);
    expect(isExemptTarget(child)).toBe(true);
  });
});
