import { describe, expect, it } from "vitest";
import {
  connectionUrl,
  normalizeConnection,
  publicConnections,
  type Connection,
} from "./connections";

describe("Connections", () => {
  it("requires an international WhatsApp number and normalizes it", () => {
    expect(normalizeConnection("whatsapp", "+44 7700 900123")).toEqual({
      ok: true,
      handle: "447700900123",
    });
    expect(normalizeConnection("whatsapp", "07700900123").ok).toBe(false);
    expect(connectionUrl("whatsapp", "447700900123")).toBe("https://wa.me/447700900123");
  });
  it("normalizes all three profile platforms and generates their actual destinations", () => {
    expect(normalizeConnection("snapchat", "https://snapchat.com/add/Founder_1")).toEqual({
      ok: true,
      handle: "founder_1",
    });
    expect(normalizeConnection("instagram", "https://instagram.com/Founder_1/?foo=bar")).toEqual({
      ok: true,
      handle: "founder_1",
    });
    expect(normalizeConnection("x", "https://twitter.com/Founder_1")).toEqual({
      ok: true,
      handle: "Founder_1",
    });
    expect(connectionUrl("snapchat", "founder_1")).toBe("https://www.snapchat.com/add/founder_1");
    expect(connectionUrl("instagram", "founder_1")).toBe("https://www.instagram.com/founder_1/");
    expect(connectionUrl("x", "Founder_1")).toBe("https://x.com/Founder_1");
  });
  it.each([
    "javascript:alert(1)",
    "https://instagram.com.evil.test/founder",
    "https://evil.test/founder",
    "https://user:pass@instagram.com/founder",
    "https://instagram.com:444/founder",
    "https://instagram.com/p/founder",
    "https://instagram.com/%2ffounder",
  ])("rejects unsafe or non-profile link %s", (input) => {
    expect(normalizeConnection("instagram", input).ok).toBe(false);
  });
  it("rejects reserved destinations even for stored handles", () => {
    expect(connectionUrl("instagram", "accounts")).toBeNull();
    expect(connectionUrl("x", "intent")).toBeNull();
  });
  it("filters private numbers and keeps all public platforms when primary is set", () => {
    const rows: Connection[] = [
      { platform: "whatsapp", handle: "447700900123", is_public: false, is_primary: true },
      { platform: "snapchat", handle: "founder", is_public: true, is_primary: false },
      { platform: "instagram", handle: "founder", is_public: true, is_primary: false },
      { platform: "x", handle: "founder", is_public: true, is_primary: false },
    ];
    expect(publicConnections(rows).map((r) => r.platform)).toEqual(["snapchat", "instagram", "x"]);
    rows[0] = { platform: "whatsapp", handle: "447700900123", is_public: true, is_primary: true };
    expect(publicConnections(rows)).toHaveLength(4);
    expect(publicConnections(rows)[0]?.platform).toBe("whatsapp");
  });
});
