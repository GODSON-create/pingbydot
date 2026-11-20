import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, tableHandlerState, authState, routerState } = vi.hoisted(() => ({
  rpcMock: vi.fn<(...args: any[]) => Promise<{ data: any; error: any }>>(async () => ({
    data: null,
    error: null,
  })),
  tableHandlerState: {
    handler: (() => ({ data: [], error: null, count: 0 })) as (table: string) => {
      data?: unknown;
      error?: unknown;
      count?: number | null;
    },
  },
  authState: {
    user: { id: "user-alpha-1111-2222-3333-444455556666", email: "ada@ping.africa" } as null | {
      id: string;
      email?: string;
    },
    profile: {
      id: "user-alpha-1111-2222-3333-444455556666",
      username: "ada_builds",
      display_name: "Ada Okafor",
      bio: "Building in .africa .technology",
      avatar_url: null,
      created_at: "2026-01-01T00:00:00Z",
    },
    ready: true,
    profileLoading: false,
    sessionExpired: false,
    clearSessionExpired: vi.fn(),
    refreshProfile: vi.fn(),
  },
  routerState: {
    params: { slug: "africa" } as Record<string, string>,
    search: {} as Record<string, unknown>,
  },
}));

function makeChain(table: string) {
  const chain: Record<string, any> = {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    upsert: () => chain,
    eq: () => chain,
    neq: () => chain,
    in: () => chain,
    gt: () => chain,
    is: () => chain,
    or: () => chain,
    order: () => chain,
    range: () => chain,
    limit: () => chain,
    maybeSingle: () => chain,
    single: () => chain,
    then: (resolve: (val: any) => unknown, reject?: (err: unknown) => unknown) =>
      Promise.resolve(tableHandlerState.handler(table)).then(resolve, reject),
  };
  return chain;
}

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    createFileRoute: () => (opts: any) => ({
      ...opts,
      options: opts,
      useParams: () => routerState.params,
      useSearch: () => routerState.search,
    }),
    Link: ({ children, to, className, onClick }: any) => (
      <a href={typeof to === "string" ? to : "#"} className={className} onClick={onClick}>
        {children}
      </a>
    ),
    useNavigate: () => vi.fn(),
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => makeChain(table),
    rpc: (...args: any[]) => rpcMock(...args),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: authState.user }, error: null })),
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => authState,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

import { VerificationBadge } from "@/components/verification/VerificationBadge";
import { detectImpersonationRisk, isVerificationExpired } from "@/lib/verification";
import {
  FALLBACK_MEMBERSHIP_PLANS,
  generateSubscriptionIdempotencyKey,
  hasMembershipBenefit,
  isEntitlementActive,
  type SubscriptionEntitlement,
} from "@/lib/memberships";
import {
  calculateBoostDotPrice,
  estimateBoostDelivery,
  generateBoostIdempotencyKey,
  validateMomentBoostEligibility,
  type BoostCampaign,
} from "@/lib/boosts";
import { PromotedBadge } from "@/components/boost/BoostContentDialog";
import {
  computeDotTagAnalytics,
  detectActiveDotTagQuery,
  extractAllDiscoveryTags,
  extractDotTags,
  validateDotTag,
} from "@/lib/dot-tags";
import { tokenizeRichText } from "@/lib/social";
import {
  CascadingProfilePanel,
  extractSharedConversationAssets,
} from "@/components/profile/CascadingProfilePanel";
import { readRecentEmojis, recordRecentEmoji } from "@/components/messages/MessageEmojiPicker";
import { DEFAULT_APPEARANCE, sanitizeAppearancePreferences, ThemeProvider } from "@/lib/theme";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { EmptyStateCard, LoadingSkeletonStack } from "@/components/ui/state-views";

function renderWithQuery(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  tableHandlerState.handler = () => ({ data: [], error: null, count: 0 });
  rpcMock.mockResolvedValue({ data: null, error: null });
});

