import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

describe("Visual System & Responsive Experience Audit (375px, 768px, 1024px, 1440px)", () => {
  it("A. verifies locked four-colour Dark Theme palette in styles.css", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../styles.css"), "utf8");
    expect(css).toContain("--obsidian: #090B0A;");
    expect(css).toContain("--graphite: #171B18;");
    expect(css).toContain("--ping-green: #C7F36B;");
    expect(css).toContain("--gold: #D8B66A;");
    expect(css).toContain("--foreground: #F4F2E9;");
    expect(css).toContain("--secondary-foreground: #C0C4BA;");
    expect(css).toContain("--muted-foreground: #9DA49A;");
  });

  it("B. verifies Champagne Gold verified badge application across Hubs and Signals", () => {
    const indexTsx = fs.readFileSync(path.resolve(__dirname, "../routes/index.tsx"), "utf8");
    const hubsTsx = fs.readFileSync(path.resolve(__dirname, "../routes/hubs.tsx"), "utf8");
    const signalsTsx = fs.readFileSync(path.resolve(__dirname, "../routes/signals.tsx"), "utf8");
    const signalsSlugTsx = fs.readFileSync(path.resolve(__dirname, "../routes/signals.$slug.tsx"), "utf8");
    const hubsSlugTsx = fs.readFileSync(path.resolve(__dirname, "../routes/hubs.$slug.tsx"), "utf8");

    // Index verified badges
    expect(indexTsx).toContain("bg-gold/15 text-gold border border-gold/30");
    // Hubs directory verified badge
    expect(hubsTsx).toContain("bg-gold/15 text-gold border border-gold/30");
    // Signals directory verified badge
    expect(signalsTsx).toContain("bg-gold/15 text-gold border border-gold/30");
    // Signals slug verified badge
    expect(signalsSlugTsx).toContain("bg-gold/15 text-gold border border-gold/30");
    // Hubs slug verified badge
    expect(hubsSlugTsx).toContain("bg-gold/15 text-gold border border-gold/30");
  });

  it("E. verifies Desktop 3-column architecture (Left Sidebar, Centre Feed, Right Discovery)", () => {
    const rootTsx = fs.readFileSync(path.resolve(__dirname, "../routes/__root.tsx"), "utf8");
    const sidebarTsx = fs.readFileSync(path.resolve(__dirname, "../components/layout/DesktopSidebar.tsx"), "utf8");
    const indexTsx = fs.readFileSync(path.resolve(__dirname, "../routes/index.tsx"), "utf8");

    // Root includes DesktopSidebar
    expect(rootTsx).toContain("<DesktopSidebar />");
    expect(rootTsx).toContain("lg:flex-row");

    // DesktopSidebar is hidden on mobile/tablet and visible on desktop (w-20 on lg, w-64 on xl)
    expect(sidebarTsx).toContain("hidden lg:flex");
    expect(sidebarTsx).toContain("w-20 xl:w-64");

    // Home index defines Centre Feed and Right Discovery column
    expect(indexTsx).toContain("lg:grid-cols-[1fr_320px] xl:grid-cols-[1fr_360px]");
  });

  it("F. verifies Mobile interaction model (compact top bar, bottom nav with safe-area spacing, touch targets)", () => {
    const headerTsx = fs.readFileSync(path.resolve(__dirname, "../components/layout/SiteHeader.tsx"), "utf8");
    const bottomNavTsx = fs.readFileSync(path.resolve(__dirname, "../components/layout/BottomNav.tsx"), "utf8");

    // Header is hidden on desktop, acting as mobile/tablet top bar
    expect(headerTsx).toContain("lg:hidden");

    // BottomNav is hidden on desktop and has safe-area padding
    expect(bottomNavTsx).toContain("md:hidden");
    expect(bottomNavTsx).toContain("env(safe-area-inset-bottom)");
    // Minimum 44px touch targets on mobile
    expect(bottomNavTsx).toContain("min-h-14 min-w-12");
  });

  it("H. verifies exact mathematical WCAG AA and AAA contrast measurements", () => {
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
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }

    // Measure:
    const ratios = {
      primaryOnObsidian: contrastRatio("#F4F2E9", "#090B0A"),
      primaryOnGraphite: contrastRatio("#F4F2E9", "#171B18"),
      secondaryOnGraphite: contrastRatio("#C0C4BA", "#171B18"),
      mutedOnGraphite: contrastRatio("#9DA49A", "#171B18"),
      electricGreenButtonText: contrastRatio("#C7F36B", "#090B0A"),
      champagneGoldOnObsidian: contrastRatio("#D8B66A", "#090B0A"),
      champagneGoldOnGraphite: contrastRatio("#D8B66A", "#171B18"),
    };

    // Assertions:
    expect(ratios.primaryOnObsidian).toBeGreaterThanOrEqual(17.0); // AAA (>=7.0)
    expect(ratios.primaryOnGraphite).toBeGreaterThanOrEqual(15.0); // AAA (>=7.0)
    expect(ratios.secondaryOnGraphite).toBeGreaterThanOrEqual(9.0); // AAA (>=7.0)
    expect(ratios.mutedOnGraphite).toBeGreaterThanOrEqual(6.5); // AA (>=4.5)
    expect(ratios.electricGreenButtonText).toBeGreaterThanOrEqual(15.0); // AAA (>=7.0)
    expect(ratios.champagneGoldOnObsidian).toBeGreaterThanOrEqual(8.5); // AAA (>=7.0)
    expect(ratios.champagneGoldOnGraphite).toBeGreaterThanOrEqual(8.0); // AAA (>=7.0)
  });
});
