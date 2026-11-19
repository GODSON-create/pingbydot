import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import {
  Send,
  Reply,
  CornerDownRight,
  Lock,
  Pencil,
  Trash2,
  X,
  Check,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useChatDraft } from "@/lib/draft-store";
import { ensureClientProfileRow } from "@/lib/ensure-profile";
import { useHubPresence } from "@/lib/presence";
import { useMarkMessagesRead } from "@/lib/read-receipts";
import { ReadReceiptDot } from "@/components/ping/ReadReceiptDot";
import { QueryErrorCard } from "@/components/QueryErrorCard";
import {
  ChatAttachmentMenu,
  ChatStickerBubble,
  ChatStickerPicker,
  ResolvedChatMedia,
  VoiceNoteButton,
  formatStickerToken,
  parseStickerMessage,
} from "@/components/chat/ChatAttachmentControls";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  checkShieldRateLimit,
  detectMediaKind,
  sanitizeUserText,
  validateMediaUpload,
  type MediaKind,
} from "@/lib/shield";
import { cn } from "@/lib/utils";

export interface HubMessage {
  id: string;
  hub_id: string;
  sender_id: string;
  content: string;
  media_url: string | null;
  reply_to_id: string | null;
  is_system: boolean;
  reactions: Record<string, number>;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  sender?: {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
  } | null;
}

interface HubChatProps {
  hubId: string;
  isMember: boolean;
  isPrivate: boolean;
  isStaff?: boolean;
}

