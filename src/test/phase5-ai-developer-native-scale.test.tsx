import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createDefaultGriotPreferences,
  getGriotProviderStatus,
  runLocalGriotAssist,
  suggestHashtagsFromText,
} from "@/lib/griot";
import {
  buildPingOpenApiSpec,
  buildWebsiteEnquiryEmbedSnippet,
  computePkceChallenge,
  sanitizeRequestedScopes,
  signPingWebhookPayload,
  validateOAuthRedirectUri,
  validateWebhookEndpointUrl,
  verifyPingWebhookSignature,
} from "@/lib/developer";
import { PingClient } from "@/lib/sdk/ping-sdk";
import {
  clearOfflineQueue,
  enqueueOfflineAction,
  flushOfflineQueue,
  getOfflineQueueSnapshot,
  resetFailedOfflineActions,
} from "@/lib/offline-queue";
import {
  formatRegionalCurrency,
  setAppLocale,
  setLowBandwidthMode,
  SUPPORTED_LOCALES,
  translate,
} from "@/lib/i18n";
import { getNativeRuntimeDiagnostics } from "@/lib/native";
import {
  buildPublicEdgeCacheHeaders,
  decodePingCursor,
  encodePingCursor,
  getSearchEngineStatus,
} from "@/lib/scale";
import { fetchPublicPings } from "@/lib/public-queries";

