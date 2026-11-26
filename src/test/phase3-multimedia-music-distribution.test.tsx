import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  classifyPingFormat,
  getMediaProcessingAdapters,
  validateVideoFileMeta,
} from "@/lib/media-pipeline";
import {
  getMusicCatalogStatus,
  isTrackAvailableForViewer,
  PING_ORIGINAL_AUDIO_LIBRARY,
  searchMusicTracks,
} from "@/lib/music";
import {
  buildAttributedShareUrl,
  buildShareDestinations,
  captureInboundReferral,
  parseExternalShareImport,
} from "@/lib/sharing/universal";
import { UniversalShareDialog } from "@/components/sharing/UniversalShareDialog";
import type { Ping } from "@/lib/pings";

function makePing(overrides: Partial<Ping> = {}): Ping {
  return {
    id: overrides.id ?? "ping-p3",
    user_id: overrides.user_id ?? "user-1",
    category: overrides.category ?? "progress",
    content: overrides.content ?? "Launching our new demo",
    image_url: overrides.image_url ?? null,
    cta_url: overrides.cta_url ?? null,
    cta_label: overrides.cta_label ?? null,
    created_at: overrides.created_at ?? new Date().toISOString(),
    updated_at: overrides.updated_at ?? new Date().toISOString(),
    author: {
      id: "user-1",
      username: "creator",
      display_name: "Creator",
      avatar_url: null,
    },
    likes: [{ count: 0 }],
    ...overrides,
  };
}

