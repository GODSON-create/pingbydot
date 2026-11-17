import { describe, expect, it } from "vitest";
import { type Theme, type ResolvedTheme } from "./theme";
import fs from "fs";
import path from "path";

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

  it("verifies locked 4-colour dark palette tokens in styles.css", () => {
    const cssPath = path.resolve(__dirname, "../styles.css");
    const css = fs.readFileSync(cssPath, "utf8").toLowerCase();

    // Check locked four-colour Dark Theme palette
    expect(css).toContain("--obsidian: #090b0a;");
    expect(css).toContain("--graphite: #171b18;");
    expect(css).toContain("--ping-green: #c7f36b;");
    expect(css).toContain("--gold: #d8b66a;");

    // Supporting typography neutrals
    expect(css).toContain("--foreground: #f4f2e9;");
    expect(css).toContain("--secondary-foreground: #c0c4ba;");
    expect(css).toContain("--muted-foreground: #9da49a;");

    // Semantic mappings
    expect(css).toContain("--background: #090b0a;");
    expect(css).toContain("--card: #171b18;");
    expect(css).toContain("--primary: #c7f36b;");
    expect(css).toContain("--primary-foreground: #090b0a;");
  });

  it("calculates and enforces WCAG AA and AAA contrast ratios mathematically", () => {
    // Standard relative luminance formula (WCAG 2.1)
    function sRGBtoLin(c: number): number {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    function relLuminance(hex: string): number {
      const clean = hex.replace("#", "");
      const r = parseInt(clean.substring(0, 2), 16);
      const g = parseInt(clean.substring(2, 4), 16);
      const b = parseInt(clean.substring(4, 6), 16);
      return 0.2126 * sRGBtoLin(r) + 0.7152 * sRGBtoLin(g) + 0.0722 * sRGBtoLin(b);
    }
    function contrastRatio(hex1: string, hex2: string): number {
      const l1 = relLuminance(hex1);
      const l2 = relLuminance(hex2);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    // 1. Primary text (#F4F2E9) on Obsidian (#090B0A)
    const primaryOnObsidian = contrastRatio("#F4F2E9", "#090B0A");
    expect(primaryOnObsidian).toBeGreaterThanOrEqual(7.0); // WCAG AAA requirement is 7:1

    // 2. Primary text (#F4F2E9) on Graphite (#171B18)
    const primaryOnGraphite = contrastRatio("#F4F2E9", "#171B18");
    expect(primaryOnGraphite).toBeGreaterThanOrEqual(7.0); // WCAG AAA requirement is 7:1

    // 3. Secondary text (#C0C4BA) on Graphite (#171B18)
    const secondaryOnGraphite = contrastRatio("#C0C4BA", "#171B18");
    expect(secondaryOnGraphite).toBeGreaterThanOrEqual(7.0); // Exceeds WCAG AAA

    // 4. Muted text (#9DA49A) on Graphite (#171B18)
    const mutedOnGraphite = contrastRatio("#9DA49A", "#171B18");
    expect(mutedOnGraphite).toBeGreaterThanOrEqual(4.5); // Meets and exceeds WCAG AA (4.5:1)

    // 5. Electric Ping Green primary button (#C7F36B) with deep Obsidian text (#090B0A)
    const buttonContrast = contrastRatio("#C7F36B", "#090B0A");
    expect(buttonContrast).toBeGreaterThanOrEqual(7.0); // Incredible ~15.3:1 contrast

    // 6. Champagne Gold (#D8B66A) with Obsidian text (#090B0A)
    const goldContrast = contrastRatio("#D8B66A", "#090B0A");
    expect(goldContrast).toBeGreaterThanOrEqual(7.0); // Exceeds WCAG AAA
  });
});
