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
  ChevronDown,
  Copy,
  Flag,
  Forward,
  Loader2,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  Reply,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  Timer,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { FounderAvatar } from "@/components/ping/Avatar";
import { VerificationBadge } from "@/components/verification/VerificationBadge";
import { MessageEmojiPicker, recordRecentEmoji } from "@/components/messages/MessageEmojiPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
  useAcceptMessageRequest,
  useDeclineMessageRequest,
  useDeletePrivateMessage,
  useEditPrivateMessage,
  useTogglePinPrivateMessage,
  useToggleMessageReaction,
  useToggleSaveMessage,
  useUpdateConversationPrefs,
  useConversationRealtime,
  useConversationPresence,
} from "@/lib/messages";
import { useUserPrivacy } from "@/lib/privacy";
import {
  CHAT_RETENTION_POLICIES,
  computeEffectiveConversationMaxPolicy,
  formatMessageExpiryBadge,
  formatStorageBytes,
  getRetentionPolicyMeta,
  isPolicyAllowedByMax,
  useMyChatRetentionEntitlement,
  useSetConversationRetention,
  type ChatRetentionPolicy,
} from "@/lib/chat-retention";
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
import { format, isSameDay, isToday, isYesterday } from "date-fns";

const QUICK_MESSAGE_EMOJIS = ["❤️", "👍", "🔥", "😂", "🙌"] as const;

function formatChatDateSeparator(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEE, MMM d, yyyy");
}

