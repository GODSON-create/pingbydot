import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";

export type NavOverlayId =
  | "none"
  | "create"
  | "notifications"
  | "header-account"
  | "sidebar-account"
  | "profile-drawer"
  | "chat-peer-profile";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "ping_desktop_sidebar_collapsed_v1";

interface NavOverlayContextValue {
  activeOverlay: NavOverlayId;
  isOpen: (id: Exclude<NavOverlayId, "none">) => boolean;
  openOverlay: (id: Exclude<NavOverlayId, "none">) => void;
  closeOverlays: () => void;
  onOpenChangeFor: (id: Exclude<NavOverlayId, "none">) => (open: boolean) => void;
  sidebarCollapsed: boolean | null;
  setSidebarCollapsed: (collapsed: boolean | null) => void;
  toggleSidebarCollapsed: (currentEffectiveCollapsed?: boolean) => void;
}

const noop = () => {};

const NavOverlayContext = createContext<NavOverlayContextValue>({
  activeOverlay: "none",
  isOpen: () => false,
  openOverlay: noop,
  closeOverlays: noop,
  onOpenChangeFor: () => noop,
  sidebarCollapsed: null,
  setSidebarCollapsed: noop,
  toggleSidebarCollapsed: noop,
});

/**
 * Coordinates global navigation overlays (drawers, dropdown menus, create deck,
 * notification sheet, chat peer profile) and desktop sidebar collapse preference
 * so only one overlay is active at a time and route transitions close them immediately.
 */
export function NavOverlayProvider({ children }: { children: ReactNode }) {
  const [activeOverlay, setActiveOverlay] = useState<NavOverlayId>("none");
  const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean | null>(null);
  const { pathname, searchStr } = useLocation();

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
      if (saved === "true") setSidebarCollapsedState(true);
      else if (saved === "false") setSidebarCollapsedState(false);
    } catch {
      // Ignore storage access errors
    }
  }, []);

  useEffect(() => {
    setActiveOverlay("none");
  }, [pathname, searchStr]);

  const setSidebarCollapsed = useCallback((collapsed: boolean | null) => {
    setSidebarCollapsedState(collapsed);
    try {
      if (collapsed === null) {
        window.localStorage.removeItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
      } else {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  const toggleSidebarCollapsed = useCallback((currentEffectiveCollapsed?: boolean) => {
    setSidebarCollapsedState((prev) => {
      const next =
        typeof currentEffectiveCollapsed === "boolean" ? !currentEffectiveCollapsed : !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }, []);

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
      value={{
        activeOverlay,
        isOpen,
        openOverlay,
        closeOverlays,
        onOpenChangeFor,
        sidebarCollapsed,
        setSidebarCollapsed,
        toggleSidebarCollapsed,
      }}
    >
      {children}
    </NavOverlayContext.Provider>
  );
}

export function useNavOverlay() {
  return useContext(NavOverlayContext);
}
