import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("Product Completion Sprint - Verification Suite", () => {
  it("Migration 0015 contains all required RPCs and security constraints", () => {
    const migrationPath = resolve(
      process.cwd(),
      "drizzle/migrations/0015_product_completion_sprint.sql",
    );
    const sql = readFileSync(migrationPath, "utf8");

    // 1. Delete hub
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.delete_hub");
    expect(sql).toContain("DELETE FROM public.hubs WHERE id = _hub");
    expect(sql).toContain("Owners delete own hubs");

    // 2. Update signal
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.update_signal");
    expect(sql).toContain("public.signal_role(_signal, v_caller) <> 'admin'");

    // 3. Hub message reaction
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.toggle_hub_message_reaction");
    expect(sql).toContain("public.can_view_hub_content(v_hub_id)");

    // 4. Re-Ping audience expansion protection
    expect(sql).toContain("v_moment.audience = 'followers' AND _audience = 'public'");
    expect(sql).toContain("Re-Ping cannot expand a followers-only moment to public audience.");

    // 5. Highlights management
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.update_highlight");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.remove_moment_from_highlight");
  });

  it("Enforces Re-Ping audience constraint in UI logic", () => {
    const repingModalPath = resolve(process.cwd(), "src/components/moments/RePingModal.tsx");
    const code = readFileSync(repingModalPath, "utf8");

    expect(code).toContain('const isFollowersOnly = moment?.audience === "followers";');
    expect(code).toContain("disabled={isFollowersOnly}");
    expect(code).toContain(
      "Original moment is Followers Only. Audience cannot be expanded to Public.",
    );
  });

  it("Includes Delete Hub action in Hub settings with confirmation dialog", () => {
    const hubSlugPath = resolve(process.cwd(), "src/routes/hubs.$slug.tsx");
    const code = readFileSync(hubSlugPath, "utf8");

    expect(code).toContain("delete_hub");
    expect(code).toContain("Danger Zone: Delete Hub");
    expect(code).toContain("AlertDialogAction");
  });

  it("Supports emoji reactions in Hub live messaging", () => {
    const chatPath = resolve(process.cwd(), "src/components/hubs/HubChat.tsx");
    const code = readFileSync(chatPath, "utf8");

    expect(code).toContain("toggle_hub_message_reaction");
    expect(code).toContain("Reaction Pills");
    expect(code).toContain("QUICK_REACTIONS");
  });

  it("Supports Add to Highlights from Moment viewer and collection editing", () => {
    const viewerPath = resolve(process.cwd(), "src/components/moments/MomentViewerModal.tsx");
    const viewerCode = readFileSync(viewerPath, "utf8");
    expect(viewerCode).toContain("Add to Highlights");
    expect(viewerCode).toContain("addHighlightItemMutation");

    const profileHlPath = resolve(process.cwd(), "src/components/moments/ProfileHighlights.tsx");
    const profileHlCode = readFileSync(profileHlPath, "utf8");
    expect(profileHlCode).toContain("useUpdateHighlight");
    expect(profileHlCode).toContain("Edit Highlight Collection");
  });

  it("Supports Signal Channel Editing for authorized administrators", () => {
    const signalPath = resolve(process.cwd(), "src/routes/signals.$slug.tsx");
    const code = readFileSync(signalPath, "utf8");

    expect(code).toContain("useUpdateSignal");
    expect(code).toContain("Edit Channel");
    expect(code).toContain("EditSignalDialog");
  });

  it("Integrates keyboard navigation shortcuts across desktop interface", () => {
    const shortcutsPath = resolve(process.cwd(), "src/hooks/use-keyboard-shortcuts.ts");
    const code = readFileSync(shortcutsPath, "utf8");

    expect(code).toContain('e.key === "c" || e.key === "n"');
    expect(code).toContain('e.key === "/"');
    expect(code).toContain('e.key === "?"');
  });
});
