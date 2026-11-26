import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLIPS_SCHEMA_MIGRATION_HINT,
  MAX_CLIP_DURATION_SEC,
  validateMomentToClipConversion,
  type PingClip,
} from "@/lib/clips";

const ROOT = path.resolve(__dirname, "../..");
const readRel = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const {
  mockNavigate,
  mockAuthState,
  mockClipsRows,
  mockSchemaMissing,
  mockInsertedPayloads,
  mockDeletedClipIds,
  mockUpdatedVisibility,
  mockRpc,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockAuthState: {
    user: { id: "creator-1", email: "creator@ping.test" } as { id: string; email: string } | null,
    profile: {
      id: "creator-1",
      username: "ada",
      display_name: "Ada Builder",
      avatar_url: null,
    } as { id: string; username: string; display_name: string; avatar_url: string | null } | null,
    ready: true,
    loading: false,
  },
  mockClipsRows: {
    value: [] as PingClip[],
  },
  mockSchemaMissing: {
    value: false,
  },
  mockInsertedPayloads: [] as Array<Record<string, unknown>>,
  mockDeletedClipIds: [] as string[],
  mockUpdatedVisibility: [] as Array<{ id: string; visibility: string }>,
  mockRpc: vi.fn().mockResolvedValue({ data: null, error: null }),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    createFileRoute: () => (opts: Record<string, unknown>) => ({
      options: opts,
      useSearch: () => ({}),
      useLoaderData: () => [],
    }),
    Link: ({
      to,
      params,
      search,
      children,
      className,
    }: {
      to?: string;
      params?: Record<string, string>;
      search?: Record<string, string>;
      children?: ReactNode;
      className?: string;
    }) => {
      const usernameParam = params?.["username"];
      const slugParam = params?.["slug"];
      const resolved =
        typeof to === "string" && usernameParam
          ? to.replace("{$username}", usernameParam)
          : typeof to === "string" && slugParam
            ? to.replace("$slug", slugParam)
            : (to ?? "#");
      const qs =
        search && Object.keys(search).length > 0
          ? `?${new URLSearchParams(search).toString()}`
          : "";
      return (
        <a href={`${resolved}${qs}`} className={className}>
          {children}
        </a>
      );
    },
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: "/clips", searchStr: "", href: "/clips" }),
  };
});

vi.mock("@/lib/auth", () => ({
  useAuth: () => mockAuthState,
}));

vi.mock("@/lib/ensure-profile", () => ({
  ensureClientProfileRow: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/moments", () => ({
  userActiveMomentsQuery: () => ({
    queryKey: ["user-active-moments-test"],
    queryFn: async () => [],
  }),
}));

vi.mock("@/lib/messages", () => ({
  useGetOrCreateDirectConversation: () => ({
    mutateAsync: vi.fn().mockResolvedValue("conv-1"),
    isPending: false,
  }),
}));

vi.mock("@/components/badges/AccountStatusBadges", () => ({
  AccountStatusBadges: () => null,
}));

vi.mock("@/components/sharing/UniversalShareDialog", () => ({
  UniversalShareDialog: () => null,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const schemaMissingError = {
    code: "PGRST205",
    message: "Could not find the table 'public.ping_clips' in the schema cache",
  };

  return {
    supabase: {
      rpc: mockRpc,
      storage: {
        from: () => ({
          createSignedUrl: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      },
      from: (table: string) => {
        if (table === "ping_clips") {
          const selectChain: Record<string, any> = {
            is: () => selectChain,
            eq: () => selectChain,
            contains: () => selectChain,
            order: () => selectChain,
            limit: async () =>
              mockSchemaMissing.value
                ? { data: null, error: schemaMissingError }
                : { data: mockClipsRows.value, error: null },
          };

          return {
            select: () => selectChain,
            insert: (payload: Record<string, unknown>) => ({
              select: () => ({
                single: async () => {
                  if (mockSchemaMissing.value) {
                    return { data: null, error: schemaMissingError };
                  }
                  mockInsertedPayloads.push(payload);
                  const created: PingClip = {
                    id: `clip-new-${mockInsertedPayloads.length}`,
                    creator_id: String(payload["creator_id"]),
                    video_url: String(payload["video_url"]),
                    poster_url: (payload["poster_url"] as string | null) ?? null,
                    caption: String(payload["caption"] ?? ""),
                    captions_text: (payload["captions_text"] as string | null) ?? null,
                    duration_sec: (payload["duration_sec"] as number | null) ?? null,
                    visibility: (payload["visibility"] as PingClip["visibility"]) ?? "public",
                    dot_tags: (payload["dot_tags"] as string[]) ?? [],
                    source_moment_id: null,
                    linked_ping_id: null,
                    processing_status: "ready",
                    views_count: 0,
                    likes_count: 0,
                    replies_count: 0,
                    shares_count: 0,
                    saves_count: 0,
                    hidden_at: null,
                    created_at: new Date().toISOString(),
                    creator: mockAuthState.profile,
                  };
                  mockClipsRows.value = [created, ...mockClipsRows.value];
                  return { data: created, error: null };
                },
              }),
            }),
            update: (patch: { visibility: string }) => ({
              eq: (_col1: string, id: string) => ({
                eq: () => ({
                  select: () => ({
                    single: async () => {
                      if (mockSchemaMissing.value) {
                        return { data: null, error: schemaMissingError };
                      }
                      mockUpdatedVisibility.push({ id, visibility: patch.visibility });
                      return {
                        data: { ...mockClipsRows.value[0], visibility: patch.visibility },
                        error: null,
                      };
                    },
                  }),
                }),
              }),
            }),
            delete: () => ({
              eq: (_col1: string, id: string) => ({
                eq: async () => {
                  if (mockSchemaMissing.value) {
                    return { error: schemaMissingError };
                  }
                  mockDeletedClipIds.push(id);
                  mockClipsRows.value = mockClipsRows.value.filter((c) => c.id !== id);
                  return { error: null };
                },
              }),
            }),
          };
        }

        if (table === "clip_likes" || table === "clip_saves") {
          return {
            select: () => ({
              eq: () => ({
                in: async () =>
                  mockSchemaMissing.value
                    ? { data: null, error: schemaMissingError }
                    : { data: [], error: null },
              }),
            }),
            insert: async () =>
              mockSchemaMissing.value ? { error: schemaMissingError } : { error: null },
            delete: () => ({
              eq: () => ({
                eq: async () =>
                  mockSchemaMissing.value ? { error: schemaMissingError } : { error: null },
              }),
            }),
          };
        }

        if (table === "clip_replies") {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: async () => ({ data: [], error: null }),
                }),
              }),
            }),
            insert: async () =>
              mockSchemaMissing.value ? { error: schemaMissingError } : { error: null },
          };
        }

        if (table === "follows") {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({ data: [], error: null }),
              }),
            }),
            insert: async () => ({ error: null }),
            delete: () => ({
              eq: () => ({
                eq: async () => ({ error: null }),
              }),
            }),
          };
        }

        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      },
    },
  };
});

