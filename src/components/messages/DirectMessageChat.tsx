import { useState, useRef, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import {
  Send,
  Image as ImageIcon,
  MoreVertical,
  ShieldAlert,
  Trash2,
  Check,
  CheckCheck,
  Loader2,
  ArrowLeft,
  Paperclip,
  Flag,
  X,
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
  type Conversation,
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
import { supabase } from "@/integrations/supabase/client";
import { checkShieldRateLimit, sanitizeUserText, validateMediaUpload } from "@/lib/shield";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface DirectMessageChatProps {
  conversation: Conversation;
  messages: PrivateMessage[];
  onBack?: () => void;
}

export function DirectMessageChat({ conversation, messages, onBack }: DirectMessageChatProps) {
  const { user } = useAuth();
  const [content, setContent] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<"image" | "video" | "document" | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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

    try {
      setContent("");
      notifyTyping(false);
      const currentMediaUrl = mediaUrl;
      const currentMediaType = mediaType;
      setMediaUrl(null);
      setMediaType(null);

      await sendMutation.mutateAsync({
        conversationId: conversation.id,
        content: cleaned,
        mediaUrl: currentMediaUrl,
        mediaType: currentMediaType,
      });
    } catch (err: any) {
      toast.error(err.message || "Failed to send message");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    const isVideo = file.type.startsWith("video/");
    const check = validateMediaUpload(
      { type: file.type, size: file.size, name: file.name },
      isVideo ? "video" : "image",
    );
    if (!check.valid) {
      toast.error(check.error || "Unsupported attachment");
      e.target.value = "";
      return;
    }

    try {
      setIsUploading(true);
      const { uploadUserMedia } = await import("@/lib/storage");
      const ext = file.name.split(".").pop()?.toLowerCase() || (isVideo ? "mp4" : "jpg");
      const path = `${user.id}/dm/${conversation.id}/${Date.now()}.${ext}`;

      const publicUrl = await uploadUserMedia(path, file);
      setMediaUrl(publicUrl);
      setMediaType(isVideo ? "video" : "image");
      toast.success("Attachment ready");
    } catch (err: any) {
      const { formatStorageUploadError } = await import("@/lib/storage");
      toast.error(formatStorageUploadError(err, "Upload failed"));
    } finally {
      setIsUploading(false);
      e.target.value = "";
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
    <div className="flex flex-col h-full bg-card/60 rounded-3xl border border-border/70 overflow-hidden shadow-soft">
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
                <DropdownMenuItem className="rounded-xl cursor-pointer" onClick={handleReportUser}>
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

      {/* 2. MESSAGE STREAM */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5 scrollbar-thin">
        {messages.length === 0 ? (
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
                        {msg.media_type === "image" ? (
                          <img
                            src={msg.media_url}
                            alt="Attachment"
                            className="max-h-60 rounded-lg object-cover"
                            loading="lazy"
                          />
                        ) : msg.media_type === "video" ? (
                          <video src={msg.media_url} controls className="max-h-60 rounded-lg" />
                        ) : (
                          <a
                            href={msg.media_url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2 p-2 bg-background/50 rounded-lg text-xs underline font-medium"
                          >
                            <Paperclip className="size-3.5" /> View Attached File
                          </a>
                        )}
                      </div>
                    )}

                    {msg.content && <p className="whitespace-pre-wrap">{msg.content}</p>}
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

      {/* Media upload preview banner */}
      {mediaUrl && (
        <div className="px-4 py-2 bg-secondary/40 border-t border-border/50 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {mediaType === "image" ? (
              <img
                src={mediaUrl}
                alt="Preview"
                className="size-10 rounded-lg object-cover border border-border"
              />
            ) : (
              <ImageIcon className="size-4 text-primary shrink-0" />
            )}
            <span className="text-xs font-semibold text-primary truncate">
              Attachment ready to send
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
        className="p-3 border-t border-border/60 bg-card/90 backdrop-blur-md flex items-center gap-2"
      >
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
          onChange={handleFileUpload}
        />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 rounded-full shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          aria-label="Attach file"
        >
          {isUploading ? (
            <Loader2 className="size-4 animate-spin text-primary" />
          ) : (
            <ImageIcon className="size-4" />
          )}
        </Button>

        <Input
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            notifyTyping(e.target.value.trim().length > 0);
          }}
          placeholder={`Message ${otherUser?.display_name || ""}…`}
          className="flex-1 rounded-full bg-secondary/50 border-border/60 px-4 py-2 text-sm focus-visible:ring-primary"
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