describe("Phase 5 — AI (GRIOT), Developer Ecosystem, Native Offline, Localisation & Scale", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearOfflineQueue();
    setAppLocale("en");
    setLowBandwidthMode(false);
  });

  describe("Migration 0032 security, RLS, private DM exclusion & GIN scale indexes", () => {
    const migrationsDir = path.resolve(__dirname, "../../drizzle/migrations");
    const m32Path = path.join(migrationsDir, "0032_phase5_griot_developer_offline_and_scale.sql");
    const journalPath = path.join(migrationsDir, "meta/_journal.json");

    it("registers migration 0032 sequentially with zero USING (true) policies and strict RLS", () => {
      const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
      const entry = journal.entries.find((e: { idx: number }) => e.idx === 32);
      expect(entry?.tag).toBe("0032_phase5_griot_developer_offline_and_scale");

      const sql = fs.readFileSync(m32Path, "utf8");
      const uncommented = sql
        .split("\n")
        .map((l) => l.replace(/--.*$/, ""))
        .join("\n");
      expect(uncommented).not.toMatch(/\bUSING\s*\(\s*true\s*\)/i);
      expect(sql).not.toMatch(/DROP\s+POLICY\s+IF\s+EXISTS\s+"[^"]+"\s+ON\s+\S+\s+FOR\s+/i);

      for (const tbl of [
        "griot_ai_preferences",
        "griot_audit_logs",
        "developer_apps",
        "oauth_authorization_codes",
        "oauth_access_tokens",
        "developer_api_keys",
        "developer_webhooks",
        "developer_webhook_deliveries",
        "api_rate_limits",
      ]) {
        expect(sql).toContain(`ALTER TABLE public.${tbl} ENABLE ROW LEVEL SECURITY;`);
      }

      // Hard-locked private DM exclusion in GRIOT AI tables
      expect(sql).toContain("CHECK (allow_private_messages_access = false)");
      expect(sql).toContain("CHECK (private_messages_accessed = false)");
      // Server-only API key verification & direct OAuth token minting revocation
      expect(sql).toContain(
        "REVOKE ALL ON FUNCTION public.verify_api_key_hash(text) FROM PUBLIC, anon, authenticated;",
      );
      expect(sql).toContain(
        "REVOKE INSERT, DELETE ON public.oauth_access_tokens FROM PUBLIC, anon, authenticated;",
      );
      expect(sql).toContain(
        "REVOKE ALL ON FUNCTION public.check_server_rate_limit(text, integer, integer) FROM PUBLIC, anon;",
      );
      // 1M+ GIN Full-Text Search indexes
      expect(sql).toContain("pings_fts_gin_idx");
      expect(sql).toContain("hubs_fts_gin_idx");
      expect(sql).toContain("business_profiles_fts_gin_idx");
      expect(sql).toContain("signal_opportunities_fts_gin_idx");
    });
  });

  describe("GRIOT AI — Opt-In Permission-Bounded Intelligence (5.1)", () => {
    it("defaults to opt-out with private direct messages permanently locked off", () => {
      const defaults = createDefaultGriotPreferences("user-123");
      expect(defaults.enabled).toBe(false);
      expect(defaults.allow_private_messages_access).toBe(false);

      const status = getGriotProviderStatus();
      expect(status.activeMode).toBe("deterministic_local");
      expect(status.privacyGuarantee).toContain("never silently reads private direct messages");
    });

    it("runs transparent deterministic local structuring, clarity audits, and business reply drafts", () => {
      const audit = runLocalGriotAssist({
        action: "clarity_audit",
        inputText:
          "We are launching a clean energy solar microgrid pilot in Lagos next month. Looking for local engineers to collaborate!",
      });
      expect(audit.providerMode).toBe("deterministic_local");
      expect(audit.privateMessagesAccessed).toBe(false);
      expect(audit.clarityScore).toBeGreaterThanOrEqual(80);
      expect(audit.suggestedHashtags).toContain("cleanenergy");
      expect(audit.suggestedHashtags).toContain("africatech");

      const shoutyAudit = runLocalGriotAssist({
        action: "clarity_audit",
        inputText: "CHECK THIS OUT RIGHT NOW EVERYONE BIG NEWS HERE",
      });
      expect(shoutyAudit.clarityScore!).toBeLessThan(audit.clarityScore!);

      const bizReply = runLocalGriotAssist({
        action: "business_reply_draft",
        inputText: "Do you offer weekend solar installation quotes in Accra?",
        tone: "professional",
      });
      expect(bizReply.outputText).toContain("thank you for contacting our team");
      expect(bizReply.privateMessagesAccessed).toBe(false);

      expect(suggestHashtagsFromText("Building an open source developer API SDK")).toContain(
        "developers",
      );
    });
  });

  describe("Developer Portal, OAuth 2.0 PKCE, SSRF-Safe Webhooks & SDK (5.2)", () => {
    it("enforces PKCE S256, rejects forbidden private-message scopes, and blocks SSRF webhook URLs", async () => {
      const challenge = await computePkceChallenge("a".repeat(64));
      expect(challenge.length).toBe(43);
      expect(challenge).not.toMatch(/[+/=]/);

      const cleaned = sanitizeRequestedScopes([
        "profile:read",
        "private_messages:read",
        "close_circle:read",
        "dot_wallet:credit",
        "business:inbox:write",
        "unknown:scope",
      ]);
      expect(cleaned).toEqual(["profile:read", "business:inbox:write"]);

      expect(validateWebhookEndpointUrl("https://hooks.partner.example/ping").valid).toBe(true);
      expect(validateWebhookEndpointUrl("http://hooks.partner.example/ping").valid).toBe(false);
      expect(validateWebhookEndpointUrl("https://localhost/hook").valid).toBe(false);
      expect(validateWebhookEndpointUrl("https://127.0.0.1/hook").valid).toBe(false);
      expect(validateWebhookEndpointUrl("https://169.254.169.254/latest/meta-data").valid).toBe(
        false,
      );
      expect(validateWebhookEndpointUrl("https://10.0.0.5/internal").valid).toBe(false);

      expect(validateOAuthRedirectUri("https://app.example.com/callback").valid).toBe(true);
      expect(validateOAuthRedirectUri("http://localhost:3000/callback").valid).toBe(true);
      expect(validateOAuthRedirectUri("http://evil.example.com/callback").valid).toBe(false);
      expect(validateOAuthRedirectUri("https://app.example.com/callback#frag").valid).toBe(false);
    });

    it("signs and verifies HMAC-SHA256 webhooks with replay protection and builds OpenAPI + SDK", async () => {
      const secret = "whsec_unit_test_secret_value";
      const payload = JSON.stringify({ event: "business.enquiry.created", id: "enq_1" });
      const nowSec = 1_800_000_000;

      const header = await signPingWebhookPayload(payload, secret, nowSec);
      expect(header).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);

      expect(await verifyPingWebhookSignature(payload, header, secret, { nowSec })).toBe(true);
      expect(await verifyPingWebhookSignature(payload + "tamper", header, secret, { nowSec })).toBe(
        false,
      );
      // Reject replay older than 5 minutes
      expect(
        await verifyPingWebhookSignature(payload, header, secret, { nowSec: nowSec + 600 }),
      ).toBe(false);

      const spec = buildPingOpenApiSpec("https://pingbydot.lovable.app");
      expect(spec.openapi).toBe("3.1.0");
      expect(spec.paths["/api/v1/pings"]).toBeDefined();
      expect(spec.paths["/api/v1/business/messages"]).toBeDefined();

      const embed = buildWebsiteEnquiryEmbedSnippet("kora-solar", "Kora Solar");
      expect(embed).toContain("/b/kora-solar?source=website_embed");

      const client = new PingClient({
        baseUrl: "https://pingbydot.lovable.app",
        apiKey: "ping_test_1234567890abcdef",
        fetchImpl: async () =>
          new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }),
      });
      const authUrl = await client.oauth.buildAuthorizeUrl({
        clientId: "ping_app_1234567890abcdef",
        redirectUri: "https://partner.example/cb",
        scopes: ["profile:read", "pings:read"],
        codeVerifier: "v".repeat(64),
        state: "xyz",
      });
      expect(authUrl).toContain("code_challenge_method=S256");
      const listRes = await client.pings.list({ limit: 10 });
      expect(listRes.items).toEqual([]);
    });
  });

  describe("Offline-First Action Queue & Native Diagnostics (5.3)", () => {
    it("deduplicates queued actions, replays on reconnect, and bounds retries on failure", async () => {
      const a1 = enqueueOfflineAction({
        kind: "ping_draft_publish",
        userId: "u1",
        summary: "Offline test ping",
        payload: { category: "progress", content: "Queued while offline" },
        clientMutationId: "mut_fixed_1",
      });
      const a1Dup = enqueueOfflineAction({
        kind: "ping_draft_publish",
        userId: "u1",
        summary: "Offline test ping",
        payload: { category: "progress", content: "Queued while offline" },
        clientMutationId: "mut_fixed_1",
      });
      expect(a1.id).toBe(a1Dup.id);
      expect(getOfflineQueueSnapshot().length).toBe(1);

      // Fail 3 times -> transitions to 'failed' and stops retrying automatically
      for (let i = 0; i < 3; i++) {
        await flushOfflineQueue(async () => {
          throw new Error("Simulated server outage");
        });
      }
      expect(getOfflineQueueSnapshot()[0]?.status).toBe("failed");

      // Reset failed & flush successfully
      resetFailedOfflineActions();
      const executed: string[] = [];
      const res = await flushOfflineQueue(async (item) => {
        executed.push(item.clientMutationId);
      });
      expect(res).toEqual({ synced: 1, failed: 0, remaining: 0 });
      expect(executed).toEqual(["mut_fixed_1"]);

      const nativeDiag = getNativeRuntimeDiagnostics();
      expect(nativeDiag.bundleId).toBe("app.lovable.pingbydot");
      expect(nativeDiag.customScheme).toBe("pingbydot://");
    });
  });

  describe("Continental Localisation, RTL Arabic & Data Saver (5.4)", () => {
    it("supports 6 continental/global locales, switches document RTL for Arabic, and formats regional currency", () => {
      expect(SUPPORTED_LOCALES.map((l) => l.code)).toEqual(["en", "fr", "sw", "ha", "yo", "ar"]);
      expect(translate("nav.explore", "fr")).toBe("Explorer");
      expect(translate("nav.home", "sw")).toBe("Nyumbani");
      expect(translate("nav.home", "yo")).toBe("Ilé");

      setAppLocale("ar");
      expect(document.documentElement.lang).toBe("ar");
      expect(document.documentElement.dir).toBe("rtl");

      setAppLocale("en");
      expect(document.documentElement.dir).toBe("ltr");

      expect(formatRegionalCurrency(5000, "NGN", "en")).toMatch(/5,000/);
      expect(formatRegionalCurrency(1200, "KES", "sw")).toMatch(/1,200/);

      setLowBandwidthMode(true);
      expect(window.localStorage.getItem("ping_low_bandwidth_v5")).toBe("true");
    });
  });

  describe("1M+ Scale Hardening: Keyset Cursors, Search Registry & Server Visibility (5.5)", () => {
    it("encodes and validates keyset cursors, edge cache headers, and search providers", () => {
      const sample = {
        createdAt: "2026-11-20T12:00:00.000Z",
        id: "123e4567-e89b-12d3-a456-426614174000",
      };
      const encoded = encodePingCursor(sample);
      expect(decodePingCursor(encoded)).toEqual(sample);
      expect(decodePingCursor("not-valid-cursor")).toBeNull();
      const injected = encodePingCursor({
        createdAt: "2026-11-20T12:00:00Z,id.neq.0",
        id: sample.id,
      });
      expect(decodePingCursor(injected)).toBeNull();

      const headers = buildPublicEdgeCacheHeaders(15, 60);
      expect(headers["Cache-Control"]).toContain("s-maxage=15");

      const searchStatus = getSearchEngineStatus();
      expect(searchStatus.activeProvider).toBe("postgres_fts");
      expect(searchStatus.providers.length).toBe(3);
    });

    it("enforces profile_visibility server-side during anonymous profile reads (Backlog #3)", async () => {
      const mockClient = {
        from: (table: string) => ({
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: async () => {
                if (table === "profiles" && val === "private_user") {
                  return {
                    data: {
                      id: "p1",
                      username: "private_user",
                      display_name: "Private",
                      profile_visibility: "private",
                    },
                    error: null,
                  };
                }
                return { data: null, error: null };
              },
            }),
          }),
        }),
      } as any;

      const res = await fetchPublicPings(mockClient, {
        kind: "profile",
        value: "private_user",
        page: 0,
      });
      expect(res.pings).toEqual([]);
      expect((res as { visibilityRestricted?: boolean }).visibilityRestricted).toBe(true);
    });
  });
});
