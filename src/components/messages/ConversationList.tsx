import { useState } from "react";
import { Search, MessageSquare, Plus } from "lucide-react";
import { FounderAvatar } from "@/components/ping/Avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Conversation } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface ConversationListProps {
  conversations: Conversation[];
  selectedId?: string | undefined;
  onSelect: (conv: Conversation) => void;
  onNewChat?: () => void;
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onNewChat,
}: ConversationListProps) {
  const [query, setQuery] = useState("");

  const filtered = conversations.filter((c) => {
    if (!query.trim()) return true;
    const name = c.other_member?.display_name?.toLowerCase() || "";
    const username = c.other_member?.username?.toLowerCase() || "";
    const q = query.toLowerCase();
    return name.includes(q) || username.includes(q);
  });

  return (
    <div className="flex flex-col h-full bg-card/40 rounded-3xl border border-border/70 overflow-hidden">
      {/* Header & Search */}
      <div className="p-4 border-b border-border/60 space-y-3 bg-card/80 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-extrabold text-lg text-foreground tracking-tight flex items-center gap-2">
            <MessageSquare className="size-5 text-primary" /> Messages
          </h2>
          {onNewChat && (
            <Button
              size="sm"
              variant="outline"
              className="rounded-full size-8 p-0"
              onClick={onNewChat}
              aria-label="New Message"
            >
              <Plus className="size-4" />
            </Button>
          )}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations..."
            className="pl-9 rounded-full bg-secondary/50 border-border/60 text-xs h-9"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto divide-y divide-border/40 scrollbar-thin">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <p className="text-xs">No conversations found.</p>
          </div>
        ) : (
          filtered.map((conv) => {
            const isSelected = conv.id === selectedId;
            const other = conv.other_member;

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
                  <FounderAvatar
                    name={other?.display_name || other?.username || "User"}
                    src={other?.avatar_url}
                    size="md"
                  />
                  {conv.unread_count > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 size-3 bg-primary rounded-full ring-2 ring-card animate-pulse" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <span className="font-display font-bold text-sm text-foreground truncate">
                      {other?.display_name || "Direct Message"}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                      {formatDistanceToNow(new Date(conv.last_message_at), { addSuffix: false })}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground truncate">
                      {conv.last_message_preview || "No messages yet"}
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
