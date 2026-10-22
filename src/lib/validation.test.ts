import { describe, expect, it } from "vitest";
import { pingSchema, usernameSchema } from "./validation";

describe("Ping rules", () => {
  it("rejects a Ping longer than 2000 characters", () => {
    expect(pingSchema.safeParse({ category: "idea", content: "a".repeat(2001) }).success).toBe(false);
    expect(pingSchema.safeParse({ category: "idea", content: "a".repeat(2000) }).success).toBe(true);
  });
  it("requires call-to-action links to be http(s)", () => {
    expect(pingSchema.safeParse({ category: "launch", content: "hi", cta_url: "javascript:alert(1)" }).success).toBe(false);
    expect(pingSchema.safeParse({ category: "launch", content: "hi", cta_url: "https://example.com" }).success).toBe(true);
  });
  it("only allows lowercase usernames of 3-24 letters, numbers, underscores", () => {
    expect(usernameSchema.safeParse("ab").success).toBe(false);
    expect(usernameSchema.safeParse("maya-k").success).toBe(false);
    expect(usernameSchema.parse("Maya_K")).toBe("maya_k");
  });
});
