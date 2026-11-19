import { useState, useRef, useEffect, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  ArrowLeft,
  Bell,
  BellOff,
  Bookmark,
  Check,
  CheckCheck,
  Flag,
  Forward,
  Loader2,
  MoreVertical,
  Pencil,
  Pin,
  Reply,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChatAttachmentMenu,
  ChatStickerBubble,
  ChatStickerPicker,
  ResolvedChatMedia,
  VoiceNoteButton,
  formatStickerToken,
  parseStickerMessage,
} from "@/components/chat/ChatAttachmentControls";
import {
  type Conversation,
  type MessageMediaType,
  type PrivateMessage,
  conversationReactionsQuery,
  savedMessagesQuery,
  useSendPrivateMessage,
  useMarkConversationRead,
  useHideConversation,
  useBlockUser,
  useDeletePrivateMessage,
  useEditPrivateMessage,
  useTogglePinPrivateMessage,
  useToggleMessageReaction,
  useToggleSaveMessage,
  useUpdateConversationPrefs,
  useConversationRealtime,
  useConversationPresence,
} from "@/lib/messages";
import { useAuth } from "@/lib/auth";
import { useChatDraft } from "@/lib/draft-store";
import { supabase } from "@/integrations/supabase/client";
import {
  checkShieldRateLimit,
  detectMediaKind,
  sanitizeUserText,
  validateMediaUpload,
} from "@/lib/shield";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const QUICK_MESSAGE_EMOJIS = ["❤️", "👍", "🔥", "😂", "🙌"] as const;

interface DirectMessageChatProps {
  conversation: Conversation;
  allConversations?: Conversation[];
  messages: PrivateMessage[];
  isLoading?: boolean;
  onBack?: () => void;
  peerProfileOpen?: boolean;
  onTogglePeerProfile?: () => void;
}

