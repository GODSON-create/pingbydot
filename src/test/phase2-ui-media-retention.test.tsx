import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { ResolvedChatMedia } from "@/components/chat/ChatAttachmentControls";
import { CascadingProfilePanel } from "@/components/profile/CascadingProfilePanel";
import type { PrivateMessage } from "@/lib/messages";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "user-alice", email: "alice@ping.test" },
    ready: true,
  }),
}));

vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return {
    ...actual,
    createAuthorizedMediaReadUrl: vi.fn(async (ref: string) => {
      if (ref.includes("voice-note-")) {
        return "https://signed.example/hub-attachments/hub-1/user-alice/voice-note-123.webm?token=abc";
      }
      return `https://signed.example/resolved/${encodeURIComponent(ref)}`;
    }),
    createPrivateDmSignedUrl: vi.fn(async (ref: string) => {
      return `https://signed.example/resolved/${encodeURIComponent(ref)}`;
    }),
  };
});

describe("Ping Stage 2 — Phase 2 UI & Media Rendering Fixes (H7, M9)", () => {
  it("H7: renders Hub WebM voice note attachments as <audio> player instead of <video>", async () => {
    const { container } = render(
      <ResolvedChatMedia
        mediaUrl="storage://hub-attachments/hub-1/user-alice/voice-note-1732645000-abc123def456.webm"
        mediaType={null}
        isOwnMessage={true}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("voice-note-player")).toBeInTheDocument();
    });
    expect(container.querySelector("audio")).not.toBeNull();
    expect(container.querySelector("video")).toBeNull();
  });

  it("M9: CascadingProfilePanel renders signed thumbnails for private DM photos", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const messages: PrivateMessage[] = [
      {
        id: "msg-1",
        conversation_id: "conv-1",
        sender_id: "user-bob",
        content: "",
        media_url: "conv-1/user-bob/photo-123.webp",
        media_type: "image",
        status: "read",
        deleted_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    render(
      <QueryClientProvider client={qc}>
        <CascadingProfilePanel
          profile={{
            id: "user-bob",
            username: "bob",
            display_name: "Bob Builder",
            avatar_url: null,
            bio: "Builder",
          }}
          messages={messages}
          onClose={() => {}}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      const img = screen.getByAltText("Shared conversation media") as HTMLImageElement;
      expect(img.src).toContain("https://signed.example/resolved/");
    });
  });
});
