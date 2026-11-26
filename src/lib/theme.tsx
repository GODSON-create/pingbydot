import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
export type ThemePreset = "obsidian" | "midnight" | "emerald" | "light";
export type AccentPreset = "ping-green" | "emerald" | "gold" | "cyan";
export type MediaAutoplayMode = "always" | "wifi_only" | "off";
export type TextScale = "compact" | "default" | "large";

export interface AppearancePreferences {
  theme: Theme;
  preset: ThemePreset;
  accent: AccentPreset;
  reducedMotion: boolean;
  mediaAutoplay: MediaAutoplayMode;
  textScale: TextScale;
}

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  theme: "system",
  preset: "obsidian",
  accent: "ping-green",
  reducedMotion: false,
  mediaAutoplay: "wifi_only",
  textScale: "default",
};

export interface CuratedThemeOption {
  id: ThemePreset | "system";
  name: string;
  description: string;
  baseTheme: Theme;
  swatches: { bg: string; card: string; primary: string; text: string };
}

export const CURATED_THEME_OPTIONS: readonly CuratedThemeOption[] = [
  {
    id: "obsidian",
    name: "Obsidian",
    description: "Ping signature deep obsidian canvas with graphite cards & electric Ping green.",
    baseTheme: "dark",
    swatches: { bg: "#090B0A", card: "#171B18", primary: "#C7F36B", text: "#F4F2E9" },
  },
  {
    id: "midnight",
    name: "Midnight",
    description:
      "Deep slate-navy night workspace engineered for long reading & messaging sessions.",
    baseTheme: "dark",
    swatches: { bg: "#0A0E17", card: "#141B2B", primary: "#C7F36B", text: "#F1F5F9" },
  },
  {
    id: "emerald",
    name: "Emerald",
    description: "Rich forest emerald dark surface inspired by Ping's organic botanical palette.",
    baseTheme: "dark",
    swatches: { bg: "#071410", card: "#10241D", primary: "#C7F36B", text: "#F0F7F2" },
  },
  {
    id: "light",
    name: "Light",
    description: "Warm paper & deep forest ink with crisp daylight legibility.",
    baseTheme: "light",
    swatches: { bg: "#FBF8F1", card: "#FFFEFA", primary: "#173C32", text: "#182822" },
  },
  {
    id: "system",
    name: "System Default",
    description: "Automatically follows your operating system appearance preference.",
    baseTheme: "system",
    swatches: { bg: "#171B18", card: "#FBF8F1", primary: "#C7F36B", text: "#F4F2E9" },
  },
] as const;

export const CURATED_ACCENT_OPTIONS: ReadonlyArray<{
  id: AccentPreset;
  label: string;
  darkHex: string;
  lightHex: string;
}> = [
  { id: "ping-green", label: "Ping Green", darkHex: "#C7F36B", lightHex: "#173C32" },
  { id: "emerald", label: "Emerald", darkHex: "#4ADE80", lightHex: "#156343" },
  { id: "gold", label: "Champagne Gold", darkHex: "#D8B66A", lightHex: "#7A5A12" },
  { id: "cyan", label: "Signal Cyan", darkHex: "#5EEAD4", lightHex: "#0F5E63" },
];

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  preset: ThemePreset;
  accent: AccentPreset;
  reducedMotion: boolean;
  mediaAutoplay: MediaAutoplayMode;
  textScale: TextScale;
  setTheme: (theme: Theme) => void;
  setPreset: (preset: ThemePreset | "system", userId?: string | null) => void;
  updateAppearance: (patch: Partial<AppearancePreferences>, userId?: string | null) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "system",
  resolvedTheme: "light",
  preset: "obsidian",
  accent: "ping-green",
  reducedMotion: false,
  mediaAutoplay: "wifi_only",
  textScale: "default",
  setTheme: () => {},
  setPreset: () => {},
  updateAppearance: () => {},
});

