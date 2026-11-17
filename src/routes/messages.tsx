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
      title: "Direct Messages — Ping by DOT",
      description: "Private, secure one-to-one conversations on Ping by DOT.",
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
      redirectUnauthenticated
    />
  );
}
