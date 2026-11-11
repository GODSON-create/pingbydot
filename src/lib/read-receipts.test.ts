import { describe, expect, it } from "vitest";

describe("Ping Read Receipts & Reciprocal Privacy Logic", () => {
  it("computes read counts accurately excluding the author", () => {
    const authorId = "user-alice";
    const members = ["user-alice", "user-bob", "user-carol", "user-dan"];
    const readReceipts = [
      { user_id: "user-bob", read_at: "2026-11-10T12:00:00Z" },
      { user_id: "user-carol", read_at: "2026-11-10T12:05:00Z" },
    ];

    const eligibleRecipients = members.filter((m) => m !== authorId);
    const validReaders = readReceipts.filter(
      (r) => r.user_id !== authorId && eligibleRecipients.includes(r.user_id),
    );

    expect(eligibleRecipients.length).toBe(3);
    expect(validReaders.length).toBe(2);
    expect(`${validReaders.length} of ${eligibleRecipients.length} members`).toBe("2 of 3 members");
  });

  it("enforces reciprocal privacy: when user disables read receipts, others' receipts are obscured", () => {
    function getVisibleReceipts(
      currentUserPreference: { read_receipts_enabled: boolean },
      receipts: { user_id: string; reader_enabled: boolean }[],
    ) {
      // If current user disabled read receipts, reciprocal rule dictates they cannot inspect others
      if (!currentUserPreference.read_receipts_enabled) {
        return {
          canViewReceipts: false,
          readers: [],
          notice: "You have disabled read receipts. Turn them on in Settings to see who has read your Pings.",
        };
      }

      // Filter readers who have permitted read receipts
      const visible = receipts.filter((r) => r.reader_enabled);
      return {
        canViewReceipts: true,
        readers: visible,
        notice: null,
      };
    }

    const aliceDisabled = { read_receipts_enabled: false };
    const bobEnabled = { read_receipts_enabled: true };

    const readers = [
      { user_id: "user-carol", reader_enabled: true },
      { user_id: "user-dan", reader_enabled: false },
    ];

    const aliceResult = getVisibleReceipts(aliceDisabled, readers);
    expect(aliceResult.canViewReceipts).toBe(false);
    expect(aliceResult.readers).toEqual([]);
    expect(aliceResult.notice).toContain("disabled read receipts");

    const bobResult = getVisibleReceipts(bobEnabled, readers);
    expect(bobResult.canViewReceipts).toBe(true);
    expect(bobResult.readers.length).toBe(1);
    expect(bobResult.readers[0]?.user_id).toBe("user-carol");
  });

  it("determines active reading indicator state (Breathing Green vs Solid Green vs Black)", () => {
    type ReadState = "breathing_green" | "solid_green" | "black";

    function computeDotStatus(args: {
      hasBeenRead: boolean;
      isActiveReader: boolean;
      activePresenceEnabled: boolean;
    }): ReadState {
      if (args.isActiveReader && args.activePresenceEnabled) {
        return "breathing_green";
      }
      if (args.hasBeenRead) {
        return "solid_green";
      }
      return "black";
    }

    // Scenario 1: Reader actively in tab with presence enabled -> Breathing Green
    expect(
      computeDotStatus({
        hasBeenRead: true,
        isActiveReader: true,
        activePresenceEnabled: true,
      }),
    ).toBe("breathing_green");

    // Scenario 2: Reader actively in tab but has active_presence_enabled OFF -> Fallback to Solid Green
    expect(
      computeDotStatus({
        hasBeenRead: true,
        isActiveReader: true,
        activePresenceEnabled: false,
      }),
    ).toBe("solid_green");

    // Scenario 3: Reader opened previously, currently offline -> Solid Green
    expect(
      computeDotStatus({
        hasBeenRead: true,
        isActiveReader: false,
        activePresenceEnabled: true,
      }),
    ).toBe("solid_green");

    // Scenario 4: Not yet read -> Black dot
    expect(
      computeDotStatus({
        hasBeenRead: false,
        isActiveReader: false,
        activePresenceEnabled: true,
      }),
    ).toBe("black");
  });
});