/* -------------------------------------------------------------------------- */
/* 1. MIGRATION 0033 & SECURITY BOUNDARIES (SECTION 11)                       */
/* -------------------------------------------------------------------------- */
describe("Migration 0033 schema, RLS & financial security invariants", () => {
  const repoRoot = process.cwd();
  const journalPath = path.join(repoRoot, "drizzle", "migrations", "meta", "_journal.json");
  const migrationPath = path.join(
    repoRoot,
    "drizzle",
    "migrations",
    "0033_premium_ux_dot_economy_and_interactions.sql",
  );

  it("registers migration 0033 sequentially in _journal.json with zero gaps", () => {
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const last = journal.entries[journal.entries.length - 1];
    expect(last?.idx).toBe(33);
    expect(last?.tag).toBe("0033_premium_ux_dot_economy_and_interactions");
    journal.entries.forEach((entry, index) => {
      expect(entry.idx).toBe(index);
    });
  });

  it("enables RLS on every new table, contains zero USING (true) policies, and revokes direct financial writes", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");
    const uncommented = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");

    expect(uncommented).not.toMatch(/\bUSING\s*\(\s*true\s*\)/i);

    const requiredTables = [
      "membership_plans",
      "subscription_entitlements",
      "subscription_receipts",
      "boost_campaigns",
      "boost_campaign_events",
      "boost_campaign_reports",
      "boost_refund_audit",
      "dot_tags",
      "ping_dot_tags",
      "user_dot_tag_follows",
    ];
    for (const tbl of requiredTables) {
      expect(sql).toContain(`ALTER TABLE public.${tbl} ENABLE ROW LEVEL SECURITY`);
    }

    // Financial & entitlement mutations must go exclusively through server RPCs
    expect(sql).toMatch(
      /REVOKE ALL ON public\.membership_plans, public\.subscription_entitlements, public\.subscription_receipts/i,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON public\.boost_campaigns, public\.boost_campaign_events, public\.boost_refund_audit/i,
    );
    // Idempotency & Moment remaining lifetime checks enforced server-side
    expect(sql).toContain("p_idempotency_key");
    expect(sql).toContain("exceeds this Moment''s remaining lifetime");
    // Anti-self-approval in verification review v2
    expect(sql).toContain("Administrators cannot approve their own verification request");
  });
});

