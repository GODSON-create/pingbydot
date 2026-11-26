import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  extractSupabaseProjectRef,
  isPrivilegedSupabaseKey,
  resolvePublicSupabaseConfigFromSources,
  syncServerSupabaseProcessEnv,
} from "./supabase-public-config";
import { sanitizeErrorContext, sanitizeErrorMessage } from "./error-diagnostics";

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signaturepart`;
}

describe("Public Supabase configuration resolver", () => {
  const originalUrl = process.env["SUPABASE_URL"];
  const originalKey = process.env["SUPABASE_PUBLISHABLE_KEY"];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalUrl !== undefined) process.env["SUPABASE_URL"] = originalUrl;
    else delete process.env["SUPABASE_URL"];
    if (originalKey !== undefined) process.env["SUPABASE_PUBLISHABLE_KEY"] = originalKey;
    else delete process.env["SUPABASE_PUBLISHABLE_KEY"];
  });

  it("extracts project refs safely without exposing keys", () => {
    expect(extractSupabaseProjectRef("https://exlttyafomvqfwgzzjrm.supabase.co")).toBe(
      "exlttyafomvqfwgzzjrm",
    );
    expect(extractSupabaseProjectRef("https://exlttyafomvqfwgzzjrm.supabase.co/")).toBe(
      "exlttyafomvqfwgzzjrm",
    );
    expect(extractSupabaseProjectRef("http://localhost:54321")).toBe("localhost");
    expect(extractSupabaseProjectRef("not-a-url")).toBeNull();
  });

  it("falls back cleanly to VITE_SUPABASE_* when server env vars are missing", () => {
    const resolved = resolvePublicSupabaseConfigFromSources({
      serverUrl: undefined,
      serverKey: undefined,
      viteUrl: "https://exlttyafomvqfwgzzjrm.supabase.co/",
      viteKey: "sb_publishable_public_example_key",
    });

    expect(resolved.url).toBe("https://exlttyafomvqfwgzzjrm.supabase.co");
    expect(resolved.publishableKey).toBe("sb_publishable_public_example_key");
    expect(resolved.projectRef).toBe("exlttyafomvqfwgzzjrm");
    expect(resolved.source).toBe("vite-fallback");
    expect(resolved.mismatchDetected).toBe(false);
  });

  it("aligns mismatched server SUPABASE_* vars to the working browser VITE_* project ref", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const resolved = resolvePublicSupabaseConfigFromSources({
      serverUrl: "https://staleprojectref12345.supabase.co",
      serverKey: "sb_publishable_stale_key",
      viteUrl: "https://exlttyafomvqfwgzzjrm.supabase.co",
      viteKey: "sb_publishable_live_key",
    });

    expect(resolved.projectRef).toBe("exlttyafomvqfwgzzjrm");
    expect(resolved.url).toBe("https://exlttyafomvqfwgzzjrm.supabase.co");
    expect(resolved.publishableKey).toBe("sb_publishable_live_key");
    expect(resolved.mismatchDetected).toBe(true);
    expect(resolved.serverProjectRef).toBe("staleprojectref12345");
    expect(resolved.viteProjectRef).toBe("exlttyafomvqfwgzzjrm");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // Ensure key material was not logged in console warning
    expect(JSON.stringify(warnSpy.mock.calls[0])).not.toContain("sb_publishable_");
  });

  it("uses server+vite when both point to the same project and key", () => {
    const resolved = resolvePublicSupabaseConfigFromSources({
      serverUrl: "https://exlttyafomvqfwgzzjrm.supabase.co",
      serverKey: "sb_publishable_same_key",
      viteUrl: "https://exlttyafomvqfwgzzjrm.supabase.co",
      viteKey: "sb_publishable_same_key",
    });

    expect(resolved.source).toBe("server+vite");
    expect(resolved.mismatchDetected).toBe(false);
  });

  it("refuses service-role or secret keys on public readers", () => {
    const serviceRoleJwt = makeJwt({ role: "service_role", iss: "supabase" });
    const anonJwt = makeJwt({ role: "anon", iss: "supabase" });

    expect(isPrivilegedSupabaseKey("sb_secret_abc123")).toBe(true);
    expect(isPrivilegedSupabaseKey(serviceRoleJwt)).toBe(true);
    expect(isPrivilegedSupabaseKey("sb_publishable_abc123")).toBe(false);
    expect(isPrivilegedSupabaseKey(anonJwt)).toBe(false);

    expect(() =>
      resolvePublicSupabaseConfigFromSources({
        serverUrl: "https://exlttyafomvqfwgzzjrm.supabase.co",
        serverKey: "sb_secret_never_allow",
      }),
    ).toThrow(/service-role|secret key/i);

    expect(() =>
      resolvePublicSupabaseConfigFromSources({
        viteUrl: "https://exlttyafomvqfwgzzjrm.supabase.co",
        viteKey: serviceRoleJwt,
      }),
    ).toThrow(/service-role|secret key/i);
  });

  it("syncServerSupabaseProcessEnv populates missing server process.env from Worker env", () => {
    delete process.env["SUPABASE_URL"];
    delete process.env["SUPABASE_PUBLISHABLE_KEY"];

    syncServerSupabaseProcessEnv({
      VITE_SUPABASE_URL: "https://exlttyafomvqfwgzzjrm.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_worker_key",
    });

    expect(process.env["SUPABASE_URL"]).toBe("https://exlttyafomvqfwgzzjrm.supabase.co");
    expect(process.env["SUPABASE_PUBLISHABLE_KEY"]).toBeTruthy();
  });
});

describe("Error diagnostics sanitization", () => {
  it("redacts database URLs, Supabase keys, JWTs, Bearer tokens, and emails", () => {
    const raw =
      "Failed connecting to postgresql://postgres:supersecret@db.exlttyafomvqfwgzzjrm.supabase.co:5432/postgres with apikey=sb_publishable_abc123, sb_secret_xyz987, Bearer my-secret-token, user founder@ping.test, jwt eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig123";
    const safe = sanitizeErrorMessage(new Error(raw));

    expect(safe).not.toContain("supersecret");
    expect(safe).not.toContain("sb_publishable_");
    expect(safe).not.toContain("sb_secret_");
    expect(safe).not.toContain("my-secret-token");
    expect(safe).not.toContain("founder@ping.test");
    expect(safe).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(safe).toContain("[redacted-db-url]");
    expect(safe).toContain("[redacted-key]");
    expect(safe).toContain("[redacted-email]");
    expect(safe).toContain("[redacted-jwt]");
  });

  it("redacts sensitive fields in reported error contexts", () => {
    const ctx = sanitizeErrorContext({
      boundary: "tanstack_root_error_component",
      pathname: "/explore",
      secret: "abc",
      balance: 100,
      content: "private DM text",
      detail: "Issue for user@example.com",
    });

    expect(ctx).toEqual({
      boundary: "tanstack_root_error_component",
      pathname: "/explore",
      secret: "[redacted]",
      balance: "[redacted]",
      content: "[redacted]",
      detail: "Issue for [redacted-email]",
    });
  });
});
