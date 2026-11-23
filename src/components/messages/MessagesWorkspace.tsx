import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Building2, MessageSquare, Plus, Radio, Search, Sparkles, X } from "lucide-react";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { QueryErrorCard } from "@/components/QueryErrorCard";
import { ConversationList } from "@/components/messages/ConversationList";
import { DirectMessageChat } from "@/components/messages/DirectMessageChat";
import { NewGroupChatDialog } from "@/components/messages/NewGroupChatDialog";
import { CascadingProfilePanel } from "@/components/profile/CascadingProfilePanel";
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
import { setFocusedWorkspaceActive } from "@/lib/draft-store";
import { useKeyboardOpen } from "@/lib/native";
import { useNavOverlay } from "@/lib/nav-overlay";
import {
  conversationByIdQuery,
  conversationMembersQuery,
  conversationMessagesQuery,
  useGetOrCreateDirectConversation,
  useInboxRealtime,
  useRemoveGroupMember,
  useUpdateConversationPrefs,
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
  const keyboardOpen = useKeyboardOpen();
  const navigate = useNavigate();
  const { isOpen, openOverlay, closeOverlays } = useNavOverlay();
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const handledUserParamRef = useRef<string | null>(null);
  const peerProfileOpen = isOpen("chat-peer-profile");

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
    isLoading: isConversationsLoading,
    isError: isConversationsError,
    error: conversationsError,
    refetch: refetchConversations,
  } = useQuery(userConversationsQuery(user?.id));

  useInboxRealtime(user?.id);

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
  const {
    data: fetchedConversation,
    isLoading: isSingleConvLoading,
    isError: isSingleConvError,
    error: singleConvError,
    refetch: refetchSingleConv,
  } = useQuery(
    conversationByIdQuery(listedConversation ? undefined : activeConversationId, user?.id),
  );
  const activeConversation = listedConversation ?? fetchedConversation ?? undefined;

  useEffect(() => {
    if (!activeConversationId) return;
    return setFocusedWorkspaceActive(true);
  }, [activeConversationId]);

  const {
    data: messages = [],
    isLoading: isMessagesLoading,
    isError: isMessagesError,
    error: messagesError,
    refetch: refetchMessages,
  } = useQuery(conversationMessagesQuery(activeConversationId, user?.id));

  const { data: groupMembers = [] } = useQuery(
    conversationMembersQuery(
      activeConversation?.type === "group" ? activeConversation.id : undefined,
    ),
  );
  const removeGroupMember = useRemoveGroupMember(activeConversation?.id ?? "");
  const updateConvPrefs = useUpdateConversationPrefs(user?.id);

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

  const communitySwitcher =
    showCommunityHeader && !activeConversationId ? (
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5 border-b border-border/60 pb-2.5">
        <div className="inline-flex lg:hidden max-w-full items-center gap-1 overflow-x-auto scrollbar-none rounded-full bg-secondary/80 p-1">
          <Link
            to="/hubs"
            search={{}}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <Building2 className="size-3.5" /> Hub
          </Link>
          <Link
            to="/signals"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-foreground text-background shadow-sm px-3.5 py-1.5 text-xs font-semibold transition-colors"
          >
            <Radio className="size-3.5" /> Signal
          </Link>
          <Link
            to="/hubs"
            search={{ view: "moments" }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <Sparkles className="size-3.5" /> Moment
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-2 ml-auto">
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
        keyboardOpen
          ? "px-2 sm:px-4 lg:px-6 pt-2 pb-1 h-[calc(100dvh-1rem)]"
          : activeConversationId
            ? "px-2 sm:px-4 lg:px-6 pt-2 pb-2 h-[calc(100dvh-0.75rem)] md:h-[calc(100dvh-4.75rem)] lg:h-[calc(100dvh-0.75rem)]"
            : showCommunityHeader
              ? "px-3 sm:px-4 lg:px-6 pt-3 pb-2 h-[calc(100dvh-9.25rem)] md:h-[calc(100dvh-4.75rem)] lg:h-[calc(100dvh-0.75rem)]"
              : "px-2 sm:px-4 lg:px-6 pt-2 pb-2 h-[calc(100dvh-9.25rem)] md:h-[calc(100dvh-4.75rem)] lg:h-[calc(100dvh-0.75rem)]",
      )}
    >
      {communitySwitcher}

      <div className="relative flex-1 min-h-0 flex gap-4">
        {/* 1. LEFT CONVERSATION LIST (Hidden on mobile if a chat is active, or on laptop when Peer Profile drawer is open) */}
        <div
          className={cn(
            "w-full lg:w-80 xl:w-96 shrink-0 h-full",
            activeConversationId ? "hidden lg:block" : "block",
            peerProfileOpen && "lg:hidden xl:block",
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
          ) : isConversationsLoading && conversations.length === 0 ? (
            <div className="space-y-2 rounded-3xl border border-border/70 bg-card/40 p-4 h-full">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-2xl bg-muted/40" />
              ))}
            </div>
          ) : (
            <ConversationList
              conversations={conversations}
              selectedId={activeConversationId}
              currentUserId={user?.id}
              onNewChat={() => setNewChatOpen(true)}
              onNewGroup={() => setNewGroupOpen(true)}
              onSelect={(c) => {
                closeOverlays();
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
                allConversations={conversations}
                messages={messages}
                isLoading={isMessagesLoading}
                peerProfileOpen={peerProfileOpen}
                onTogglePeerProfile={() =>
                  peerProfileOpen ? closeOverlays() : openOverlay("chat-peer-profile")
                }
                onBack={() => {
                  closeOverlays();
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
          ) : activeConversationId && isSingleConvError ? (
            <div className="p-4 flex flex-col gap-3">
              <QueryErrorCard
                title="Couldn't open conversation"
                description="You may not have access to this private conversation, or your connection dropped."
                error={singleConvError}
                onRetry={() => void refetchSingleConv()}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-center rounded-full"
                onClick={() => {
                  clearedByUserRef.current = true;
                  setActiveConversationId(undefined);
                  navigate({ to: basePath, search: {} as any });
                }}
              >
                Back to conversations
              </Button>
            </div>
          ) : activeConversationId ? (
            <div className="flex-1 bg-card/40 rounded-3xl border border-border/70 flex flex-col items-center justify-center text-center p-8">
              <p className="font-display font-bold text-base text-foreground">
                Conversation unavailable
              </p>
              <p className="mt-1 text-xs text-muted-foreground max-w-sm">
                This conversation doesn&apos;t exist or is restricted to its participants.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4 rounded-full"
                onClick={() => {
                  clearedByUserRef.current = true;
                  setActiveConversationId(undefined);
                  navigate({ to: basePath, search: {} as any });
                }}
              >
                Back to inbox
              </Button>
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

        {/* 3. RIGHT CONTEXTUAL DETAILS (Participant Profile OR Group Roster) */}
        {peerProfileOpen && activeConversation && activeConversation.type === "group" && (
          <aside
            aria-label="Group conversation details"
            data-testid="chat-peer-profile-drawer"
            className="fixed inset-0 z-50 lg:static lg:z-auto flex flex-col w-full lg:w-72 shrink-0 h-full bg-card lg:bg-card/60 lg:rounded-3xl border border-border/70 p-5 overflow-y-auto shadow-lift lg:shadow-none"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Group Info
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 rounded-full"
                onClick={closeOverlays}
                aria-label="Close group details"
              >
                <X className="size-4" />
              </Button>
            </div>
            <h4 className="font-display font-bold text-base text-foreground">
              {activeConversation.title || "Group Conversation"}
            </h4>
            {activeConversation.description && (
              <p className="mt-1 text-xs text-muted-foreground">{activeConversation.description}</p>
            )}
            <div className="mt-4 pt-4 border-t border-border/50 space-y-2.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Members ({groupMembers.length})
              </p>
              {groupMembers.map((m) => {
                const isAdminViewer =
                  activeConversation.my_membership?.role === "owner" ||
                  activeConversation.my_membership?.role === "admin";
                const canRemove =
                  (isAdminViewer && m.user_id !== user?.id) || m.user_id === user?.id;
                return (
                  <div
                    key={m.user_id}
                    className="flex items-center justify-between gap-2 rounded-xl bg-secondary/40 px-2.5 py-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FounderAvatar
                        name={m.profile?.display_name || m.profile?.username || "Member"}
                        src={m.profile?.avatar_url}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">
                          {m.profile?.display_name || m.profile?.username || "Member"}
                        </p>
                        <p className="text-[10px] text-muted-foreground capitalize">{m.role}</p>
                      </div>
                    </div>
                    {canRemove && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await removeGroupMember.mutateAsync(m.user_id);
                            toast.success(
                              m.user_id === user?.id ? "You left the group" : "Member removed",
                            );
                            if (m.user_id === user?.id) {
                              closeOverlays();
                              setActiveConversationId(undefined);
                            }
                          } catch (err: any) {
                            toast.error(err?.message || "Could not remove member");
                          }
                        }}
                        className="text-[11px] font-semibold text-destructive hover:underline shrink-0"
                      >
                        {m.user_id === user?.id ? "Leave" : "Remove"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>
        )}

        {peerProfileOpen &&
          activeConversation &&
          activeConversation.type !== "group" &&
          otherUser && (
            <div data-testid="chat-peer-profile-drawer" className="contents">
              <CascadingProfilePanel
                profile={otherUser}
                messages={messages}
                isChatMuted={Boolean(activeConversation.my_membership?.is_muted)}
                isChatArchived={Boolean(activeConversation.my_membership?.is_archived)}
                onToggleChatMute={() => {
                  const nextMuted = !activeConversation.my_membership?.is_muted;
                  updateConvPrefs.mutate(
                    { conversationId: activeConversation.id, isMuted: nextMuted },
                    {
                      onSuccess: () =>
                        toast.success(nextMuted ? "Conversation muted" : "Conversation unmuted"),
                    },
                  );
                }}
                onToggleChatArchive={() => {
                  const nextArchived = !activeConversation.my_membership?.is_archived;
                  updateConvPrefs.mutate(
                    { conversationId: activeConversation.id, isArchived: nextArchived },
                    {
                      onSuccess: () =>
                        toast.success(
                          nextArchived ? "Conversation archived" : "Conversation unarchived",
                        ),
                    },
                  );
                }}
                onClose={closeOverlays}
                onBlocked={() => {
                  clearedByUserRef.current = true;
                  setActiveConversationId(undefined);
                  navigate({ to: basePath, search: {} as any });
                }}
              />
            </div>
          )}
      </div>

      <NewDirectMessageDialog
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        currentUserId={user?.id}
        onStartChat={handleStartDirectChat}
      />
      <NewGroupChatDialog
        open={newGroupOpen}
        onOpenChange={setNewGroupOpen}
        currentUserId={user?.id}
        onCreated={(convId) => {
          setActiveConversationId(convId);
          navigate({ to: basePath, search: { conversationId: convId } as any });
        }}
      />
    </div>
  );
}
