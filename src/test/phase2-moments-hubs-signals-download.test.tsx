import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock Supabase client with controllable storage signing spies
const mockCreateSignedUrl = vi.fn();
const mockGetSession = vi
  .fn()
  .mockResolvedValue({ data: { session: { access_token: "tok-test" } } });
const mockFrom = vi.fn((..._args: unknown[]) => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  gt: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
}));
const mockRpc = vi.fn((..._args: unknown[]) => Promise.resolve({ data: null, error: null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: (path: string, ttl: number) => mockCreateSignedUrl(bucket, path, ttl),
        getPublicUrl: (path: string) => ({
          data: {
            publicUrl: `https://exlttyafomvqfwgzzjrm.supabase.co/storage/v1/object/public/${bucket}/${path}`,
          },
        }),
      }),
    },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
    channel: () => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    }),
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "viewer-1", email: "viewer@ping.test" },
    profile: { id: "viewer-1", username: "viewer", display_name: "Viewer" },
    loading: false,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: any) => (
    <a href={typeof to === "string" ? to : "#"} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ searchStr: "", pathname: "/download" }),
  createFileRoute: () => (opts: any) => opts,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

import { clearAllPrivateSignedUrlCaches, createAuthorizedMediaReadUrl } from "@/lib/storage";
import { CloudflareR2MediaProvider, extractSupabasePublicMediaPath } from "@/lib/media-provider";
import { ResolvedMomentThumb } from "@/components/media/ResolvedPrivateMedia";
import { MomentViewerModal } from "@/components/moments/MomentViewerModal";
import { generateQrMatrix, generateQrSvgPath } from "@/lib/qr-svg";
import { HUB_SELECT } from "@/lib/hubs";
import type { CreatorMomentsSequence, Moment } from "@/lib/moments";

function makeQueryWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function makeMoment(overrides: Partial<Moment> = {}): Moment {
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 86_400_000).toISOString();
  return {
    id: "m-1",
    author_id: "author-1",
    media_url:
      "https://exlttyafomvqfwgzzjrm.supabase.co/storage/v1/object/public/media/author-1/moments/photo.jpg",
    media_type: "image",
    caption: "Shipping Ping v2",
    overlay_text: "Day 14",
    stickers: [{ id: "stk-1", emoji: "🚀", x: 50, y: 50 }],
    mentions: ["alice"],
    location: null,
    duration: 5,
    audience: "public",
    hub_id: null,
    is_discoverable: true,
    allow_comments: true,
    allow_sharing: true,
    allow_repings: true,
    expires_at: future,
    is_archived: false,
    deleted_at: null,
    view_count: 10,
    like_count: 3,
    reping_count: 1,
    reply_count: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makeSequence(moment: Moment): CreatorMomentsSequence[] {
  return [
    {
      author: {
        id: moment.author_id,
        username: "founder",
        display_name: "Founder One",
        avatar_url: null,
        bio: "",
        created_at: moment.created_at,
      },
      moments: [moment],
      hasUnseen: true,
      latestCreatedAt: moment.created_at,
    },
  ];
}

describe("Objective A — Moments Media Resolution, Playback, Caching & Resilience (Mocked/jsdom)", () => {
  beforeEach(() => {
    clearAllPrivateSignedUrlCaches();
    mockCreateSignedUrl.mockReset();
  });

  it("renders public Moment image directly and falls back to signed 'media' URL if public bucket load errors", async () => {
    const publicUrl =
      "https://exlttyafomvqfwgzzjrm.supabase.co/storage/v1/object/public/media/author-1/moments/hero.jpg";
    expect(extractSupabasePublicMediaPath(publicUrl)).toBe("author-1/moments/hero.jpg");
    // Private buckets must NEVER match public-media extraction
    expect(
      extractSupabasePublicMediaPath(
        "https://exlttyafomvqfwgzzjrm.supabase.co/storage/v1/object/public/private-moments/a/b.jpg",
      ),
    ).toBeNull();

    mockCreateSignedUrl.mockResolvedValueOnce({
      data: {
        signedUrl: "https://cdn.ping.test/sign/media/author-1/moments/hero.jpg?tok=fallback",
      },
      error: null,
    });

    const Wrapper = makeQueryWrapper();
    render(
      <Wrapper>
        <MomentViewerModal
          sequences={makeSequence(makeMoment({ media_url: publicUrl }))}
          open
          onOpenChange={vi.fn()}
        />
      </Wrapper>,
    );

    const img = await screen.findByAltText("Shipping Ping v2");
    expect(img).toHaveAttribute("src", publicUrl);
    // Captions, overlays, stickers, mentions preserved
    expect(screen.getByText("Shipping Ping v2")).toBeInTheDocument();
    expect(screen.getByText("Day 14")).toBeInTheDocument();
    expect(screen.getByText("🚀")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();

    // Simulate pre-0038 live state where media.public = false returns 400/404 on /object/public/media
    fireEvent.error(img);
    await waitFor(() => {
      expect(img).toHaveAttribute(
        "src",
        "https://cdn.ping.test/sign/media/author-1/moments/hero.jpg?tok=fallback",
      );
    });
    expect(mockCreateSignedUrl).toHaveBeenCalledWith("media", "author-1/moments/hero.jpg", 900);
  });

  it("resolves private Moment storage:// ref once across concurrent mounts (deduped & cached)", async () => {
    const privateRef = "storage://private-moments/author-1/followers/self/123-abc.jpg";
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://cdn.ping.test/sign/private-moments/tok-1" },
      error: null,
    });

    const [a, b] = await Promise.all([
      createAuthorizedMediaReadUrl(privateRef),
      createAuthorizedMediaReadUrl(privateRef),
    ]);
    expect(a).toBe("https://cdn.ping.test/sign/private-moments/tok-1");
    expect(b).toBe("https://cdn.ping.test/sign/private-moments/tok-1");
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(1);

    // Subsequent render reads cache without re-signing
    render(<ResolvedMomentThumb mediaUrl={privateRef} mediaType="image" alt="Followers story" />);
    const img = await screen.findByAltText("Followers story");
    expect(img).toHaveAttribute("src", "https://cdn.ping.test/sign/private-moments/tok-1");
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(1);
  });

  it("caches and deduplicates R2 signed read URLs for r2://private-moments/ refs", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        signedUrl: "https://r2.ping.test/private-moments/signed-1",
        expiresAtMs: Date.now() + 900_000,
      }),
    });
    const fallback = {
      id: "lovable_cloud" as const,
      supportsResumable: true,
      supportsMultipart: false,
      upload: vi.fn(),
      getReadUrl: vi.fn(),
      deleteObjects: vi.fn(),
    };
    const r2 = new CloudflareR2MediaProvider({
      getAccessToken: async () => "jwt-token",
      fallbackProvider: fallback,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const ref = "r2://private-moments/author-1/close_circle/self/vid.mp4";
    const [u1, u2] = await Promise.all([r2.getReadUrl(ref), r2.getReadUrl(ref)]);
    const u3 = await r2.getReadUrl(ref);
    expect(u1).toBe("https://r2.ping.test/private-moments/signed-1");
    expect(u2).toBe(u1);
    expect(u3).toBe(u1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // forceRefresh bypasses cache
    await r2.getReadUrl(ref, { forceRefresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("handles private video Moment playback, expired URL refresh, unauthorized failure, and Retry", async () => {
    const videoRef = "storage://private-moments/author-1/hub/hub-9/clip.mp4";
    // First sign fails (unauthorized / transient), then manual retry succeeds!
    mockCreateSignedUrl
      .mockResolvedValueOnce({ data: null, error: { message: "Forbidden" } })
      .mockResolvedValueOnce({
        data: { signedUrl: "https://cdn.ping.test/sign/private-moments/clip-refreshed.mp4" },
        error: null,
      });

    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(() => Promise.resolve());
    const pauseSpy = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => undefined);

    const Wrapper = makeQueryWrapper();
    render(
      <Wrapper>
        <MomentViewerModal
          sequences={makeSequence(
            makeMoment({
              id: "m-video",
              media_url: videoRef,
              media_type: "video",
              audience: "hub",
              hub_id: "hub-9",
            }),
          )}
          open
          onOpenChange={vi.fn()}
        />
      </Wrapper>,
    );

    // Unauthorized / failed state shows alert and Retry button
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Moment media unavailable");
    const retryBtn = screen.getByRole("button", { name: /retry loading/i });

    fireEvent.click(retryBtn);

    await waitFor(() => {
      const video = document.querySelector("video");
      expect(video).toBeTruthy();
      expect(video).toHaveAttribute(
        "src",
        "https://cdn.ping.test/sign/private-moments/clip-refreshed.mp4",
      );
    });
    expect(playSpy).toHaveBeenCalled();

    playSpy.mockRestore();
    pauseSpy.mockRestore();
  });

  it("integrates ResolvedMomentThumb into DiscoverableMomentsFeed and ProfileHighlights", () => {
    const discoverSrc = readFileSync(
      resolve(process.cwd(), "src/components/moments/DiscoverableMomentsFeed.tsx"),
      "utf8",
    );
    const highlightsSrc = readFileSync(
      resolve(process.cwd(), "src/components/moments/ProfileHighlights.tsx"),
      "utf8",
    );
    expect(discoverSrc).toContain("ResolvedMomentThumb");
    expect(discoverSrc).not.toContain("src={m.media_url}");
    expect(highlightsSrc).toContain("ResolvedMomentThumb");
    expect(highlightsSrc).not.toContain("src={h.cover_url}");
  });
});

describe("Objectives B & C — Hubs and Signals Code-Level Regression Guards", () => {
  it("exposes Hub avatar_url, fixes Events tab, aligns Hub RBAC dropdown, and eliminates external QR leakage", () => {
    expect(HUB_SELECT).toContain("avatar_url");

    const hubDetailSrc = readFileSync(resolve(process.cwd(), "src/routes/hubs.$slug.tsx"), "utf8");
    expect(hubDetailSrc).toContain('"events"');
    expect(hubDetailSrc).toContain("canManageModRole");
    expect(hubDetailSrc).toContain("hub.avatar_url");

    const shareModalSrc = readFileSync(
      resolve(process.cwd(), "src/components/hubs/HubShareModal.tsx"),
      "utf8",
    );
    expect(shareModalSrc).toContain("generateQrSvgPath");
    expect(shareModalSrc).not.toContain("api.qrserver.com");
  });

  it("replaces manual Signal broadcast URL input with ImageUploadField and adds Realtime + ResolvedMomentThumb", () => {
    const signalSlugSrc = readFileSync(
      resolve(process.cwd(), "src/routes/signals.$slug.tsx"),
      "utf8",
    );
    expect(signalSlugSrc).toContain('label="Optional Broadcast Attachment"');
    expect(signalSlugSrc).toContain("ResolvedMomentThumb");
    expect(signalSlugSrc).not.toContain("Optional Attachment Image URL");
    expect(signalSlugSrc).toContain('table: "signal_posts"');
    expect(signalSlugSrc).toContain('table: "signal_followers"');
  });
});

describe("Objectives D & E — Downloadable Ping (QR, PWA, Android, iOS) & Vercel Readiness", () => {
  it("generates a valid ISO/IEC 18004 QR matrix with 3 finder patterns and alternating timing rows", () => {
    const matrix = generateQrMatrix("https://justping.cv/download");
    expect(matrix.version).toBe(2);
    expect(matrix.size).toBe(25);
    // Top-left 7x7 finder outer border + 3x3 center
    expect(matrix.modules[0]![0]).toBe(true);
    expect(matrix.modules[3]![3]).toBe(true);
    expect(matrix.modules[1]![1]).toBe(false);
    // Top-right & bottom-left finder centers
    expect(matrix.modules[3]![matrix.size - 4]).toBe(true);
    expect(matrix.modules[matrix.size - 4]![3]).toBe(true);
    // Timing pattern alternating at row 6
    expect(matrix.modules[6]![8]).toBe(true);
    expect(matrix.modules[6]![9]).toBe(false);
    expect(matrix.modules[6]![10]).toBe(true);

    const svg = generateQrSvgPath("https://justping.cv/download");
    expect(svg.viewBoxSize).toBe(33); // 25 + 4*2 quiet zone
    expect(svg.path.startsWith("M")).toBe(true);
  });

  it("validates PWA manifest, Android App Links, iOS Associated Domains, /download page, and Vercel runbook", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), "public/manifest.webmanifest"), "utf8"),
    );
    expect(manifest.name).toBe("Ping by DOT");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);

    const androidManifest = readFileSync(
      resolve(process.cwd(), "android/app/src/main/AndroidManifest.xml"),
      "utf8",
    );
    expect(androidManifest).toContain('android:host="justping.cv"');
    expect(androidManifest).toContain('android:host="www.justping.cv"');
    expect(androidManifest).toContain('android:host="pingbydot.lovable.app"');

    const iosEntitlements = readFileSync(
      resolve(process.cwd(), "ios/App/App/App.entitlements"),
      "utf8",
    );
    expect(iosEntitlements).toContain("applinks:justping.cv");
    expect(iosEntitlements).toContain("applinks:www.justping.cv");
    expect(iosEntitlements).toContain("applinks:pingbydot.lovable.app");

    const downloadSrc = readFileSync(resolve(process.cwd(), "src/routes/download.tsx"), "utf8");
    expect(downloadSrc).toContain("generateQrSvgPath");
    expect(downloadSrc).toContain("Version &amp; Device Compatibility");

    const earlyAccess = JSON.parse(
      readFileSync(resolve(process.cwd(), "public/releases/early-access-manifest.json"), "utf8"),
    );
    // Honest manifest: no fake APK or TestFlight URLs fabricated
    expect(earlyAccess.android.downloadUrl).toBeNull();
    expect(earlyAccess.ios.testFlightUrl).toBeNull();

    const vercelDoc = readFileSync(
      resolve(process.cwd(), "docs/VERCEL_DEPLOYMENT_RUNBOOK.md"),
      "utf8",
    );
    expect(vercelDoc).toContain("justping.cv");
    expect(vercelDoc).toContain("www.justping.cv");
    expect(vercelDoc).toContain("NITRO_PRESET=vercel");
  });
});
