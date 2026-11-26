import { createFileRoute } from "@tanstack/react-router";
import { InboxSectionTabs, type InboxSection } from "@/components/inbox/InboxSectionTabs";
import { MessagesWorkspace } from "@/components/messages/MessagesWorkspace";
import { HubsDirectorySection } from "@/routes/hubs";
import { SignalsDirectorySection } from "@/routes/signals";
import { pageHead } from "@/lib/site";
import { cn } from "@/lib/utils";

export interface InboxSearchParams {
  section?: InboxSection | undefined;
  conversationId?: string | undefined;
  userId?: string | undefined;
  category?: string | undefined;
  q?: string | undefined;
}

function parseInboxSection(raw: unknown): InboxSection | undefined {
  if (raw === "chats" || raw === "hubs" || raw === "signals") return raw;
  return undefined;
}

export const Route = createFileRoute("/inbox")({
  staticData: { sitemap: true },
  validateSearch: (search: Record<string, unknown>): InboxSearchParams => ({
    section: parseInboxSection(search["section"]),
    conversationId:
      typeof search["conversationId"] === "string"
        ? (search["conversationId"] as string)
        : undefined,
    userId: typeof search["userId"] === "string" ? (search["userId"] as string) : undefined,
    category: typeof search["category"] === "string" ? (search["category"] as string) : undefined,
    q: typeof search["q"] === "string" ? (search["q"] as string) : undefined,
  }),
  head: () =>
    pageHead({
      title: "Inbox — Chats, Hubs & Signals on PING",
      description:
        "Central communication centre on PING: private Chats, collaborative group Hubs, and official institutional Signals.",
      path: "/inbox",
    }),
  component: InboxPage,
});

function InboxPage() {
  const { section, conversationId, userId, category, q } = Route.useSearch();
  const activeSection: InboxSection = section ?? "chats";

  if (activeSection === "chats") {
    return (
      <div className="w-full min-w-0 flex flex-col">
        <div
          className={cn(
            "mx-auto max-w-7xl w-full px-3 sm:px-6 pt-3 sm:pt-4",
            conversationId && "hidden lg:block",
          )}
        >
          <InboxSectionTabs activeSection="chats" />
        </div>
        <MessagesWorkspace
          basePath="/inbox"
          conversationId={conversationId}
          userIdParam={userId}
          embeddedInInbox
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl w-full min-w-0 px-4 sm:px-6 pt-4 pb-32 sm:pb-24 space-y-5 overflow-x-clip">
      <InboxSectionTabs activeSection={activeSection} />
      {activeSection === "hubs" ? (
        <HubsDirectorySection embeddedInInbox initialCategory={category} initialQuery={q} />
      ) : (
        <SignalsDirectorySection embeddedInInbox initialCategory={category} initialQuery={q} />
      )}
    </div>
  );
}