describe("Phase 3 — Multimedia, Music and Universal Distribution", () => {
  describe("Migration 0030, RLS security & Universal Links manifests", () => {
    const migrationsDir = path.resolve(__dirname, "../../drizzle/migrations");
    const m30Path = path.join(migrationsDir, "0030_phase3_multimedia_music_and_distribution.sql");
    const journalPath = path.join(migrationsDir, "meta/_journal.json");

    it("registers migration 0030 sequentially with zero USING (true) policies and strict RLS", () => {
      const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
      const entry = journal.entries.find((e: { idx: number }) => e.idx === 30);
      expect(entry?.tag).toBe("0030_phase3_multimedia_music_and_distribution");

      const sql = fs.readFileSync(m30Path, "utf8");
      const uncommented = sql
        .split("\n")
        .map((l) => l.replace(/--.*$/, ""))
        .join("\n");
      expect(uncommented).not.toMatch(/\bUSING\s*\(\s*true\s*\)/i);
      expect(sql).not.toMatch(/DROP\s+POLICY\s+IF\s+EXISTS\s+"[^"]+"\s+ON\s+\S+\s+FOR\s+/i);

      for (const tbl of [
        "media_assets",
        "ping_video_views",
        "copyright_reports",
        "music_tracks",
        "content_music_attachments",
        "share_events",
      ]) {
        expect(sql).toContain(`ALTER TABLE public.${tbl} ENABLE ROW LEVEL SECURITY;`);
      }

      // Original user audio requires ownership declaration
      expect(sql).toContain("ownership_declared = true");
    });

    it("ships Android App Links and iOS Universal Links .well-known templates", () => {
      const publicDir = path.resolve(__dirname, "../../public/.well-known");
      const assetLinks = JSON.parse(
        fs.readFileSync(path.join(publicDir, "assetlinks.json"), "utf8"),
      );
      const aasa = JSON.parse(
        fs.readFileSync(path.join(publicDir, "apple-app-site-association"), "utf8"),
      );
      expect(assetLinks[0]?.target?.package_name).toBe("app.lovable.pingbydot");
      expect(aasa?.applinks?.details?.[0]?.components?.some((c: any) => c["/"] === "/p/*")).toBe(
        true,
      );
    });
  });

  describe("Unified multimedia format classification & video pipeline (3.1, 3.2, 3.3)", () => {
    it("classifies text, image, and video Pings on a shared architecture", () => {
      expect(classifyPingFormat(makePing())).toBe("text");
      expect(classifyPingFormat(makePing({ image_url: "https://cdn.example/photo.jpg" }))).toBe(
        "image",
      );
      expect(classifyPingFormat(makePing({ image_url: "https://cdn.example/demo.mp4" }))).toBe(
        "video",
      );
      expect(classifyPingFormat(makePing({ media_urls: ["https://cdn.example/clip.webm"] }))).toBe(
        "video",
      );
    });

    it("validates video file size, MIME, and duration limits and exposes swappable providers", () => {
      expect(
        validateVideoFileMeta({
          size: 1024 * 1024,
          type: "video/mp4",
          name: "demo.mp4",
          durationSec: 45,
        }).valid,
      ).toBe(true);
      expect(validateVideoFileMeta({ size: 0, type: "video/mp4", name: "empty.mp4" }).valid).toBe(
        false,
      );
      expect(
        validateVideoFileMeta({ size: 80 * 1024 * 1024, type: "video/mp4", name: "huge.mp4" })
          .valid,
      ).toBe(false);
      expect(
        validateVideoFileMeta({
          size: 5 * 1024 * 1024,
          type: "video/mp4",
          name: "long.mp4",
          durationSec: 400,
        }).valid,
      ).toBe(false);

      const adapters = getMediaProcessingAdapters();
      expect(adapters.map((a) => a.id)).toEqual(["supabase_storage", "cloudflare_stream", "mux"]);
    });
  });

  describe("Rights-respecting Music & Audio Attachment System (3.4)", () => {
    it("keeps commercial catalog gated until licensed and exposes royalty-free original library", () => {
      const status = getMusicCatalogStatus();
      expect(status.commercialCatalogActive).toBe(false);
      expect(status.originalAudioUploadsEnabled).toBe(true);
      expect(PING_ORIGINAL_AUDIO_LIBRARY.length).toBeGreaterThanOrEqual(5);

      const results = searchMusicTracks("sunrise");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]?.title.toLowerCase()).toContain("sunrise");
    });

    it("enforces regional availability and copyright takedown fallbacks", () => {
      expect(
        isTrackAvailableForViewer({
          license_status: "original_user",
          available_regions: ["GLOBAL"],
        }).available,
      ).toBe(true);

      const takenDown = isTrackAvailableForViewer({
        license_status: "taken_down",
        available_regions: ["GLOBAL"],
      });
      expect(takenDown.available).toBe(false);
      expect(takenDown.reason).toContain("takedown");

      const regionalBlock = isTrackAvailableForViewer(
        { license_status: "licensed_catalog", available_regions: ["US", "GB"] },
        "NG",
      );
      expect(regionalBlock.available).toBe(false);
      expect(regionalBlock.reason).toContain("region");
    });
  });

  describe("Universal Sharing, Platform Restrictions & Cross-Platform Import (3.5–3.10)", () => {
    it("builds attributed URLs and honest platform destinations (respecting Instagram/Snapchat restrictions)", () => {
      const attributed = buildAttributedShareUrl("/p/abc", "pi_abc");
      expect(attributed).toContain("/p/abc?ref=pi_abc");

      const { destinations } = buildShareDestinations({
        targetType: "ping",
        targetId: "abc",
        title: "Demo Ping",
        description: "Check out our build",
        path: "/p/abc",
      });

      const directIds = destinations.filter((d) => d.mode === "direct_url").map((d) => d.id);
      expect(directIds).toEqual(
        expect.arrayContaining([
          "whatsapp",
          "x",
          "telegram",
          "facebook",
          "linkedin",
          "email",
          "sms",
        ]),
      );

      const instagram = destinations.find((d) => d.id === "instagram");
      const snapchat = destinations.find((d) => d.id === "snapchat");
      expect(instagram?.mode).toBe("card_or_sheet_fallback");
      expect(snapchat?.mode).toBe("card_or_sheet_fallback");
      expect(instagram?.restrictionNote).toContain("auto-posting");
    });

    it("parses cross-platform share imports with preserved source attribution and rejects unsafe schemes", () => {
      const fromX = parseExternalShareImport({
        text: "Great thread https://x.com/builder/status/12345",
        title: "Thread on product craft",
      });
      expect(fromX?.platform).toBe("x");
      expect(fromX?.hostname).toBe("x.com");
      expect(fromX?.attributionNotice).toContain("not copied without permission");

      const fromSnap = parseExternalShareImport({
        url: "https://www.snapchat.com/spotlight/xyz",
      });
      expect(fromSnap?.platform).toBe("snapchat");

      expect(parseExternalShareImport({ url: "javascript:alert(1)" })).toBeNull();
    });

    it("captures inbound referral codes and renders UniversalShareDialog cleanly", () => {
      expect(captureInboundReferral("?ref=pi_1234", "/p/1234")).toBe("pi_1234");

      render(
        <UniversalShareDialog
          open
          onOpenChange={() => {}}
          payload={{
            targetType: "opportunity",
            targetId: "opp-1",
            title: "Seed Grant",
            description: "Apply before Friday",
            path: "/signals/opportunities",
          }}
        />,
      );

      expect(screen.getByText("WhatsApp")).toBeInTheDocument();
      expect(screen.getByText("Telegram")).toBeInTheDocument();
      expect(screen.getByText("LinkedIn")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Instagram/i }));
      expect(
        screen.getByText(/Instagram does not permit direct web auto-posting/i),
      ).toBeInTheDocument();
    });
  });
});
