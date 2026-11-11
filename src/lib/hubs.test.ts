import { describe, it, expect } from "vitest";
import {
  slugify,
  hubUrl,
  inviteUrl,
  HUB_CATEGORIES,
  HUB_INTENTS,
  hubSchema,
  canSeeHubContent,
  isHubStaff,
  canManageInvites,
  topBuilders,
} from "./hubs";

describe("slugify", () => {
  it("normalizes names into lowercase dash-separated slugs", () => {
    expect(slugify("Stanford AI Club")).toBe("stanford-ai-club");
    expect(slugify("YC W25 Cohort!")).toBe("yc-w25-cohort");
    expect(slugify("  Spaces   & Special---Chars  ")).toBe("spaces-special-chars");
  });

  it("handles non-ascii characters and strips accents", () => {
    expect(slugify("Café Founders Collective")).toBe("cafe-founders-collective");
    expect(slugify("Über Cool Tech")).toBe("uber-cool-tech");
  });

  it("limits length to 40 characters and trims trailing dashes", () => {
    const longName = "A".repeat(50);
    const slug = slugify(longName);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug).not.toMatch(/^-|-$/);
  });
});

describe("hub URLs", () => {
  it("generates correct hub and invite URLs", () => {
    expect(hubUrl("stanford-founders")).toContain("/hubs/stanford-founders");
    expect(inviteUrl("stanford-founders", "token123")).toContain("/hubs/stanford-founders?invite=token123");
  });
});

describe("categories and intents configuration", () => {
  it("includes all required category types", () => {
    const values = HUB_CATEGORIES.map((c) => c.value);
    expect(values).toContain("organization");
    expect(values).toContain("school");
    expect(values).toContain("incubator");
    expect(values).toContain("ecosystem");
    expect(values).toContain("community");
  });

  it("includes all required intent types", () => {
    const values = HUB_INTENTS.map((i) => i.value);
    expect(values).toContain("ask");
    expect(values).toContain("offer");
    expect(values).toContain("launch");
    expect(values).toContain("collaborate");
    expect(values).toContain("intro");
  });
});

describe("hubSchema validation", () => {
  it("accepts valid hub draft", () => {
    const draft = {
      name: "Acme Incubator",
      slug: "acme-incubator",
      tagline: "Helping founders ship",
      description: "A great community",
      rules: "Be kind",
      category: "incubator",
      access: "public",
      resources: [{ label: "Discord", url: "https://discord.gg/acme" }],
    };
    const res = hubSchema.safeParse(draft);
    expect(res.success).toBe(true);
  });

  it("rejects invalid slugs", () => {
    const res = hubSchema.safeParse({
      name: "Acme",
      slug: "-invalid-slug",
      category: "community",
      access: "public",
    });
    expect(res.success).toBe(false);
  });

  it("rejects non-https resource URLs", () => {
    const res = hubSchema.safeParse({
      name: "Acme Hub",
      slug: "acme-hub",
      category: "community",
      access: "public",
      resources: [{ label: "Insecure", url: "http://example.com" }],
    });
    expect(res.success).toBe(false);
  });
});

describe("hub permissions and visibility", () => {
  it("correctly evaluates content visibility for public and private hubs", () => {
    expect(canSeeHubContent("public", null)).toBe(true);
    expect(canSeeHubContent("public", undefined)).toBe(true);
    expect(canSeeHubContent("public", "member")).toBe(true);

    expect(canSeeHubContent("private", null)).toBe(false);
    expect(canSeeHubContent("private", undefined)).toBe(false);
    expect(canSeeHubContent("private", "member")).toBe(true);
    expect(canSeeHubContent("private", "admin")).toBe(true);
  });

  it("evaluates staff roles", () => {
    expect(isHubStaff("owner")).toBe(true);
    expect(isHubStaff("admin")).toBe(true);
    expect(isHubStaff("moderator")).toBe(true);
    expect(isHubStaff("member")).toBe(false);
    expect(isHubStaff(null)).toBe(false);

    expect(canManageInvites("owner")).toBe(true);
    expect(canManageInvites("admin")).toBe(true);
    expect(canManageInvites("moderator")).toBe(false);
  });

  it("ranks top builders properly", () => {
    const items = [
      { author: { username: "alice" } },
      { author: { username: "bob" } },
      { author: { username: "alice" } },
      { author: { username: "alice" } },
      { author: { username: "charlie" } },
    ];
    const top = topBuilders(items, 2);
    expect(top).toHaveLength(2);
    expect(top[0]?.author.username).toBe("alice");
    expect(top[0]?.count).toBe(3);
    expect(top[1]?.author.username).toBe("bob");
    expect(top[1]?.count).toBe(1);
  });
});
