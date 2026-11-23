import { useState } from "react";
import { Archive, BellOff, Search, MessageSquare, Plus, Users } from "lucide-react";
import { FounderAvatar } from "@/components/ping/Avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Conversation } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

export function formatConversationPreview(preview: string | null | undefined): string {
  const trimmed = preview?.trim();
  if (!trimmed) return "No messages yet";
  if (/^(?:🎵\s*)?audio\s+message$/i.test(trimmed)) return "Voice message";
  return trimmed;
}

interface ConversationListProps {
  conversations: Conversation[];
  selectedId?: string | undefined;
  currentUserId?: string | undefined;
  onSelect: (conv: Conversation) => void;
  onNewChat?: () => void;
  onNewGroup?: () => void;
}

export function ConversationList({
  conversations,
  selectedId,
  currentUserId,
  onSelect,
  onNewChat,
  onNewGroup,
}: ConversationListProps) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"active" | "requests" | "archived">("active");

  const isIncomingRequest = (c: Conversation) =>
    c.type === "direct" &&
    c.request_status === "pending" &&
    Boolean(currentUserId) &&
    c.request_recipient_id === currentUserId;

  const archivedCount = conversations.filter((c) => Boolean(c.my_membership?.is_archived)).length;
  const requestsCount = conversations.filter(
    (c) => !c.my_membership?.is_archived && isIncomingRequest(c),
  ).length;

  const filtered = conversations.filter((c) => {
    const isArchived = Boolean(c.my_membership?.is_archived);
    const incomingReq = isIncomingRequest(c);
    if (view === "archived" && !isArchived) return false;
    if (view === "requests" && (isArchived || !incomingReq)) return false;
    if (view === "active" && (isArchived || incomingReq)) return false;

    if (!query.trim()) return true;
    const label =
      c.type === "group"
        ? (c.title ?? "Group Chat").toLowerCase()
        : (c.other_member?.display_name ?? "").toLowerCase();
    const username = c.other_member?.username?.toLowerCase() || "";
    const preview = (c.last_message_preview ?? "").toLowerCase();
    const q = query.toLowerCase();
    return label.includes(q) || username.includes(q) || preview.includes(q);
  });

  return (
    <div className="flex flex-col h-full bg-card/40 rounded-3xl border border-border/70 overflow-hidden">
      {/* Header & Search */}
      <div className="p-4 border-b border-border/60 space-y-3 bg-card/80 backdrop-blur-md">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display font-extrabold text-lg text-foreground tracking-tight flex items-center gap-2">
            <MessageSquare className="size-5 text-primary" /> Messages
          </h2>
          <div className="flex items-center gap-1.5">
            {onNewGroup && (
              <Button
                size="sm"
                variant="outline"
                className="rounded-full size-8 p-0"
                onClick={onNewGroup}
                aria-label="New Group Chat"
                title="New Group Chat"
              >
                <Users className="size-4" />
              </Button>
            )}
            {onNewChat && (
              <Button
                size="sm"
                variant="outline"
                className="rounded-full size-8 p-0"
                onClick={onNewChat}
                aria-label="New Message"
                title="New Direct Message"
              >
                <Plus className="size-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations…"
            className="pl-9 rounded-full bg-secondary/50 border-border/60 text-xs h-9"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setView("active")}
            className={cn(
              "rounded-full px-3 py-1 text-[11px] font-semibold transition-colors",
              view === "active"
                ? "bg-foreground text-background"
                : "bg-secondary/60 text-muted-foreground hover:text-foreground",
            )}
          >
            Inbox
          </button>
          {(requestsCount > 0 || view === "requests") && (
            <button
              type="button"
              onClick={() => setView("requests")}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold transition-colors",
                view === "requests"
                  ? "bg-foreground text-background"
                  : "bg-primary/15 text-primary hover:bg-primary/25",
              )}
            >
              Requests {requestsCount > 0 ? `(${requestsCount})` : ""}
            </button>
          )}
          <button
            type="button"
            onClick={() => setView("archived")}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold transition-colors",
              view === "archived"
                ? "bg-foreground text-background"
                : "bg-secondary/60 text-muted-foreground hover:text-foreground",
            )}
          >
            <Archive className="size-3" />
            Archived {archivedCount > 0 ? `(${archivedCount})` : ""}
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto divide-y divide-border/40 scrollbar-thin">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <p className="text-xs">
              {view === "archived"
                ? "No archived conversations."
                : view === "requests"
                  ? "No pending message requests."
                  : "No conversations found."}
            </p>
          </div>
        ) : (
          filtered.map((conv) => {
            const isSelected = conv.id === selectedId;
            const other = conv.other_member;
            const isGroup = conv.type === "group";
            const displayTitle = isGroup
              ? conv.title || "Group Conversation"
              : other?.display_name || other?.username || "Direct Message";
            const isMuted = Boolean(conv.my_membership?.is_muted);

            return (
              <button
                key={conv.id}
                type="button"
                onClick={() => onSelect(conv)}
                className={cn(
                  "w-full text-left p-3.5 flex items-center gap-3 transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:bg-secondary/50",
                  {
                    "bg-secondary/60 border-l-4 border-primary pl-2.5": isSelected,
                  },
                )}
              >
                <div className="relative shrink-0">
                  {isGroup ? (
                    <div className="size-10 rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold border border-primary/25">
                      <Users className="size-5" />
                    </div>
                  ) : (
                    <FounderAvatar
                      name={other?.display_name || other?.username || "User"}
                      src={other?.avatar_url}
                      size="md"
                    />
                  )}
                  {conv.unread_count > 0 && !isMuted && (
                    <span className="absolute -top-0.5 -right-0.5 size-3 bg-primary rounded-full ring-2 ring-card animate-pulse" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <span className="font-display font-bold text-sm text-foreground truncate flex items-center gap-1">
                      <span className="truncate">{displayTitle}</span>
                      {isMuted && (
                        <BellOff
                          className="size-3 text-muted-foreground shrink-0"
                          aria-label="Muted"
                        />
                      )}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                      {formatDistanceToNow(new Date(conv.last_message_at), { addSuffix: false })}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground truncate">
                      {formatConversationPreview(conv.last_message_preview)}
                    </p>

                    {conv.unread_count > 0 && (
                      <Badge className="bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0 h-4 rounded-full shrink-0">
                        {conv.unread_count}
                      </Badge>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
