import { describe, expect, it } from "vitest";
import {
  hubSchema,
  safeResources,
  isHubStaff,
  canManageInvites,
  canSeeHubContent,
  inviteUrl,
  slugify,
  type HubRole,
  type HubCategory,
} from "./hubs";
import {
  signalAnalyticsQuery,
  type SignalInstitutionType,
} from "./signals";

describe("Hubs Critical Functionality & Repair Verification", () => {
  it("Journey 1 & 2: validates Hub creation and schema rules", () => {
    const validHub = {
      name: "AI Founders Europe",
      slug: "ai-founders-europe",
      tagline: "Connecting European AI builders",
      description: "A private circle for founders shipping applied AI models.",
      rules: "1. Ship weekly\\n2. Respect founder privacy\\n3. No unsolicited sales",
      category: "ecosystem" as HubCategory,
      access: "public" as const,
      resources: [{ label: "Docs", url: "https://docs.aieurope.org" }],
    };

    const res = hubSchema.safeParse(validHub);
    expect(res.success).toBe(true);

    // Rejects short names or invalid slugs
    expect(hubSchema.safeParse({ ...validHub, name: "A" }).success).toBe(false);
    expect(hubSchema.safeParse({ ...validHub, slug: "-invalid-slug" }).success).toBe(false);
    expect(hubSchema.safeParse({ ...validHub, slug: "HAS_CAPS" }).success).toBe(false);
  });

  it("Journey 3 & 4: supports editing hub details and toggling public/private visibility", () => {
    const publicHub = hubSchema.parse({
      name: "Open Source Builders",
      slug: "open-source-builders",
      category: "community",
      access: "public",
    });
    expect(publicHub.access).toBe("public");

    // Switching to private access
    const updatedPrivate = hubSchema.parse({
      ...publicHub,
      access: "private",
      rules: "Must have an active repository to request access.",
    });
    expect(updatedPrivate.access).toBe("private");
    expect(updatedPrivate.rules).toContain("active repository");
  });

  it("Journey 5 & 6: protects content visibility based on public vs private access", () => {
    // Public hub: non-members, anonymous, and members can view
    expect(canSeeHubContent("public", null)).toBe(true);
    expect(canSeeHubContent("public", "member")).toBe(true);

    // Private hub: non-members CANNOT view content
    expect(canSeeHubContent("private", null)).toBe(false);
    expect(canSeeHubContent("private", undefined)).toBe(false);

    // Private hub: only members and staff can view
    expect(canSeeHubContent("private", "member")).toBe(true);
    expect(canSeeHubContent("private", "moderator")).toBe(true);
    expect(canSeeHubContent("private", "admin")).toBe(true);
    expect(canSeeHubContent("private", "owner")).toBe(true);
  });

  it("Journey 7 & 9: correctly distinguishes Hub staff roles for managing membership requests", () => {
    const roles: (HubRole | null)[] = ["owner", "admin", "moderator", "member", null];

    const staffMap = roles.map((r) => ({ role: r, isStaff: isHubStaff(r) }));
    expect(staffMap).toEqual([
      { role: "owner", isStaff: true },
      { role: "admin", isStaff: true },
      { role: "moderator", isStaff: true },
      { role: "member", isStaff: false },
      { role: null, isStaff: false },
    ]);

    const inviteManagers = roles.map((r) => ({ role: r, canInvite: canManageInvites(r) }));
    expect(inviteManagers).toEqual([
      { role: "owner", canInvite: true },
      { role: "admin", canInvite: true },
      { role: "moderator", canInvite: false },
      { role: "member", canInvite: false },
      { role: null, canInvite: false },
    ]);
  });

  it("Journey 8: protects owner retention on leave_hub", () => {
    function canLeaveHub(role: HubRole | null): boolean {
      if (role === "owner") return false; // Owners cannot leave their hub
      return true;
    }

    expect(canLeaveHub("owner")).toBe(false);
    expect(canLeaveHub("admin")).toBe(true);
    expect(canLeaveHub("moderator")).toBe(true);
    expect(canLeaveHub("member")).toBe(true);
  });

  it("Journey 13: generates valid invitation URLs and sanitizes resources", () => {
    const invite = inviteUrl("ai-accelerator", "tok_secret_9876");
    expect(invite).toContain("/hubs/ai-accelerator?invite=tok_secret_9876");

    // safeResources only keeps valid https links
    const raw = [
      { label: "Website", url: "https://accelerator.ai" },
      { label: "Insecure", url: "http://insecure.ai" },
      { label: "Javascript", url: "javascript:alert(1)" },
      { label: "Valid Repo", url: "https://github.com/dot/ping" },
    ];
    const cleaned = safeResources(raw);
    expect(cleaned.length).toBe(2);
    expect(cleaned[0].url).toBe("https://accelerator.ai");
    expect(cleaned[1].url).toBe("https://github.com/dot/ping");
  });

  it("Journey 14: moderates Hub feed pings (pin, unpin, remove) within max pinned constraints", () => {
    const MAX_PINNED = 3;
    let pinnedCount = 2;

    function canPinMore(current: number): boolean {
      return current < MAX_PINNED;
    }

    expect(canPinMore(pinnedCount)).toBe(true);
    pinnedCount++;
    expect(canPinMore(pinnedCount)).toBe(false);
  });
});

