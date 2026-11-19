import fs from "node:fs";
import path from "node:path";
import { Suspense, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  rpcMock,
  adminContextRpcMock,
  tableHandlerState,
  authState,
  adminAccessState,
  routerState,
  navigateMock,
} = vi.hoisted(() => ({
  rpcMock: vi.fn<(...args: any[]) => Promise<{ data: any; error: any }>>(async () => ({
    data: null,
    error: null,
  })),
  adminContextRpcMock: vi.fn<(...args: any[]) => Promise<{ data: any; error: any }>>(async () => ({
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
      interests: [],
      participation_pathways: [],
    },
    ready: true,
    profileLoading: false,
    sessionExpired: false,
    clearSessionExpired: vi.fn(),
    refreshProfile: vi.fn(),
  },
  adminAccessState: {
    isAdmin: false,
  },
  routerState: {
    params: { username: "bob" } as Record<string, string>,
    search: {} as Record<string, unknown>,
    location: { pathname: "/upgrades", searchStr: "" },
  },
  navigateMock: vi.fn(),
}));

function makeTableChain(table: string) {
  const chain: Record<string, any> = {
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    in: () => chain,
    is: () => chain,
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
    Link: ({
      children,
      to,
      onClick,
      className,
      search: _s,
      params: _p,
      ...rest
    }: {
      children?: ReactNode;
      to?: string;
      onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
      className?: string;
      search?: unknown;
      params?: unknown;
      [key: string]: unknown;
    }) => (
      <a
        href={typeof to === "string" ? to : "#"}
        onClick={(e) => {
          e.preventDefault();
          onClick?.(e);
        }}
        className={className}
        {...rest}
      >
        {children}
      </a>
    ),
    useNavigate: () => navigateMock,
    useLocation: () => routerState.location,
    useHydrated: () => true,
  };
});

vi.mock("@tanstack/react-start", () => {
  const createChain = (): any => ({
    inputValidator: (schema?: any) => ({
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
              rpc: (...args: any[]) => adminContextRpcMock(...args),
            },
          },
        });
      },
    }),
    middleware: () => createChain(),
    handler: (fn: (ctx: any) => unknown) => (input?: any) =>
      fn({
        data: input?.data ?? input ?? {},
        context: {
          userId: authState.user?.id ?? "",
          supabase: {
            rpc: (...args: any[]) => adminContextRpcMock(...args),
          },
        },
      }),
  });
  return {
    createServerFn: () => createChain(),
    useServerFn: (fn: any) => fn,
  };
});

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: {},
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: any[]) => rpcMock(...(args as [])),
    from: vi.fn((table: string) => makeTableChain(table)),
  },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => makeTableChain(table)),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  },
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => authState,
  markIntentionalSignOut: vi.fn(),
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: "dark", resolvedTheme: "dark", setTheme: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

import { NavOverlayProvider } from "@/lib/nav-overlay";
import { UPGRADE_TIERS } from "@/lib/economy";
import { monetizationCatalogQuery } from "@/lib/monetization";
import {
  formatProfessionalBadgeLabel,
  formatVerificationStatusLabel,
  submitVerificationRequestSchema,
} from "@/lib/verification";
import { reviewVerification } from "@/lib/admin.functions";
import { Route as ProfileRoute } from "@/routes/@{$username}";
import { Route as UpgradesRoute } from "@/routes/_authenticated/upgrades";
import { PingCard } from "@/components/ping/PingCard";

const ROOT = path.resolve(__dirname, "../..");

function renderApp(ui: ReactNode, client?: QueryClient) {
  const qc =
    client ??
    new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  return {
    client: qc,
    ...render(
      <QueryClientProvider client={qc}>
        <NavOverlayProvider>
          <Suspense fallback={<div>Loading...</div>}>{ui}</Suspense>
        </NavOverlayProvider>
      </QueryClientProvider>,
    ),
  };
}

