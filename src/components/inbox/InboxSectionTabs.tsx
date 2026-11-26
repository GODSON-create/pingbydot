import { Link } from "@tanstack/react-router";
import { MessageSquare, Radio, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { userConversationsQuery } from "@/lib/messages";
import { cn } from "@/lib/utils";

export type InboxSection = "chats" | "hubs" | "signals";

interface InboxSectionTabsProps {
  activeSection: InboxSection;
  className?: string | undefined;
  compact?: boolean | undefined;
}

const SECTION_META: Record<
  InboxSection,
  {
    label: string;
    subtitle: string;
    icon: typeof MessageSquare;
  }
> = {
  chats: {
    label: "Chats",
    subtitle: "Direct & private conversations",
    icon: MessageSquare,
  },
  hubs: {
    label: "Hubs",
    subtitle: "Group communication spaces",
    icon: Users,
  },
  signals: {
    label: "Signals",
    subtitle: "Institutional broadcast channels",
    icon: Radio,
  },
};

export function InboxSectionTabs({
  activeSection,
  className,
  compact = false,
}: InboxSectionTabsProps) {
  const { user } = useAuth();
  const { data: conversations = [] } = useQuery(userConversationsQuery(user?.id));
  const unreadChats = conversations.reduce((sum, c) => sum + (c.unread_count ?? 0), 0);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-3.5",
        className,
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        {!compact && (
          <div className="min-w-0">
            <h1 className="font-display text-xl sm:text-2xl font-extrabold tracking-tight text-foreground leading-none">
              Inbox
            </h1>
            <p className="mt-1 text-xs text-muted-foreground truncate">
              {SECTION_META[activeSection].subtitle}
            </p>
          </div>
        )}
      </div>

      <nav
        aria-label="Inbox sections"
        data-inbox-sections="true"
        className="inline-flex w-full sm:w-auto items-center gap-1 rounded-full bg-secondary/80 p-1 border border-border/50"
      >
        {(["chats", "hubs", "signals"] as const).map((sectionKey) => {
          const meta = SECTION_META[sectionKey];
          const Icon = meta.icon;
          const isActive = activeSection === sectionKey;
          const showBadge = sectionKey === "chats" && unreadChats > 0;

          return (
            <Link
              key={sectionKey}
              to="/inbox"
              search={sectionKey === "chats" ? {} : { section: sectionKey }}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-all whitespace-nowrap",
                isActive
                  ? "bg-foreground text-background shadow-sm font-bold"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/40",
              )}
            >
              <Icon className="size-3.5 shrink-0" />
              <span>{meta.label}</span>
              {showBadge && (
                <span
                  className={cn(
                    "inline-flex min-w-4 h-4 px-1 items-center justify-center rounded-full text-[10px] font-bold tabular-nums",
                    isActive ? "bg-primary text-primary-foreground" : "bg-primary/20 text-primary",
                  )}
                >
                  {unreadChats > 99 ? "99+" : unreadChats}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
