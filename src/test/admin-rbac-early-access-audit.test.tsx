// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Mutable auth / RPC mocks for server function & Download Centre tests
const mockCaller = {
  userId: "11111111-1111-4111-8111-111111111111",
  profilePayload: {
    isAdmin: false,
    isPlatformOwner: false,
    roles: [] as string[],
    permissions: [] as string[],
  },
};

const callerRpcMock = vi.fn(async (fn: string, _args?: Record<string, unknown>) => {
  if (fn === "get_my_admin_profile") {
    return { data: mockCaller.profilePayload, error: null };
  }
  if (fn === "is_ping_admin") {
    return { data: mockCaller.profilePayload.isAdmin, error: null };
  }
  return { data: { ok: true }, error: null };
});

const supabaseAdminRpcMock = vi.fn(async () => ({ data: { ok: true }, error: null }));
const clientRpcMock = vi.fn(async (fn: string, _args?: Record<string, unknown>) => {
  if (fn === "register_early_access") {
    return { data: { id: "ea-1", platform: "android", status: "registered" }, error: null };
  }
  return { data: null, error: null };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    createFileRoute: () => (opts: any) => ({
      ...opts,
      options: opts,
    }),
    Link: ({
      children,
      to,
      className,
      ...rest
    }: {
      children?: ReactNode;
      to?: string;
      className?: string;
      [k: string]: unknown;
    }) => (
      <a href={typeof to === "string" ? to : "#"} className={className} {...rest}>
        {children}
      </a>
    ),
    useLocation: () => ({
      pathname: "/download",
      searchStr: "?ref=site1&site=joinarise.cv&utm_source=arise&utm_campaign=early_access",
    }),
  };
});

vi.mock("@tanstack/react-start", () => {
  const buildValidator = (schema?: any) => ({
    ...createChain(),
    handler: (fn: (ctx: any) => unknown) => (input?: any) => {
      const parsed = schema
        ? schema.parse(input?.data ?? input ?? {})
        : (input?.data ?? input ?? {});
      return fn({
        data: parsed,
        context: {
          userId: mockCaller.userId,
          supabase: {
            rpc: (fn: string, params?: Record<string, unknown>) => callerRpcMock(fn, params),
          },
        },
      });
    },
  });
  const createChain = (): any => ({
    validator: buildValidator,
    inputValidator: buildValidator,
    middleware: () => createChain(),
    handler: (fn: (ctx: any) => unknown) => (input?: any) =>
      fn({
        data: input?.data ?? input ?? {},
        context: {
          userId: mockCaller.userId,
          supabase: {
            rpc: (fn: string, params?: Record<string, unknown>) => callerRpcMock(fn, params),
          },
        },
      }),
  });
  return {
    createServerFn: () => createChain(),
    createMiddleware: () => ({ server: (fn: unknown) => fn }),
    useServerFn: (fn: unknown) => fn,
  };
});

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: () => supabaseAdminRpcMock(),
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, params?: Record<string, unknown>) => clientRpcMock(fn, params),
  },
}));

import {
  ADMIN_MODULE_DESCRIPTORS,
  evaluateAdminRoleMutation,
  getAccessibleAdminModules,
  hasAdminPermission,
  resolveEffectiveAdminPermissions,
} from "@/lib/admin-rbac";
import {
  appointAdminRole,
  moderatePing,
  revokeAdminRole,
  setAdminUserPermission,
  upsertMembershipPlan,
} from "@/lib/admin.functions";
import { parseDownloadReferral } from "@/lib/distribution";
import { Route as DownloadRoute } from "@/routes/download";

const ROOT = process.cwd();