export function HubChat({ hubId, isMember, isPrivate, isStaff = false }: HubChatProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [content, setContent, clearDraft] = useChatDraft(`hub:${hubId}`);
  const [replyTo, setReplyTo] = useState<HubMessage | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaKind, setMediaKind] = useState<MediaKind | null>(null);
  const [mediaName, setMediaName] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [failedFile, setFailedFile] = useState<File | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const markedIdsRef = useRef<Set<string>>(new Set());

  const { activeCount, isUserActivelyReading } = useHubPresence(hubId);
  const { mutate: markMessagesRead } = useMarkMessagesRead(hubId);

  const {
    data: messages = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["hub-messages", hubId],
    enabled: Boolean(hubId),
    queryFn: async (): Promise<HubMessage[]> => {
      const { data, error } = await supabase
        .from("hub_messages")
        .select(
          `
          id, hub_id, sender_id, content, media_url, reply_to_id, is_system, reactions, deleted_at, created_at, updated_at,
          sender:profiles!hub_messages_sender_id_fkey(id, username, display_name, avatar_url)
        `,
        )
        .eq("hub_id", hubId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(100);

      if (error) {
        throw error;
      }

      return (data || []) as unknown as HubMessage[];
    },
  });

  const messageById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  // Realtime subscription for incoming messages, edits, reactions & deletes
  useEffect(() => {
    if (!hubId) return;

    const channel = supabase
      .channel(`hub-messages-live:${hubId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "hub_messages",
          filter: `hub_id=eq.${hubId}`,
        },
        (payload) => {
          qc.invalidateQueries({ queryKey: ["hub-messages", hubId] });

          if (payload.eventType === "INSERT") {
            const msg = payload.new as Record<string, unknown> | null;
            if (
              user &&
              msg &&
              typeof msg["sender_id"] === "string" &&
              msg["sender_id"] !== user.id &&
              document.visibilityState === "visible" &&
              typeof msg["id"] === "string" &&
              !markedIdsRef.current.has(msg["id"])
            ) {
              markedIdsRef.current.add(msg["id"]);
              markMessagesRead([msg["id"]]);
            }
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [hubId, user, qc, markMessagesRead]);

  // Mark unread messages once per message ID
  useEffect(() => {
    if (!user || messages.length === 0 || document.visibilityState !== "visible") return;
    const unreadIds = messages
      .filter((m) => m.sender_id !== user.id && !markedIdsRef.current.has(m.id))
      .map((m) => m.id);
    if (unreadIds.length > 0) {
      unreadIds.forEach((id) => markedIdsRef.current.add(id));
      markMessagesRead(unreadIds);
    }
  }, [messages, user, markMessagesRead]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const reactionMutation = useMutation({
    mutationFn: async ({ messageId, emoji }: { messageId: string; emoji: string }) => {
      const { error } = await supabase.rpc("toggle_hub_message_reaction", {
        _message_id: messageId,
        _reaction: emoji,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub-messages", hubId] });
    },
  });

  const QUICK_REACTIONS = ["👍", "❤️", "🔥", "🚀", "👀"];

  const sendMutation = useMutation({
    mutationFn: async (overrideText?: string) => {
      if (!user) throw new Error("Must be signed in to post.");
      const clean = sanitizeUserText(overrideText ?? content);
      if (!clean && !mediaUrl) return;

      const rate = checkShieldRateLimit("send_message", user.id);
      if (!rate.allowed) throw new Error(rate.reason || "Sending too fast.");

      const fallbackContent =
        mediaKind === "audio"
          ? "🎙️ Voice note"
          : mediaKind === "video"
            ? "🎬 Video"
            : mediaKind === "document"
              ? `📄 ${mediaName || "Document"}`
              : "📷 Photo";

      const insertPayload = {
        hub_id: hubId,
        sender_id: user.id,
        content: clean || fallbackContent,
        media_url: overrideText ? null : mediaUrl,
        reply_to_id: replyTo?.id ?? null,
      };

      let { data, error } = await supabase
        .from("hub_messages")
        .insert(insertPayload)
        .select("id")
        .single();

      if (error && error.code === "23503") {
        const recovered = await ensureClientProfileRow(user);
        if (recovered) {
          const retry = await supabase
            .from("hub_messages")
            .insert(insertPayload)
            .select("id")
            .single();
          data = retry.data;
          error = retry.error;
        }
      }

      if (error) throw error;
      return data;
    },
    onSuccess: (_data, overrideText) => {
      if (!overrideText) {
        clearDraft();
        setMediaUrl(null);
        setMediaKind(null);
        setMediaName(null);
      }
      setReplyTo(null);
      qc.invalidateQueries({ queryKey: ["hub-messages", hubId] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Couldn't send message.");
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({ messageId, nextContent }: { messageId: string; nextContent: string }) => {
      const clean = sanitizeUserText(nextContent);
      if (!clean) throw new Error("Message cannot be empty.");
      const { error } = await supabase
        .from("hub_messages")
        .update({ content: clean, updated_at: new Date().toISOString() })
        .eq("id", messageId);
      if (error) throw error;
    },
    onSuccess: () => {
      setEditingId(null);
      setEditDraft("");
      qc.invalidateQueries({ queryKey: ["hub-messages", hubId] });
      toast.success("Message updated");
    },
    onError: () => toast.error("Couldn't update message."),
  });

  const deleteMutation = useMutation({
    mutationFn: async (messageId: string) => {
      const { error } = await supabase
        .from("hub_messages")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", messageId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hub-messages", hubId] });
      toast.success("Message removed");
    },
    onError: () => toast.error("Couldn't remove message."),
  });

  const uploadHubFile = async (file: File) => {
    if (!user) return;
    const detected = detectMediaKind(file);
    const check = validateMediaUpload(
      { type: file.type, size: file.size, name: file.name },
      detected,
    );
    if (!check.valid) {
      const msg = check.error || "Invalid attachment";
      setUploadError(msg);
      toast.error(msg);
      return;
    }
    try {
      setIsUploading(true);
      setUploadError(null);
      setFailedFile(null);
      const { uploadUserMedia } = await import("@/lib/storage");
      const fallbackExt =
        detected === "video"
          ? "mp4"
          : detected === "audio"
            ? "webm"
            : detected === "document"
              ? "bin"
              : "jpg";
      const ext = file.name.split(".").pop()?.toLowerCase() || fallbackExt;
      const path = `${user.id}/hubs/${hubId}/${Date.now()}.${ext}`;
      const publicUrl = await uploadUserMedia(path, file);
      setMediaUrl(publicUrl);
      setMediaKind(detected);
      setMediaName(file.name);
      toast.success("Attachment ready");
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!content.trim() && !mediaUrl) || sendMutation.isPending) return;
    sendMutation.mutate(undefined);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  if (isPrivate && !isMember) {
    return (
      <div className="surface-card flex flex-col items-center justify-center rounded-3xl p-12 text-center border border-border">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-secondary text-foreground">
          <Lock className="size-6" />
        </div>
        <h3 className="mt-4 font-display text-xl font-bold">Private Hub Discussion</h3>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          This hub conversation is private. Join or request access to participate in real-time
          builder discussions.
        </p>
      </div>
    );
  }

  return (
    <div
      data-no-gesture="true"
      className="surface-card flex flex-col rounded-3xl border border-border overflow-hidden shadow-sm h-[min(600px,68dvh)]"
    >
      {/* Realtime Active Presence Header */}
      <div className="flex items-center justify-between border-b border-border bg-card/60 px-5 py-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2 items-center justify-center">
            <span className="absolute inline-flex size-full rounded-full bg-emerald-400 opacity-75 animate-ping-breathe" />
            <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
          </span>
          <span className="font-semibold text-foreground">Live Hub Channel</span>
        </div>

        <div className="flex items-center gap-1.5 text-muted-foreground">
          <span>
            {activeCount} {activeCount === 1 ? "builder" : "builders"} active
          </span>
        </div>
      </div>

      {/* Message history */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading messages…
          </div>
        ) : isError ? (
          <div className="p-2">
            <QueryErrorCard
              compact
              title="Couldn't load Hub chat"
              description="Unable to load messages for this Hub right now."
              error={error}
              onRetry={() => void refetch()}
            />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center p-6 text-muted-foreground">
            <p className="font-medium text-foreground">No Pings in this Hub yet</p>
            <p className="mt-1 text-xs max-w-xs">
              Be the first to share progress, ask a question, or introduce yourself to the
              collective!
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = user?.id === msg.sender_id;
            const canDelete = isMe || isStaff;
            const senderName = msg.sender?.display_name || msg.sender?.username || "Builder";
            const isActive = isUserActivelyReading(msg.sender_id);
            const quotedMsg = msg.reply_to_id ? messageById.get(msg.reply_to_id) : undefined;

            return (
              <div
                key={msg.id}
                className={cn("flex gap-3 group", isMe ? "flex-row-reverse" : "flex-row")}
              >
                {!isMe && (
                  <Avatar className="size-8 shrink-0 mt-0.5">
                    <AvatarImage src={msg.sender?.avatar_url ?? undefined} alt={senderName} />
                    <AvatarFallback className="text-[10px] font-bold uppercase">
                      {senderName.slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                )}

                <div
                  className={cn(
                    "flex flex-col max-w-[82%] sm:max-w-[72%]",
                    isMe ? "items-end" : "items-start",
                  )}
                >
                  {!isMe && (
                    <span className="text-[11px] font-semibold text-muted-foreground mb-1 px-1">
                      {senderName}
                    </span>
                  )}

                  {/* Quoted Reply banner */}
                  {msg.reply_to_id && (
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1 px-2.5 py-1 rounded-lg bg-secondary/60 border border-border/40 max-w-full">
                      <CornerDownRight className="size-3 shrink-0 text-primary" />
                      <span className="truncate">
                        {quotedMsg
                          ? `${quotedMsg.sender?.display_name || quotedMsg.sender?.username || "Builder"}: ${quotedMsg.content}`
                          : "Replying to earlier message"}
                      </span>
                    </div>
                  )}

                  {/* Message bubble or inline editor */}
                  {editingId === msg.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        editMutation.mutate({ messageId: msg.id, nextContent: editDraft });
                      }}
                      className="flex items-center gap-1.5 w-full min-w-[220px]"
                    >
                      <Input
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        className="h-9 rounded-xl text-xs flex-1"
                        autoFocus
                      />
                      <Button
                        type="submit"
                        size="icon"
                        variant="hero"
                        className="size-8 rounded-xl"
                        aria-label="Save edit"
                      >
                        <Check className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-8 rounded-xl"
                        onClick={() => setEditingId(null)}
                        aria-label="Cancel edit"
                      >
                        <X className="size-3.5" />
                      </Button>
                    </form>
                  ) : (
                    <div
                      className={cn(
                        "rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words leading-relaxed",
                        isMe
                          ? "bg-primary text-primary-foreground rounded-tr-sm"
                          : "bg-secondary/70 text-foreground rounded-tl-sm border border-border/50",
                      )}
                    >
                      {msg.media_url && (
                        <div className="mb-2 rounded-xl overflow-hidden">
                          <ResolvedChatMedia mediaUrl={msg.media_url} />
                        </div>
                      )}
                      {(() => {
                        const sticker = !msg.media_url ? parseStickerMessage(msg.content) : null;
                        if (sticker) {
                          return <ChatStickerBubble sticker={sticker} />;
                        }
                        return msg.content;
                      })()}
                    </div>
                  )}

                  {/* Reaction Pills */}
                  {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {Object.entries(msg.reactions).map(([emoji, count]) =>
                        Number(count) > 0 ? (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => reactionMutation.mutate({ messageId: msg.id, emoji })}
                            className="inline-flex items-center gap-1 rounded-full bg-secondary/80 hover:bg-secondary border border-border/60 px-2 py-0.5 text-[11px] font-medium transition-colors"
                            title={`React with ${emoji}`}
                          >
                            <span>{emoji}</span>
                            <span className="text-[10px] text-muted-foreground font-bold">
                              {count}
                            </span>
                          </button>
                        ) : null,
                      )}
                    </div>
                  )}

                  {/* Footer: timestamp + read receipts dot + actions */}
                  <div className="mt-1 flex flex-wrap items-center gap-2 px-1 text-[11px] text-muted-foreground">
                    <time dateTime={msg.created_at}>
                      {formatDistanceToNowStrict(new Date(msg.created_at))} ago
                    </time>

                    <ReadReceiptDot messageId={msg.id} isAuthor={isMe} isActiveReader={isActive} />

                    {isMember && (
                      <>
                        <button
                          type="button"
                          onClick={() => setReplyTo(msg)}
                          className="opacity-80 sm:opacity-0 sm:group-hover:opacity-100 hover:text-foreground transition-opacity"
                          title="Reply"
                          aria-label="Reply to message"
                        >
                          <Reply className="size-3.5" />
                        </button>

                        {isMe && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(msg.id);
                              setEditDraft(msg.content);
                            }}
                            className="opacity-80 sm:opacity-0 sm:group-hover:opacity-100 hover:text-foreground transition-opacity"
                            title="Edit message"
                            aria-label="Edit message"
                          >
                            <Pencil className="size-3" />
                          </button>
                        )}

                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => deleteMutation.mutate(msg.id)}
                            className="opacity-80 sm:opacity-0 sm:group-hover:opacity-100 hover:text-destructive transition-opacity"
                            title="Delete message"
                            aria-label="Delete message"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        )}

                        <div className="opacity-85 sm:opacity-0 sm:group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                          {QUICK_REACTIONS.map((em) => (
                            <button
                              key={em}
                              type="button"
                              onClick={() =>
                                reactionMutation.mutate({ messageId: msg.id, emoji: em })
                              }
                              className="hover:scale-125 transition-transform text-xs p-0.5"
                              title={`React ${em}`}
                            >
                              {em}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Reply indicator banner */}
      {replyTo && (
        <div className="flex items-center justify-between border-t border-border bg-secondary/40 px-4 py-2 text-xs">
          <div className="flex items-center gap-2 truncate">
            <CornerDownRight className="size-3.5 text-primary shrink-0" />
            <span className="text-muted-foreground shrink-0">Replying to:</span>
            <span className="font-medium truncate max-w-xs">{replyTo.content}</span>
          </div>
          <button
            type="button"
            onClick={() => setReplyTo(null)}
            className="text-muted-foreground hover:text-foreground font-bold px-1"
            aria-label="Cancel reply"
          >
            ✕
          </button>
        </div>
      )}

      {/* Upload failure recovery */}
      {uploadError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 border-t border-destructive/30 bg-destructive/10 px-4 py-2 text-xs"
        >
          <span className="text-destructive truncate">{uploadError}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            {failedFile && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-full text-[11px] gap-1"
                onClick={() => void uploadHubFile(failedFile)}
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
              aria-label="Dismiss upload error"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Attachment preview */}
      {mediaUrl && (
        <div className="flex items-center justify-between border-t border-border bg-secondary/40 px-4 py-2 text-xs gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="max-w-[140px] max-h-12 overflow-hidden rounded-lg">
              <ResolvedChatMedia mediaUrl={mediaUrl} mediaType={mediaKind} />
            </div>
            <span className="font-semibold text-primary truncate">
              {mediaName || "Attachment ready"}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setMediaUrl(null);
              setMediaKind(null);
              setMediaName(null);
            }}
            className="text-destructive font-semibold text-xs hover:underline shrink-0"
          >
            Remove
          </button>
        </div>
      )}

      {/* Message input */}
      <div className="border-t border-border bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
        {isMember ? (
          <form onSubmit={handleSubmit} className="flex gap-1.5 items-end">
            <ChatAttachmentMenu
              onFileSelected={uploadHubFile}
              loading={isUploading}
              disabled={sendMutation.isPending}
            />
            <ChatStickerPicker
              onSelect={(sticker) => sendMutation.mutate(formatStickerToken(sticker))}
              disabled={sendMutation.isPending || isUploading}
            />
            <VoiceNoteButton
              onRecorded={uploadHubFile}
              disabled={sendMutation.isPending || isUploading}
            />
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={(e) => {
                e.currentTarget.scrollIntoView({ block: "nearest", behavior: "smooth" });
              }}
              placeholder="Send a Ping to this Hub… (Enter to send)"
              rows={1}
              className="min-h-[44px] max-h-32 min-w-0 flex-1 resize-none rounded-2xl bg-secondary/40 border-border text-sm py-2.5 px-3.5 leading-normal"
            />
            <Button
              type="submit"
              disabled={(!content.trim() && !mediaUrl) || sendMutation.isPending}
              variant="hero"
              size="icon"
              className="size-11 shrink-0 rounded-2xl"
              aria-label="Send message"
            >
              <Send className="size-4" />
            </Button>
          </form>
        ) : (
          <div className="text-center py-2 text-xs text-muted-foreground">
            Join this Hub to participate in live discussions.
          </div>
        )}
      </div>
    </div>
  );
}