export function DirectMessageChat({
  conversation,
  allConversations = [],
  messages,
  isLoading = false,
  onBack,
  peerProfileOpen = false,
  onTogglePeerProfile,
}: DirectMessageChatProps) {
  const { user } = useAuth();
  const [content, setContent, clearDraft] = useChatDraft(`dm:${conversation.id}`);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [failedFile, setFailedFile] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<MessageMediaType | null>(null);
  const [mediaPreviewName, setMediaPreviewName] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [replyingTo, setReplyingTo] = useState<PrivateMessage | null>(null);
  const [editingMsg, setEditingMsg] = useState<PrivateMessage | null>(null);
  const [forwardingMsg, setForwardingMsg] = useState<PrivateMessage | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const lastMarkedRef = useRef<string>("");

  const sendMutation = useSendPrivateMessage();
  const { mutate: markRead } = useMarkConversationRead();
  const hideMutation = useHideConversation();
  const blockMutation = useBlockUser();
  const deleteMessageMutation = useDeletePrivateMessage();
  const editMessageMutation = useEditPrivateMessage(conversation.id);
  const pinMessageMutation = useTogglePinPrivateMessage(conversation.id);
  const reactMessageMutation = useToggleMessageReaction(conversation.id, user?.id);
  const saveMessageMutation = useToggleSaveMessage(user?.id);
  const updatePrefsMutation = useUpdateConversationPrefs(user?.id);

  const messageIds = useMemo(() => messages.map((m) => m.id), [messages]);
  const { data: reactionsMap = {} } = useQuery(
    conversationReactionsQuery(conversation.id, messageIds),
  );
  const { data: savedMessages = new Set<string>() } = useQuery(savedMessagesQuery(user?.id));

  const isGroup = conversation.type === "group";
  const otherUser = conversation.other_member;
  const isMuted = Boolean(conversation.my_membership?.is_muted);
  const isArchived = Boolean(conversation.my_membership?.is_archived);
  const myRole = conversation.my_membership?.role ?? "member";
  const postingRestricted = Boolean(
    isGroup && conversation.only_admins_can_post && myRole !== "owner" && myRole !== "admin",
  );

  useConversationRealtime(conversation.id);
  const { otherOnline, otherTyping, notifyTyping } = useConversationPresence(
    conversation.id,
    user?.id,
    otherUser?.id,
  );

  const pinnedMessages = useMemo(() => messages.filter((m) => Boolean(m.is_pinned)), [messages]);
  const visibleMessages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter(
      (m) =>
        m.content.toLowerCase().includes(q) ||
        (m.sender?.display_name ?? "").toLowerCase().includes(q) ||
        (m.sender?.username ?? "").toLowerCase().includes(q),
    );
  }, [messages, searchQuery]);

  // Auto-scroll to bottom on new message (respects reduced motion)
  useEffect(() => {
    if (searchQuery.trim()) return;
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    messagesEndRef.current?.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }, [messages.length, otherTyping, searchQuery]);

  // Mark as read cleanly without infinite re-trigger
  useEffect(() => {
    if (!conversation.id || !user) return;
    const latestId = messages[messages.length - 1]?.id ?? "empty";
    const key = `${conversation.id}:${messages.length}:${latestId}`;
    if (lastMarkedRef.current === key) return;
    lastMarkedRef.current = key;
    markRead(conversation.id);
  }, [conversation.id, messages, user, markRead]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const cleaned = sanitizeUserText(content);
    if (!cleaned && !mediaUrl) return;
    if (!user || postingRestricted) return;

    // Handle editing an existing message
    if (editingMsg) {
      try {
        await editMessageMutation.mutateAsync({ messageId: editingMsg.id, content: cleaned });
        setEditingMsg(null);
        clearDraft();
        toast.success("Message updated");
      } catch (err: any) {
        toast.error(err?.message || "Couldn't edit message.");
      }
      return;
    }

    const rateCheck = checkShieldRateLimit("send_message", user.id);
    if (!rateCheck.allowed) {
      toast.error(rateCheck.reason || "You are sending messages too quickly.");
      return;
    }

    const currentMediaUrl = mediaUrl;
    const currentMediaType = mediaType;
    const currentReply = replyingTo;

    const outgoingContent = currentReply
      ? `↩ ${currentReply.sender?.display_name || currentReply.sender?.username || "Reply"}: "${currentReply.content.slice(0, 80)}"\n${cleaned}`
      : cleaned;

    try {
      clearDraft();
      notifyTyping(false);
      setMediaUrl(null);
      setMediaType(null);
      setMediaPreviewName(null);
      setUploadError(null);
      setFailedFile(null);
      setReplyingTo(null);

      await sendMutation.mutateAsync({
        conversationId: conversation.id,
        content: outgoingContent,
        mediaUrl: currentMediaUrl,
        mediaType: currentMediaType,
      });
    } catch (err: any) {
      setContent((prev) => prev || cleaned);
      if (currentMediaUrl) {
        setMediaUrl(currentMediaUrl);
        setMediaType(currentMediaType);
      }
      if (currentReply) setReplyingTo(currentReply);
      toast.error(err?.message || "Failed to send message — your draft was kept.");
    }
  };

  const handleForwardToConversation = async (targetConversationId: string) => {
    if (!forwardingMsg || !user) return;
    try {
      const forwardedText = forwardingMsg.content
        ? `↪ Forwarded:\n${forwardingMsg.content}`
        : "↪ Forwarded attachment";
      await sendMutation.mutateAsync({
        conversationId: targetConversationId,
        content: forwardedText,
        mediaUrl: forwardingMsg.media_url,
        mediaType: forwardingMsg.media_type,
      });
      toast.success("Message forwarded");
      setForwardingMsg(null);
    } catch (err: any) {
      toast.error(err?.message || "Could not forward message");
    }
  };

  const handleSendSticker = async (stickerToken: string) => {
    if (!user || postingRestricted) return;
    const rateCheck = checkShieldRateLimit("send_message", user.id);
    if (!rateCheck.allowed) {
      toast.error(rateCheck.reason || "You are sending messages too quickly.");
      return;
    }
    try {
      await sendMutation.mutateAsync({
        conversationId: conversation.id,
        content: stickerToken,
      });
    } catch (err: any) {
      toast.error(err?.message || "Couldn't send sticker.");
    }
  };

  const uploadSelectedFile = async (file: File) => {
    if (!user) return;

    const detectedKind = detectMediaKind(file);
    const check = validateMediaUpload(
      { type: file.type, size: file.size, name: file.name },
      detectedKind,
    );
    if (!check.valid) {
      const errMsg = check.error || "Unsupported attachment";
      setUploadError(errMsg);
      toast.error(errMsg);
      return;
    }

    try {
      setIsUploading(true);
      setUploadError(null);
      setFailedFile(null);
      const { uploadPrivateDmMedia } = await import("@/lib/storage");
      const fallbackExt =
        detectedKind === "video"
          ? "mp4"
          : detectedKind === "audio"
            ? "webm"
            : detectedKind === "document"
              ? "bin"
              : "jpg";
      const ext = file.name.split(".").pop()?.toLowerCase() || fallbackExt;
      const path = `${user.id}/dm/${conversation.id}/${Date.now()}.${ext}`;

      const { storageRef } = await uploadPrivateDmMedia(path, file, file.name);
      setMediaUrl(storageRef);
      setMediaType(detectedKind);
      setMediaPreviewName(file.name);
      toast.success("Private attachment ready");
    } catch (err: any) {
      const { formatStorageUploadError } = await import("@/lib/storage");
      const msg = formatStorageUploadError(err, "Upload failed");
      setUploadError(msg);
      setFailedFile(file);
      toast.error(msg);
    } finally {
      setIsUploading(false);
    }
  };

  const handleReportUser = async () => {
    if (!otherUser || !user) return;
    try {
      const { error } = await supabase.from("profile_reports").insert({
        reported_user_id: otherUser.id,
        reporter_id: user.id,
        reason: "Direct message abuse or spam",
        details: `Reported from conversation ${conversation.id}`,
      });
      if (error) throw error;
      toast.success(`Reported @${otherUser.username} to moderation.`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : `Couldn't submit report for @${otherUser.username}.`,
      );
    }
  };

  const forwardTargets = allConversations.filter((c) => c.id !== conversation.id);

  return (
    <div
      data-no-gesture="true"
      className="flex flex-col h-full bg-card/60 rounded-3xl border border-border/70 overflow-hidden shadow-soft"
    >
      {/* 1. CHAT HEADER */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-card/90 backdrop-blur-md">
        <div className="flex items-center gap-3 min-w-0">
          {onBack && (
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden rounded-full size-8 shrink-0"
              onClick={onBack}
              aria-label="Back to conversations"
            >
              <ArrowLeft className="size-5" />
            </Button>
          )}

          {isGroup ? (
            <button
              type="button"
              onClick={onTogglePeerProfile}
              className="flex items-center gap-2.5 text-left min-w-0"
            >
              <div className="size-9 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0">
                <Users className="size-4" />
              </div>
              <div className="min-w-0">
                <h3 className="font-display font-bold text-sm text-foreground truncate">
                  {conversation.title || "Group Conversation"}
                </h3>
                <p className="text-[11px] text-muted-foreground truncate">
                  {conversation.only_admins_can_post
                    ? "Announcements · Only admins can post"
                    : conversation.description || "Group conversation"}
                </p>
              </div>
            </button>
          ) : otherUser ? (
            <Link
              to="/@{$username}"
              params={{ username: otherUser.username }}
              className="flex items-center gap-2.5 group min-w-0"
            >
              <div className="relative shrink-0">
                <FounderAvatar
                  name={otherUser.display_name || otherUser.username}
                  src={otherUser.avatar_url}
                  size="sm"
                />
                {otherOnline && (
                  <span
                    className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-card"
                    title="Active now"
                  />
                )}
              </div>
              <div className="min-w-0">
                <h3 className="font-display font-bold text-sm text-foreground group-hover:text-primary transition-colors truncate">
                  {otherUser.display_name || otherUser.username}
                </h3>
                <p className="text-[11px] text-muted-foreground font-mono truncate">
                  {otherTyping ? (
                    <span className="text-primary font-sans font-semibold">typing…</span>
                  ) : otherOnline ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-sans font-medium">
                      Active now · @{otherUser.username}
                    </span>
                  ) : (
                    `@${otherUser.username}`
                  )}
                </p>
              </div>
            </Link>
          ) : (
            <div className="flex items-center gap-2.5">
              <div className="size-9 rounded-full bg-muted flex items-center justify-center font-bold text-sm">
                ?
              </div>
              <h3 className="font-display font-bold text-sm">Direct Conversation</h3>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            type="button"
            variant={searchOpen ? "secondary" : "ghost"}
            size="icon"
            className="size-8 rounded-full shrink-0"
            onClick={() => {
              setSearchOpen((prev) => !prev);
              if (searchOpen) setSearchQuery("");
            }}
            aria-label="Search messages in conversation"
            title="Search messages"
          >
            <Search className="size-4 text-muted-foreground" />
          </Button>

          {(otherUser || isGroup) && onTogglePeerProfile && (
            <Button
              type="button"
              variant={peerProfileOpen ? "secondary" : "ghost"}
              size="icon"
              data-testid="chat-peer-profile-toggle"
              className="size-8 rounded-full shrink-0"
              onClick={onTogglePeerProfile}
              aria-label={isGroup ? "Toggle group details" : "Toggle participant profile"}
              aria-expanded={peerProfileOpen}
              title={
                isGroup
                  ? "View group members & settings"
                  : peerProfileOpen
                    ? "Close participant profile"
                    : "View participant details"
              }
            >
              {isGroup ? (
                <Users className="size-4 text-muted-foreground" />
              ) : (
                <User className="size-4 text-muted-foreground" />
              )}
            </Button>
          )}

          {/* Action dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-full shrink-0"
                aria-label="Chat options"
              >
                <MoreVertical className="size-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 rounded-2xl p-1.5">
              <DropdownMenuItem
                className="rounded-xl cursor-pointer"
                onClick={async () => {
                  try {
                    await updatePrefsMutation.mutateAsync({
                      conversationId: conversation.id,
                      isMuted: !isMuted,
                    });
                    toast.success(isMuted ? "Notifications unmuted" : "Conversation muted");
                  } catch (e: any) {
                    toast.error(e.message || "Failed to update mute setting");
                  }
                }}
              >
                {isMuted ? (
                  <>
                    <Bell className="size-4 mr-2" /> Unmute notifications
                  </>
                ) : (
                  <>
                    <BellOff className="size-4 mr-2" /> Mute notifications
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="rounded-xl cursor-pointer"
                onClick={async () => {
                  try {
                    await updatePrefsMutation.mutateAsync({
                      conversationId: conversation.id,
                      isArchived: !isArchived,
                    });
                    toast.success(isArchived ? "Conversation unarchived" : "Conversation archived");
                  } catch (e: any) {
                    toast.error(e.message || "Failed to update archive status");
                  }
                }}
              >
                <Archive className="size-4 mr-2" />
                {isArchived ? "Unarchive chat" : "Archive chat"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {otherUser && !isGroup && (
                <>
                  <DropdownMenuItem
                    className="rounded-xl cursor-pointer"
                    onClick={handleReportUser}
                  >
                    <Flag className="size-4 mr-2" /> Report @{otherUser.username}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="rounded-xl text-destructive focus:text-destructive cursor-pointer"
                    onClick={async () => {
                      try {
                        await blockMutation.mutateAsync(otherUser.id);
                        toast.success(`Blocked @${otherUser.username}`);
                        onBack?.();
                      } catch (e: any) {
                        toast.error(e.message || "Failed to block user");
                      }
                    }}
                  >
                    <ShieldAlert className="size-4 mr-2" /> Block @{otherUser.username}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                className="rounded-xl cursor-pointer"
                onClick={async () => {
                  try {
                    await hideMutation.mutateAsync(conversation.id);
                    toast.success("Conversation hidden");
                    onBack?.();
                  } catch (e: any) {
                    toast.error(e.message || "Failed to hide conversation");
                  }
                }}
              >
                <Trash2 className="size-4 mr-2" /> Delete / Hide Chat
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* IN-CONVERSATION SEARCH BAR */}
      {searchOpen && (
        <div className="px-4 py-2 border-b border-border/50 bg-secondary/40 flex items-center gap-2">
          <Search className="size-3.5 text-muted-foreground shrink-0" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search messages in this chat…"
            className="h-8 text-xs rounded-full bg-card"
            autoFocus
          />
          {searchQuery && (
            <span className="text-[11px] text-muted-foreground shrink-0">
              {visibleMessages.length} match{visibleMessages.length === 1 ? "" : "es"}
            </span>
          )}
        </div>
      )}

      {/* PINNED MESSAGES BANNER */}
      {pinnedMessages.length > 0 && (
        <div className="px-4 py-2 border-b border-border/50 bg-primary/5 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <Pin className="size-3.5 text-primary shrink-0" />
            <span className="truncate font-medium text-foreground">
              Pinned: {pinnedMessages[pinnedMessages.length - 1]?.content || "Attachment"}
            </span>
          </div>
          {pinnedMessages.length > 1 && (
            <span className="text-[10px] text-muted-foreground shrink-0">
              +{pinnedMessages.length - 1} more
            </span>
          )}
        </div>
      )}

      {/* 2. MESSAGE STREAM */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5 scrollbar-thin">
        {isLoading && messages.length === 0 ? (
          <div className="space-y-3 py-4" aria-label="Loading messages">
            <div className="h-10 w-2/3 animate-pulse rounded-2xl bg-secondary/70" />
            <div className="ml-auto h-10 w-1/2 animate-pulse rounded-2xl bg-primary/15" />
            <div className="h-10 w-3/5 animate-pulse rounded-2xl bg-secondary/70" />
          </div>
        ) : visibleMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground">
            <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <Send className="size-5 text-primary" />
            </div>
            <p className="font-display font-bold text-foreground text-sm">
              {searchQuery
                ? "No matching messages"
                : isGroup
                  ? conversation.title || "Group Conversation"
                  : "Private Direct Message"}
            </p>
            <p className="text-xs text-muted-foreground max-w-xs mt-1">
              {searchQuery
                ? `No messages contain "${searchQuery}".`
                : isGroup
                  ? "Start the conversation with your group."
                  : `Say hello! Only you and ${otherUser?.display_name || "this member"} can read these messages.`}
            </p>
          </div>
        ) : (
          visibleMessages.map((msg) => {
            const isMe = msg.sender_id === user?.id;
            const msgReactions = reactionsMap[msg.id] ?? [];
            const isSaved = savedMessages.has(msg.id);
            const reactionTally = new Map<string, { count: number; mine: boolean }>();
            for (const r of msgReactions) {
              const curr = reactionTally.get(r.emoji) ?? { count: 0, mine: false };
              curr.count += 1;
              if (r.user_id === user?.id) curr.mine = true;
              reactionTally.set(r.emoji, curr);
            }

            return (
              <div
                key={msg.id}
                className={cn("group flex flex-col max-w-[84%] sm:max-w-[72%]", {
                  "ml-auto items-end": isMe,
                  "mr-auto items-start": !isMe,
                })}
              >
                {isGroup && !isMe && msg.sender && (
                  <span className="mb-0.5 px-1 text-[10px] font-semibold text-muted-foreground">
                    {msg.sender.display_name || `@${msg.sender.username}`}
                  </span>
                )}

                <div className="flex items-end gap-1.5">
                  <div
                    className={cn("rounded-2xl px-4 py-2.5 shadow-sm text-sm break-words", {
                      "bg-primary text-primary-foreground rounded-br-sm": isMe,
                      "bg-secondary text-foreground border border-border/60 rounded-bl-sm": !isMe,
                    })}
                  >
                    {msg.is_pinned && (
                      <div className="mb-1 flex items-center gap-1 text-[10px] opacity-80">
                        <Pin className="size-2.5" /> Pinned
                      </div>
                    )}

                    {msg.media_url && (
                      <div className="mb-2 rounded-xl overflow-hidden">
                        <ResolvedChatMedia mediaUrl={msg.media_url} mediaType={msg.media_type} />
                      </div>
                    )}

                    {(() => {
                      const sticker = !msg.media_url ? parseStickerMessage(msg.content) : null;
                      if (sticker) {
                        return <ChatStickerBubble sticker={sticker} />;
                      }
                      return msg.content ? (
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      ) : null;
                    })()}
                  </div>
                </div>

                {/* Message reactions pills */}
                {reactionTally.size > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1 px-1">
                    {Array.from(reactionTally.entries()).map(([emoji, info]) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => reactMessageMutation.mutate({ messageId: msg.id, emoji })}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px]",
                          info.mine
                            ? "border-primary/50 bg-primary/15 text-foreground font-semibold"
                            : "border-border/70 bg-card text-muted-foreground",
                        )}
                      >
                        <span>{emoji}</span>
                        <span>{info.count}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Quick message actions + timestamp */}
                <div className="flex flex-wrap items-center gap-1.5 mt-1 px-1 text-[10px] text-muted-foreground font-mono">
                  <span>{format(new Date(msg.created_at), "h:mm a")}</span>
                  {msg.edited_at && <span className="italic font-sans">edited</span>}
                  {isMe && (
                    <span title={msg.status === "read" ? "Read" : "Sent"}>
                      {msg.status === "sending" ? (
                        <Loader2 className="size-3 animate-spin text-muted-foreground" />
                      ) : msg.status === "read" ? (
                        <CheckCheck className="size-3 text-primary font-bold" />
                      ) : (
                        <Check className="size-3 text-muted-foreground" />
                      )}
                    </span>
                  )}

                  <div className="flex items-center gap-0.5 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity ml-1">
                    {QUICK_MESSAGE_EMOJIS.slice(0, 3).map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => reactMessageMutation.mutate({ messageId: msg.id, emoji })}
                        className="rounded-full px-1 py-0.5 text-[11px] hover:bg-secondary"
                        aria-label={`React ${emoji}`}
                      >
                        {emoji}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setEditingMsg(null);
                        setReplyingTo(msg);
                      }}
                      className="p-1 rounded-full hover:bg-secondary hover:text-foreground"
                      aria-label="Reply to message"
                      title="Reply"
                    >
                      <Reply className="size-3" />
                    </button>
                    {forwardTargets.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setForwardingMsg(msg)}
                        className="p-1 rounded-full hover:bg-secondary hover:text-foreground"
                        aria-label="Forward message"
                        title="Forward"
                      >
                        <Forward className="size-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        saveMessageMutation.mutate(
                          { messageId: msg.id, currentlySaved: isSaved },
                          {
                            onSuccess: (saved) =>
                              toast.success(saved ? "Message saved" : "Removed from saved"),
                          },
                        );
                      }}
                      className={cn(
                        "p-1 rounded-full hover:bg-secondary",
                        isSaved ? "text-primary" : "hover:text-foreground",
                      )}
                      aria-label={isSaved ? "Unsave message" : "Save message"}
                      title={isSaved ? "Saved" : "Save message"}
                    >
                      <Bookmark className={cn("size-3", isSaved && "fill-current")} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        pinMessageMutation.mutate(msg.id, {
                          onSuccess: (res) =>
                            toast.success(res.is_pinned ? "Message pinned" : "Message unpinned"),
                          onError: (err) =>
                            toast.error(err instanceof Error ? err.message : "Could not pin"),
                        });
                      }}
                      className="p-1 rounded-full hover:bg-secondary hover:text-foreground"
                      aria-label="Pin message"
                      title="Pin message"
                    >
                      <Pin className="size-3" />
                    </button>
                    {isMe && !msg.media_url && (
                      <button
                        type="button"
                        onClick={() => {
                          setReplyingTo(null);
                          setEditingMsg(msg);
                          setContent(msg.content);
                        }}
                        className="p-1 rounded-full hover:bg-secondary hover:text-foreground"
                        aria-label="Edit message"
                        title="Edit message"
                      >
                        <Pencil className="size-3" />
                      </button>
                    )}
                    {isMe && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await deleteMessageMutation.mutateAsync({
                              messageId: msg.id,
                              conversationId: conversation.id,
                            });
                            toast.success("Message removed");
                          } catch {
                            toast.error("Couldn't remove message");
                          }
                        }}
                        className="p-1 rounded-full text-muted-foreground hover:text-destructive"
                        aria-label="Delete message"
                        title="Unsend message"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {otherTyping && (
          <div className="mr-auto flex items-center gap-2 rounded-2xl rounded-bl-sm bg-secondary px-3.5 py-2 text-xs text-muted-foreground border border-border/50">
            <span className="flex gap-1">
              <span className="size-1.5 rounded-full bg-primary animate-bounce" />
              <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
              <span className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
            </span>
            <span>{otherUser?.display_name || "Member"} is typing…</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Upload failure recovery banner */}
      {uploadError && (
        <div
          role="alert"
          className="px-4 py-2 bg-destructive/10 border-t border-destructive/30 flex items-center justify-between gap-2 text-xs"
        >
          <span className="text-destructive truncate">{uploadError}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            {failedFile && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-full text-[11px] gap-1"
                onClick={() => void uploadSelectedFile(failedFile)}
              >
                <RotateCcw className="size-3" /> Retry
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 rounded-full"
              onClick={() => {
                setUploadError(null);
                setFailedFile(null);
              }}
              aria-label="Dismiss attachment error"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Reply or Edit Context Banner */}
      {(replyingTo || editingMsg) && (
        <div className="px-4 py-2 bg-primary/10 border-t border-primary/20 flex items-center justify-between gap-2 text-xs">
          <div className="min-w-0">
            <span className="font-semibold text-primary">
              {editingMsg
                ? "Editing message"
                : `Replying to ${replyingTo?.sender?.display_name || replyingTo?.sender?.username || "message"}`}
            </span>
            <p className="truncate text-muted-foreground">{(editingMsg ?? replyingTo)?.content}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 rounded-full shrink-0"
            onClick={() => {
              setReplyingTo(null);
              if (editingMsg) {
                setEditingMsg(null);
                clearDraft();
              }
            }}
            aria-label="Cancel reply or edit"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      )}

      {/* Media upload preview banner */}
      {mediaUrl && (
        <div className="px-4 py-2 bg-secondary/40 border-t border-border/50 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="max-w-[140px] max-h-12 overflow-hidden rounded-lg">
              <ResolvedChatMedia mediaUrl={mediaUrl} mediaType={mediaType} />
            </div>
            <span className="text-xs font-semibold text-primary truncate">
              {mediaPreviewName || "Attachment ready to send"}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 rounded-full text-destructive shrink-0"
            onClick={() => {
              setMediaUrl(null);
              setMediaType(null);
              setMediaPreviewName(null);
            }}
            aria-label="Remove attachment"
          >
            <X className="size-4" />
          </Button>
        </div>
      )}

      {/* 3. INPUT COMPOSER */}
      {postingRestricted ? (
        <div className="p-3.5 border-t border-border/60 bg-secondary/40 text-center text-xs text-muted-foreground">
          Only group admins can post announcements in this conversation.
        </div>
      ) : (
        <form
          onSubmit={handleSend}
          className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-border/60 bg-card/90 backdrop-blur-md flex items-center gap-1.5"
        >
          {!editingMsg && (
            <>
              <ChatAttachmentMenu
                onFileSelected={uploadSelectedFile}
                loading={isUploading}
                disabled={sendMutation.isPending}
              />
              <ChatStickerPicker
                onSelect={(sticker) => void handleSendSticker(formatStickerToken(sticker))}
                disabled={sendMutation.isPending || isUploading}
              />
              <VoiceNoteButton
                onRecorded={uploadSelectedFile}
                disabled={sendMutation.isPending || isUploading}
              />
            </>
          )}

          <Input
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              notifyTyping(e.target.value.trim().length > 0);
            }}
            onFocus={(e) => {
              e.currentTarget.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }}
            placeholder={
              editingMsg
                ? "Edit your message…"
                : isGroup
                  ? `Message ${conversation.title || "group"}…`
                  : `Message ${otherUser?.display_name || ""}…`
            }
            className="flex-1 min-w-0 rounded-full bg-secondary/50 border-border/60 px-4 py-2 text-sm focus-visible:ring-primary"
            disabled={sendMutation.isPending || editMessageMutation.isPending}
            maxLength={5000}
          />

          <Button
            type="submit"
            size="icon"
            className="size-9 rounded-full shrink-0 bg-primary text-primary-foreground font-bold shadow-sm active:scale-95 transition-transform"
            disabled={
              (!content.trim() && !mediaUrl) ||
              sendMutation.isPending ||
              editMessageMutation.isPending
            }
            aria-label={editingMsg ? "Save edited message" : "Send message"}
          >
            {editingMsg ? <Check className="size-4" /> : <Send className="size-4" />}
          </Button>
        </form>
      )}

      {/* Forward Message Dialog */}
      <Dialog open={Boolean(forwardingMsg)} onOpenChange={(o) => !o && setForwardingMsg(null)}>
        <DialogContent className="sm:max-w-sm rounded-3xl p-5">
          <DialogHeader>
            <DialogTitle className="font-display text-base">Forward message</DialogTitle>
            <DialogDescription className="text-xs">
              Select a conversation to forward this message to.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto">
            {forwardTargets.map((target) => (
              <button
                key={target.id}
                type="button"
                disabled={sendMutation.isPending}
                onClick={() => void handleForwardToConversation(target.id)}
                className="w-full flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-secondary/40 hover:bg-secondary p-2.5 text-left text-xs"
              >
                <span className="font-semibold truncate">
                  {target.type === "group"
                    ? target.title || "Group Chat"
                    : target.other_member?.display_name ||
                      target.other_member?.username ||
                      "Direct Chat"}
                </span>
                <span className="text-primary font-semibold shrink-0">Send</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
