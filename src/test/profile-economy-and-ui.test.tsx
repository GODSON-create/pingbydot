import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { UPGRADE_TIERS, canClaimDailyCheckin } from "@/lib/economy";
import { buildDailySeries } from "@/lib/analytics";
import { INTENT_FORMATS, parseStructuredPing, serializeStructuredPing } from "@/lib/validation";
import { isCommunityPath } from "@/components/layout/BottomNav";

const ROOT = path.resolve(__dirname, "../..");
const readRel = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("PING Human Coordination Redesign, Economy, and Navigation Architecture", () => {
  it("validates upgrade tiers and daily check-in eligibility helper", () => {
    expect(UPGRADE_TIERS.map((t) => t.id)).toEqual(["free", "plus", "pro", "institution"]);
    expect(UPGRADE_TIERS[0]?.dotCost).toBe(0);
    expect(UPGRADE_TIERS[2]?.highlighted).toBe(true);

    expect(canClaimDailyCheckin(null)).toBe(true);
    expect(canClaimDailyCheckin(new Date().toISOString())).toBe(false);
    expect(canClaimDailyCheckin("2020-01-01T12:00:00.000Z")).toBe(true);
  });

  it("aggregates daily analytics buckets across arbitrary day windows", () => {
    const todayIso = new Date().toISOString();
    const series = buildDailySeries(
      [
        { created_at: todayIso, likes: 4, replies: 2 },
        { created_at: todayIso, likes: 1, replies: 3 },
      ],
      7,
    );
    expect(series).toHaveLength(7);
    const last = series[series.length - 1];
    expect(last?.pings).toBe(2);
    expect(last?.likes).toBe(5);
    expect(last?.replies).toBe(5);
  });

  it("serializes and parses structured intent PINGs (Needs, Offers, Headline, Outcome)", () => {
    expect(INTENT_FORMATS.map((f) => f.label)).toEqual([
      "Building",
      "Need",
      "Offer",
      "Opportunity",
      "Idea",
      "Question",
      "Collaboration",
      "Update",
    ]);

    const encoded = serializeStructuredPing({
      intentFormat: "need",
      headline: "Co-founder for climate hardware",
      description: "Building modular grid sensors.",
      needs: ["Embedded C++", "PCB layout"],
      offers: ["Co-founder equity", "Lab access"],
      desiredOutcome: "Ship v1 prototype in Q2",
    });

    const parsed = parseStructuredPing({
      category: "opportunity",
      content: encoded,
    });

    expect(parsed.intentFormat).toBe("need");
    expect(parsed.intentLabel).toBe("Need");
    expect(parsed.headline).toBe("Co-founder for climate hardware");
    expect(parsed.body).toBe("Building modular grid sensors.");
    expect(parsed.needs).toEqual(["Embedded C++", "PCB layout"]);
    expect(parsed.offers).toEqual(["Co-founder equity", "Lab access"]);
    expect(parsed.desiredOutcome).toBe("Ship v1 prototype in Q2");
  });

  it("enforces 5 primary navigation items and 4 contextual Community navigation items", () => {
    expect(isCommunityPath("/")).toBe(false);
    expect(isCommunityPath("/explore")).toBe(false);
    expect(isCommunityPath("/messages")).toBe(false);
    expect(isCommunityPath("/hubs")).toBe(true);
    expect(isCommunityPath("/hubs/stanford-ai")).toBe(true);
    expect(isCommunityPath("/signals")).toBe(true);

    const navSrc = readRel("src/components/layout/BottomNav.tsx");
    expect(navSrc).toContain('data-nav-mode="primary"');
    expect(navSrc).toContain('data-nav-mode="community"');
    expect(navSrc).toContain("<span>Home</span>");
    expect(navSrc).toContain("<span>Explore</span>");
    expect(navSrc).toContain(">Create</span>");
    expect(navSrc).toContain("<span>Community</span>");
    expect(navSrc).toContain("<span>Profile</span>");
    expect(navSrc).toContain("<span>Back</span>");
    expect(navSrc).toContain("<span>Hub</span>");
    expect(navSrc).toContain("<span>Signal</span>");
    expect(navSrc).toContain("<span>Moment</span>");
  });

  it("wires the 3-card Create Stack modal with exact required copy", () => {
    const createStackSrc = readRel("src/components/layout/CreateStackModal.tsx");
    expect(createStackSrc).toContain("Create a Ping");
    expect(createStackSrc).toContain(
      "Share an intention. Find the people and resources to make it happen.",
    );
    expect(createStackSrc).toContain("Create a Moment");
    expect(createStackSrc).toContain("Share what's happening around you.");
    expect(createStackSrc).toContain("Go Live");
    expect(createStackSrc).toContain("Bring people together in real time.");
  });

  it("Configures Explore search placeholder, 6 discovery filters, and personalized sections", () => {
    const exploreSrc = readRel("src/routes/explore.tsx");
    expect(exploreSrc).toContain("Find people, intentions, opportunities and more...");
    for (const label of ["All", "PINGs", "People", "Moments", "Communities", "Opportunities"]) {
      expect(exploreSrc).toContain(`label: "${label}"`);
    }
    expect(exploreSrc).toContain("People you should know");
    expect(exploreSrc).toContain("Recommended communities");
  });

  it("incorporates Forums and Institutional Broadcasts into Hub while keeping Signal distinct", () => {
    const forumsSrc = readRel("src/components/hubs/HubForumsAndBroadcasts.tsx");
    expect(forumsSrc).toContain("Official Hub Broadcasts");
    expect(forumsSrc).toContain("Publish Institutional Broadcast");
    expect(forumsSrc).toContain("Create Hub Forum");

    const signalsSrc = readRel("src/routes/signals.tsx");
    expect(signalsSrc).toContain("Community Destination · Signal");
    expect(signalsSrc).toContain("bg-gold/15 text-gold border border-gold/30");
  });

  it("wires top-right menu drawer on profile page to DOT balance, wallet, verification, settings, and tabs", () => {
    const profileSrc = readRel("src/routes/@{$username}.tsx");
    expect(profileSrc).toContain("MoreVertical");
    expect(profileSrc).toContain("Menu");
    expect(profileSrc).toContain('aria-label="Profile options menu"');
    expect(profileSrc).toContain('to="/balance"');
    expect(profileSrc).toContain('to="/analytics"');
    expect(profileSrc).toContain('to="/upgrades"');
    expect(profileSrc).toContain('to="/settings"');
    expect(profileSrc).toContain("DOT Balance Summary");
    expect(profileSrc).toContain("DOT Wallet");
    expect(profileSrc).toContain("Privacy and Security");
    expect(profileSrc).toContain("Help and Support");
    expect(profileSrc).toContain("CloseCircleDialog");
    expect(profileSrc).toContain("MomentViewerModal");
    expect(profileSrc).toContain("profile_reports");
  });

  it("marks private authenticated dashboard routes non-indexable with sitemap: false", () => {
    for (const rel of [
      "src/routes/_authenticated/balance.tsx",
      "src/routes/_authenticated/analytics.tsx",
      "src/routes/_authenticated/upgrades.tsx",
    ]) {
      const src = readRel(rel);
      expect(src).toContain("staticData: { sitemap: false }");
      expect(src).toContain("noindex, nofollow");
    }
  });

  it("preserves dark-mode WCAG fixes and SQL migration security rules (0015, 0016, 0017)", () => {
    const css = readRel("src/styles.css");
    expect(css).toContain("color-scheme: dark;");
    expect(css).toContain(".dark select option");

    const callout = readRel("src/components/AriseCallout.tsx");
    expect(callout).toContain("text-[#f4f2e9]");

    const sw = readRel("src/components/ui/switch.tsx");
    expect(sw).toContain("dark:data-[state=unchecked]");

    const sql0015 = readRel("drizzle/migrations/0015_product_completion_sprint.sql");
    expect(sql0015).toContain("v_moment.author_id");
    expect(sql0015).not.toContain("v_moment.user_id");

    const sql0016 = readRel("drizzle/migrations/0016_profile_economy_analytics_and_fixes.sql");
    expect(sql0016).toContain("get_my_dot_summary");
    expect(sql0016).not.toMatch(/USING\s*\(\s*true\s*\)/i);

    const sql0017 = readRel("drizzle/migrations/0017_human_coordination_forums_broadcasts.sql");
    expect(sql0017).toContain("CREATE TABLE IF NOT EXISTS public.hub_forums");
    expect(sql0017).toContain("CREATE TABLE IF NOT EXISTS public.hub_broadcasts");
    expect(sql0017).toContain("CREATE TABLE IF NOT EXISTS public.saved_pings");
    expect(sql0017).not.toMatch(/USING\s*\(\s*true\s*\)/i);
  });

  it("embeds official PING logos across all 3 colorways (lime, gold, silver) and mounts the Boot splash screen", () => {
    const brandSrc = readRel("src/lib/brand.ts");
    expect(brandSrc).toContain("/brand/ping-mark-lime.png");
    expect(brandSrc).toContain("/brand/ping-mark-gold.png");
    expect(brandSrc).toContain("/brand/ping-mark-silver.png");

    const logoSrc = readRel("src/components/BrandLogo.tsx");
    expect(logoSrc).toContain("export function PingMark");
    expect(logoSrc).toContain("BRAND_MARK_PNGS");

    const bootSrc = readRel("src/components/layout/BootSplashScreen.tsx");
    expect(bootSrc).toContain('variant="lime"');
    expect(bootSrc).toContain('variant="gold"');
    expect(bootSrc).toContain('variant="silver"');

    const rootSrc = readRel("src/routes/__root.tsx");
    expect(rootSrc).toContain("BootSplashScreen");
    expect(rootSrc).toContain("/brand/ping-mark-lime.png");

    const createStackSrc = readRel("src/components/layout/CreateStackModal.tsx");
    expect(createStackSrc).toContain('variant="lime"');
    expect(createStackSrc).toContain('variant="silver"');
    expect(createStackSrc).toContain('variant="gold"');

    const balanceSrc = readRel("src/routes/_authenticated/balance.tsx");
    expect(balanceSrc).toContain('PingMark variant="gold"');

    const upgradesSrc = readRel("src/routes/_authenticated/upgrades.tsx");
    expect(upgradesSrc).toContain("PingMark");

    const footerSrc = readRel("src/components/layout/SiteFooter.tsx");
    expect(footerSrc).toContain('BrandLogo variant="silver"');
  });
});