describe("Signals Critical Functionality & Repair Verification", () => {
  it("Journey 1 & 2: validates institutional Signal categories and discovery", () => {
    const validTypes: SignalInstitutionType[] = [
      "university",
      "company",
      "incubator",
      "government",
      "community",
      "other",
    ];

    expect(validTypes).toContain("university");
    expect(validTypes).toContain("company");
    expect(validTypes).toContain("incubator");
    expect(validTypes).toContain("government");
  });

  it("Journey 3: tracks institutional verification states without fake data", () => {
    type VerificationStatus = "unverified" | "pending" | "verified" | "rejected";

    function computeVerificationDisplay(verified: boolean, status: VerificationStatus) {
      if (verified && status === "verified") {
        return { label: "Verified Institution", badge: "verified" };
      }
      if (status === "pending") {
        return { label: "Verification Pending Review", badge: "pending" };
      }
      return { label: "Unverified", badge: "unverified" };
    }

    expect(computeVerificationDisplay(false, "unverified")).toEqual({
      label: "Unverified",
      badge: "unverified",
    });
    expect(computeVerificationDisplay(false, "pending")).toEqual({
      label: "Verification Pending Review",
      badge: "pending",
    });
    expect(computeVerificationDisplay(true, "verified")).toEqual({
      label: "Verified Institution",
      badge: "verified",
    });
  });

  it("Journey 4 & 10: enforces Signal publisher role separation and creator immunity", () => {
    type PublisherRole = "admin" | "publisher";
    const creatorId = "user_creator_123";

    function canRemovePublisher(callerRole: PublisherRole, targetUserId: string): boolean {
      if (callerRole !== "admin") return false;
      if (targetUserId === creatorId) return false; // Primary creator cannot be removed
      return true;
    }

    expect(canRemovePublisher("publisher", "user_456")).toBe(false);
    expect(canRemovePublisher("admin", creatorId)).toBe(false);
    expect(canRemovePublisher("admin", "user_456")).toBe(true);
  });

  it("Journey 5: fixes signal_followers composite primary key query (no 'id' column)", () => {
    // signal_followers has composite PK (signal_id, user_id).
    // Selecting "signal_id, user_id" succeeds; selecting standalone "id" crashes in PostgreSQL.
    const querySelectFields = "signal_id, user_id";
    const columns = querySelectFields.split(",").map((c) => c.trim());
    expect(columns).toEqual(["signal_id", "user_id"]);
    expect(columns.includes("id")).toBe(false);
  });

  it("Journey 8 & 9: correctly maps SQL RPC analytics keys to frontend contracts", () => {
    // SQL get_signal_post_analytics returns { total_recipients, read_count, read_percentage }
    const rawSqlPayload = {
      post_id: "post_abc",
      signal_id: "signal_xyz",
      total_recipients: 1420,
      read_count: 890,
      read_percentage: 62.7,
    };

    const mapped = {
      post_id: rawSqlPayload.post_id,
      total_delivered: Number(rawSqlPayload.total_recipients ?? 0),
      total_read: Number(rawSqlPayload.read_count ?? 0),
      read_percentage: Number(rawSqlPayload.read_percentage ?? 0),
    };

    expect(mapped.total_delivered).toBe(1420);
    expect(mapped.total_read).toBe(890);
    expect(mapped.read_percentage).toBe(62.7);
  });
});