import { Route as ClipsRoute } from "@/routes/clips";
import { ClipComposerDialog } from "@/components/clips/ClipComposerDialog";

function renderWithQuery(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const SAMPLE_CLIPS: PingClip[] = [
  {
    id: "clip-1",
    creator_id: "creator-2",
    video_url: "https://cdn.example.com/clip-1.mp4",
    poster_url: "https://cdn.example.com/clip-1.jpg",
    caption: "Building clean grid storage in Lagos .startups .climate",
    captions_text: "Day 14 inverter benchmark test",
    duration_sec: 32,
    visibility: "public",
    dot_tags: ["startups", "climate"],
    source_moment_id: null,
    linked_ping_id: null,
    processing_status: "ready",
    views_count: 42,
    likes_count: 7,
    replies_count: 2,
    shares_count: 1,
    saves_count: 3,
    hidden_at: null,
    created_at: "2026-11-26T10:00:00.000Z",
    creator: {
      id: "creator-2",
      username: "kofi",
      display_name: "Kofi Mensah",
      avatar_url: null,
    },
  },
  {
    id: "clip-2",
    creator_id: "creator-1",
    video_url: "https://cdn.example.com/clip-2.mp4",
    poster_url: null,
    caption: "Our own persistent Clip walkthrough .technology",
    captions_text: null,
    duration_sec: 48,
    visibility: "public",
    dot_tags: ["technology"],
    source_moment_id: null,
    linked_ping_id: null,
    processing_status: "ready",
    views_count: 15,
    likes_count: 3,
    replies_count: 0,
    shares_count: 0,
    saves_count: 1,
    hidden_at: null,
    created_at: "2026-11-26T12:00:00.000Z",
    creator: {
      id: "creator-1",
      username: "ada",
      display_name: "Ada Builder",
      avatar_url: null,
    },
  },
];

describe("Ping Explore + Clips Navigation & Short-Video Platform Acceptance Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSchemaMissing.value = false;
    mockClipsRows.value = [...SAMPLE_CLIPS];
    mockInsertedPayloads.length = 0;
    mockDeletedClipIds.length = 0;
    mockUpdatedVisibility.length = 0;
    mockAuthState.user = { id: "creator-1", email: "creator@ping.test" };
    mockAuthState.profile = {
      id: "creator-1",
      username: "ada",
      display_name: "Ada Builder",
      avatar_url: null,
    };
  });

  it("renders a full-screen vertical snap-scrolling Clips feed with one active Clip at a time, prev/next navigation, playback controls, and video error retry", async () => {
    const ClipsPage = ClipsRoute.options.component as React.ComponentType;
    renderWithQuery(<ClipsPage />);

    await waitFor(() => {
      expect(screen.getByTestId("clip-card-clip-1")).toBeInTheDocument();
    });

    const container = screen.getByTestId("clip-card-clip-1").closest("[data-clips-feed]");
    expect(container).toHaveAttribute("data-clips-feed", "vertical-reels");

    // First clip active, second clip inactive initially
    expect(screen.getByTestId("clip-card-clip-1")).toHaveAttribute("data-active-clip", "true");
    expect(screen.getByTestId("clip-card-clip-2")).toHaveAttribute("data-active-clip", "false");
    expect(screen.getByText("1 / 2")).toBeInTheDocument();

    // Advance vertically to Next Clip
    fireEvent.click(screen.getByRole("button", { name: "Next Clip" }));
    await waitFor(() => {
      expect(screen.getByTestId("clip-card-clip-2")).toHaveAttribute("data-active-clip", "true");
      expect(screen.getByText("2 / 2")).toBeInTheDocument();
    });

    // Video error state renders clear Retry control instead of broken blank box
    const videos = document.querySelectorAll("video");
    expect(videos.length).toBeGreaterThanOrEqual(2);
    fireEvent.error(videos[0]!);
    await waitFor(() => {
      expect(screen.getByText(/This Clip video couldn't load/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Retry video/i })).toBeInTheDocument();
    });
  });

  it("shows an honest unmigrated notice (zero fake Clips) when remote ping_clips schema is not applied", async () => {
    mockSchemaMissing.value = true;
    const ClipsPage = ClipsRoute.options.component as React.ComponentType;
    renderWithQuery(<ClipsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Clips Backend Migration Pending/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/0034_ping_learn_spotlight_and_clips\.sql/i)).toBeInTheDocument();
    expect(screen.queryByTestId("clip-card-clip-1")).toBeNull();
  });

  it("publishes a persistent Clip through ClipComposerDialog and refuses to fake success when backend schema is missing", async () => {
    const onOpenChange = vi.fn();
    const onPublished = vi.fn();
    const { rerender } = renderWithQuery(
      <ClipComposerDialog open onOpenChange={onOpenChange} onPublished={onPublished} />,
    );

    fireEvent.change(screen.getByLabelText(/Video File or Source URL/i), {
      target: { value: "https://cdn.example.com/demo-vertical.mp4" },
    });
    fireEvent.change(screen.getByLabelText(/Caption & Topic DOT Tags/i), {
      target: { value: "Shipping Ping Clips v1 .startups .video" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Publish Clip$/i }));

    await waitFor(() => {
      expect(mockInsertedPayloads).toHaveLength(1);
    });
    expect(mockInsertedPayloads[0]).toMatchObject({
      creator_id: "creator-1",
      video_url: "https://cdn.example.com/demo-vertical.mp4",
      visibility: "public",
      dot_tags: ["startups", "video"],
    });
    expect(onPublished).toHaveBeenCalledTimes(1);

    // When backend migration is missing, publish must fail honestly with clear alert (no fake local fallback)
    mockSchemaMissing.value = true;
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ClipComposerDialog open onOpenChange={onOpenChange} onPublished={onPublished} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/Video File or Source URL/i), {
      target: { value: "https://cdn.example.com/demo-2.mp4" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Publish Clip$/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(CLIPS_SCHEMA_MIGRATION_HINT);
    });
    expect(mockInsertedPayloads).toHaveLength(1);
  });

  it("enforces Moments vs Clips privacy boundaries and creator ownership, plus registers additive migration 0043 cleanly", () => {
    expect(MAX_CLIP_DURATION_SEC).toBe(180);

    // Private-bucket Moments (storage://private-moments/...) cannot be copied directly into Clips
    const privateMomentCheck = validateMomentToClipConversion({
      moment: {
        id: "mom-priv-1",
        author_id: "creator-1",
        media_type: "video",
        audience: "followers",
        media_url: "storage://private-moments/creator-1/followers/self/clip.mp4",
      },
      callerUserId: "creator-1",
      targetVisibility: "public",
    });
    expect(privateMomentCheck.eligible).toBe(false);
    expect(privateMomentCheck.reason).toMatch(/private-bucket/i);

    // Profile route separates Clips and Moments tabs cleanly
    const profileSrc = readRel("src/routes/@{$username}.tsx");
    expect(profileSrc).toContain("userClipsQuery");
    expect(profileSrc).toContain('data-profile-clips-tab="true"');
    expect(profileSrc).toContain("Persistent Clips");
    expect(profileSrc).toContain("Temporary Moments &amp; Highlights");

    // Additive migration 0043 is registered and contains no open USING (true) policy
    const journal = JSON.parse(readRel("drizzle/migrations/meta/_journal.json"));
    const entry43 = journal.entries.find((e: { idx: number }) => e.idx === 43);
    expect(entry43?.tag).toBe("0043_clips_interaction_counters_and_indexes");

    const sql0043 = readRel(
      "drizzle/migrations/0043_clips_interaction_counters_and_indexes.sql",
    );
    expect(sql0043).toContain("ping_clips_creator_created_idx");
    expect(sql0043).toContain("trg_sync_clip_likes_count");
    expect(sql0043).toContain("trg_sync_clip_saves_count");
    expect(sql0043).toContain("trg_sync_clip_replies_count");
    expect(sql0043).toContain("record_clip_share");
    expect(sql0043).not.toMatch(/USING\s*\(\s*true\s*\)/i);
  });
});