function formatMessageSummary(msg: PrivateMessage | null | undefined): string {
  if (!msg) return "Attachment";
  if (msg.content) return msg.content;
  if (msg.media_type === "audio") return "Voice message";
  if (msg.media_type === "image") return "Photo";
  if (msg.media_type === "video") return "Video";
  return "Attachment";
}

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
  const [pinnedPanelOpen, setPinnedPanelOpen] = useState(false);
  const [retentionDialogOpen, setRetentionDialogOpen] = useState(false);
  const [mobileActionMsg, setMobileActionMsg] = useState<PrivateMessage | null>(null);
  const [swipeState, setSwipeState] = useState<{ id: string; dx: number } | null>(null);
  const touchOriginRef = useRef<{
    id: string;
    x: number;
    y: number;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);

  const initialUnreadCountRef = useRef<number>(conversation.unread_count ?? 0);
  useEffect(() => {
    initialUnreadCountRef.current = conversation.unread_count ?? 0;
  }, [conversation.id, conversation.unread_count]);

  // Clear pending composer attachments/reply/edit state when switching conversations
  useEffect(() => {
    setMediaUrl(null);
    setMediaType(null);
    setMediaPreviewName(null);
    setUploadError(null);
    setFailedFile(null);
    setReplyingTo(null);
    setEditingMsg(null);
  }, [conversation.id]);

  const handleCopyMessage = async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Message copied");
    } catch {
      toast.error("Couldn't copy message");
    }
  };

  const handleReactMessage = (messageId: string, emoji: string) => {
    recordRecentEmoji(emoji);
    reactMessageMutation.mutate({ messageId, emoji });
  };

  const scrollToMessage = (messageId: string) => {
    if (typeof document === "undefined") return;
    const el = document.getElementById(`dm-msg-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setPinnedPanelOpen(false);
    }
  };

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const lastMarkedRef = useRef<string>("");

  const sendMutation = useSendPrivateMessage();
  const { mutate: markRead } = useMarkConversationRead();
  const hideMutation = useHideConversation();
  const blockMutation = useBlockUser();
  const acceptRequestMutation = useAcceptMessageRequest();
  const declineRequestMutation = useDeclineMessageRequest();
  const deleteMessageMutation = useDeletePrivateMessage();
  const editMessageMutation = useEditPrivateMessage(conversation.id);
  const pinMessageMutation = useTogglePinPrivateMessage(conversation.id);
  const reactMessageMutation = useToggleMessageReaction(conversation.id, user?.id);
  const saveMessageMutation = useToggleSaveMessage(user?.id, conversation.id);
  const updatePrefsMutation = useUpdateConversationPrefs(user?.id);
  const setRetentionMutation = useSetConversationRetention(conversation.id);
  const { preferences: myPrivacy } = useUserPrivacy(user?.id);
  const { data: retentionEntitlement } = useMyChatRetentionEntitlement(user?.id);
  const retentionEnabled = Boolean(retentionEntitlement?.feature_enabled);
  const activeRetentionPolicy = (conversation.retention_policy ?? "7d") as ChatRetentionPolicy;
  const activeRetentionMeta = getRetentionPolicyMeta(activeRetentionPolicy);
  const effectiveConversationMaxPolicy = useMemo<ChatRetentionPolicy>(() => {
    const ceilings: ChatRetentionPolicy[] = [];
    if (retentionEntitlement?.max_retention_policy) {
      ceilings.push(retentionEntitlement.max_retention_policy);
    }
    if (conversation.effective_max_retention_policy) {
      ceilings.push(conversation.effective_max_retention_policy);
    }
    return ceilings.length > 0 ? computeEffectiveConversationMaxPolicy(ceilings) : "7d";
  }, [retentionEntitlement?.max_retention_policy, conversation.effective_max_retention_policy]);

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
  const requestStatus = conversation.request_status ?? "accepted";
  const isIncomingPendingRequest =
    !isGroup &&
    requestStatus === "pending" &&
    Boolean(user?.id) &&
    conversation.request_recipient_id === user?.id;
  const isOutgoingPendingRequest =
    !isGroup &&
    requestStatus === "pending" &&
    Boolean(user?.id) &&
    conversation.requested_by === user?.id;
  const isDeclinedRequest = !isGroup && requestStatus === "declined";
  const mySentCount = useMemo(
    () => (user?.id ? messages.filter((m) => m.sender_id === user.id).length : 0),
    [messages, user?.id],
  );
  const outgoingRequestLimitReached = isOutgoingPendingRequest && mySentCount >= 1;
  const postingRestricted = Boolean(
    (isGroup && conversation.only_admins_can_post && myRole !== "owner" && myRole !== "admin") ||
    isIncomingPendingRequest ||
    isDeclinedRequest ||
    outgoingRequestLimitReached,
  );
  const mediaRestricted = isOutgoingPendingRequest || postingRestricted;

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
    messagesEndRef.current?.scrollIntoView?.({
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
      ? `↩ ${currentReply.sender?.display_name || currentReply.sender?.username || "Reply"}: "${formatMessageSummary(currentReply).slice(0, 80)}"\n${cleaned}`
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
      let forwardedMediaUrl = forwardingMsg.media_url;
      if (forwardedMediaUrl) {
        const { isPrivateDmMediaRef, forwardPrivateDmAttachment } = await import("@/lib/storage");
        if (isPrivateDmMediaRef(forwardedMediaUrl)) {
          const copied = await forwardPrivateDmAttachment(
            forwardedMediaUrl,
            targetConversationId,
            user.id,
            forwardingMsg.media_type,
          );
          forwardedMediaUrl = copied.storagePath;
        }
      }

      const forwardedText = forwardingMsg.content
        ? `↪ Forwarded:\n${forwardingMsg.content}`
        : forwardingMsg.media_type === "audio"
          ? "↪ Forwarded voice message"
          : "↪ Forwarded attachment";
      await sendMutation.mutateAsync({
        conversationId: targetConversationId,
        content: forwardedText,
        mediaUrl: forwardedMediaUrl,
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
    if (mediaRestricted) {
      toast.error("Attachments are only enabled once a message request is accepted.");
      return;
    }

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
      const { buildDmAttachmentPath, uploadPrivateDmMedia } = await import("@/lib/storage");
      const fallbackExt =
        detectedKind === "video"
          ? "mp4"
          : detectedKind === "audio"
            ? "webm"
            : detectedKind === "document"
              ? "bin"
              : "jpg";
      const path = buildDmAttachmentPath(conversation.id, user.id, file.name, fallbackExt);

      const { storagePath } = await uploadPrivateDmMedia(path, file, file.name, {
        conversationId: conversation.id,
        ownerId: user.id,
      });
      setMediaUrl(storagePath);
      setMediaType(detectedKind);
      setMediaPreviewName(file.name);
      toast.success("Private attachment ready");
    } catch (err: any) {
      const { DM_MEDIA_BUCKET, formatStorageUploadError } = await import("@/lib/storage");
      const msg = formatStorageUploadError(err, "Upload failed", DM_MEDIA_BUCKET);
      setUploadError(msg);
      setFailedFile(file);
      toast.error(msg);
    } finally {
      setIsUploading(false);
    }
  };

  const uploadSelectedFiles = async (files: File[]) => {
    if (!user || files.length === 0) return;
    if (mediaRestricted) {
      toast.error("Attachments are only enabled once a message request is accepted.");
      return;
    }
    if (files.length === 1 && files[0]) {
      await uploadSelectedFile(files[0]);
      return;
    }

    const rateCheck = checkShieldRateLimit("send_message", user.id);
    if (!rateCheck.allowed) {
      toast.error(rateCheck.reason || "You are sending messages too quickly.");
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    setFailedFile(null);

    try {
      const { buildDmAttachmentPath, uploadPrivateDmMedia } = await import("@/lib/storage");
      let sentCount = 0;

      for (const file of files) {
        const detectedKind = detectMediaKind(file);
        const check = validateMediaUpload(
          { type: file.type, size: file.size, name: file.name },
          detectedKind,
        );
        if (!check.valid) {
          toast.error(check.error || `Skipped unsupported file ${file.name}`);
          continue;
        }
        const fallbackExt =
          detectedKind === "video"
            ? "mp4"
            : detectedKind === "audio"
              ? "webm"
              : detectedKind === "document"
                ? "bin"
                : "jpg";
        const path = buildDmAttachmentPath(conversation.id, user.id, file.name, fallbackExt);
        const { storagePath } = await uploadPrivateDmMedia(path, file, file.name, {
          conversationId: conversation.id,
          ownerId: user.id,
        });
        await sendMutation.mutateAsync({
          conversationId: conversation.id,
          content: "",
          mediaUrl: storagePath,
          mediaType: detectedKind,
        });
        sentCount += 1;
      }

      if (sentCount > 0) {
        toast.success(`Sent ${sentCount} private attachments`);
      }
    } catch (err: any) {
      const { DM_MEDIA_BUCKET, formatStorageUploadError } = await import("@/lib/storage");
      const msg = formatStorageUploadError(err, "Upload failed", DM_MEDIA_BUCKET);
      setUploadError(msg);
      toast.error(msg);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSendVoiceNote = async (file: File) => {
    if (!user || mediaRestricted) {
      throw new Error(
        isOutgoingPendingRequest
          ? "Voice messages are available once the recipient accepts your request."
          : "Sign in to send voice messages.",
      );
    }

    const check = validateMediaUpload(
      { type: file.type, size: file.size, name: file.name },
      "audio",
    );
    if (!check.valid) {
      const errMsg = check.error || "Invalid voice note recording.";
      toast.error(errMsg);
      throw new Error(errMsg);
    }

    const rateCheck = checkShieldRateLimit("send_message", user.id);
    if (!rateCheck.allowed) {
      const errMsg = rateCheck.reason || "You are sending messages too quickly.";
      toast.error(errMsg);
      throw new Error(errMsg);
    }

    try {
      const { buildDmAttachmentPath, uploadPrivateDmMedia } = await import("@/lib/storage");
      const path = buildDmAttachmentPath(conversation.id, user.id, file.name, "webm");
      const { storagePath } = await uploadPrivateDmMedia(path, file, file.name, {
        conversationId: conversation.id,
        ownerId: user.id,
        optimizeImage: false,
      });

      await sendMutation.mutateAsync({
        conversationId: conversation.id,
        content: "",
        mediaUrl: storagePath,
        mediaType: "audio",
      });
    } catch (err: any) {
      const { DM_MEDIA_BUCKET, formatStorageUploadError } = await import("@/lib/storage");
      const msg = formatStorageUploadError(err, "Voice note upload failed.", DM_MEDIA_BUCKET);
      toast.error(msg);
      throw new Error(msg);
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

  const forwardTargets = allConversations.filter(
    (c) => c.id !== conversation.id && (c.request_status ?? "accepted") === "accepted",
  );

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
            onTogglePeerProfile ? (
              <button
                type="button"
                onClick={onTogglePeerProfile}
                data-testid="chat-header-profile-trigger"
                className="flex items-center gap-2.5 group min-w-0 text-left rounded-2xl px-1 py-0.5 hover:bg-secondary/60 transition-colors"
                title={`Inspect ${otherUser.display_name || otherUser.username}'s profile`}
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
                  <span className="flex items-center gap-1 min-w-0">
                    <h3 className="font-display font-bold text-sm text-foreground group-hover:text-primary transition-colors truncate">
                      {otherUser.display_name || otherUser.username}
                    </h3>
                    <VerificationBadge userId={otherUser.id} size="xs" />
                  </span>
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
              </button>
            ) : (
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
                  <span className="flex items-center gap-1 min-w-0">
                    <h3 className="font-display font-bold text-sm text-foreground group-hover:text-primary transition-colors truncate">
                      {otherUser.display_name || otherUser.username}
                    </h3>
                    <VerificationBadge userId={otherUser.id} size="xs" />
                  </span>
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
            )
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
          {retentionEnabled && (
            <button
              type="button"
              data-testid="conversation-retention-badge"
              onClick={() => setRetentionDialogOpen(true)}
              className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-secondary/60 hover:bg-secondary px-2.5 py-1 text-[11px] font-semibold text-foreground transition-colors shrink-0"
              aria-label={`Chat retention: ${activeRetentionMeta.label}`}
              title={`Chat retention: ${activeRetentionMeta.label} (click to configure)`}
            >
              <Timer className="size-3 text-primary" />
              <span className="hidden sm:inline">{activeRetentionMeta.shortLabel}</span>
            </button>
          )}
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

      {/* PINNED MESSAGES BANNER & EXPANDABLE PANEL */}
      {pinnedMessages.length > 0 && (
        <div className="border-b border-border/50 bg-primary/5">
          <button
            type="button"
            onClick={() => setPinnedPanelOpen((v) => !v)}
            data-testid="pinned-messages-toggle"
            className="w-full px-4 py-2 flex items-center justify-between gap-2 text-xs hover:bg-primary/10 transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Pin className="size-3.5 text-primary shrink-0" />
              <span className="truncate font-medium text-foreground">
                Pinned: {formatMessageSummary(pinnedMessages[pinnedMessages.length - 1])}
              </span>
            </div>
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary shrink-0">
              {pinnedMessages.length} pinned
              <ChevronDown
                className={cn("size-3 transition-transform", pinnedPanelOpen && "rotate-180")}
              />
            </span>
          </button>

          {pinnedPanelOpen && (
            <div
              data-testid="pinned-messages-panel"
              className="px-4 pb-2.5 pt-1 space-y-1.5 max-h-40 overflow-y-auto border-t border-border/40"
            >
              {pinnedMessages.map((pm) => (
                <div
                  key={`pin-${pm.id}`}
                  className="flex items-center justify-between gap-2 rounded-xl bg-card/80 border border-border/60 px-3 py-1.5 text-xs"
                >
                  <button
                    type="button"
                    onClick={() => scrollToMessage(pm.id)}
                    className="min-w-0 flex-1 text-left truncate text-foreground hover:text-primary"
                  >
                    {formatMessageSummary(pm)}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      pinMessageMutation.mutate(pm.id, {
                        onSuccess: () => toast.success("Message unpinned"),
                      })
                    }
                    className="text-[10px] font-semibold text-muted-foreground hover:text-destructive inline-flex items-center gap-1 shrink-0"
                    aria-label="Unpin message"
                  >
                    <PinOff className="size-3" /> Unpin
                  </button>
                </div>
              ))}
            </div>
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
          visibleMessages.map((msg, idx) => {
            const prevMsg = idx > 0 ? visibleMessages[idx - 1] : null;
            const showDateSep =
              !prevMsg || !isSameDay(new Date(prevMsg.created_at), new Date(msg.created_at));
            const unreadThresholdIdx =
              !searchQuery && initialUnreadCountRef.current > 0
                ? Math.max(0, visibleMessages.length - initialUnreadCountRef.current)
                : -1;
            const showUnreadSep = idx === unreadThresholdIdx && msg.sender_id !== user?.id;

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

            const swipeDx = swipeState?.id === msg.id ? swipeState.dx : 0;

            return (
              <div key={msg.id} id={`dm-msg-${msg.id}`} className="space-y-2">
                {showDateSep && (
                  <div
                    data-testid="chat-date-separator"
                    className="flex items-center justify-center py-1.5"
                  >
                    <span className="rounded-full bg-secondary/80 border border-border/60 px-3 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      {formatChatDateSeparator(msg.created_at)}
                    </span>
                  </div>
                )}

                {showUnreadSep && (
                  <div
                    data-testid="chat-unread-separator"
                    className="flex items-center gap-2 py-1 text-[10px] font-bold uppercase tracking-wider text-primary"
                  >
                    <span className="h-px flex-1 bg-primary/30" />
                    <span>Unread messages</span>
                    <span className="h-px flex-1 bg-primary/30" />
                  </div>
                )}

                {msg.is_system ? (
                  <div
                    data-testid="chat-system-notice"
                    className="flex items-center justify-center py-1"
                  >
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-medium text-foreground">
                      <Timer className="size-3 text-primary shrink-0" />
                      <span>{msg.content}</span>
                    </span>
                  </div>
                ) : (
                  <div
                    style={
                      swipeDx > 0
                        ? { transform: `translateX(${Math.min(56, swipeDx)}px)` }
                        : undefined
                    }
                    onTouchStart={(e) => {
                      const touch = e.touches[0];
                      if (!touch) return;
                      const timer = setTimeout(() => {
                        setMobileActionMsg(msg);
                      }, 520);
                      touchOriginRef.current = {
                        id: msg.id,
                        x: touch.clientX,
                        y: touch.clientY,
                        timer,
                      };
                    }}
                    onTouchMove={(e) => {
                      const origin = touchOriginRef.current;
                      const touch = e.touches[0];
                      if (!origin || !touch || origin.id !== msg.id) return;
                      const dx = touch.clientX - origin.x;
                      const dy = Math.abs(touch.clientY - origin.y);
                      if (Math.abs(dx) > 10 || dy > 10) {
                        if (origin.timer) {
                          clearTimeout(origin.timer);
                          origin.timer = null;
                        }
                      }
                      if (dx > 12 && dy < 32) {
                        setSwipeState({ id: msg.id, dx: Math.min(60, dx) });
                      }
                    }}
                    onTouchEnd={() => {
                      const origin = touchOriginRef.current;
                      if (origin?.timer) clearTimeout(origin.timer);
                      if (swipeState?.id === msg.id && swipeState.dx >= 44) {
                        setEditingMsg(null);
                        setReplyingTo(msg);
                      }
                      touchOriginRef.current = null;
                      setSwipeState(null);
                    }}
                    className={cn(
                      "group flex flex-col max-w-[84%] sm:max-w-[72%] transition-transform",
                      {
                        "ml-auto items-end": isMe,
                        "mr-auto items-start": !isMe,
                      },
                    )}
                  >
                    {isGroup && !isMe && msg.sender && (
                      <span className="mb-0.5 px-1 text-[10px] font-semibold text-muted-foreground">
                        {msg.sender.display_name || `@${msg.sender.username}`}
                      </span>
                    )}

                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <div className="flex items-end gap-1.5">
                          <div
                            className={cn("rounded-2xl px-4 py-2.5 shadow-sm text-sm break-words", {
                              "bg-primary text-primary-foreground rounded-br-sm": isMe,
                              "bg-secondary text-foreground border border-border/60 rounded-bl-sm":
                                !isMe,
                            })}
                          >
                            {msg.is_pinned && (
                              <div className="mb-1 flex items-center gap-1 text-[10px] opacity-80">
                                <Pin className="size-2.5" /> Pinned
                              </div>
                            )}

                            {msg.media_url && (
                              <div className="mb-2 rounded-xl overflow-hidden">
                                <ResolvedChatMedia
                                  mediaUrl={msg.media_url}
                                  mediaType={msg.media_type}
                                  isOwnMessage={isMe}
                                />
                              </div>
                            )}

                            {(() => {
                              const sticker = !msg.media_url
                                ? parseStickerMessage(msg.content)
                                : null;
                              if (sticker) {
                                return <ChatStickerBubble sticker={sticker} />;
                              }
                              return msg.content ? (
                                <p className="whitespace-pre-wrap">{msg.content}</p>
                              ) : null;
                            })()}
                          </div>
                        </div>
                      </ContextMenuTrigger>

                      <ContextMenuContent className="w-48 rounded-2xl p-1.5">
                        <ContextMenuItem
                          className="rounded-xl text-xs cursor-pointer"
                          onClick={() => {
                            setEditingMsg(null);
                            setReplyingTo(msg);
                          }}
                        >
                          <Reply className="size-3.5 mr-2" /> Reply
                        </ContextMenuItem>
                        {msg.content && (
                          <ContextMenuItem
                            className="rounded-xl text-xs cursor-pointer"
                            onClick={() => void handleCopyMessage(msg.content)}
                          >
                            <Copy className="size-3.5 mr-2" /> Copy text
                          </ContextMenuItem>
                        )}
                        {forwardTargets.length > 0 && (
                          <ContextMenuItem
                            className="rounded-xl text-xs cursor-pointer"
                            onClick={() => setForwardingMsg(msg)}
                          >
                            <Forward className="size-3.5 mr-2" /> Forward
                          </ContextMenuItem>
                        )}
                        <ContextMenuItem
                          className="rounded-xl text-xs cursor-pointer"
                          onClick={() =>
                            pinMessageMutation.mutate(msg.id, {
                              onSuccess: (res) =>
                                toast.success(
                                  res.is_pinned ? "Message pinned" : "Message unpinned",
                                ),
                              onError: (err) =>
                                toast.error(err instanceof Error ? err.message : "Could not pin"),
                            })
                          }
                        >
                          {msg.is_pinned ? (
                            <>
                              <PinOff className="size-3.5 mr-2" /> Unpin
                            </>
                          ) : (
                            <>
                              <Pin className="size-3.5 mr-2" /> Pin message
                            </>
                          )}
                        </ContextMenuItem>
                        <ContextMenuItem
                          className="rounded-xl text-xs cursor-pointer"
                          onClick={() =>
                            saveMessageMutation.mutate(
                              { messageId: msg.id, currentlySaved: isSaved },
                              {
                                onSuccess: (saved) =>
                                  toast.success(
                                    saved
                                      ? "Saved in chat (protected from expiry)"
                                      : "Removed from saved",
                                  ),
                                onError: (err) =>
                                  toast.error(
                                    err instanceof Error
                                      ? err.message
                                      : "Could not update saved state",
                                  ),
                              },
                            )
                          }
                        >
                          <Bookmark className="size-3.5 mr-2" />{" "}
                          {isSaved ? "Unsave" : "Save message"}
                        </ContextMenuItem>
                        {isMe && !msg.media_url && (
                          <>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              className="rounded-xl text-xs cursor-pointer"
                              onClick={() => {
                                setReplyingTo(null);
                                setEditingMsg(msg);
                                setContent(msg.content);
                              }}
                            >
                              <Pencil className="size-3.5 mr-2" /> Edit message
                            </ContextMenuItem>
                          </>
                        )}
                        {isMe && (
                          <ContextMenuItem
                            className="rounded-xl text-xs text-destructive focus:text-destructive cursor-pointer"
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
                          >
                            <Trash2 className="size-3.5 mr-2" /> Delete / Unsend
                          </ContextMenuItem>
                        )}
                      </ContextMenuContent>
                    </ContextMenu>

                    {/* Message reactions pills */}
                    {reactionTally.size > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1 px-1">
                        {Array.from(reactionTally.entries()).map(([emoji, info]) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => handleReactMessage(msg.id, emoji)}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] transition-transform active:scale-95",
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
                      {(msg.is_saved_in_chat || isSaved) && (
                        <span
                          data-testid="message-saved-indicator"
                          className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 font-sans font-semibold text-primary"
                          title="Saved in chat by a participant — protected from automatic expiry"
                        >
                          <Bookmark className="size-2.5 fill-current" /> Saved
                        </span>
                      )}
                      {(() => {
                        if (!retentionEnabled && !msg.expires_at) return null;
                        if (msg.is_saved_in_chat || isSaved) return null;
                        const badge = formatMessageExpiryBadge({
                          expiresAt: msg.expires_at ?? null,
                          retentionPolicy: msg.retention_policy ?? null,
                          isSavedInChat: false,
                        });
                        if (!badge) return null;
                        return (
                          <span
                            data-testid="message-expiry-indicator"
                            className={cn(
                              "inline-flex items-center gap-0.5 font-sans",
                              badge.urgent
                                ? "text-amber-600 dark:text-amber-400 font-semibold"
                                : "",
                            )}
                          >
                            <Timer className="size-2.5" /> {badge.label}
                          </span>
                        );
                      })()}
                      {isMe && (
                        <span
                          title={
                            msg.status === "sending"
                              ? "Sending"
                              : msg.status === "read" && myPrivacy.read_receipts_enabled
                                ? "Read"
                                : msg.status === "delivered" || msg.status === "read"
                                  ? "Delivered"
                                  : "Sent"
                          }
                        >
                          {msg.status === "sending" ? (
                            <Loader2 className="size-3 animate-spin text-muted-foreground" />
                          ) : msg.status === "read" && myPrivacy.read_receipts_enabled ? (
                            <CheckCheck className="size-3 text-primary font-bold" />
                          ) : msg.status === "delivered" || msg.status === "read" ? (
                            <CheckCheck className="size-3 text-muted-foreground" />
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
                            onClick={() => handleReactMessage(msg.id, emoji)}
                            className="rounded-full px-1 py-0.5 text-[11px] hover:bg-secondary"
                            aria-label={`React ${emoji}`}
                          >
                            {emoji}
                          </button>
                        ))}
                        <MessageEmojiPicker
                          onSelect={(emoji) => handleReactMessage(msg.id, emoji)}
                          ariaLabel="More emoji reactions"
                        />
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
                        {msg.content && (
                          <button
                            type="button"
                            onClick={() => void handleCopyMessage(msg.content)}
                            className="p-1 rounded-full hover:bg-secondary hover:text-foreground"
                            aria-label="Copy message"
                            title="Copy"
                          >
                            <Copy className="size-3" />
                          </button>
                        )}
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
                                  toast.success(
                                    saved
                                      ? "Saved in chat (protected from expiry)"
                                      : "Removed from saved",
                                  ),
                                onError: (err) =>
                                  toast.error(
                                    err instanceof Error
                                      ? err.message
                                      : "Could not update saved state",
                                  ),
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
                                toast.success(
                                  res.is_pinned ? "Message pinned" : "Message unpinned",
                                ),
                              onError: (err) =>
                                toast.error(err instanceof Error ? err.message : "Could not pin"),
                            });
                          }}
                          className="p-1 rounded-full hover:bg-secondary hover:text-foreground"
                          aria-label={msg.is_pinned ? "Unpin message" : "Pin message"}
                          title={msg.is_pinned ? "Unpin message" : "Pin message"}
                        >
                          {msg.is_pinned ? (
                            <PinOff className="size-3" />
                          ) : (
                            <Pin className="size-3" />
                          )}
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
                )}
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
            <p className="truncate text-muted-foreground">
              {formatMessageSummary(editingMsg ?? replyingTo)}
            </p>
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
            <div
              className={
                mediaType === "audio"
                  ? "max-w-full rounded-lg"
                  : "max-w-[140px] max-h-12 overflow-hidden rounded-lg"
              }
            >
              <ResolvedChatMedia mediaUrl={mediaUrl} mediaType={mediaType} />
            </div>
            <span className="text-xs font-semibold text-primary truncate">
              {mediaPreviewName ||
                (mediaType === "audio"
                  ? "Voice message ready to send"
                  : "Attachment ready to send")}
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

      {/* 3. INPUT COMPOSER OR MESSAGE REQUEST CONTROLS */}
      {isIncomingPendingRequest ? (
        <div
          data-testid="incoming-message-request-banner"
          className="p-4 border-t border-border/60 bg-secondary/40 space-y-3"
        >
          <p className="text-xs text-muted-foreground text-center">
            <strong>{otherUser?.display_name || otherUser?.username || "This user"}</strong> wants
            to send you a message. They can&apos;t see read receipts or send attachments unless you
            accept.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="hero"
              className="rounded-full px-4"
              disabled={acceptRequestMutation.isPending}
              onClick={async () => {
                try {
                  await acceptRequestMutation.mutateAsync(conversation.id);
                  toast.success("Message request accepted");
                } catch (err: any) {
                  toast.error(err?.message || "Couldn't accept message request.");
                }
              }}
            >
              Accept
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-full px-4"
              disabled={declineRequestMutation.isPending}
              onClick={async () => {
                try {
                  await declineRequestMutation.mutateAsync(conversation.id);
                  toast.success("Message request declined");
                  onBack?.();
                } catch (err: any) {
                  toast.error(err?.message || "Couldn't decline message request.");
                }
              }}
            >
              Decline
            </Button>
            {otherUser && (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="rounded-full px-4"
                disabled={blockMutation.isPending}
                onClick={async () => {
                  try {
                    await blockMutation.mutateAsync(otherUser.id);
                    toast.success(`Blocked @${otherUser.username}`);
                    onBack?.();
                  } catch (err: any) {
                    toast.error(err?.message || "Couldn't block user.");
                  }
                }}
              >
                Block
              </Button>
            )}
          </div>
        </div>
      ) : isDeclinedRequest ? (
        <div
          data-testid="declined-message-request-banner"
          className="p-3.5 border-t border-border/60 bg-secondary/40 text-center text-xs text-muted-foreground"
        >
          This message request was declined. You cannot send further messages here.
        </div>
      ) : outgoingRequestLimitReached ? (
        <div
          data-testid="outgoing-request-limit-banner"
          className="p-3.5 border-t border-border/60 bg-secondary/40 text-center text-xs text-muted-foreground"
        >
          Message request sent. You can send additional messages, media, or voice notes once{" "}
          {otherUser?.display_name || otherUser?.username || "the recipient"} accepts.
        </div>
      ) : postingRestricted ? (
        <div className="p-3.5 border-t border-border/60 bg-secondary/40 text-center text-xs text-muted-foreground">
          Only group admins can post announcements in this conversation.
        </div>
      ) : (
        <form
          onSubmit={handleSend}
          className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-border/60 bg-card/90 backdrop-blur-md flex flex-wrap sm:flex-nowrap items-center gap-1.5"
        >
          {!editingMsg && !isOutgoingPendingRequest && (
            <>
              <ChatAttachmentMenu
                onFileSelected={uploadSelectedFile}
                onFilesSelected={uploadSelectedFiles}
                loading={isUploading}
                disabled={sendMutation.isPending}
              />
              <ChatStickerPicker
                onSelect={(sticker) => void handleSendSticker(formatStickerToken(sticker))}
                disabled={sendMutation.isPending || isUploading}
              />
              <VoiceNoteButton
                conversationId={conversation.id}
                onSendVoiceNote={handleSendVoiceNote}
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
                : isOutgoingPendingRequest
                  ? "Send a one-time text message request…"
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

      {/* Forward Message Dialog with Attribution Preview */}
      <Dialog open={Boolean(forwardingMsg)} onOpenChange={(o) => !o && setForwardingMsg(null)}>
        <DialogContent className="sm:max-w-sm rounded-3xl p-5">
          <DialogHeader>
            <DialogTitle className="font-display text-base">Forward message</DialogTitle>
            <DialogDescription className="text-xs">
              Select an authorised conversation to forward this message to.
            </DialogDescription>
          </DialogHeader>
          {forwardingMsg && (
            <div
              data-testid="forward-message-preview"
              className="rounded-2xl border border-border/70 bg-secondary/45 p-3 text-xs space-y-1"
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                ↪ Forward preview ·{" "}
                {forwardingMsg.sender?.display_name || forwardingMsg.sender?.username || "Sender"}
              </span>
              {forwardingMsg.content && (
                <p className="text-foreground line-clamp-3 whitespace-pre-wrap">
                  {forwardingMsg.content}
                </p>
              )}
              {forwardingMsg.media_url && (
                <p className="text-[11px] text-muted-foreground">
                  {forwardingMsg.media_type === "audio"
                    ? "Includes voice message"
                    : `Includes ${forwardingMsg.media_type || "media"} attachment`}
                </p>
              )}
            </div>
          )}
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

      {/* Mobile Long-Press Message Action Sheet */}
      <Dialog open={Boolean(mobileActionMsg)} onOpenChange={(o) => !o && setMobileActionMsg(null)}>
        <DialogContent className="sm:max-w-xs rounded-3xl p-5 space-y-3">
          <DialogHeader>
            <DialogTitle className="font-display text-base">Message actions</DialogTitle>
            <DialogDescription className="text-xs line-clamp-2">
              {formatMessageSummary(mobileActionMsg)}
            </DialogDescription>
          </DialogHeader>
          {mobileActionMsg && (
            <div className="space-y-2">
              <div className="flex justify-between gap-1 rounded-2xl bg-secondary/60 p-2">
                {QUICK_MESSAGE_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      handleReactMessage(mobileActionMsg.id, emoji);
                      setMobileActionMsg(null);
                    }}
                    className="size-9 rounded-xl hover:bg-card flex items-center justify-center text-lg"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <div className="grid gap-1 text-xs">
                <Button
                  type="button"
                  variant="ghost"
                  className="justify-start rounded-xl gap-2"
                  onClick={() => {
                    setEditingMsg(null);
                    setReplyingTo(mobileActionMsg);
                    setMobileActionMsg(null);
                  }}
                >
                  <Reply className="size-4" /> Reply
                </Button>
                {mobileActionMsg.content && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="justify-start rounded-xl gap-2"
                    onClick={() => {
                      void handleCopyMessage(mobileActionMsg.content);
                      setMobileActionMsg(null);
                    }}
                  >
                    <Copy className="size-4" /> Copy text
                  </Button>
                )}
                {forwardTargets.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="justify-start rounded-xl gap-2"
                    onClick={() => {
                      setForwardingMsg(mobileActionMsg);
                      setMobileActionMsg(null);
                    }}
                  >
                    <Forward className="size-4" /> Forward
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  className="justify-start rounded-xl gap-2"
                  onClick={() => {
                    const isCurrentlySaved = savedMessages.has(mobileActionMsg.id);
                    saveMessageMutation.mutate(
                      { messageId: mobileActionMsg.id, currentlySaved: isCurrentlySaved },
                      {
                        onSuccess: (saved) =>
                          toast.success(
                            saved ? "Saved in chat (protected from expiry)" : "Removed from saved",
                          ),
                        onError: (err) =>
                          toast.error(
                            err instanceof Error ? err.message : "Couldn't update saved status.",
                          ),
                      },
                    );
                    setMobileActionMsg(null);
                  }}
                >
                  <Bookmark className="size-4" />{" "}
                  {savedMessages.has(mobileActionMsg.id) ? "Remove from saved" : "Save in chat"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="justify-start rounded-xl gap-2"
                  onClick={() => {
                    pinMessageMutation.mutate(mobileActionMsg.id, {
                      onSuccess: (res) =>
                        toast.success(res.is_pinned ? "Message pinned" : "Message unpinned"),
                    });
                    setMobileActionMsg(null);
                  }}
                >
                  <Pin className="size-4" /> {mobileActionMsg.is_pinned ? "Unpin" : "Pin message"}
                </Button>
                {mobileActionMsg.sender_id === user?.id && !mobileActionMsg.media_url && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="justify-start rounded-xl gap-2"
                    onClick={() => {
                      setReplyingTo(null);
                      setEditingMsg(mobileActionMsg);
                      setContent(mobileActionMsg.content);
                      setMobileActionMsg(null);
                    }}
                  >
                    <Pencil className="size-4" /> Edit message
                  </Button>
                )}
                {mobileActionMsg.sender_id === user?.id && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="justify-start rounded-xl gap-2 text-destructive hover:text-destructive"
                    onClick={async () => {
                      try {
                        await deleteMessageMutation.mutateAsync({
                          messageId: mobileActionMsg.id,
                          conversationId: conversation.id,
                        });
                        toast.success("Message removed");
                      } catch {
                        toast.error("Couldn't remove message");
                      }
                      setMobileActionMsg(null);
                    }}
                  >
                    <Trash2 className="size-4" /> Delete / Unsend
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Conversation Chat Retention Settings Dialog (Feature-Flagged) */}
      <Dialog open={retentionDialogOpen} onOpenChange={setRetentionDialogOpen}>
        <DialogContent
          data-testid="conversation-retention-dialog"
          className="sm:max-w-md rounded-3xl p-5 space-y-3"
        >
          <DialogHeader>
            <DialogTitle className="font-display text-base flex items-center gap-2">
              <Timer className="size-4 text-primary" /> Chat Retention Settings
            </DialogTitle>
            <DialogDescription className="text-xs">
              Changes apply strictly to <strong>new messages</strong> in this conversation. Existing
              messages keep their current expiry, and saved-in-chat items survive automatic expiry.
            </DialogDescription>
          </DialogHeader>

          {retentionEntitlement && (
            <div className="rounded-2xl border border-border/60 bg-secondary/40 px-3 py-2 text-[11px] text-muted-foreground flex flex-wrap items-center justify-between gap-2">
              <span>
                Chat limit:{" "}
                <strong className="text-foreground">
                  {getRetentionPolicyMeta(effectiveConversationMaxPolicy).label}
                </strong>
              </span>
              <span className="font-mono">
                Saved {formatStorageBytes(retentionEntitlement.saved_storage_used_bytes)} /{" "}
                {formatStorageBytes(retentionEntitlement.saved_storage_quota_bytes)}
              </span>
            </div>
          )}

          <div className="space-y-1.5">
            {CHAT_RETENTION_POLICIES.map((opt) => {
              const allowedByConversation = isPolicyAllowedByMax(
                opt.value,
                effectiveConversationMaxPolicy,
              );
              const selected = activeRetentionPolicy === opt.value;
              const disabled =
                !allowedByConversation ||
                setRetentionMutation.isPending ||
                (isGroup && myRole !== "owner" && myRole !== "admin");
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={disabled}
                  onClick={async () => {
                    try {
                      await setRetentionMutation.mutateAsync(opt.value);
                      toast.success(`Chat retention updated to ${opt.label} for new messages`);
                      setRetentionDialogOpen(false);
                    } catch (err) {
                      toast.error(
                        err instanceof Error
                          ? err.message
                          : "Couldn't update conversation retention policy.",
                      );
                    }
                  }}
                  className={cn(
                    "w-full rounded-2xl border p-3 text-left transition-colors",
                    selected
                      ? "border-primary bg-primary/10"
                      : disabled
                        ? "border-border/40 bg-muted/30 opacity-60 cursor-not-allowed"
                        : "border-border/70 bg-secondary/30 hover:bg-secondary/60",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground">{opt.label}</span>
                    {!allowedByConversation && (
                      <span className="text-[10px] text-muted-foreground">
                        {retentionEntitlement &&
                        isPolicyAllowedByMax(opt.value, retentionEntitlement.max_retention_policy)
                          ? "Limited by participant tier"
                          : opt.requiredTierLabel}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{opt.description}</p>
                </button>
              );
            })}
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            When participants hold different account entitlements, the server enforces the lowest
            eligible retention ceiling across active participants. Saving in chat is visible to all
            participants and separate from downloading a file to a device.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
