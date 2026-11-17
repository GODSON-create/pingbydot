import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "system",
  resolvedTheme: "light",
  setTheme: () => {},
});

const THEME_STORAGE_KEY = "ping-theme";

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Match SSR initial state on the first client render to avoid React #418 hydration mismatches,
  // then sync with localStorage + system media query right after hydration.
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === "light" || stored === "dark" || stored === "system") {
        setThemeState(stored);
      }
    } catch {
      // Ignore storage errors
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const root = document.documentElement;

    const applyTheme = () => {
      const activeResolved = theme === "system" ? getSystemTheme() : theme;
      setResolvedTheme(activeResolved);

      if (activeResolved === "dark") {
        root.classList.add("dark");
        root.style.colorScheme = "dark";
      } else {
        root.classList.remove("dark");
        root.style.colorScheme = "light";
      }
      const themeMeta = document.querySelector('meta[name="theme-color"]');
      if (themeMeta) {
        themeMeta.setAttribute("content", activeResolved === "dark" ? "#090b0a" : "#173C32");
      }
    };

    applyTheme();

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemChange = () => {
      if (theme === "system") {
        applyTheme();
      }
    };

    mediaQuery.addEventListener("change", handleSystemChange);
    return () => mediaQuery.removeEventListener("change", handleSystemChange);
  }, [theme, hydrated]);

  const setTheme = (nextTheme: Theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Ignore storage errors
    }
    setThemeState(nextTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
