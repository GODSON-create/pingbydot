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
  useConversationRealtime,
} from "@/lib/messages";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format } from "date-fns";

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

  const sendMutation = useSendPrivateMessage();
  const markReadMutation = useMarkConversationRead();
  const hideMutation = useHideConversation();
  const blockMutation = useBlockUser();

  const otherUser = conversation.other_member;

  // Real-time listener
  useConversationRealtime(conversation.id);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Mark as read on mount and when new messages arrive
  useEffect(() => {
    if (conversation.id && user) {
      markReadMutation.mutate(conversation.id);
    }
  }, [conversation.id, messages.length, user, markReadMutation]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = content.trim();
    if (!trimmed && !mediaUrl) return;

    try {
      setContent("");
      const currentMediaUrl = mediaUrl;
      const currentMediaType = mediaType;
      setMediaUrl(null);
      setMediaType(null);

      await sendMutation.mutateAsync({
        conversationId: conversation.id,
        content: trimmed,
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

    if (file.size > 15 * 1024 * 1024) {
      toast.error("File size cannot exceed 15MB");
      return;
    }

    try {
      setIsUploading(true);
      const ext = file.name.split(".").pop();
      const path = `${user.id}/${conversation.id}/${Date.now()}.${ext}`;

      const { data, error } = await supabase.storage.from("media").upload(path, file);
      if (error) throw error;

      const { data: urlData } = supabase.storage.from("media").getPublicUrl(data.path);
      setMediaUrl(urlData.publicUrl);

      if (file.type.startsWith("image/")) {
        setMediaType("image");
      } else if (file.type.startsWith("video/")) {
        setMediaType("video");
      } else {
        setMediaType("document");
      }

      toast.success("Attachment ready");
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-card/60 rounded-3xl border border-border/70 overflow-hidden shadow-soft">
      {/* 1. CHAT HEADER */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-border/60 bg-card/90 backdrop-blur-md">
        <div className="flex items-center gap-3">
          {onBack && (
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden rounded-full size-8"
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
              className="flex items-center gap-2.5 group"
            >
              <FounderAvatar
                name={otherUser.display_name || otherUser.username}
                src={otherUser.avatar_url}
                size="sm"
              />
              <div>
                <h3 className="font-display font-bold text-sm text-foreground group-hover:text-primary transition-colors flex items-center gap-1.5">
                  {otherUser.display_name}
                </h3>
                <p className="text-[11px] text-muted-foreground font-mono">@{otherUser.username}</p>
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
            <Button variant="ghost" size="icon" className="size-8 rounded-full">
              <MoreVertical className="size-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 rounded-2xl">
            {otherUser && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive cursor-pointer"
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
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer"
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
            <p className="font-display font-bold text-foreground text-sm">
              End-to-End Direct Message
            </p>
            <p className="text-xs text-muted-foreground max-w-xs mt-1">
              Say hello! Only you and {otherUser?.display_name || "this user"} can read these
              messages.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.sender_id === user?.id;

            return (
              <div
                key={msg.id}
                className={cn("flex flex-col max-w-[80%] sm:max-w-[70%]", {
                  "ml-auto items-end": isMe,
                  "mr-auto items-start": !isMe,
                })}
              >
                <div
                  className={cn("rounded-2xl px-4 py-2.5 shadow-sm text-sm break-words", {
                    "bg-primary text-primary-foreground rounded-br-sm": isMe,
                    "bg-secondary/80 text-foreground border border-border/50 rounded-bl-sm": !isMe,
                  })}
                >
                  {/* Media attachment */}
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

                {/* Timestamp & Status checkmarks */}
                <div className="flex items-center gap-1 mt-1 px-1 text-[10px] text-muted-foreground font-mono">
                  <span>{format(new Date(msg.created_at), "h:mm a")}</span>
                  {isMe && (
                    <span>
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
        <div ref={messagesEndRef} />
      </div>

      {/* Media upload preview banner */}
      {mediaUrl && (
        <div className="px-4 py-2 bg-secondary/40 border-t border-border/50 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-primary">
            <ImageIcon className="size-4" /> Attachment attached
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs text-destructive"
            onClick={() => {
              setMediaUrl(null);
              setMediaType(null);
            }}
          >
            Remove
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
          accept="image/*,video/*"
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
          onChange={(e) => setContent(e.target.value)}
          placeholder={`Message ${otherUser?.display_name || ""}...`}
          className="flex-1 rounded-full bg-secondary/50 border-border/60 px-4 py-2 text-sm focus-visible:ring-primary"
          disabled={sendMutation.isPending}
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
