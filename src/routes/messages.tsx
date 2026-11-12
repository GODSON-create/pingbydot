import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { MessageSquare, Shield, User, ExternalLink, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  userConversationsQuery,
  conversationMessagesQuery,
  type Conversation,
} from "@/lib/messages";
import { ConversationList } from "@/components/messages/ConversationList";
import { DirectMessageChat } from "@/components/messages/DirectMessageChat";
import { FounderAvatar } from "@/components/ping/Avatar";
import { Button } from "@/components/ui/button";
import { pageHead } from "@/lib/site";
import { cn } from "@/lib/utils";

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
  const { user, ready } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();

  const [activeConversationId, setActiveConversationId] = useState<string | undefined>(
    search.conversationId,
  );

  // Auth gate
  useEffect(() => {
    if (ready && !user) {
      navigate({ to: "/login", search: { next: "/messages" } });
    }
  }, [ready, user, navigate]);

  // Sync search param with state
  useEffect(() => {
    if (search.conversationId) {
      setActiveConversationId(search.conversationId);
    }
  }, [search.conversationId]);

  const { data: conversations = [], isLoading: isLoadingConversations } = useQuery(
    userConversationsQuery(user?.id),
  );

  // If user opens page with no selected conversation on desktop, default to the first one
  useEffect(() => {
    if (
      !activeConversationId &&
      conversations.length > 0 &&
      conversations[0] &&
      typeof window !== "undefined" &&
      window.innerWidth >= 1024
    ) {
      setActiveConversationId(conversations[0].id);
    }
  }, [activeConversationId, conversations]);

  const activeConversation = conversations.find((c) => c.id === activeConversationId);

  const { data: messages = [] } = useQuery(
    conversationMessagesQuery(activeConversationId, user?.id),
  );

  const otherUser = activeConversation?.other_member;

  return (
    <div className="w-full max-w-7xl mx-auto px-2 sm:px-4 lg:px-6 py-4 h-[calc(100vh-4.5rem)] lg:h-[calc(100vh-2rem)] flex gap-4">
      {/* 1. LEFT CONVERSATION LIST (Hidden on mobile if a chat is active) */}
      <div
        className={cn(
          "w-full lg:w-80 xl:w-96 shrink-0 h-full",
          activeConversationId ? "hidden lg:block" : "block",
        )}
      >
        <ConversationList
          conversations={conversations}
          selectedId={activeConversationId}
          onSelect={(c) => {
            setActiveConversationId(c.id);
            navigate({
              to: "/messages",
              search: { conversationId: c.id },
            });
          }}
        />
      </div>

      {/* 2. CENTRE CHAT PANEL (Hidden on mobile if no chat is active) */}
      <div
        className={cn(
          "flex-1 h-full min-w-0",
          !activeConversationId ? "hidden lg:flex flex-col" : "flex flex-col",
        )}
      >
        {activeConversation ? (
          <DirectMessageChat
            conversation={activeConversation}
            messages={messages}
            onBack={() => {
              setActiveConversationId(undefined);
              navigate({ to: "/messages", search: {} });
            }}
          />
        ) : (
          <div className="flex-1 bg-card/40 rounded-3xl border border-border/70 flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
            <div className="size-16 rounded-3xl bg-primary/10 flex items-center justify-center mb-4 text-primary">
              <MessageSquare className="size-8" />
            </div>
            <h3 className="font-display font-extrabold text-lg text-foreground mb-1">
              Your Private Conversations
            </h3>
            <p className="text-xs text-muted-foreground max-w-sm mb-6">
              Select a conversation from the left or visit any profile to send a direct message.
            </p>
            <Button asChild variant="outline" className="rounded-full text-xs font-semibold">
              <Link to="/explore">Discover People on Explore</Link>
            </Button>
          </div>
        )}
      </div>

      {/* 3. RIGHT CONTEXTUAL USER DETAILS (Desktop only: >= 1280px) */}
      {activeConversation && otherUser && (
        <div className="hidden xl:flex flex-col w-72 shrink-0 h-full bg-card/40 rounded-3xl border border-border/70 p-5 overflow-y-auto">
          <div className="flex flex-col items-center text-center pb-5 border-b border-border/50">
            <FounderAvatar
              name={otherUser.display_name || otherUser.username}
              src={otherUser.avatar_url}
              size="xl"
            />
            <h4 className="font-display font-bold text-base text-foreground">
              {otherUser.display_name}
            </h4>
            <p className="text-xs text-muted-foreground font-mono">@{otherUser.username}</p>

            {otherUser.bio && (
              <p className="text-xs text-foreground/80 mt-3 line-clamp-3 leading-relaxed">
                {otherUser.bio}
              </p>
            )}

            <Button
              asChild
              size="sm"
              variant="outline"
              className="rounded-full mt-4 text-xs w-full"
            >
              <Link to="/@{$username}" params={{ username: otherUser.username }}>
                <ExternalLink className="size-3.5 mr-1.5" /> View Profile
              </Link>
            </Button>
          </div>

          <div className="mt-5 space-y-4 text-xs">
            <div className="flex items-center gap-2.5 text-muted-foreground">
              <Shield className="size-4 text-primary shrink-0" />
              <span>Direct messages are restricted to conversation participants.</span>
            </div>
            <div className="flex items-center gap-2.5 text-muted-foreground">
              <Sparkles className="size-4 text-primary shrink-0" />
              <span>Real-time presence and read states are synchronized.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