describe("Workstream 1: Appointment-Based RBAC & Server Enforcement", () => {
  const TARGET_USER = "22222222-2222-4222-8222-222222222222";
  const TARGET_PING = "33333333-3333-4333-8333-333333333333";

  beforeEach(() => {
    vi.clearAllMocks();
    mockCaller.userId = "11111111-1111-4111-8111-111111111111";
  });

  it("enforces distinct least-privilege boundaries across all 7 roles and ordinary users", () => {
    const owner = resolveEffectiveAdminPermissions(["platform_owner"]);
    expect(owner.isAdmin).toBe(true);
    expect(owner.isPlatformOwner).toBe(true);
    expect(getAccessibleAdminModules(owner)).toHaveLength(ADMIN_MODULE_DESCRIPTORS.length);
    expect(hasAdminPermission(owner, "admin.appoint_admins")).toBe(true);
    expect(hasAdminPermission(owner, "admin.revoke_admins")).toBe(true);
    expect(hasAdminPermission(owner, "admin.manage_permissions")).toBe(true);

    const ordinaryAdmin = resolveEffectiveAdminPermissions(["admin"]);
    expect(ordinaryAdmin.isAdmin).toBe(true);
    expect(ordinaryAdmin.isPlatformOwner).toBe(false);
    expect(hasAdminPermission(ordinaryAdmin, "content.moderate")).toBe(true);
    expect(hasAdminPermission(ordinaryAdmin, "admin.appoint_admins")).toBe(false);
    expect(hasAdminPermission(ordinaryAdmin, "admin.revoke_admins")).toBe(false);
    expect(hasAdminPermission(ordinaryAdmin, "admin.manage_permissions")).toBe(false);

    const moderator = resolveEffectiveAdminPermissions(["moderator"]);
    expect(hasAdminPermission(moderator, "content.moderate")).toBe(true);
    expect(hasAdminPermission(moderator, "economy.manage_plans")).toBe(false);
    expect(hasAdminPermission(moderator, "people.verify")).toBe(false);
    expect(hasAdminPermission(moderator, "admin.appoint_admins")).toBe(false);

    const analyst = resolveEffectiveAdminPermissions(["analyst"]);
    expect(hasAdminPermission(analyst, "overview.view")).toBe(true);
    expect(hasAdminPermission(analyst, "growth.view")).toBe(true);
    expect(hasAdminPermission(analyst, "content.moderate")).toBe(false);
    expect(hasAdminPermission(analyst, "economy.manage_plans")).toBe(false);
    expect(hasAdminPermission(analyst, "people.verify")).toBe(false);
    expect(hasAdminPermission(analyst, "communities.manage")).toBe(false);

    const finance = resolveEffectiveAdminPermissions(["finance_admin"]);
    expect(hasAdminPermission(finance, "economy.manage_plans")).toBe(true);
    expect(hasAdminPermission(finance, "economy.moderate_boosts")).toBe(true);
    expect(hasAdminPermission(finance, "content.moderate")).toBe(false);

    const support = resolveEffectiveAdminPermissions(["support"]);
    expect(hasAdminPermission(support, "people.verify")).toBe(true);
    expect(hasAdminPermission(support, "communications.view_metrics")).toBe(true);
    expect(hasAdminPermission(support, "economy.manage_plans")).toBe(false);

    const community = resolveEffectiveAdminPermissions(["community_admin"]);
    expect(hasAdminPermission(community, "communities.manage")).toBe(true);
    expect(hasAdminPermission(community, "learn.manage_schedule")).toBe(true);
    expect(hasAdminPermission(community, "economy.manage_plans")).toBe(false);

    // Ordinary user with NO staff role receives zero permissions even if stray override exists
    const ordinaryUser = resolveEffectiveAdminPermissions(
      [],
      [
        { permission: "content.moderate", effect: "grant" },
        { permission: "admin.appoint_admins", effect: "grant" },
      ],
    );
    expect(ordinaryUser.isAdmin).toBe(false);
    expect(ordinaryUser.permissions).toHaveLength(0);
  });

  it("supports per-user grant/revoke overrides while permanently blocking owner-exclusive delegation and self-escalation", () => {
    const delegatedAdmin = resolveEffectiveAdminPermissions(
      ["admin"],
      [
        { permission: "admin.appoint_admins", effect: "grant" },
        { permission: "economy.manage_plans", effect: "revoke" },
        { permission: "admin.revoke_admins", effect: "grant" },
        { permission: "admin.manage_permissions", effect: "grant" },
      ],
    );

    expect(hasAdminPermission(delegatedAdmin, "admin.appoint_admins")).toBe(true);
    expect(hasAdminPermission(delegatedAdmin, "economy.manage_plans")).toBe(false);
    expect(hasAdminPermission(delegatedAdmin, "admin.revoke_admins")).toBe(false);
    expect(hasAdminPermission(delegatedAdmin, "admin.manage_permissions")).toBe(false);

    // Self-escalation blocked even for Platform Owner
    const owner = resolveEffectiveAdminPermissions(["platform_owner"]);
    const selfDecision = evaluateAdminRoleMutation({
      action: "appoint",
      actorId: mockCaller.userId,
      actorAccess: owner,
      targetUserId: mockCaller.userId,
      targetRole: "admin",
    });
    expect(selfDecision.allowed).toBe(false);
    expect(selfDecision.reason).toMatch(/self-escalation/i);
  });

  it("enforces server-side authorization on protected mutations for owner, admin, moderator, analyst, and ordinary users", async () => {
    // 1. Ordinary user blocked everywhere
    mockCaller.profilePayload = resolveEffectiveAdminPermissions([]);
    await expect(
      moderatePing({ data: { id: TARGET_PING, action: "hide", reason: "Spam attempt" } }),
    ).rejects.toThrow(/Access denied/i);
    await expect(
      appointAdminRole({
        data: { targetUserId: TARGET_USER, role: "moderator", reason: "Unauthorized attempt" },
      }),
    ).rejects.toThrow(/Platform Owner/i);

    // 2. Analyst is read-only — blocked from moderation and plan edits
    mockCaller.profilePayload = resolveEffectiveAdminPermissions(["analyst"]);
    await expect(
      moderatePing({ data: { id: TARGET_PING, action: "hide", reason: "Analyst test" } }),
    ).rejects.toThrow(/content\.moderate/i);
    await expect(
      upsertMembershipPlan({
        data: {
          slug: "plus",
          name: "Builder Plus",
          badge: "Builder Plus",
          tagline: "Test",
          dotPrice: 300,
          durationDays: 30,
          isActive: true,
        },
      }),
    ).rejects.toThrow(/economy\.manage_plans/i);

    // 3. Moderator allowed to moderate Pings, blocked from economy & appointments
    mockCaller.profilePayload = resolveEffectiveAdminPermissions(["moderator"]);
    const modRes = await moderatePing({
      data: { id: TARGET_PING, action: "hide", reason: "Verified spam link" },
    });
    expect(modRes).toEqual({ ok: true });
    await expect(
      appointAdminRole({
        data: { targetUserId: TARGET_USER, role: "support", reason: "Moderator attempt" },
      }),
    ).rejects.toThrow(/Platform Owner/i);

    // 4. Ordinary Administrator blocked from appointing/revoking without explicit Platform Owner grant
    mockCaller.profilePayload = resolveEffectiveAdminPermissions(["admin"]);
    await expect(
      appointAdminRole({
        data: { targetUserId: TARGET_USER, role: "moderator", reason: "Unapproved delegation" },
      }),
    ).rejects.toThrow(/Platform Owner/i);
    await expect(
      revokeAdminRole({
        data: { targetUserId: TARGET_USER, reason: "Admin cannot revoke" },
      }),
    ).rejects.toThrow(/Platform Owner/i);

    // 5. Administrator WITH explicit Platform Owner grant of admin.appoint_admins may appoint, still cannot revoke
    mockCaller.profilePayload = resolveEffectiveAdminPermissions(
      ["admin"],
      [{ permission: "admin.appoint_admins", effect: "grant" }],
    );
    await expect(
      appointAdminRole({
        data: { targetUserId: TARGET_USER, role: "moderator", reason: "Owner-delegated hire" },
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      setAdminUserPermission({
        data: {
          targetUserId: TARGET_USER,
          permission: "content.moderate",
          effect: "grant",
          reason: "Should fail for non-owner",
        },
      }),
    ).rejects.toThrow(/Platform Owner/i);

    // 6. Platform Owner can appoint, revoke, and set individual permissions for another user
    mockCaller.profilePayload = resolveEffectiveAdminPermissions(["platform_owner"]);
    await expect(
      appointAdminRole({
        data: { targetUserId: TARGET_USER, role: "analyst", reason: "Appointed analytics lead" },
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      setAdminUserPermission({
        data: {
          targetUserId: TARGET_USER,
          permission: "growth.view",
          effect: "grant",
          reason: "Scoped growth access",
        },
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      revokeAdminRole({
        data: { targetUserId: TARGET_USER, reason: "Assignment ended cleanly" },
      }),
    ).resolves.toEqual({ ok: true });
  });

  it("verifies Migration 0035 sequential registration, strict RLS, zero USING(true), and zero private message body access", () => {
    const journalPath = path.join(ROOT, "drizzle/migrations/meta/_journal.json");
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    const entry35 = journal.entries.find((e: any) => e.idx === 35);
    expect(entry35?.tag).toBe("0035_admin_control_centre_and_early_access");

    const sql = fs.readFileSync(
      path.join(ROOT, "drizzle/migrations/0035_admin_control_centre_and_early_access.sql"),
      "utf8",
    );
    const sqlWithoutComments = sql.replace(/--.*$/gm, "");
    expect(sqlWithoutComments).not.toMatch(/USING\s*\(\s*true\s*\)/i);
    expect(sqlWithoutComments).not.toMatch(/WITH CHECK\s*\(\s*true\s*\)/i);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.admin_control_centre_metrics\(\) FROM PUBLIC, anon, authenticated/i,
    );
    expect(sql).toMatch(/Self-escalation is strictly forbidden/i);
    // Ensure admin metrics NEVER reads private message content/body columns
    expect(sql).not.toMatch(/private_messages\.(body|content|text)/i);

    const migrateScript = fs.readFileSync(path.join(ROOT, "scripts/migrate-remote.mjs"), "utf8");
    expect(migrateScript).toContain("admin_appointments");
    expect(migrateScript).toContain("early_access_registrations");
    expect(migrateScript).toContain("admin_control_centre_metrics");
  });
});

describe("Workstream 2: PWA Hardening, Android Release Guard & Official Download Centre", () => {
  it("ships valid PWA manifest, real PNG icons, offline fallback, and privacy-hardened Service Worker", () => {
    const manifestRaw = fs.readFileSync(path.join(ROOT, "public/manifest.webmanifest"), "utf8");
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.display).toBe("standalone");
    expect(manifest.share_target?.action).toBe("/share-target");
    expect(manifest.icons.some((i: any) => i.sizes === "192x192")).toBe(true);
    expect(manifest.icons.some((i: any) => i.sizes === "512x512" && i.purpose === "maskable")).toBe(
      true,
    );

    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (const icon of [
      "public/icons/icon-192.png",
      "public/icons/icon-512.png",
      "public/icons/icon-maskable-512.png",
      "public/icons/apple-touch-icon-180.png",
    ]) {
      const buf = fs.readFileSync(path.join(ROOT, icon));
      expect(buf.subarray(0, 8).equals(pngHeader)).toBe(true);
    }

    const offlineHtml = fs.readFileSync(path.join(ROOT, "public/offline.html"), "utf8");
    expect(offlineHtml).toMatch(/currently offline/i);

    const sw = fs.readFileSync(path.join(ROOT, "public/sw.js"), "utf8");
    for (const forbiddenPath of [
      "/rest/v1/",
      "/auth/v1/",
      "/realtime/",
      "/storage/v1/object/sign/",
      "/api/",
      "/admin",
      "/messages",
    ]) {
      expect(sw).toContain(forbiddenPath);
    }
    expect(sw).toContain("Authorization");
    expect(sw).toContain("SKIP_WAITING");
    expect(sw).toContain("CLEAR_ALL_CACHES");
  });

  it("blocks public debug APK distribution and never fabricates SHA-256 checksums", () => {
    const releaseManifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, "public/releases/early-access-manifest.json"), "utf8"),
    );
    expect(releaseManifest.android.debugDistributionBlocked).toBe(true);
    expect(releaseManifest.android.downloadUrl).toBeNull();
    expect(releaseManifest.android.sha256).toBeNull();

    const androidScript = fs.readFileSync(path.join(ROOT, "scripts/android-build.mjs"), "utf8");
    expect(androidScript).toContain("--require-signed");
    expect(androidScript).toContain("Debug APKs must NEVER be distributed publicly");
    expect(androidScript).toContain('crypto.createHash("sha256")');
  });

  it("parses external website referrals and renders /download cleanly with working early-access registration", async () => {
    const parsed = parseDownloadReferral(
      "?ref=site1&site=joinarise.cv&utm_source=arise&utm_medium=banner&utm_campaign=launch",
    );
    expect(parsed.referralSource).toBe("site1");
    expect(parsed.sourceSite).toBe("joinarise.cv");
    expect(parsed.utmSource).toBe("arise");

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const DownloadPage = DownloadRoute.options.component as React.ComponentType;
    render(
      <QueryClientProvider client={qc}>
        <DownloadPage />
      </QueryClientProvider>,
    );

    expect(screen.getByText(/Install Ping on any device/i)).toBeInTheDocument();
    expect(screen.getByText(/joinarise\.cv/i)).toBeInTheDocument();
    expect(screen.getByText(/Pending Signed Build/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Add to Home Screen/i).length).toBeGreaterThanOrEqual(1);

    fireEvent.change(screen.getByLabelText(/Email Address/i), {
      target: { value: "tester@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/Device Model/i), {
      target: { value: "Pixel 8" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Register for Ping Early Access/i }));

    await waitFor(() => {
      expect(clientRpcMock).toHaveBeenCalledWith(
        "register_early_access",
        expect.objectContaining({
          p_email: "tester@example.com",
          p_device_model: "Pixel 8",
          p_referral_source: "site1",
          p_source_site: "joinarise.cv",
        }),
      );
    });
  });
});

describe("Workstream 3: Required Documentation & Terminology Audit Deliverables", () => {
  it("contains all 6 required governance, release, roadmap, bug register, and terminology audit docs", () => {
    const requiredDocs = [
      "docs/admin/PING_ADMIN_OPERATIONS.md",
      "docs/admin/PING_ADMIN_PERMISSIONS.md",
      "docs/release/PING_EARLY_ACCESS_DISTRIBUTION.md",
      "docs/product/PING_TERMINOLOGY_IMPLEMENTATION_AUDIT.md",
      "docs/product/PING_MASTER_ROADMAP.md",
      "docs/quality/PING_BUG_REGISTER.md",
    ];
    for (const rel of requiredDocs) {
      const full = path.join(ROOT, rel);
      expect(fs.existsSync(full), `Missing doc: ${rel}`).toBe(true);
      const content = fs.readFileSync(full, "utf8");
      expect(content.length).toBeGreaterThan(500);
    }

    const auditDoc = fs.readFileSync(
      path.join(ROOT, "docs/product/PING_TERMINOLOGY_IMPLEMENTATION_AUDIT.md"),
      "utf8",
    );
    for (const term of [
      "Pings",
      "Reping",
      "Moments",
      "Clips",
      "Hubs",
      "Signals",
      "DOT Tags",
      "Ping Connections",
      "Ping Spotlight",
      "Ping Learn",
      "Ping Boost",
      "Inbox",
      "Ping Verification",
      "Builder Plus",
      "Builder Pro",
      "Ping Calls",
      "Ping Embed",
      "Appearance Settings",
      "Messaging Actions",
      "Universal Sharing",
    ]) {
      expect(auditDoc, `Audit doc missing term: ${term}`).toContain(term);
    }
  });
});
