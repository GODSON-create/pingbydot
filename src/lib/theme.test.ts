import { describe, expect, it } from "vitest";
import { type Theme, type ResolvedTheme } from "./theme";

describe("Theme Management Logic", () => {
  it("resolves theme options correctly (light, dark, system)", () => {
    function resolveTheme(theme: Theme, systemIsDark: boolean): ResolvedTheme {
      if (theme === "system") {
        return systemIsDark ? "dark" : "light";
      }
      return theme;
    }

    // Direct light
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");

    // Direct dark
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("dark", true)).toBe("dark");

    // System matches preference
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
  });

  it("handles theme persistence validation safely", () => {
    function sanitizeStoredTheme(value: string | null): Theme {
      if (value === "light" || value === "dark" || value === "system") {
        return value;
      }
      return "system";
    }

    expect(sanitizeStoredTheme("dark")).toBe("dark");
    expect(sanitizeStoredTheme("light")).toBe("light");
    expect(sanitizeStoredTheme("system")).toBe("system");
    expect(sanitizeStoredTheme("invalid_theme")).toBe("system");
    expect(sanitizeStoredTheme(null)).toBe("system");
  });
});
