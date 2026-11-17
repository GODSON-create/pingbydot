import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Building2,
  ExternalLink,
  MessageSquare,
  Plus,
  Radio,
  Search,
  Shield,
  Sparkles,
} from "lucide-react";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { QueryErrorCard } from "@/components/QueryErrorCard";
import { ConversationList } from "@/components/messages/ConversationList";
import { DirectMessageChat } from "@/components/messages/DirectMessageChat";
import { FounderAvatar } from "@/components/ping/Avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  conversationByIdQuery,
  conversationMessagesQuery,
  useGetOrCreateDirectConversation,
  userConversationsQuery,
} from "@/lib/messages";
import type { Profile } from "@/lib/pings";
import { cn } from "@/lib/utils";

export function NewDirectMessageDialog({
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

  const {
    data: results = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
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

      const { data, error: queryError } = await q;
      if (queryError) throw queryError;
      return (data ?? []) as Profile[];
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
            Search anyone on Ping to start a private 1-to-1 conversation.
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
            <p className="py-6 text-center text-xs text-muted-foreground">Searching people…</p>
          ) : isError ? (
            <QueryErrorCard
              compact
              title="Couldn't load people"
              error={error}
              onRetry={() => void refetch()}
            />
          ) : results.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {deferredSearch
                ? `No people found matching "${deferredSearch}".`
                : "No profiles available yet."}
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
                    setSearch("");
                  } finally {
                    setStartingId(null);
                  }
                }}
                className="w-full flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-secondary/40 hover:bg-secondary p-3 text-left transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <FounderAvatar name={p.display_name || p.username} src={p.avatar_url} size="sm" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">{p.display_name || p.username}</p>
                    <p className="text-xs text-muted-foreground truncate">@{p.username}</p>
                  </div>
                </div>
                <span className="rounded-full bg-primary/15 text-primary px-2.5 py-1 text-xs font-semibold shrink-0">
                  {startingId === p.id ? "Opening…" : "Chat"}
                </span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MessagesWorkspace({
  basePath = "/signals",
  conversationId,
  userIdParam,
  showCommunityHeader = false,
  redirectUnauthenticated = false,
}: {
  basePath?: "/messages" | "/signals";
  conversationId?: string | undefined;
  userIdParam?: string | undefined;
  showCommunityHeader?: boolean;
  redirectUnauthenticated?: boolean;
}) {
  const { user, ready } = useAuth();
  const navigate = useNavigate();
  const [newChatOpen, setNewChatOpen] = useState(false);
  const handledUserParamRef = useRef<string | null>(null);

  const { mutateAsync: getOrCreateConversation } = useGetOrCreateDirectConversation();

  const clearedByUserRef = useRef(false);
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>(
    conversationId,
  );

  // If userId query param is provided, open/create conversation with that user once
  useEffect(() => {
    if (
      userIdParam &&
      user &&
      userIdParam !== user.id &&
      handledUserParamRef.current !== userIdParam
    ) {
      handledUserParamRef.current = userIdParam;
      clearedByUserRef.current = false;
      getOrCreateConversation(userIdParam)
        .then((convId) => {
          if (convId) {
            setActiveConversationId(convId);
            navigate({ to: basePath, search: { conversationId: convId } as any, replace: true });
          }
        })
        .catch((err) => {
          toast.error(err instanceof Error ? err.message : "Could not open conversation.");
        });
    }
  }, [userIdParam, user, getOrCreateConversation, navigate, basePath]);

  // Optional redirect for dedicated /messages route
  useEffect(() => {
    if (redirectUnauthenticated && ready && !user) {
      navigate({ to: "/login", search: { next: basePath } });
    }
  }, [redirectUnauthenticated, ready, user, navigate, basePath]);

  // Sync URL search param with active state cleanly
  useEffect(() => {
    if (conversationId) {
      clearedByUserRef.current = false;
      setActiveConversationId(conversationId);
    } else if (!userIdParam) {
      setActiveConversationId(undefined);
    }
  }, [conversationId, userIdParam]);

  const {
    data: conversations = [],
    isError: isConversationsError,
    error: conversationsError,
    refetch: refetchConversations,
  } = useQuery(userConversationsQuery(user?.id));

  // If user opens page with no selected conversation on desktop, default to the first one
  useEffect(() => {
    if (
      !clearedByUserRef.current &&
      !userIdParam &&
      !conversationId &&
      !activeConversationId &&
      conversations.length > 0 &&
      conversations[0] &&
      typeof window !== "undefined" &&
      window.innerWidth >= 1024
    ) {
      setActiveConversationId(conversations[0].id);
    }
  }, [activeConversationId, conversationId, userIdParam, conversations]);

  const listedConversation = conversations.find((c) => c.id === activeConversationId);
  const { data: fetchedConversation, isLoading: isSingleConvLoading } = useQuery(
    conversationByIdQuery(listedConversation ? undefined : activeConversationId, user?.id),
  );
  const activeConversation = listedConversation ?? fetchedConversation ?? undefined;

  const {
    data: messages = [],
    isError: isMessagesError,
    error: messagesError,
    refetch: refetchMessages,
  } = useQuery(conversationMessagesQuery(activeConversationId, user?.id));

  const otherUser = activeConversation?.other_member;

  const handleStartDirectChat = async (targetUserId: string) => {
    try {
      const convId = await getOrCreateConversation(targetUserId);
      setActiveConversationId(convId);
      navigate({ to: basePath, search: { conversationId: convId } as any });
    } catch (err: any) {
      toast.error(err?.message || "Failed to start conversation");
    }
  };

  const communitySwitcher = showCommunityHeader ? (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
      <div className="inline-flex items-center gap-1.5 rounded-full bg-secondary/80 p-1">
        <Link
          to="/hubs"
          search={{}}
          className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          <Building2 className="size-3.5" /> Hub
        </Link>
        <Link
          to="/signals"
          className="inline-flex items-center gap-1.5 rounded-full bg-foreground text-background shadow-sm px-4 py-1.5 text-xs font-semibold transition-colors"
        >
          <Radio className="size-3.5" /> Signal
        </Link>
        <Link
          to="/hubs"
          search={{ view: "moments" }}
          className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          <Sparkles className="size-3.5" /> Moment
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
          <MessageSquare className="size-3.5" />
          Community Destination · Signal
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 text-gold border border-gold/30 px-2.5 py-0.5 text-[11px] font-bold">
          1-on-1 Chats
        </span>
        <Link
          to="/signals/channels"
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-foreground hover:bg-secondary transition-colors"
        >
          <Radio className="size-3.5 text-primary" />
          Institutional Channels
        </Link>
      </div>
    </div>
  ) : null;

  if (ready && !user && !redirectUnauthenticated) {
    return (
      <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-24">
        {communitySwitcher}
        <section className="surface-card rounded-[2rem] p-8 sm:p-12 text-center border border-border/70">
          <div className="mx-auto flex size-16 items-center justify-center rounded-3xl bg-primary/15 text-primary">
            <MessageSquare className="size-8" />
          </div>
          <h1 className="mt-4 font-display text-2xl sm:text-3xl font-extrabold">
            Signal — 1-on-1 Chats &amp; Conversations
          </h1>
          <p className="mt-2 mx-auto max-w-md text-sm text-muted-foreground">
            Private direct conversations with anyone on PING. Sign in to view your chats or message
            people across the network.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild variant="hero" className="rounded-full px-6">
              <Link to="/login" search={{ next: basePath }}>
                Sign in to open Signal Chats
              </Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full px-6">
              <Link to="/explore">Explore Ping</Link>
            </Button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "w-full max-w-7xl mx-auto flex flex-col",
        showCommunityHeader
          ? "px-3 sm:px-4 lg:px-6 pt-3 pb-2 h-[calc(100dvh-9.25rem)] md:h-[calc(100dvh-4.75rem)] lg:h-[calc(100dvh-0.75rem)]"
          : "px-2 sm:px-4 lg:px-6 pt-2 pb-2 h-[calc(100dvh-9.25rem)] md:h-[calc(100dvh-4.75rem)] lg:h-[calc(100dvh-0.75rem)]",
      )}
    >
      {communitySwitcher}

      <div className="flex-1 min-h-0 flex gap-4">
        {/* 1. LEFT CONVERSATION LIST (Hidden on mobile if a chat is active) */}
        <div
          className={cn(
            "w-full lg:w-80 xl:w-96 shrink-0 h-full",
            activeConversationId ? "hidden lg:block" : "block",
          )}
        >
          {isConversationsError ? (
            <div className="p-2">
              <QueryErrorCard
                compact
                title="Couldn't load conversations"
                description="Unable to reach your inbox right now."
                error={conversationsError}
                onRetry={() => void refetchConversations()}
              />
            </div>
          ) : (
            <ConversationList
              conversations={conversations}
              selectedId={activeConversationId}
              onNewChat={() => setNewChatOpen(true)}
              onSelect={(c) => {
                setActiveConversationId(c.id);
                navigate({
                  to: basePath,
                  search: { conversationId: c.id } as any,
                });
              }}
            />
          )}
        </div>

        {/* 2. CENTRE CHAT PANEL (Hidden on mobile if no chat is active) */}
        <div
          className={cn(
            "flex-1 h-full min-w-0",
            !activeConversationId ? "hidden lg:flex flex-col" : "flex flex-col",
          )}
        >
          {activeConversation ? (
            isMessagesError ? (
              <div className="p-4">
                <QueryErrorCard
                  title="Couldn't load messages"
                  description="We couldn't fetch messages for this conversation."
                  error={messagesError}
                  onRetry={() => void refetchMessages()}
                />
              </div>
            ) : (
              <DirectMessageChat
                conversation={activeConversation}
                messages={messages}
                onBack={() => {
                  clearedByUserRef.current = true;
                  setActiveConversationId(undefined);
                  navigate({ to: basePath, search: {} as any });
                }}
              />
            )
          ) : activeConversationId && isSingleConvLoading ? (
            <div className="flex-1 bg-card/40 rounded-3xl border border-border/70 flex flex-col items-center justify-center p-8 text-xs text-muted-foreground">
              Opening conversation…
            </div>
          ) : (
            <div className="flex-1 bg-card/40 rounded-3xl border border-border/70 flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
              <div className="size-16 rounded-3xl bg-primary/10 flex items-center justify-center mb-4 text-primary">
                <MessageSquare className="size-8" />
              </div>
              <h3 className="font-display font-extrabold text-lg text-foreground mb-1">
                {showCommunityHeader
                  ? "Signal · 1-on-1 Conversations"
                  : "Your Private Conversations"}
              </h3>
              <p className="text-xs text-muted-foreground max-w-sm mb-6">
                Select a conversation from the left or start a new 1-to-1 chat with any founder on
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
        {activeConversation && otherUser && (
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
        currentUserId={user?.id}
        onStartChat={handleStartDirectChat}
      />
    </div>
  );
}