/* -------------------------------------------------------------------------- */
/* 2. VERIFICATION BADGE SYSTEM & ANTI-IMPERSONATION (SECTION 2)              */
/* -------------------------------------------------------------------------- */
describe("Verification badges, expiry & anti-impersonation", () => {
  it("renders Verified Identity badge and opens popover explaining DOT separation", async () => {
    renderWithQuery(
      <VerificationBadge
        badges={{
          identity_verified: true,
          identity_verified_at: "2026-06-01T00:00:00Z",
          identity_expires_at: "2099-06-01T00:00:00Z",
          professional_verified: false,
          professional_pathway: null,
        }}
      />,
    );

    const trigger = screen.getByTestId("verification-badge-trigger");
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByText(/Verified Identity/i)).toBeTruthy();
      expect(
        screen.getByText(/never purchased or automatically granted by spending DOT credits/i),
      ).toBeTruthy();
    });
  });

  it("renders Verified Business badge for verified businesses and hides unverified or expired credentials", () => {
    const { container: unverifiedContainer } = renderWithQuery(
      <VerificationBadge
        badges={{
          identity_verified: false,
          professional_verified: false,
          professional_pathway: null,
        }}
      />,
    );
    expect(unverifiedContainer.innerHTML).toBe("");

    const { container: expiredContainer } = renderWithQuery(
      <VerificationBadge
        badges={{
          identity_verified: true,
          identity_expires_at: "2020-01-01T00:00:00Z",
          professional_verified: false,
          professional_pathway: null,
        }}
      />,
    );
    expect(expiredContainer.innerHTML).toBe("");
    expect(isVerificationExpired("2020-01-01T00:00:00Z")).toBe(true);
    expect(isVerificationExpired("2099-01-01T00:00:00Z")).toBe(false);

    renderWithQuery(<VerificationBadge businessVerified businessName="Kora Solar" showLabel />);
    expect(screen.getByText("Verified Business")).toBeTruthy();
  });

  it("blocks reserved official handles and fake verification symbols in display names", () => {
    expect(detectImpersonationRisk("ping_official", "Ping Official").risky).toBe(true);
    expect(detectImpersonationRisk("dot_support", "Support Team").risky).toBe(true);
    expect(detectImpersonationRisk("ada_dev", "Ada ✓").risky).toBe(true);
    expect(detectImpersonationRisk("ada_dev", "Ada (Verified Account)").risky).toBe(true);
    expect(detectImpersonationRisk("ada_builds", "Ada Okafor").risky).toBe(false);
    expect(detectImpersonationRisk("kora_solar", "Kora Solar Engineering").risky).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. DOT MEMBERSHIP & SUBSCRIPTIONS (SECTION 3)                              */
/* -------------------------------------------------------------------------- */
describe("Configurable DOT Memberships & Entitlements", () => {
  it("defines configurable Free, Plus, Pro, and Business plans with separated benefits", () => {
    expect(FALLBACK_MEMBERSHIP_PLANS.map((p) => p.slug)).toEqual([
      "free",
      "plus",
      "pro",
      "business",
    ]);
    const pro = FALLBACK_MEMBERSHIP_PLANS.find((p) => p.slug === "pro")!;
    expect(pro.dot_price).toBeGreaterThan(0);
    expect(pro.duration_days).toBeGreaterThan(0);
    expect(pro.benefits.scheduling).toBe(true);
    expect(pro.benefits.analytics_days).toBeGreaterThanOrEqual(30);
  });

  it("generates unique idempotency keys and accurately evaluates active vs expired entitlements", () => {
    const k1 = generateSubscriptionIdempotencyKey("user-12345678", "pro");
    const k2 = generateSubscriptionIdempotencyKey("user-12345678", "pro");
    expect(k1).not.toBe(k2);
    expect(k1.startsWith("sub_pro_user-123")).toBe(true);

    const activeEnt: SubscriptionEntitlement = {
      user_id: "user-1",
      plan_slug: "pro",
      status: "active",
      auto_renew: false,
      started_at: "2026-01-01T00:00:00Z",
      expires_at: "2099-01-01T00:00:00Z",
      cancelled_at: null,
      entitlements: { scheduling: true, max_profile_links: 15, enhanced_business: false },
      updated_at: "2026-01-01T00:00:00Z",
    };
    expect(isEntitlementActive(activeEnt)).toBe(true);
    expect(hasMembershipBenefit(activeEnt, "scheduling")).toBe(true);
    expect(hasMembershipBenefit(activeEnt, "enhanced_business")).toBe(false);

    const cancelledStillValid: SubscriptionEntitlement = {
      ...activeEnt,
      status: "cancelled",
      cancelled_at: "2026-01-10T00:00:00Z",
    };
    expect(isEntitlementActive(cancelledStillValid)).toBe(true);

    const expiredEnt: SubscriptionEntitlement = {
      ...activeEnt,
      expires_at: "2020-01-01T00:00:00Z",
    };
    expect(isEntitlementActive(expiredEnt)).toBe(false);
    expect(hasMembershipBenefit(expiredEnt, "scheduling")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. PING & MOMENT BOOSTING (SECTION 4)                                      */
/* -------------------------------------------------------------------------- */
describe("Ping & Moment Boosting pricing, eligibility & honest telemetry", () => {
  it("computes deterministic DOT pricing and unique boost idempotency keys", () => {
    expect(calculateBoostDotPrice(6, "followers_and_similar")).toBe(20);
    expect(calculateBoostDotPrice(24, "everyone")).toBe(60);
    expect(calculateBoostDotPrice(72, "regional")).toBeGreaterThan(
      calculateBoostDotPrice(24, "everyone"),
    );
    const b1 = generateBoostIdempotencyKey("user-1", "ping", "ping-11112222");
    const b2 = generateBoostIdempotencyKey("user-1", "ping", "ping-11112222");
    expect(b1).not.toBe(b2);
  });

  it("enforces Moment remaining lifetime and public audience eligibility rules", () => {
    const nowMs = Date.parse("2026-06-01T12:00:00Z");

    // Close Circle Moment must be rejected
    expect(
      validateMomentBoostEligibility({
        audience: "close_circle",
        expiresAt: "2026-06-02T12:00:00Z",
        durationHours: 6,
        nowMs,
      }).eligible,
    ).toBe(false);

    // Public Moment expiring in 4h cannot run a 6h campaign
    const tooShort = validateMomentBoostEligibility({
      audience: "public",
      expiresAt: "2026-06-01T16:00:00Z",
      durationHours: 6,
      nowMs,
    });
    expect(tooShort.eligible).toBe(false);
    expect(tooShort.reason).toMatch(/shorter than the selected 6h/i);

    // Public Moment with 18h left CAN run a 12h campaign
    const validMoment = validateMomentBoostEligibility({
      audience: "public",
      expiresAt: "2026-06-02T06:00:00Z",
      durationHours: 12,
      nowMs,
    });
    expect(validMoment.eligible).toBe(true);
    expect(validMoment.remainingHours).toBe(18);
  });

  it("never fabricates delivery estimates without sufficient completed campaign history", () => {
    const noData = estimateBoostDelivery([]);
    expect(noData.hasReliableData).toBe(false);
    expect(noData.disclaimer).toMatch(/never fabricates/i);

    const makeCompleted = (id: string, impressions: number): BoostCampaign => ({
      id,
      user_id: "u1",
      content_type: "ping",
      content_id: `p-${id}`,
      status: "completed",
      duration_hours: 24,
      audience: "everyone",
      target_interests: [],
      target_regions: ["GLOBAL"],
      dot_cost: 60,
      idempotency_key: `k-${id}`,
      receipt_number: `BST-${id}`,
      reach_count: 50,
      impressions_count: impressions,
      clicks_count: 10,
      engagement_count: 5,
      starts_at: "2026-01-01T00:00:00Z",
      ends_at: "2026-01-02T00:00:00Z",
      moderation_note: "",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    });

    const withHistory = estimateBoostDelivery([
      makeCompleted("1", 240),
      makeCompleted("2", 480),
      makeCompleted("3", 360),
    ]);
    expect(withHistory.hasReliableData).toBe(true);
    expect(withHistory.label).toContain("observed impressions/hr");
    expect(withHistory.disclaimer).toMatch(/not guaranteed/i);
  });

  it("renders clearly labeled Promoted badge with report modal", async () => {
    renderWithQuery(<PromotedBadge campaignId="camp-123" />);
    const badge = screen.getByTestId("promoted-content-badge");
    expect(badge.textContent).toMatch(/Promoted/i);
    fireEvent.click(badge);
    await waitFor(() => {
      expect(screen.getByText(/About This Promoted Post/i)).toBeTruthy();
    });
  });
});

/* -------------------------------------------------------------------------- */
/* 5. ADVANCED CHAT & CASCADING PROFILE PANEL (SECTIONS 5 & 6)                */
/* -------------------------------------------------------------------------- */
describe("Advanced Chat assets, Recent Emojis & Cascading Profile Panel", () => {
  it("extracts shared media, files, and deduplicated HTTPS links from chat messages", () => {
    const assets = extractSharedConversationAssets([
      {
        id: "m1",
        conversation_id: "c1",
        sender_id: "u1",
        content: "Check https://ping.africa/docs and https://ping.africa/docs",
        created_at: "2026-05-01T10:00:00Z",
        updated_at: "2026-05-01T10:00:00Z",
        deleted_at: null,
        status: "sent",
        media_url: null,
        media_type: null,
      },
      {
        id: "m2",
        conversation_id: "c1",
        sender_id: "u2",
        content: "",
        created_at: "2026-05-01T10:01:00Z",
        updated_at: "2026-05-01T10:01:00Z",
        deleted_at: null,
        status: "sent",
        media_url: "https://cdn.ping.africa/photo.png",
        media_type: "image",
      },
      {
        id: "m3",
        conversation_id: "c1",
        sender_id: "u2",
        content: "voice-memo.ogg",
        created_at: "2026-05-01T10:02:00Z",
        updated_at: "2026-05-01T10:02:00Z",
        deleted_at: null,
        status: "sent",
        media_url: "https://cdn.ping.africa/voice-memo.ogg",
        media_type: "audio",
      },
    ]);

    expect(assets.media).toHaveLength(1);
    expect(assets.files).toHaveLength(1);
    expect(assets.links).toHaveLength(1);
    expect(assets.links[0]?.host).toBe("ping.africa");
  });

  it("persists deduplicated recent emojis in localStorage", () => {
    recordRecentEmoji("🔥");
    recordRecentEmoji("🚀");
    recordRecentEmoji("🔥");
    const recents = readRecentEmojis();
    expect(recents[0]).toBe("🔥");
    expect(recents[1]).toBe("🚀");
    expect(recents.filter((e) => e === "🔥")).toHaveLength(1);
  });

  it("renders reusable CascadingProfilePanel with profile details, shared tabs, and safety controls", () => {
    const onClose = vi.fn();
    renderWithQuery(
      <CascadingProfilePanel
        profile={{
          id: "peer-999",
          username: "chidi_ops",
          display_name: "Chidi Mensah",
          avatar_url: null,
          bio: "Coordinating solar supply chains in .africa",
        }}
        messages={[
          {
            id: "msg-1",
            conversation_id: "conv-1",
            sender_id: "peer-999",
            content: "Deck at https://kora.energy/deck",
            created_at: "2026-05-01T12:00:00Z",
            updated_at: "2026-05-01T12:00:00Z",
            deleted_at: null,
            status: "sent",
            media_url: null,
            media_type: null,
          },
        ]}
        onClose={onClose}
        onToggleChatMute={vi.fn()}
      />,
    );

    expect(screen.getByTestId("cascading-profile-panel")).toBeTruthy();
    expect(screen.getByText("Chidi Mensah")).toBeTruthy();
    expect(screen.getByText("@chidi_ops")).toBeTruthy();
    expect(screen.getByText(/Open Full Profile/i)).toBeTruthy();
    expect(screen.getByText(/Mute conversation/i)).toBeTruthy();
    expect(screen.getByText(/Block @chidi_ops/i)).toBeTruthy();
    expect(screen.getByText(/Report @chidi_ops/i)).toBeTruthy();

    // Switch to Shared Links tab
    fireEvent.click(screen.getByRole("button", { name: /Links/i }));
    expect(screen.getByText("kora.energy")).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* 6. DOT TAG SYSTEM & LEGACY HASHTAG COMPATIBILITY (SECTION 7)               */
/* -------------------------------------------------------------------------- */
describe("DOT Tag extraction, validation, tokenization & backwards compatibility", () => {
  it("extracts valid .dotTags while ignoring URLs, decimals, emails, and file extensions", () => {
    const text =
      "Shipping v2.5 of our platform in .africa .startups .technology! See https://ping.com/deck.pdf or email ada@ping.africa and photo.png — legacy #business still works.";

    expect(extractDotTags(text)).toEqual(["africa", "startups", "technology"]);
    expect(extractAllDiscoveryTags(text)).toEqual(["africa", "startups", "technology", "business"]);
  });

  it("validates DOT Tags and blocks abusive or reserved tags", () => {
    expect(validateDotTag(".Africa").valid).toBe(true);
    expect(validateDotTag(".Africa").slug).toBe("africa");
    expect(validateDotTag(".a").valid).toBe(false);
    expect(validateDotTag(".scam").valid).toBe(false);
    expect(validateDotTag(".admin").valid).toBe(false);
  });

  it("detects active DOT Tag autocomplete query at cursor without false positives on URLs/decimals", () => {
    const text = "Launching in .af";
    expect(detectActiveDotTagQuery(text, text.length)).toEqual({
      query: "af",
      startIndex: 13,
      endIndex: 16,
    });
    const urlText = "Visit https://ping.af";
    expect(detectActiveDotTagQuery(urlText, urlText.length)).toBeNull();
    const decimalText = "Version 2.5";
    expect(detectActiveDotTagQuery(decimalText, decimalText.length)).toBeNull();
  });

  it("tokenizes rich text into dot_tag, hashtag, mention, and preserves URLs verbatim", () => {
    const tokens = tokenizeRichText(
      "Hey @ada check https://ping.africa/app for .trending and legacy #fyp",
    );
    expect(tokens.some((t) => t.type === "mention" && t.username === "ada")).toBe(true);
    expect(tokens.some((t) => t.type === "dot_tag" && t.tag === "trending")).toBe(true);
    expect(tokens.some((t) => t.type === "hashtag" && t.tag === "fyp")).toBe(true);
    // URL must NOT be broken into a .africa DOT Tag
    expect(tokens.some((t) => t.type === "dot_tag" && t.tag === "africa")).toBe(false);
    expect(
      tokens.some((t) => t.type === "text" && t.value.includes("https://ping.africa/app")),
    ).toBe(true);
  });

  it("computes tag analytics across both native .dotTags and legacy #hashtags", () => {
    const analytics = computeDotTagAnalytics("africa", [
      {
        id: "1",
        user_id: "u1",
        category: "progress",
        content: "Building energy grids in .africa",
        likes: [{ count: 5 }],
        replies: [{ count: 2 }],
      } as any,
      {
        id: "2",
        user_id: "u2",
        category: "update",
        content: "Legacy post with #africa tag",
        likes: [{ count: 3 }],
        replies: [{ count: 1 }],
      } as any,
      {
        id: "3",
        user_id: "u3",
        category: "update",
        content: "Unrelated .music update",
        likes: [{ count: 9 }],
        replies: [{ count: 4 }],
      } as any,
    ]);

    expect(analytics.postCount).toBe(2);
    expect(analytics.totalLikes).toBe(8);
    expect(analytics.totalReplies).toBe(3);
    expect(analytics.uniqueAuthors).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* 7. CURATED THEMES, APPEARANCE CONTROLS & DESIGN SYSTEM (SECTIONS 8–10)     */
/* -------------------------------------------------------------------------- */
describe("Curated Themes, Appearance Settings & Reusable State Views", () => {
  it("sanitizes appearance preferences safely with strict allowlists", () => {
    const clean = sanitizeAppearancePreferences({
      theme: "dark",
      preset: "midnight",
      accent: "gold",
      reducedMotion: true,
      mediaAutoplay: "off",
      textScale: "large",
    });
    expect(clean).toEqual({
      theme: "dark",
      preset: "midnight",
      accent: "gold",
      reducedMotion: true,
      mediaAutoplay: "off",
      textScale: "large",
    });

    const fallback = sanitizeAppearancePreferences({
      theme: "neon-invalid",
      preset: "rainbow",
      accent: "red",
      mediaAutoplay: "invalid",
      textScale: "giant",
    });
    expect(fallback).toEqual(DEFAULT_APPEARANCE);
  });

  it("renders AppearanceSettings with Obsidian, Midnight, Emerald, Light & System previews and persists changes", async () => {
    renderWithQuery(
      <ThemeProvider>
        <AppearanceSettings />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("theme-preset-obsidian")).toBeTruthy();
    expect(screen.getByTestId("theme-preset-midnight")).toBeTruthy();
    expect(screen.getByTestId("theme-preset-emerald")).toBeTruthy();
    expect(screen.getByTestId("theme-preset-light")).toBeTruthy();
    expect(screen.getByTestId("theme-preset-system")).toBeTruthy();

    fireEvent.click(screen.getByTestId("theme-preset-midnight"));
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme-preset")).toBe("midnight");
    });

    fireEvent.click(screen.getByTestId("accent-option-gold"));
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-accent")).toBe("gold");
    });

    fireEvent.click(screen.getByTestId("reduced-motion-switch"));
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-reduced-motion")).toBe("true");
    });

    fireEvent.click(screen.getByTestId("text-scale-large"));
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-text-scale")).toBe("large");
    });
  });

  it("renders canonical EmptyStateCard and LoadingSkeletonStack components cleanly", () => {
    render(
      <div>
        <EmptyStateCard
          icon={<span aria-hidden="true">📣</span>}
          title="No campaigns yet"
          description="Boost a Ping to track real performance metrics."
        />
        <LoadingSkeletonStack rows={2} />
      </div>,
    );
    expect(screen.getByText("No campaigns yet")).toBeTruthy();
    expect(screen.getByRole("status", { name: /Loading content/i })).toBeTruthy();
  });
});
