import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { checkShieldRateLimit, validateMediaUpload, sanitizeUserText } from "@/lib/shield";

describe("Ping by DOT — Full V1 & V2 Features Acceptance Suite", () => {
  const rootDir = path.resolve(__dirname, "../..");

  it("verifies migration 0011 fixes the Signal publisher privilege escalation loophole", () => {
    const mig0011 = fs.readFileSync(
      path.join(rootDir, "drizzle/migrations/0011_hubs_signals_read_receipts.sql"),
      "utf-8",
    );

    // Ensure the vulnerable clause 'OR user_id = auth.uid()' was removed from publisher policy
    expect(mig0011).not.toContain("OR user_id = (select auth.uid())");
    expect(mig0011).toContain('CREATE POLICY "Signal admins manage publishers"');
    expect(mig0011).toContain("public.signal_role(signal_id, (select auth.uid())) = 'admin'");

    // Verify secure RPCs are defined
    expect(mig0011).toContain("CREATE OR REPLACE FUNCTION public.add_signal_publisher");
    expect(mig0011).toContain("CREATE OR REPLACE FUNCTION public.remove_signal_publisher");
  });

  it("verifies migration 0011 restricts Hub member direct insert to prevent unauthorized private hub joins", () => {
    const mig0011 = fs.readFileSync(
      path.join(rootDir, "drizzle/migrations/0011_hubs_signals_read_receipts.sql"),
      "utf-8",
    );

    expect(mig0011).toContain('CREATE POLICY "Users can join or be added to hubs"');
    expect(mig0011).toContain("access = 'public'");
  });

  it("verifies migration 0012 enforces least-privilege grants and prevents moment audience expansion", () => {
    const mig0012 = fs.readFileSync(
      path.join(rootDir, "drizzle/migrations/0012_moments_highlights_reping.sql"),
      "utf-8",
    );

    // Avoid broad GRANT ALL
    expect(mig0012).not.toContain("GRANT ALL ON public.moments TO authenticated");
    expect(mig0012).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON public.moments TO authenticated",
    );

    // Audience protection in reping_moment
    expect(mig0012).toContain("Cannot expand a followers-only moment to public");
    expect(mig0012).toContain("Private Hub and Close Circle moments cannot be re-pinged");
  });

  it("verifies migration 0014 provisions private direct messaging with participant isolation", () => {
    const mig0014 = fs.readFileSync(
      path.join(rootDir, "drizzle/migrations/0014_private_direct_messaging.sql"),
      "utf-8",
    );

    expect(mig0014).toContain("CREATE TABLE IF NOT EXISTS public.conversations");
    expect(mig0014).toContain("CREATE TABLE IF NOT EXISTS public.conversation_members");
    expect(mig0014).toContain("CREATE TABLE IF NOT EXISTS public.conversation_messages");
    expect(mig0014).toContain("CREATE TABLE IF NOT EXISTS public.user_blocks");

    // Verify postflight RPCs
    expect(mig0014).toContain("CREATE OR REPLACE FUNCTION public.create_conversation");
    expect(mig0014).toContain("CREATE OR REPLACE FUNCTION public.send_message");
    expect(mig0014).toContain("CREATE OR REPLACE FUNCTION public.mark_conversation_read");
    expect(mig0014).toContain("CREATE OR REPLACE FUNCTION public.block_user");
  });

  it("verifies migration 0015 provisions Hub cascade deletion, reactions, and highlight curation", () => {
    const mig0015 = fs.readFileSync(
      path.join(rootDir, "drizzle/migrations/0015_product_completion_sprint.sql"),
      "utf-8",
    );

    expect(mig0015).toContain("CREATE OR REPLACE FUNCTION public.delete_hub");
    expect(mig0015).toContain("CREATE OR REPLACE FUNCTION public.toggle_hub_message_reaction");
    expect(mig0015).toContain("CREATE OR REPLACE FUNCTION public.update_signal");
    expect(mig0015).toContain("CREATE OR REPLACE FUNCTION public.update_highlight");
    expect(mig0015).toContain("CREATE OR REPLACE FUNCTION public.remove_moment_from_highlight");
  });

  it("verifies direct messaging components and routes exist and are wired correctly", () => {
    const inboxRoute = fs.readFileSync(path.join(rootDir, "src/routes/inbox.tsx"), "utf-8");
    const messagesRoute = fs.readFileSync(path.join(rootDir, "src/routes/messages.tsx"), "utf-8");
    const workspace = fs.readFileSync(
      path.join(rootDir, "src/components/messages/MessagesWorkspace.tsx"),
      "utf-8",
    );
    expect(inboxRoute).toContain("MessagesWorkspace");
    expect(messagesRoute).toContain("MessagesWorkspace");
    expect(workspace).toContain("DirectMessageChat");
    expect(workspace).toContain("ConversationList");
    expect(workspace).toContain("useGetOrCreateDirectConversation");

    const messagesLib = fs.readFileSync(path.join(rootDir, "src/lib/messages.ts"), "utf-8");
    expect(messagesLib).toContain("useSendPrivateMessage");
    expect(messagesLib).toContain("useConversationRealtime");
  });

  it("verifies PING SHIELD security functions operate correctly", () => {
    // Rate limit
    const res = checkShieldRateLimit("create_moment", "test-user-v2");
    expect(res.allowed).toBe(true);

    // Media validation
    const validJpg = { name: "photo.jpg", type: "image/jpeg", size: 1024 * 100 };
    expect(validateMediaUpload(validJpg, "image").valid).toBe(true);

    // Text sanitization
    expect(sanitizeUserText("Ping\x00 test")).toBe("Ping test");
  });

  it("verifies dark palette tokens and design system constants are preserved", () => {
    const styles = fs.readFileSync(path.join(rootDir, "src/styles.css"), "utf-8").toLowerCase();
    // Four-color Dark palette: Obsidian (#090b0a), Graphite (#171b18), Electric Ping Green (#c7f36b), Champagne Gold (#d8b66a)
    expect(styles).toContain("#090b0a");
    expect(styles).toContain("#171b18");
    expect(styles).toContain("#c7f36b");
    expect(styles).toContain("#d8b66a");
  });
});
