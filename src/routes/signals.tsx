import { createFileRoute, Outlet, useChildMatches } from "@tanstack/react-router";
import { MessagesWorkspace } from "@/components/messages/MessagesWorkspace";
import { pageHead } from "@/lib/site";

interface SignalsSearchParams {
  conversationId?: string | undefined;
  userId?: string | undefined;
}

export const Route = createFileRoute("/signals")({
  staticData: { sitemap: true },
  validateSearch: (search: Record<string, unknown>): SignalsSearchParams => ({
    conversationId:
      typeof search["conversationId"] === "string"
        ? (search["conversationId"] as string)
        : undefined,
    userId: typeof search["userId"] === "string" ? (search["userId"] as string) : undefined,
  }),
  head: () =>
    pageHead({
      title: "Signal — 1-on-1 Chats & Conversations on PING",
      description: "Signal is the private 1-on-1 chat and conversation hub inside PING Community.",
      path: "/signals",
    }),
  component: SignalsLayout,
});

function SignalsLayout() {
  const childMatches = useChildMatches();
  if (childMatches.length > 0) return <Outlet />;
  return <SignalConversationsPage />;
}

function SignalConversationsPage() {
  const search = Route.useSearch();

  return (
    <MessagesWorkspace
      basePath="/signals"
      conversationId={search.conversationId}
      userIdParam={search.userId}
      showCommunityHeader
    />
  );
}