const THEME_STORAGE_KEY = "ping-theme";
const APPEARANCE_STORAGE_KEY = "ping-appearance-v2";

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function sanitizeAppearancePreferences(raw: unknown): AppearancePreferences {
  if (!raw || typeof raw !== "object") return DEFAULT_APPEARANCE;
  const obj = raw as Record<string, unknown>;
  const theme: Theme =
    obj["theme"] === "light" || obj["theme"] === "dark" || obj["theme"] === "system"
      ? obj["theme"]
      : "system";
  const preset: ThemePreset =
    obj["preset"] === "obsidian" ||
    obj["preset"] === "midnight" ||
    obj["preset"] === "emerald" ||
    obj["preset"] === "light"
      ? obj["preset"]
      : theme === "light"
        ? "light"
        : "obsidian";
  const accent: AccentPreset =
    obj["accent"] === "ping-green" ||
    obj["accent"] === "emerald" ||
    obj["accent"] === "gold" ||
    obj["accent"] === "cyan"
      ? obj["accent"]
      : "ping-green";
  const mediaAutoplay: MediaAutoplayMode =
    obj["mediaAutoplay"] === "always" ||
    obj["mediaAutoplay"] === "wifi_only" ||
    obj["mediaAutoplay"] === "off"
      ? obj["mediaAutoplay"]
      : "wifi_only";
  const textScale: TextScale =
    obj["textScale"] === "compact" || obj["textScale"] === "default" || obj["textScale"] === "large"
      ? obj["textScale"]
      : "default";

  return {
    theme,
    preset,
    accent,
    reducedMotion: obj["reducedMotion"] === true,
    mediaAutoplay,
    textScale,
  };
}

function persistAppearanceRemote(prefs: AppearancePreferences, userId?: string | null) {
  if (!userId) return;
  void (supabase as any)
    .from("profiles")
    .update({ appearance_preferences: prefs })
    .eq("id", userId)
    .then(
      () => {},
      () => {},
    );
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<AppearancePreferences>(DEFAULT_APPEARANCE);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const storedV2 = localStorage.getItem(APPEARANCE_STORAGE_KEY);
      if (storedV2) {
        setPrefs(sanitizeAppearancePreferences(JSON.parse(storedV2)));
      } else {
        const legacy = localStorage.getItem(THEME_STORAGE_KEY);
        if (legacy === "light" || legacy === "dark" || legacy === "system") {
          setPrefs({
            ...DEFAULT_APPEARANCE,
            theme: legacy,
            preset: legacy === "light" ? "light" : "obsidian",
          });
        }
      }
    } catch {
      // Ignore storage errors
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const root = document.documentElement;

    const applyAppearance = () => {
      const activeResolved: ResolvedTheme =
        prefs.theme === "system" ? getSystemTheme() : prefs.theme;
      setResolvedTheme(activeResolved);

      if (activeResolved === "dark") {
        root.classList.add("dark");
        root.style.colorScheme = "dark";
        root.dataset["themePreset"] = prefs.preset === "light" ? "obsidian" : prefs.preset;
      } else {
        root.classList.remove("dark");
        root.style.colorScheme = "light";
        root.dataset["themePreset"] = "light";
      }

      root.dataset["accent"] = prefs.accent;
      root.dataset["reducedMotion"] = prefs.reducedMotion ? "true" : "false";
      root.dataset["textScale"] = prefs.textScale;

      const themeMeta = document.querySelector('meta[name="theme-color"]');
      if (themeMeta) {
        const color =
          activeResolved === "light"
            ? "#173C32"
            : prefs.preset === "midnight"
              ? "#0A0E17"
              : prefs.preset === "emerald"
                ? "#071410"
                : "#090b0a";
        themeMeta.setAttribute("content", color);
      }
    };

    applyAppearance();

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemChange = () => {
      if (prefs.theme === "system") {
        applyAppearance();
      }
    };

    mediaQuery.addEventListener("change", handleSystemChange);
    return () => mediaQuery.removeEventListener("change", handleSystemChange);
  }, [prefs, hydrated]);

  const updateAppearance = (patch: Partial<AppearancePreferences>, userId?: string | null) => {
    setPrefs((prev) => {
      const next = sanitizeAppearancePreferences({ ...prev, ...patch });
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next.theme);
        localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage errors
      }
      persistAppearanceRemote(next, userId);
      return next;
    });
  };

  const setTheme = (nextTheme: Theme) => {
    updateAppearance({
      theme: nextTheme,
      ...(nextTheme === "light"
        ? { preset: "light" }
        : nextTheme === "dark" && prefs.preset === "light"
          ? { preset: "obsidian" }
          : {}),
    });
  };

  const setPreset = (nextPreset: ThemePreset | "system", userId?: string | null) => {
    if (nextPreset === "system") {
      updateAppearance({ theme: "system", preset: "obsidian" }, userId);
      return;
    }
    updateAppearance(
      {
        theme: nextPreset === "light" ? "light" : "dark",
        preset: nextPreset,
      },
      userId,
    );
  };

  return (
    <ThemeContext.Provider
      value={{
        theme: prefs.theme,
        resolvedTheme,
        preset: prefs.preset,
        accent: prefs.accent,
        reducedMotion: prefs.reducedMotion,
        mediaAutoplay: prefs.mediaAutoplay,
        textScale: prefs.textScale,
        setTheme,
        setPreset,
        updateAppearance,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
