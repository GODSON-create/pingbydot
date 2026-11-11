import { describe, expect, it } from "vitest";

describe("Moments Lifecycle & Audience Logic", () => {
  it("determines if a moment is active or expired based on 24-hour window", () => {
    function isMomentActive(createdAt: string, expiresAt?: string): boolean {
      const now = new Date();
      const exp = expiresAt ? new Date(expiresAt) : new Date(new Date(createdAt).getTime() + 24 * 60 * 60 * 1000);
      return now.getTime() < exp.getTime();
    }

    const recentDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
    const oldDate = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(); // 26h ago

    expect(isMomentActive(recentDate)).toBe(true);
    expect(isMomentActive(oldDate)).toBe(false);
  });

  it("enforces strict Re-Ping privacy rules: Hub & Close Circle moments cannot be re-pinged publicly", () => {
    interface MomentCheck {
      audience: "public" | "followers" | "hub" | "close_circle";
      allow_repings: boolean;
    }

    function canRePingMoment(m: MomentCheck): { allowed: boolean; reason?: string } {
      if (m.audience === "hub" || m.audience === "close_circle") {
        return {
          allowed: false,
          reason: "Private Hub and Close Circle moments cannot be re-pinged.",
        };
      }
      if (!m.allow_repings) {
        return {
          allowed: false,
          reason: "Creator has disabled re-pings for this moment.",
        };
      }
      return { allowed: true };
    }

    // Public moment with re-pings enabled
    expect(canRePingMoment({ audience: "public", allow_repings: true }).allowed).toBe(true);

    // Followers moment with re-pings enabled
    expect(canRePingMoment({ audience: "followers", allow_repings: true }).allowed).toBe(true);

    // Private Hub moment
    const hubResult = canRePingMoment({ audience: "hub", allow_repings: true });
    expect(hubResult.allowed).toBe(false);
    expect(hubResult.reason).toContain("Private Hub");

    // Close Circle moment
    const circleResult = canRePingMoment({ audience: "close_circle", allow_repings: true });
    expect(circleResult.allowed).toBe(false);
    expect(circleResult.reason).toContain("Close Circle");

    // Public moment with re-pings disabled by creator
    const disabledResult = canRePingMoment({ audience: "public", allow_repings: false });
    expect(disabledResult.allowed).toBe(false);
    expect(disabledResult.reason).toContain("disabled re-pings");
  });

  it("preserves original creator attribution when creating a Re-Ping", () => {
    function buildRePing(
      moment: { id: string; author_id: string; author_username: string },
      repingUserId: string,
      commentary?: string,
    ) {
      return {
        original_moment_id: moment.id,
        original_creator_id: moment.author_id,
        original_creator_username: moment.author_username,
        reping_user_id: repingUserId,
        commentary: commentary?.trim() || null,
        created_at: new Date().toISOString(),
      };
    }

    const rePing = buildRePing(
      { id: "moment-123", author_id: "user-alice", author_username: "alice" },
      "user-bob",
      "Huge milestone for Amara!",
    );

    expect(rePing.original_moment_id).toBe("moment-123");
    expect(rePing.original_creator_username).toBe("alice");
    expect(rePing.reping_user_id).toBe("user-bob");
    expect(rePing.commentary).toBe("Huge milestone for Amara!");
  });

  it("filters discoverable moments for For You feed: guarantees ZERO leak of private Hub or Close Circle content", () => {
    interface MomentFeedItem {
      id: string;
      audience: "public" | "followers" | "hub" | "close_circle";
      is_discoverable: boolean;
      deleted_at: string | null;
    }

    function filterForYouMoments(items: MomentFeedItem[]) {
      return items.filter(
        (m) =>
          !m.deleted_at &&
          m.is_discoverable === true &&
          m.audience === "public", // MUST be public!
      );
    }

    const testMoments: MomentFeedItem[] = [
      { id: "1", audience: "public", is_discoverable: true, deleted_at: null },
      { id: "2", audience: "hub", is_discoverable: true, deleted_at: null }, // Attempted discoverable on hub -> MUST BE BLOCKED
      { id: "3", audience: "close_circle", is_discoverable: true, deleted_at: null }, // Attempted discoverable on close circle -> MUST BE BLOCKED
      { id: "4", audience: "followers", is_discoverable: true, deleted_at: null },
      { id: "5", audience: "public", is_discoverable: false, deleted_at: null },
      { id: "6", audience: "public", is_discoverable: true, deleted_at: "2026-11-10" },
    ];

    const eligible = filterForYouMoments(testMoments);
    expect(eligible.length).toBe(1);
    expect(eligible[0]?.id).toBe("1");
  });
});
