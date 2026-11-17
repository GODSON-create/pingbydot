import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";

export type NavOverlayId =
  "none" | "create" | "notifications" | "header-account" | "sidebar-account" | "profile-drawer";

interface NavOverlayContextValue {
  activeOverlay: NavOverlayId;
  isOpen: (id: Exclude<NavOverlayId, "none">) => boolean;
  openOverlay: (id: Exclude<NavOverlayId, "none">) => void;
  closeOverlays: () => void;
  onOpenChangeFor: (id: Exclude<NavOverlayId, "none">) => (open: boolean) => void;
}

const noop = () => {};

const NavOverlayContext = createContext<NavOverlayContextValue>({
  activeOverlay: "none",
  isOpen: () => false,
  openOverlay: noop,
  closeOverlays: noop,
  onOpenChangeFor: () => noop,
});

/**
 * Coordinates global navigation overlays (drawers, dropdown menus, create deck,
 * notification sheet) so only one is active at a time and route navigation
 * dismisses any open overlay immediately without arbitrary timers.
 */
export function NavOverlayProvider({ children }: { children: ReactNode }) {
  const [activeOverlay, setActiveOverlay] = useState<NavOverlayId>("none");
  const { pathname, searchStr } = useLocation();

  useEffect(() => {
    setActiveOverlay("none");
  }, [pathname, searchStr]);

  const closeOverlays = useCallback(() => {
    setActiveOverlay("none");
  }, []);

  const openOverlay = useCallback((id: Exclude<NavOverlayId, "none">) => {
    setActiveOverlay(id);
  }, []);

  const isOpen = useCallback(
    (id: Exclude<NavOverlayId, "none">) => activeOverlay === id,
    [activeOverlay],
  );

  const onOpenChangeFor = useCallback(
    (id: Exclude<NavOverlayId, "none">) => (open: boolean) => {
      setActiveOverlay((prev) => {
        if (open) return id;
        return prev === id ? "none" : prev;
      });
    },
    [],
  );

  return (
    <NavOverlayContext.Provider
      value={{ activeOverlay, isOpen, openOverlay, closeOverlays, onOpenChangeFor }}
    >
      {children}
    </NavOverlayContext.Provider>
  );
}

export function useNavOverlay() {
  return useContext(NavOverlayContext);
}
