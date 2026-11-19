import { useState, useRef, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import {
  Send,
  MoreVertical,
  ShieldAlert,
  Trash2,
  Check,
  CheckCheck,
  Loader2,
  ArrowLeft,
  Flag,
  X,
  User,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { FounderAvatar } from "@/components/ping/Avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  useSendPrivateMessage,
  useMarkConversationRead,
  useHideConversation,
  useBlockUser,
  useDeletePrivateMessage,
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

interface DirectMessageChatProps {
  conversation: Conversation;
  messages: PrivateMessage[];
  isLoading?: boolean;
  onBack?: () => void;
  peerProfileOpen?: boolean;
  onTogglePeerProfile?: () => void;
}

export function DirectMessageChat({
  conversation,
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
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const lastMarkedRef = useRef<string>("");

  const sendMutation = useSendPrivateMessage();
  const { mutate: markRead } = useMarkConversationRead();
  const hideMutation = useHideConversation();
  const blockMutation = useBlockUser();
  const deleteMessageMutation = useDeletePrivateMessage();

  const otherUser = conversation.other_member;

  useConversationRealtime(conversation.id);
  const { otherOnline, otherTyping, notifyTyping } = useConversationPresence(
    conversation.id,
    user?.id,
    otherUser?.id,
  );

  // Auto-scroll to bottom on new message (respects reduced motion)
  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    messagesEndRef.current?.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }, [messages.length, otherTyping]);

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
    if (!user) return;

    const rateCheck = checkShieldRateLimit("send_message", user.id);
    if (!rateCheck.allowed) {
      toast.error(rateCheck.reason || "You are sending messages too quickly.");
      return;
    }

    const currentMediaUrl = mediaUrl;
    const currentMediaType = mediaType;

    try {
      clearDraft();
      notifyTyping(false);
      setMediaUrl(null);
      setMediaType(null);
      setMediaPreviewName(null);
      setUploadError(null);
      setFailedFile(null);

      await sendMutation.mutateAsync({
        conversationId: conversation.id,
        content: cleaned,
        mediaUrl: currentMediaUrl,
        mediaType: currentMediaType,
      });
    } catch (err: any) {
      setContent((prev) => prev || cleaned);
      if (currentMediaUrl) {
        setMediaUrl(currentMediaUrl);
        setMediaType(currentMediaType);
      }
      toast.error(err?.message || "Failed to send message — your draft was kept.");
    }
  };

  const handleSendSticker = async (stickerToken: string) => {
    if (!user) return;
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

          {otherUser ? (
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
          {otherUser && onTogglePeerProfile && (
            <Button
              type="button"
              variant={peerProfileOpen ? "secondary" : "ghost"}
              size="icon"
              data-testid="chat-peer-profile-toggle"
              className="size-8 rounded-full shrink-0"
              onClick={onTogglePeerProfile}
              aria-label="Toggle participant profile"
              aria-expanded={peerProfileOpen}
              title={peerProfileOpen ? "Close participant profile" : "View participant details"}
            >
              <User className="size-4 text-muted-foreground" />
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
              {otherUser && (
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

      {/* 2. MESSAGE STREAM */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5 scrollbar-thin">
        {isLoading && messages.length === 0 ? (
          <div className="space-y-3 py-4" aria-label="Loading messages">
            <div className="h-10 w-2/3 animate-pulse rounded-2xl bg-secondary/70" />
            <div className="ml-auto h-10 w-1/2 animate-pulse rounded-2xl bg-primary/15" />
            <div className="h-10 w-3/5 animate-pulse rounded-2xl bg-secondary/70" />
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground">
            <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <Send className="size-5 text-primary" />
            </div>
            <p className="font-display font-bold text-foreground text-sm">Private Direct Message</p>
            <p className="text-xs text-muted-foreground max-w-xs mt-1">
              Say hello! Only you and {otherUser?.display_name || "this builder"} can read these
              messages.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.sender_id === user?.id;

            return (
              <div
                key={msg.id}
                className={cn("group flex flex-col max-w-[82%] sm:max-w-[70%]", {
                  "ml-auto items-end": isMe,
                  "mr-auto items-start": !isMe,
                })}
              >
                <div className="flex items-end gap-1.5">
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
                      className="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 p-1 rounded-full text-muted-foreground hover:text-destructive transition-opacity"
                      aria-label="Delete message"
                      title="Unsend message"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  )}

                  <div
                    className={cn("rounded-2xl px-4 py-2.5 shadow-sm text-sm break-words", {
                      "bg-primary text-primary-foreground rounded-br-sm": isMe,
                      "bg-secondary text-foreground border border-border/60 rounded-bl-sm": !isMe,
                    })}
                  >
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

                {/* Timestamp & Status checkmarks */}
                <div className="flex items-center gap-1 mt-1 px-1 text-[10px] text-muted-foreground font-mono">
                  <span>{format(new Date(msg.created_at), "h:mm a")}</span>
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
            <span>{otherUser?.display_name || "Builder"} is typing…</span>
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
      <form
        onSubmit={handleSend}
        className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-border/60 bg-card/90 backdrop-blur-md flex items-center gap-1.5"
      >
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

        <Input
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            notifyTyping(e.target.value.trim().length > 0);
          }}
          onFocus={(e) => {
            e.currentTarget.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }}
          placeholder={`Message ${otherUser?.display_name || ""}…`}
          className="flex-1 min-w-0 rounded-full bg-secondary/50 border-border/60 px-4 py-2 text-sm focus-visible:ring-primary"
          disabled={sendMutation.isPending}
          maxLength={5000}
        />

        <Button
          type="submit"
          size="icon"
          className="size-9 rounded-full shrink-0 bg-primary text-primary-foreground font-bold shadow-sm active:scale-95 transition-transform"
          disabled={(!content.trim() && !mediaUrl) || sendMutation.isPending}
          aria-label="Send message"
        >
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
