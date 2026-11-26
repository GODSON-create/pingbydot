import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPingComposerDraft,
  getPingComposerDraft,
  savePingComposerDraft,
} from "@/lib/draft-store";
import {
  FEATURE_FLAGS,
  getFeatureFlagsSnapshot,
  isFeatureEnabled,
  setFeatureFlagOverride,
} from "@/lib/feature-flags";
import { initializeNativeApp } from "@/lib/native";
import { isTransientStorageError, withTransientRetry } from "@/lib/storage";
import { profileSchema } from "@/lib/validation";

const ROOT = path.resolve(__dirname, "../..");
const readRel = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("Phase 1 Master Programme — Navigation, Reliability, Account Controls & Governance", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("1. enforces the unified five-destination navigation (HOME | EXPLORE | CREATE | INBOX | PROFILE) across desktop, tablet, and mobile", () => {
    const bottomNav = readRel("src/components/layout/BottomNav.tsx");
    expect(bottomNav).toContain("<span>Home</span>");
    expect(bottomNav).toContain("<span>Explore</span>");
    expect(bottomNav).toContain(">Create</span>");
    expect(bottomNav).toContain("<span>Inbox</span>");
    expect(bottomNav).toContain("<span>Profile</span>");

    const desktopSidebar = readRel("src/components/layout/DesktopSidebar.tsx");
    expect(desktopSidebar).toContain('label: "Home"');
    expect(desktopSidebar).toContain('label: "Explore"');
    expect(desktopSidebar).toContain('label: "Inbox"');
    expect(desktopSidebar).toContain('label: "Profile"');
    expect(desktopSidebar).toContain("Create");

    const siteHeader = readRel("src/components/layout/SiteHeader.tsx");
    expect(siteHeader).toContain("Inbox");
    expect(siteHeader).toMatch(/>\s*Profile\s*</);

    const createModal = readRel("src/components/layout/CreateStackModal.tsx");
    expect(createModal).toContain("Create a Ping");
    expect(createModal).toContain("Create a Moment");
    expect(createModal).toContain("Create a Signal");
    expect(createModal).toContain("Create a Hub");
    expect(createModal).toContain("Go Live");
  });

  it("2. prevents duplicate window online/offline listener leaks in initializeNativeApp", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    await initializeNativeApp();
    const afterFirst = addSpy.mock.calls.filter(
      ([ev]) => ev === "online" || ev === "offline",
    ).length;

    await initializeNativeApp();
    await initializeNativeApp();
    const afterRepeated = addSpy.mock.calls.filter(
      ([ev]) => ev === "online" || ev === "offline",
    ).length;

    expect(afterRepeated).toBe(afterFirst);
    addSpy.mockRestore();
  });

  it("3. retries transient upload/network errors with backoff and fails fast on RLS/4xx/missing-bucket errors", async () => {
    expect(isTransientStorageError(new Error("Failed to fetch"))).toBe(true);
    expect(isTransientStorageError({ message: "Gateway timeout", statusCode: 504 })).toBe(true);
    expect(isTransientStorageError(new Error("Bucket not found"))).toBe(false);
    expect(isTransientStorageError(new Error("new row violates row-level security policy"))).toBe(
      false,
    );
    expect(isTransientStorageError({ message: "Bad request", status: 400 })).toBe(false);

    let transientAttempts = 0;
    const recovered = await withTransientRetry(
      async () => {
        transientAttempts++;
        if (transientAttempts < 3) {
          throw new Error("Failed to fetch");
        }
        return "uploaded-ok";
      },
      { maxAttempts: 3, baseDelayMs: 0 },
    );
    expect(recovered).toBe("uploaded-ok");
    expect(transientAttempts).toBe(3);

    let rlsAttempts = 0;
    await expect(
      withTransientRetry(
        async () => {
          rlsAttempts++;
          throw new Error("row-level security violation");
        },
        { maxAttempts: 3, baseDelayMs: 0 },
      ),
    ).rejects.toThrow(/row-level security/i);
    expect(rlsAttempts).toBe(1);
  });

  it("4. preserves and clears Ping composer drafts across navigation", () => {
    savePingComposerDraft(
      {
        category: "opportunity",
        headline: "Seeking founding designer",
        content: "Building Ping v2 tools in Lagos.",
        needsInput: "Design systems",
        cta_url: "https://pingbydot.example/apply",
      },
      "new",
    );

    const restored = getPingComposerDraft("new");
    expect(restored?.headline).toBe("Seeking founding designer");
    expect(restored?.content).toBe("Building Ping v2 tools in Lagos.");
    expect(restored?.category).toBe("opportunity");

    clearPingComposerDraft("new");
    expect(getPingComposerDraft("new")).toBeNull();
  });

  it("5. manages typed Phase 1–5 feature flags with safe defaults and reversible overrides", () => {
    expect(FEATURE_FLAGS.five_destination_nav.defaultEnabled).toBe(true);
    expect(FEATURE_FLAGS.griot_ai_v5.defaultEnabled).toBe(false);
    expect(FEATURE_FLAGS.music_attachments_v3.defaultEnabled).toBe(false);

    expect(isFeatureEnabled("five_destination_nav")).toBe(true);
    expect(isFeatureEnabled("griot_ai_v5")).toBe(false);

    setFeatureFlagOverride("griot_ai_v5", true);
    expect(isFeatureEnabled("griot_ai_v5")).toBe(true);
    expect(getFeatureFlagsSnapshot().griot_ai_v5).toBe(true);

    setFeatureFlagOverride("griot_ai_v5", null);
    expect(isFeatureEnabled("griot_ai_v5")).toBe(false);
  });

  it("6. validates extended profile fields (location, website_url, profile_visibility) and registers secure migration 0028", () => {
    const valid = profileSchema.safeParse({
      username: "ada_builder",
      display_name: "Ada Lovelace",
      bio: "Building digital networks.",
      location: "Lagos",
      country: "Nigeria",
      website_url: "https://pingbydot.example",
      profile_visibility: "followers",
    });
    expect(valid.success).toBe(true);

    const badUrl = profileSchema.safeParse({
      username: "ada_builder",
      display_name: "Ada Lovelace",
      bio: "",
      website_url: "javascript:alert(1)",
    });
    expect(badUrl.success).toBe(false);

    const journal = JSON.parse(readRel("drizzle/migrations/meta/_journal.json"));
    const entries = journal.entries as Array<{ idx: number; tag: string }>;
    expect(
      entries.some((e) => e.idx === 28 && e.tag === "0028_phase1_profile_controls_and_mutes"),
    ).toBe(true);

    const sql0028 = readRel("drizzle/migrations/0028_phase1_profile_controls_and_mutes.sql");
    expect(sql0028).toContain("CREATE TABLE IF NOT EXISTS public.user_mutes");
    expect(sql0028).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql0028).toContain("CREATE OR REPLACE FUNCTION public.export_my_account_data()");
    expect(sql0028).toContain(
      "REVOKE ALL ON FUNCTION public.export_my_account_data() FROM PUBLIC, anon",
    );
    expect(sql0028).not.toMatch(/USING\s*\(\s*true\s*\)/i);
  });

  it("7. wires Muted Accounts, Account Visibility, Location, Website, and Data Export in Settings & Profile", () => {
    const settingsSrc = readRel("src/routes/_authenticated/settings.tsx");
    expect(settingsSrc).toContain("settings-location");
    expect(settingsSrc).toContain("settings-website");
    expect(settingsSrc).toContain("settings-visibility");
    expect(settingsSrc).toContain("Muted Accounts");
    expect(settingsSrc).toContain("Export My Data");
    expect(settingsSrc).toContain("buildAccountDataExport");

    const profileSrc = readRel("src/routes/@{$username}.tsx");
    expect(profileSrc).toContain("Mute Account");
    expect(profileSrc).toContain("profile.website_url");
    expect(profileSrc).toContain("profile.location");
  });

  it("8. maintains all required Programme living documentation files", () => {
    for (const docPath of [
      "docs/quality/PING_BUG_REGISTER.md",
      "docs/product/PING_MASTER_ROADMAP.md",
      "docs/architecture/PING_SYSTEM_ARCHITECTURE.md",
      "docs/architecture/PING_API_CATALOGUE.md",
      "docs/product/PING_FEATURE_INVENTORY.md",
      "docs/quality/PING_PHASE_1_REPORT.md",
    ]) {
      expect(fs.existsSync(path.join(ROOT, docPath)), `Missing required doc: ${docPath}`).toBe(
        true,
      );
    }
  });
});
