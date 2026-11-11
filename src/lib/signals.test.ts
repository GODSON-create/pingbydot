import { describe, expect, it } from "vitest";

describe("Signals Institutional Layer Logic", () => {
  it("calculates aggregate read percentages correctly without dividing by zero", () => {
    function computeAnalytics(delivered: number, reads: number) {
      if (delivered <= 0) {
        return { total_delivered: 0, total_read: 0, read_percentage: 0 };
      }
      const pct = Math.min(100, Math.round((reads / delivered) * 100));
      return {
        total_delivered: delivered,
        total_read: reads,
        read_percentage: pct,
      };
    }

    expect(computeAnalytics(0, 0).read_percentage).toBe(0);
    expect(computeAnalytics(100, 45).read_percentage).toBe(45);
    expect(computeAnalytics(3, 2).read_percentage).toBe(67);
    expect(computeAnalytics(50, 50).read_percentage).toBe(100);
  });

  it("validates Signal categories", () => {
    const validCategories = [
      "university",
      "company",
      "incubator",
      "government",
      "community",
      "other",
    ];

    expect(validCategories.includes("university")).toBe(true);
    expect(validCategories.includes("company")).toBe(true);
    expect(validCategories.includes("invalid_category")).toBe(false);
  });

  it("slugifies institutional names safely", () => {
    function slugify(name: string) {
      return name
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, "")
        .replace(/[\s_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
    }

    expect(slugify("Stanford AI Lab")).toBe("stanford-ai-lab");
    expect(slugify("Y Combinator (W26)")).toBe("y-combinator-w26");
    expect(slugify("  Ping // Dot  ")).toBe("ping-dot");
    expect(slugify("GovTech Singapore & Co.")).toBe("govtech-singapore-co");
  });
});
