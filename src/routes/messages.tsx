import { createFileRoute } from "@tanstack/react-router";
import { MessagesWorkspace } from "@/components/messages/MessagesWorkspace";
import { pageHead } from "@/lib/site";

interface MessagesSearchParams {
  conversationId?: string | undefined;
  userId?: string | undefined;
}

export const Route = createFileRoute("/messages")({
  staticData: { sitemap: false },
  validateSearch: (search: Record<string, unknown>): MessagesSearchParams => ({
    conversationId:
      typeof search["conversationId"] === "string"
        ? (search["conversationId"] as string)
        : undefined,
    userId: typeof search["userId"] === "string" ? (search["userId"] as string) : undefined,
  }),
  head: () =>
    pageHead({
      title: "Chats — Inbox on Ping by DOT",
      description: "Private direct and group conversations inside your Ping Inbox.",
      path: "/messages",
    }),
  component: MessagesPage,
});

function MessagesPage() {
  const search = Route.useSearch();

  return (
    <MessagesWorkspace
      basePath="/messages"
      conversationId={search.conversationId}
      userIdParam={search.userId}
    />
  );
}
