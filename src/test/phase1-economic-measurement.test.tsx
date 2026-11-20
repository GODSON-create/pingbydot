import fs from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, tableMock, authState, adminAccessState, navigateMock } = vi.hoisted(() => ({
  rpcMock: vi.fn<(...args: any[]) => Promise<{ data: any; error: any }>>(async () => ({
    data: "event-uuid-1",
    error: null,
  })),
  tableMock: vi.fn(),
  authState: {
    user: { id: "user-a-uuid", email: "alice@example.com" } as null | {
      id: string;
      email?: string;
    },
    profile: {
      id: "user-a-uuid",
      username: "alice",
      display_name: "Alice Wonder",
      bio: "",
      avatar_url: null,
      created_at: "2026-01-01T00:00:00Z",
    },
    ready: true,
    profileLoading: false,
    sessionExpired: false,
    clearSessionExpired: vi.fn(),
    refreshProfile: vi.fn(),
  },
  adminAccessState: {
    isAdmin: false,
    adminReadinessData: {
      days: 30,
      acquisition: { accounts_total: 10, accounts_window: 3 },
      activation: { onboarding_completed: 2, profile_completed: 2, first_meaningful_sessions: 2 },
      retention: { multi_day_active_actors: 1 },
      engagement: {
        pings_published: 5,
        connections_created: 4,
        meaningful_conversations: 1,
        communities_joined: 2,
      },
      referrals: { shares_recorded: 3 },
      monetization: {
        business_leads: 2,
        dot_credits_earned: 100,
        dot_credits_redeemed: 0,
        dot_credit_upgrades: 0,
      },
      verified_outcomes: {
        settled_transactions: 0,
        settled_gross_amount_minor: 0,
        dot_excluded_from_cash: true,
      },
      segments: { creator: 2, business: 1 },
    },
  },
  navigateMock: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    onClick,
    className,
    ...rest
  }: {
    children?: ReactNode;
    to?: string;
    onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
    className?: string;
    [key: string]: unknown;
  }) => {
    const clean = { ...rest };
    delete clean["params"];
    delete clean["search"];
    return (
      <a
        href={typeof to === "string" ? to : "#"}
        onClick={(e) => {
          e.preventDefault();
          onClick?.(e);
        }}
        className={className}
        {...clean}
      >
        {children}
      </a>
    );
  },
  useNavigate: () => navigateMock,
  useHydrated: () => true,
}));

vi.mock("@tanstack/react-start", () => {
  const buildValidator = (schema?: any) => ({
    ...createChain(),
    handler: (fn: (ctx: any) => unknown) => (input?: any) => {
      const parsed = schema
        ? schema.parse(input?.data ?? input ?? {})
        : (input?.data ?? input ?? {});
      return fn({
        data: parsed,
        context: {
          userId: authState.user?.id ?? "",
          supabase: {
            rpc: vi.fn(async (name: string) => {
              if (name === "is_ping_admin") {
                return { data: adminAccessState.isAdmin, error: null };
              }
              return { data: null, error: null };
            }),
          },
        },
      });
    },
  });
  const createChain = (): any => ({
    inputValidator: buildValidator,
    validator: buildValidator,
    middleware: () => createChain(),
    handler: (fn: (ctx: any) => unknown) => (input?: any) =>
      fn({
        data: input?.data ?? input ?? {},
        context: {
          userId: authState.user?.id ?? "",
          supabase: {
            rpc: vi.fn(async (name: string) => {
              if (name === "is_ping_admin") {
                return { data: adminAccessState.isAdmin, error: null };
              }
              return { data: null, error: null };
            }),
          },
        },
      }),
  });
  return {
    createServerFn: () => createChain(),
  };
});

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: {},
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: any[]) => rpcMock(...(args as [])),
    from: (...args: any[]) => tableMock(...(args as [])),
  },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: vi.fn(async (name: string) => {
      if (name === "admin_economic_readiness") {
        return { data: adminAccessState.adminReadinessData, error: null };
      }
      return { data: null, error: null };
    }),
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