describe("Phase 1 Workstream 5: Optional Verification & Monetization Foundations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { id: "user-a-uuid", email: "alice@example.com" };
    adminAccessState.isAdmin = false;
    routerState.params = { username: "bob" };
    tableHandlerState.handler = () => ({ data: [], error: null, count: 0 });
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "get_public_account_tier") return { data: "free", error: null };
      if (fn === "get_public_verification_badges") {
        return {
          data: {
            identity_verified: false,
            professional_verified: false,
            professional_pathway: null,
          },
          error: null,
        };
      }
      if (fn === "get_monetization_foundation") {
        return { data: null, error: { code: "PGRST202", message: "function not found" } };
      }
      if (fn === "get_my_dot_summary") {
        return {
          data: {
            wallet: {
              user_id: "user-a-uuid",
              balance: 50,
              lifetime_earned: 50,
              lifetime_spent: 0,
              streak_days: 0,
              last_checkin_at: null,
            },
            subscription: {
              user_id: "user-a-uuid",
              tier: "free",
              status: "active",
              billing_cycle: "dot_credits",
              started_at: "2026-01-01T00:00:00Z",
              expires_at: null,
            },
            transactions: [],
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });
    adminContextRpcMock.mockImplementation(async (fn: string) => {
      if (fn === "is_ping_admin") {
        return { data: adminAccessState.isAdmin, error: null };
      }
      return { data: { id: "verif-1", status: "verified" }, error: null };
    });
  });

  describe("1. Migration 0026 SQL security, RLS, non-self-approval & role separation", () => {
    const sqlPath = path.join(
      ROOT,
      "drizzle/migrations/0026_verification_and_monetization_foundations.sql",
    );
    const journalPath = path.join(ROOT, "drizzle/migrations/meta/_journal.json");

    it("registers migration 0026 and defines RLS + indexes without open USING (true) policies", () => {
      expect(fs.existsSync(sqlPath)).toBe(true);
      const sql = fs.readFileSync(sqlPath, "utf8");
      const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
        entries: Array<{ idx: number; tag: string }>;
      };
      expect(journal.entries.find((e) => e.idx === 26)?.tag).toBe(
        "0026_verification_and_monetization_foundations",
      );

      for (const line of sql.split("\n")) {
        expect(line.replace(/--.*$/, "")).not.toMatch(/\bUSING\s*\(\s*true\s*\)/i);
      }

      expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.account_verifications");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.verification_audit");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.monetization_offerings");
      expect(sql).toContain("ALTER TABLE public.account_verifications ENABLE ROW LEVEL SECURITY;");
      expect(sql).toContain("ALTER TABLE public.verification_audit ENABLE ROW LEVEL SECURITY;");
      expect(sql).toContain("ALTER TABLE public.monetization_offerings ENABLE ROW LEVEL SECURITY;");
      expect(sql).toContain("account_verifications_status_created_idx");
      expect(sql).toContain("account_verifications_user_status_idx");
      expect(sql).toContain("verification_audit_user_created_idx");
    });

    it("prevents client writes, self-approval, and compulsory/live real-money payments at SQL level", () => {
      const sql = fs.readFileSync(sqlPath, "utf8");

      expect(sql).toContain(
        "REVOKE ALL ON public.account_verifications FROM PUBLIC, anon, authenticated;",
      );
      expect(sql).toContain("GRANT SELECT ON public.account_verifications TO authenticated;");
      expect(sql).toContain("Users cannot approve their own verification");
      expect(sql).toContain(
        "Administrators cannot approve or review their own verification request",
      );
      expect(sql).toContain(
        "is_compulsory boolean NOT NULL DEFAULT false CHECK (NOT is_compulsory)",
      );
      expect(sql).toContain(
        "live_payment_enabled boolean NOT NULL DEFAULT false CHECK (NOT live_payment_enabled)",
      );
      expect(sql).toContain("UNIQUE (user_id, verification_domain)");

      // Does not grant user_roles or modify dot_wallets / dot_transactions
      expect(sql).not.toContain("INSERT INTO public.user_roles");
      expect(sql).not.toContain("DROP TABLE public.dot_wallets");
    });
  });

  describe("2. Neutral treatment of unverified users & badge vs plan vs role separation", () => {
    it("does not display fake verified badges or derogatory unverified warnings on ordinary profiles and Ping cards", async () => {
      const bobProfile = {
        id: "user-b-uuid",
        username: "bob",
        display_name: "Bob Everyday",
        bio: "Sharing regular updates on Ping.",
        avatar_url: null,
        created_at: "2026-01-01T00:00:00Z",
        participation_pathways: ["investor", "general"],
      };

      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      qc.setQueryData(["profile", "bob"], {
        profile: bobProfile,
        pings: [],
        connections: [],
      });

      const ProfilePage = ProfileRoute.options.component as React.ComponentType;
      const profileView = renderApp(<ProfilePage />, qc);

      await waitFor(() => {
        expect(screen.getByText("Bob Everyday")).toBeInTheDocument();
      });

      // Selecting 'investor' pathway or having 'free' tier must NOT render Verified badges or derogatory labels
      expect(screen.queryByLabelText("Verified PING profile")).not.toBeInTheDocument();
      expect(screen.queryByText(/Verified Institution/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Verified Investor/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/fraudulent|inferior|untrusted/i)).not.toBeInTheDocument();
      profileView.unmount();

      renderApp(
        <PingCard
          ping={{
            id: "ping-1",
            user_id: "user-b-uuid",
            category: "update",
            content: "Ordinary Ping from a regular user.",
            image_url: null,
            cta_url: null,
            cta_label: null,
            created_at: "2026-03-01T00:00:00Z",
            updated_at: "2026-03-01T00:00:00Z",
            author: bobProfile,
            likes: [{ count: 0 }],
            replies: [{ count: 0 }],
          }}
        />,
      );
      expect(screen.queryByLabelText("Verified builder")).not.toBeInTheDocument();
    });

    it("separates DOT Organization Plan tier from server-verified Identity & Professional credentials", async () => {
      rpcMock.mockImplementation(async (fn: string) => {
        if (fn === "get_public_account_tier") return { data: "institution", error: null };
        if (fn === "get_public_verification_badges") {
          return {
            data: {
              identity_verified: true,
              professional_verified: true,
              professional_pathway: "investor",
            },
            error: null,
          };
        }
        return { data: null, error: null };
      });

      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      qc.setQueryData(["profile", "bob"], {
        profile: {
          id: "user-b-uuid",
          username: "bob",
          display_name: "Bob Capital",
          bio: "",
          avatar_url: null,
          created_at: "2026-01-01T00:00:00Z",
        },
        pings: [],
        connections: [],
      });

      const ProfilePage = ProfileRoute.options.component as React.ComponentType;
      renderApp(<ProfilePage />, qc);

      await waitFor(() => {
        expect(screen.getByText("Verified Identity")).toBeInTheDocument();
        expect(screen.getByText("Verified Investor")).toBeInTheDocument();
        expect(screen.getByText("Organization Plan")).toBeInTheDocument();
      });

      // Spending DOT on 'institution' plan alone never displays 'Verified Institution'
      expect(screen.queryByText("Verified Institution")).not.toBeInTheDocument();
    });
  });

  describe("3. Optional verification validation, submission & admin-only review authorization", () => {
    it("enforces schema separation between identity and professional pathways + HTTPS evidence", () => {
      expect(
        submitVerificationRequestSchema.safeParse({
          verificationDomain: "identity",
          pathwayType: "investor",
          organizationName: "",
          evidenceUrl: "",
          submissionNote: "",
        }).success,
      ).toBe(false);

      expect(
        submitVerificationRequestSchema.safeParse({
          verificationDomain: "professional",
          pathwayType: "business",
          organizationName: "Horizon Studio",
          evidenceUrl: "http://insecure.example.com",
          submissionNote: "Official site",
        }).success,
      ).toBe(false);

      expect(
        submitVerificationRequestSchema.safeParse({
          verificationDomain: "professional",
          pathwayType: "business",
          organizationName: "Horizon Studio LLC",
          evidenceUrl: "https://horizon.example.com",
          submissionNote: "Registered product studio",
        }).success,
      ).toBe(true);

      expect(formatVerificationStatusLabel("unverified")).toBe("Not requested (optional)");
      expect(formatProfessionalBadgeLabel("creator")).toBe("Verified Creator");
      expect(formatProfessionalBadgeLabel("community_org")).toBe("Verified Organization");
    });

    it("renders optional verification pathways and monetization foundations on /upgrades without live cash checkout", async () => {
      rpcMock.mockImplementation(async (fn: string) => {
        if (fn === "get_my_dot_summary") {
          return {
            data: {
              wallet: {
                user_id: "user-a-uuid",
                balance: 50,
                lifetime_earned: 50,
                lifetime_spent: 0,
                streak_days: 0,
                last_checkin_at: null,
              },
              subscription: {
                user_id: "user-a-uuid",
                tier: "free",
                status: "active",
                billing_cycle: "dot_credits",
                started_at: "2026-01-01T00:00:00Z",
                expires_at: null,
              },
              transactions: [],
            },
            error: null,
          };
        }
        if (fn === "submit_verification_request") {
          return { data: { id: "verif-new", status: "pending" }, error: null };
        }
        if (fn === "get_monetization_foundation") {
          return {
            data: {
              verification_optional: true,
              dot_credits_are_cash: false,
              live_fiat_payments_enabled: false,
              offerings: [],
            },
            error: null,
          };
        }
        return { data: null, error: null };
      });

      const UpgradesPage = UpgradesRoute.options.component as React.ComponentType;
      renderApp(<UpgradesPage />);

      await waitFor(() => {
        expect(screen.getByText(/Voluntary · Never Required/i)).toBeInTheDocument();
        expect(screen.getByText(/Cash Checkout Not Active Yet/i)).toBeInTheDocument();
        expect(screen.getByText(/Core Ping Network Access/i)).toBeInTheDocument();
      });

      // Switch to Professional pathway, select Creator, and submit optional review
      fireEvent.click(screen.getByRole("button", { name: /Professional \/ Account-Type/i }));
      fireEvent.change(screen.getByLabelText(/Account-Type Pathway/i), {
        target: { value: "creator" },
      });
      fireEvent.change(screen.getByLabelText(/Official Website or Public Profile/i), {
        target: { value: "https://alice.example.com" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Request Optional Review" }));

      await waitFor(() => {
        expect(rpcMock).toHaveBeenCalledWith("submit_verification_request", {
          _verification_domain: "professional",
          _pathway_type: "creator",
          _organization_name: "",
          _evidence_url: "https://alice.example.com",
          _submission_note: "",
        });
      });

      // Confirm DOT tier definitions stay non-cash and separate from verification badges
      expect(UPGRADE_TIERS.find((t) => t.id === "institution")?.badge).toBe("Org Plan");
      const monState = await (monetizationCatalogQuery().queryFn as any)();
      expect(monState.dot_credits_are_cash).toBe(false);
      expect(monState.live_fiat_payments_enabled).toBe(false);
    });

    it("gates reviewVerification to verified admins and calls caller-scoped RPC so self-approval stays blocked in Postgres", async () => {
      const targetReqId = "22222222-2222-4222-8222-222222222222";

      adminAccessState.isAdmin = false;
      await expect(
        reviewVerification({ data: { id: targetReqId, status: "verified", reviewerNote: "" } }),
      ).rejects.toThrow(/Access denied/i);
      expect(adminContextRpcMock).not.toHaveBeenCalledWith(
        "review_verification_request",
        expect.anything(),
      );

      adminAccessState.isAdmin = true;
      await reviewVerification({
        data: { id: targetReqId, status: "verified", reviewerNote: "Verified registry link" },
      });
      expect(adminContextRpcMock).toHaveBeenCalledWith("review_verification_request", {
        _verification_id: targetReqId,
        _status: "verified",
        _reviewer_note: "Verified registry link",
      });
    });
  });
});
