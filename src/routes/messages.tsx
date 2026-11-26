import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect, useDeferredValue, useRef } from "react";
import { MessageSquare, Shield, ExternalLink, Sparkles, Plus, Search, Lock } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  userConversationsQuery,
  conversationMessagesQuery,
  useGetOrCreateDirectConversation,
} from "@/lib/messages";
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/lib/pings";
import { InboxSectionTabs } from "@/components/inbox/InboxSectionTabs";
import { ConversationList } from "@/components/messages/ConversationList";
import { DirectMessageChat } from "@/components/messages/DirectMessageChat";
import { FounderAvatar } from "@/components/ping/Avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
      title: "Chats — Inbox on Ping by DOT",
      description: "Private direct and group conversations inside your Ping Inbox.",
      path: "/messages",
    }),
  component: MessagesPage,
});

function NewDirectMessageDialog({
  open,
  onOpenChange,
  currentUserId,
  onStartChat,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUserId?: string | undefined;
  onStartChat: (targetUserId: string) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [startingId, setStartingId] = useState<string | null>(null);

  const { data: results = [], isLoading } = useQuery({
    queryKey: ["dm-recipient-search", deferredSearch],
    enabled: open && Boolean(currentUserId),
    queryFn: async (): Promise<Profile[]> => {
      const term = deferredSearch.replace(/[%_,()*@]/g, "").trim();
      let q = supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url, bio, created_at")
        .neq("id", currentUserId ?? "")
        .limit(12);

      if (term) {
        q = q.or(`username.ilike.%${term}%,display_name.ilike.%${term}%`);
      } else {
        q = q.order("created_at", { ascending: false });
      }

      const { data, error } = await q;
      if (error || !data) return [];
      return data as Profile[];
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-3xl p-6 max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <MessageSquare className="size-5 text-primary" /> New Direct Message
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Search any founder on Ping to start a private conversation.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-3 relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by @username or name…"
            className="pl-9 rounded-xl h-10 text-sm"
            autoFocus
          />
        </div>

        <div className="mt-3 space-y-2 max-h-72 overflow-y-auto pr-1">
          {isLoading ? (
            <p className="py-6 text-center text-xs text-muted-foreground">Searching founders…</p>
          ) : results.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No founders found matching "{deferredSearch}".
            </p>
          ) : (
            results.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={startingId === p.id}
                onClick={async () => {
                  setStartingId(p.id);
                  try {
                    await onStartChat(p.id);
                    onOpenChange(false);
                  } finally {
                    setStartingId(null);
                  }
                }}
                className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card p-3 text-left transition-colors hover:border-primary/60 hover:bg-secondary/50 disabled:opacity-60"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <FounderAvatar name={p.display_name || p.username} src={p.avatar_url} size="sm" />
                  <div className="min-w-0">
                    <p className="font-semibold text-xs text-foreground truncate">
                      {p.display_name || p.username}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">@{p.username}</p>
                  </div>
                </div>
                <span className="rounded-full bg-primary/15 px-3 py-1 text-[11px] font-bold text-primary shrink-0">
                  {startingId === p.id ? "Opening…" : "Message"}
                </span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export interface ChatsSectionWorkspaceProps {
  baseRoute: "/inbox" | "/messages";
  conversationId?: string | undefined;
  userIdParam?: string | undefined;
}

export function ChatsSectionWorkspace({
  baseRoute,
  conversationId,
  userIdParam,
}: ChatsSectionWorkspaceProps) {
  const { user, ready } = useAuth();
  const navigate = useNavigate();

  const [activeConversationId, setActiveConversationId] = useState<string | undefined>(
    conversationId,
  );
  const [newChatOpen, setNewChatOpen] = useState(false);

  const { data: conversations = [] } = useQuery(userConversationsQuery(user?.id));
  const { data: messages = [] } = useQuery(
    conversationMessagesQuery(activeConversationId, user?.id),
  );
  const getOrCreateConv = useGetOrCreateDirectConversation();
  const handledTargetUserRef = useRef<string | null>(null);

  const navigateToConversation = (nextConvId?: string, replace = false) => {
    if (baseRoute === "/inbox") {
      navigate({
        to: "/inbox",
        search: nextConvId ? { section: "chats", conversationId: nextConvId } : {},
        replace,
      });
    } else {
      navigate({
        to: "/messages",
        search: nextConvId ? { conversationId: nextConvId } : {},
        replace,
      });
    }
  };

  // Handle incoming ?userId=<uuid> query parameter to auto-start or open 1-to-1 chat
  useEffect(() => {
    if (!userIdParam || !user || !ready) return;
    if (userIdParam === user.id) return;
    if (handledTargetUserRef.current === userIdParam) return;
    handledTargetUserRef.current = userIdParam;

    getOrCreateConv
      .mutateAsync(userIdParam)
      .then((convId) => {
        setActiveConversationId(convId);
        navigateToConversation(convId, true);
      })
      .catch((err: any) => {
        handledTargetUserRef.current = null;
        toast.error(err.message || "Could not start conversation");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userIdParam, user, ready]);

  // Sync URL query param
  useEffect(() => {
    setActiveConversationId(conversationId);
  }, [conversationId]);

  if (!ready) {
    return (
      <div className="flex h-[55vh] items-center justify-center text-sm text-muted-foreground">
        Loading conversations…
      </div>
    );
  }

  if (!user) {
    const nextPath = baseRoute === "/inbox" ? "/inbox" : "/messages";
    return (
      <div className="surface-card mx-auto max-w-lg rounded-3xl p-8 sm:p-10 text-center border border-border/70">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <Lock className="size-6" />
        </div>
        <h2 className="mt-4 font-display text-2xl font-extrabold tracking-tight">
          Sign in to open your Chats
        </h2>
        <p className="mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed">
          Access your private direct messages, group conversations, attachments, and read receipts —
          or switch to Hubs and Signals above to browse public groups and institutional channels.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button asChild variant="hero" className="rounded-full px-6">
            <Link to="/login" search={{ next: nextPath }}>
              Sign in to Chats
            </Link>
          </Button>
          <Button asChild variant="outline" className="rounded-full px-5">
            <Link to="/signup">Create account</Link>
          </Button>
        </div>
      </div>
    );
  }

  const activeConversation = conversations.find((c) => c.id === activeConversationId);
  const otherUser = activeConversation?.other_member;

  const handleStartDirectChat = async (targetUserId: string) => {
    try {
      const convId = await getOrCreateConv.mutateAsync(targetUserId);
      setActiveConversationId(convId);
      navigateToConversation(convId);
    } catch (err: any) {
      toast.error(err?.message || "Could not start conversation.");
      throw err;
    }
  };

  return (
    <>
      <div className="w-full h-[calc(100vh-13.5rem)] lg:h-[calc(100vh-8.5rem)] flex gap-4">
        {/* 1. CONVERSATIONS LIST (Hidden on mobile if a chat is active) */}
        <div
          className={cn(
            "w-full lg:w-80 xl:w-96 shrink-0 h-full",
            activeConversationId ? "hidden lg:block" : "block",
          )}
        >
          <ConversationList
            conversations={conversations}
            selectedId={activeConversationId}
            onNewChat={() => setNewChatOpen(true)}
            onSelect={(c) => {
              setActiveConversationId(c.id);
              navigateToConversation(c.id);
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
                navigateToConversation(undefined);
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
                Select a conversation from the left or start a new private chat with any founder on
                Ping.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <Button
                  variant="hero"
                  size="sm"
                  className="rounded-full text-xs font-semibold gap-1.5"
                  onClick={() => setNewChatOpen(true)}
                >
                  <Plus className="size-4" /> Start New Chat
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="rounded-full text-xs font-semibold"
                >
                  <Link to="/explore">Discover People on Explore</Link>
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* 3. RIGHT CONTEXTUAL USER DETAILS (Desktop only: >= 1280px) */}
        {activeConversation && otherUser && activeConversation.type !== "group" && (
          <div className="hidden xl:flex flex-col w-72 shrink-0 h-full bg-card/40 rounded-3xl border border-border/70 p-5 overflow-y-auto">
            <div className="flex flex-col items-center text-center pb-5 border-b border-border/50">
              <FounderAvatar
                name={otherUser.display_name || otherUser.username}
                src={otherUser.avatar_url}
                size="xl"
              />
              <h4 className="mt-3 font-display font-bold text-base text-foreground">
                {otherUser.display_name || otherUser.username}
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

      <NewDirectMessageDialog
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        currentUserId={user.id}
        onStartChat={handleStartDirectChat}
      />
    </>
  );
}

function MessagesPage() {
  const { conversationId, userId } = Route.useSearch();

  return (
    <div className="mx-auto max-w-6xl w-full px-3 sm:px-5 pt-4 pb-20 lg:pb-4 space-y-4">
      <InboxSectionTabs activeSection="chats" />
      <ChatsSectionWorkspace
        baseRoute="/messages"
        conversationId={conversationId}
        userIdParam={userId}
      />
    </div>
  );
}