import {
  CLIENT_EMITTABLE_EVENT_TYPES,
  DASHBOARD_FOUNDATION_PILLARS,
  ECONOMIC_EVENT_TYPES,
  SERVER_ONLY_OUTCOME_EVENT_TYPES,
  USER_SEGMENTS,
  captureLandingAttribution,
  creatorEconomicSummaryQuery,
  recordFirstMeaningfulSessionOnce,
  sanitizeEventRecord,
  submitValidatedNetworkEvent,
  validateClientEventPayload,
} from "@/lib/economic-events";
import { clearSessionRestoredFlag } from "@/lib/telemetry";
import { getAdminEconomicReadiness } from "@/lib/admin.functions";
import { AriseCallout } from "@/components/AriseCallout";
import { PingCard } from "@/components/ping/PingCard";
import { PingShareActions } from "@/components/ping/ShareCardDialog";
import { PublicConnections } from "@/components/connections/PublicConnections";

const ROOT = path.resolve(__dirname, "../..");

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("Phase 1 Workstream 4: Ping Economic Activity Measurement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/");
    authState.user = { id: "user-a-uuid", email: "alice@example.com" };
    adminAccessState.isAdmin = false;
    rpcMock.mockResolvedValue({ data: "event-uuid-1", error: null });
    tableMock.mockImplementation(() => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        then: (resolve: (v: any) => void) => resolve({ data: [], error: null }),
      };
      return chain;
    });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => undefined) },
      configurable: true,
    });
  });

  describe("1. Migration 0025 schema, indexes, RLS, privacy & separation rules", () => {
    const migrationPath = path.join(
      ROOT,
      "drizzle/migrations/0025_economic_activity_measurement.sql",
    );
    const journalPath = path.join(ROOT, "drizzle/migrations/meta/_journal.json");

    it("registers migration 0025 cleanly and avoids open USING (true) policies", () => {
      expect(fs.existsSync(migrationPath)).toBe(true);
      const sql = fs.readFileSync(migrationPath, "utf8");
      const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
        entries: Array<{ idx: number; tag: string }>;
      };
      const entry = journal.entries.find((e) => e.idx === 25);
      expect(entry?.tag).toBe("0025_economic_activity_measurement");

      const uncommentedLines = sql.split("\n").map((l) => l.replace(/--.*$/, ""));
      for (const line of uncommentedLines) {
        expect(line).not.toMatch(/\bUSING\s*\(\s*true\s*\)/i);
      }
    });

    it("defines RLS, append-only immutability, DOT-vs-cash isolation, and required indexes", () => {
      const sql = fs.readFileSync(migrationPath, "utf8");

      expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.economic_events");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.verified_economic_outcomes");
      expect(sql).toContain("ALTER TABLE public.economic_events ENABLE ROW LEVEL SECURITY;");
      expect(sql).toContain(
        "ALTER TABLE public.verified_economic_outcomes ENABLE ROW LEVEL SECURITY;",
      );

      // Clients only get SELECT via RLS, never INSERT/UPDATE/DELETE directly on tables
      expect(sql).toContain(
        "REVOKE ALL ON public.economic_events FROM PUBLIC, anon, authenticated;",
      );
      expect(sql).toContain("GRANT SELECT ON public.economic_events TO authenticated;");
      expect(sql).toContain(
        "REVOKE ALL ON public.verified_economic_outcomes FROM PUBLIC, anon, authenticated;",
      );
      expect(sql).toContain("GRANT SELECT ON public.verified_economic_outcomes TO authenticated;");

      // Append-only triggers and monetary integrity checks
      expect(sql).toContain("economic_events_immutable");
      expect(sql).toContain("verified_outcomes_guard");
      expect(sql).toContain("upper(currency) <> 'DOT'");
      expect(sql).toContain("economic_events_verified_tx_guard");
      expect(sql).toContain("economic_events_non_revenue_guard");

      // Required indexes
      for (const idx of [
        "economic_events_actor_created_idx",
        "economic_events_type_created_idx",
        "economic_events_category_created_idx",
        "economic_events_subject_type_idx",
        "economic_events_target_idx",
        "economic_events_segments_gin_idx",
        "economic_events_dedupe_uidx",
        "verified_outcomes_beneficiary_idx",
        "verified_outcomes_payer_idx",
        "verified_outcomes_lead_idx",
      ]) {
        expect(sql).toContain(idx);
      }

      // Server-only verified settlement confirmation & readiness RPCs
      expect(sql).toContain("auth.uid() IS NOT NULL OR current_user NOT IN");
      expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.record_verified_economic_outcome");
      expect(sql).toContain(
        "REVOKE ALL ON FUNCTION public.admin_economic_readiness(integer) FROM PUBLIC, anon, authenticated;",
      );
    });

    it("never accesses or stores private message content or external contact handles in trigger functions", () => {
      const sql = fs.readFileSync(migrationPath, "utf8");
      const pmSectionMatch = sql.match(
        /CREATE OR REPLACE FUNCTION public\.trg_private_messages_economic_events[\s\S]*?\$\$;/,
      );
      expect(pmSectionMatch).toBeTruthy();
      const pmBody = pmSectionMatch![0];
      expect(pmBody).not.toMatch(/NEW\.content|NEW\.media_url|p_content/i);

      const extConnMatch = sql.match(
        /CREATE OR REPLACE FUNCTION public\.trg_profile_connections_economic_events[\s\S]*?\$\$;/,
      );
      expect(extConnMatch).toBeTruthy();
      expect(extConnMatch![0]).not.toMatch(/NEW\.handle/i);
    });
  });

  describe("2. Client anti-fabrication, PII scrubbing, attribution & readiness contract", () => {
    it("covers all 13 requested events, 6 user segments, and 7 dashboard foundation pillars", () => {
      expect(USER_SEGMENTS).toEqual([
        "general",
        "creator",
        "business",
        "community",
        "builder",
        "investor",
      ]);
      expect(DASHBOARD_FOUNDATION_PILLARS).toHaveLength(7);
      for (const requiredType of [
        "account_created",
        "onboarding_completed",
        "profile_completed",
        "first_meaningful_session",
        "connection_created",
        "ping_published",
        "ping_shared",
        "meaningful_conversation_started",
        "community_joined",
        "business_lead_generated",
        "transaction_completed",
        "venture_submitted",
        "investor_introduction_completed",
      ] as const) {
        expect(ECONOMIC_EVENT_TYPES).toContain(requiredType);
      }
      expect(CLIENT_EMITTABLE_EVENT_TYPES).toEqual([
        "first_meaningful_session",
        "ping_shared",
        "business_lead_generated",
      ]);
    });

    it("blocks client fabrication of verified revenue, outcomes, credits, or trigger-only events", async () => {
      const forbiddenTypes = [
        ...SERVER_ONLY_OUTCOME_EVENT_TYPES,
        "dot_credit_earned",
        "dot_credit_redeemed",
        "account_created",
        "onboarding_completed",
        "profile_completed",
        "ping_published",
        "community_joined",
        "meaningful_conversation_started",
        "connection_created",
      ];

      for (const eventType of forbiddenTypes) {
        expect(() =>
          validateClientEventPayload({
            eventType,
            metadata: { amount: 5000, currency: "USD" },
          }),
        ).toThrow(/Client cannot emit/i);

        await expect(
          submitValidatedNetworkEvent({ eventType, metadata: { revenue: 100 } }),
        ).rejects.toThrow(/Client cannot emit/i);
      }

      expect(rpcMock).not.toHaveBeenCalled();
    });

    it("strips fabricated financial keys, private message bodies, emails, tokens, and handles", () => {
      const cleaned = sanitizeEventRecord({
        ping_category: "offer",
        channel: "whatsapp",
        amount: 10000,
        amount_minor: 1000000,
        gross_amount_minor: 500,
        net_amount_minor: 450,
        revenue: 9999,
        price: 49,
        currency: "USD",
        verified: true,
        verification_tier: "server_verified",
        settlement_status: "settled",
        content: "Secret DM body",
        message: "Do not store this",
        private_message: "Secret",
        email: "founder@example.com",
        token: "secret-jwt",
        handle: "+447700900123",
        safe_note: "Contact user@example.com cleanly",
      });

      expect(cleaned["ping_category"]).toBe("offer");
      expect(cleaned["channel"]).toBe("whatsapp");
      expect(cleaned["safe_note"]).toBe("Contact [redacted-email] cleanly");
      for (const stripped of [
        "amount",
        "amount_minor",
        "gross_amount_minor",
        "net_amount_minor",
        "revenue",
        "price",
        "currency",
        "verified",
        "verification_tier",
        "settlement_status",
        "content",
        "message",
        "private_message",
        "email",
        "token",
        "handle",
      ]) {
        expect(cleaned).not.toHaveProperty(stripped);
      }
    });

    it("captures clean UTM attribution without auth codes/tokens and emits first_meaningful_session once", () => {
      window.history.replaceState(
        {},
        "",
        "/explore?utm_source=whatsapp&utm_campaign=launch&code=oauth_secret_code&token=abc",
      );
      const attr = captureLandingAttribution();
      expect(attr["utm_source"]).toBe("whatsapp");
      expect(attr["utm_campaign"]).toBe("launch");
      expect(attr["entry_path"]).toBe("/explore");
      expect(attr).not.toHaveProperty("code");
      expect(attr).not.toHaveProperty("token");

      recordFirstMeaningfulSessionOnce("user-a-uuid");
      recordFirstMeaningfulSessionOnce("user-a-uuid");
      expect(rpcMock).toHaveBeenCalledTimes(1);
      expect(rpcMock).toHaveBeenCalledWith(
        "record_network_event",
        expect.objectContaining({
          _event_type: "first_meaningful_session",
          _target_type: "profile",
          _target_id: "user-a-uuid",
        }),
      );

      clearSessionRestoredFlag();
      recordFirstMeaningfulSessionOnce("user-a-uuid");
      expect(rpcMock).toHaveBeenCalledTimes(2);
    });

    it("keeps DOT virtual credits separate from verified cash settlements in creatorEconomicSummaryQuery", async () => {
      rpcMock.mockResolvedValueOnce({
        data: {
          days: 30,
          engagement: {
            pings_published: 4,
            connections_created: 7,
            meaningful_conversations: 2,
            communities_joined: 1,
          },
          referrals: { shares_received: 5, shares_initiated: 2 },
          leads: { leads_received: 3, leads_initiated: 1 },
          dot_credits: {
            is_cash_revenue: false,
            currency: "DOT_CREDIT",
            earned: 80,
            redeemed: 0,
            upgrades_count: 0,
          },
          verified_outcomes: {
            is_cash_revenue: true,
            settled_transactions_count: 0,
            verified_net_amount_minor: 0,
          },
        },
        error: null,
      } as any);

      const q = creatorEconomicSummaryQuery("user-a-uuid", 30);
      const summary = await (q.queryFn as any)();
      expect(summary.migrated).toBe(true);
      expect(summary.dot_credits.is_cash_revenue).toBe(false);
      expect(summary.dot_credits.currency).toBe("DOT_CREDIT");
      expect(summary.dot_credits.earned).toBe(80);
      expect(summary.verified_outcomes.is_cash_revenue).toBe(true);
      expect(summary.verified_outcomes.verified_net_amount_minor).toBe(0);

      // Graceful unmigrated RPC fallback
      rpcMock.mockResolvedValueOnce({
        data: null,
        error: { code: "42883", message: "function does not exist" },
      } as any);
      const fallback = await (q.queryFn as any)();
      expect(fallback.migrated).toBe(false);
      expect(fallback.dot_credits.is_cash_revenue).toBe(false);
      expect(fallback.verified_outcomes.settled_transactions_count).toBe(0);
    });
  });

  describe("3. Instrumented user journeys & server authorization checks", () => {
    const otherOfferPing = {
      id: "11111111-1111-4111-8111-111111111111",
      user_id: "user-b-uuid",
      category: "offer",
      content: "We build fast MVPs for local businesses.",
      image_url: null,
      cta_url: "https://studio.example.com/book",
      cta_label: "Book a discovery call",
      created_at: "2026-03-01T10:00:00Z",
      updated_at: "2026-03-01T10:00:00Z",
      author: {
        id: "user-b-uuid",
        username: "bob",
        display_name: "Bob Studio",
        avatar_url: null,
      },
      likes: [{ count: 3 }],
      replies: [{ count: 1 }],
    };

    it("records non-self Ping CTA & offer DM leads cleanly without recording leads on own Pings", async () => {
      const view = renderWithClient(<PingCard ping={otherOfferPing} />);

      fireEvent.click(screen.getByRole("link", { name: /Book a discovery call/i }));
      await waitFor(() => {
        expect(rpcMock).toHaveBeenCalledWith(
          "record_network_event",
          expect.objectContaining({
            _event_type: "business_lead_generated",
            _target_type: "ping",
            _target_id: otherOfferPing.id,
            _source: "ping_cta",
            _metadata: expect.objectContaining({
              ping_category: "offer",
              cta_host: "studio.example.com",
            }),
          }),
        );
      });

      rpcMock.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "Respond" }));
      await waitFor(() => {
        expect(rpcMock).toHaveBeenCalledWith(
          "record_network_event",
          expect.objectContaining({
            _event_type: "business_lead_generated",
            _source: "ping_direct_reply",
            _target_id: otherOfferPing.id,
          }),
        );
      });
      view.unmount();

      // Own Ping CTA click must NOT inflate self-lead metrics
      rpcMock.mockClear();
      renderWithClient(
        <PingCard
          ping={{
            ...otherOfferPing,
            user_id: "user-a-uuid",
          }}
        />,
      );
      fireEvent.click(screen.getByRole("link", { name: /Book a discovery call/i }));
      await new Promise((r) => setTimeout(r, 20));
      expect(rpcMock).not.toHaveBeenCalledWith("record_network_event", expect.anything());
    });

    it("records Ping shares, ARISE referral clicks, and privacy-safe external contact leads (no handle leaked)", async () => {
      renderWithClient(
        <>
          <PingShareActions ping={otherOfferPing} />
          <AriseCallout compact />
          <PublicConnections
            ownerId="user-b-uuid"
            currentUserId="user-a-uuid"
            connections={[
              {
                platform: "whatsapp",
                handle: "447700900123",
                is_public: true,
                is_primary: true,
              },
            ]}
          />
        </>,
      );

      fireEvent.click(screen.getByRole("button", { name: /Copy link/i }));
      await waitFor(() => {
        expect(rpcMock).toHaveBeenCalledWith(
          "record_network_event",
          expect.objectContaining({
            _event_type: "ping_shared",
            _target_type: "ping",
            _target_id: otherOfferPing.id,
            _metadata: expect.objectContaining({ channel: "copy_link" }),
          }),
        );
      });

      fireEvent.click(screen.getByRole("link", { name: /Visit JoinArise\.cv/i }));
      await waitFor(() => {
        expect(rpcMock).toHaveBeenCalledWith(
          "record_network_event",
          expect.objectContaining({
            _event_type: "business_lead_generated",
            _target_type: "external_url",
            _target_id: "arise",
            _source: "arise_callout",
          }),
        );
      });

      fireEvent.click(screen.getByRole("link", { name: /Open WhatsApp \+447700900123/i }));
      await waitFor(() => {
        const calls = rpcMock.mock.calls.filter(
          (c: unknown[]) =>
            c[0] === "record_network_event" &&
            (c[1] as Record<string, unknown>)?.["_source"] === "profile_contact_click",
        );
        expect(calls).toHaveLength(1);
        const args = (calls[0]?.[1] ?? {}) as Record<string, any>;
        expect(args["_target_type"]).toBe("profile");
        expect(args["_target_id"]).toBe("user-b-uuid");
        expect(args["_metadata"]).toEqual({ platform: "whatsapp" });
        expect(JSON.stringify(args)).not.toContain("447700900123");
      });
    });

    it("gates getAdminEconomicReadiness strictly to verified Ping admins", async () => {
      adminAccessState.isAdmin = false;
      await expect(getAdminEconomicReadiness({ data: { days: 30 } })).rejects.toThrow(
        /Access denied/i,
      );

      adminAccessState.isAdmin = true;
      const summary = await getAdminEconomicReadiness({ data: { days: 30 } });
      expect(summary).toMatchObject({
        days: 30,
        verified_outcomes: {
          settled_transactions: 0,
          dot_excluded_from_cash: true,
        },
        segments: { creator: 2, business: 1 },
      });
    });
  });
});
