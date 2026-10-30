import { describe, expect, it } from "vitest";
import { ADMIN_PAGE_SIZE, adminListSchema, moderationSchema, assertAdminRole } from "./admin-policy";

describe("Administrator security rules", () => {
  it("denies non-admin access", () => { expect(() => assertAdminRole(false)).toThrow("Access denied"); });
  it("accepts server-verified admin access", () => { expect(() => assertAdminRole(true)).not.toThrow(); });
  it("requires a moderation reason and disallows destructive actions", () => {
    const id = "f173a470-fef1-412c-bbfb-30d444b828a1";
    expect(moderationSchema.safeParse({ id, action: "hide", reason: " " }).success).toBe(false);
    expect(moderationSchema.safeParse({ id, action: "delete", reason: "Abuse" }).success).toBe(false);
    expect(moderationSchema.parse({ id, action: "hide", reason: "Abuse" }).action).toBe("hide");
  });
  it("paginates management and rejects invalid pages", () => {
    expect(ADMIN_PAGE_SIZE).toBe(25);
    expect(adminListSchema.safeParse({ view: "users", page: -1, search: "" }).success).toBe(false);
  });
});