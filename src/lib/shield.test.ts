import { describe, it, expect, beforeEach } from "vitest";
import {
  checkShieldRateLimit,
  resetShieldCache,
  validateMediaUpload,
  sanitizeUserText,
} from "./shield";

describe("PING SHIELD Security Baseline", () => {
  beforeEach(() => {
    resetShieldCache();
  });

  it("permits actions within rate limits and blocks when exceeded", () => {
    const userId = "user-123";

    // 5 create_ping allowed in window
    for (let i = 0; i < 5; i++) {
      const res = checkShieldRateLimit("create_ping", userId);
      expect(res.allowed).toBe(true);
      expect(res.remaining).toBe(4 - i);
    }

    // 6th attempt is blocked
    const blocked = checkShieldRateLimit("create_ping", userId);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain("Rate limit exceeded");
  });

  it("isolates rate limits per user and action", () => {
    const userA = "user-a";
    const userB = "user-b";

    for (let i = 0; i < 5; i++) {
      checkShieldRateLimit("create_ping", userA);
    }

    // User A blocked
    expect(checkShieldRateLimit("create_ping", userA).allowed).toBe(false);

    // User B still permitted
    expect(checkShieldRateLimit("create_ping", userB).allowed).toBe(true);

    // User A can still perform other actions (e.g. like_action)
    expect(checkShieldRateLimit("like_action", userA).allowed).toBe(true);
  });

  it("validates media uploads strictly according to MIME and size rules", () => {
    const validImage = {
      name: "avatar.png",
      type: "image/png",
      size: 1024 * 500, // 500KB
    };
    expect(validateMediaUpload(validImage, "image").valid).toBe(true);

    const oversizedImage = {
      name: "huge.jpg",
      type: "image/jpeg",
      size: 15 * 1024 * 1024, // 15MB > 10MB limit
    };
    const oversizeRes = validateMediaUpload(oversizedImage, "image");
    expect(oversizeRes.valid).toBe(false);
    expect(oversizeRes.error).toContain("too large");

    const executableMime = {
      name: "script.sh",
      type: "application/x-sh",
      size: 100,
    };
    const mimeRes = validateMediaUpload(executableMime, "image");
    expect(mimeRes.valid).toBe(false);
    expect(mimeRes.error).toContain("Unsupported file format");

    const dangerousName = {
      name: "exploit.html",
      type: "image/png",
      size: 500,
    };
    expect(validateMediaUpload(dangerousName, "image").valid).toBe(false);
  });

  it("sanitizes user text and strips non-printable control characters", () => {
    const malicious = "Hello\x00World!\x1F This is a test.\nNewline is kept.";
    const clean = sanitizeUserText(malicious);
    expect(clean).toBe("HelloWorld! This is a test.\nNewline is kept.");
  });
});
