import { Link, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Compass, Home, Inbox, Plus, User } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { userConversationsQuery } from "@/lib/messages";
import { FounderAvatar } from "@/components/ping/Avatar";
import { CreateStackModal } from "./CreateStackModal";
import { cn } from "@/lib/utils";

const item =
  "flex min-h-14 min-w-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[10px] font-semibold text-muted-foreground transition-colors active:scale-95 motion-reduce:active:scale-100";
const activeClass = "text-primary bg-primary/15 font-bold";

/**
 * Returns true when the current route belongs to the Inbox communication
 * architecture (Chats, Hubs, or Signals).
 */
export function isInboxPath(pathname: string): boolean {
  return (
    pathname === "/inbox" ||
    pathname.startsWith("/inbox/") ||
    pathname === "/messages" ||
    pathname.startsWith("/messages/") ||
    pathname === "/hubs" ||
    pathname.startsWith("/hubs/") ||
    pathname === "/signals" ||
    pathname.startsWith("/signals/")
  );
}

/**
 * Mobile persistent bottom navigation with exactly five primary destinations:
 * 1. Home
 * 2. Explore
 * 3. Create (+)
 * 4. Inbox
 * 5. Profile
 */
export function BottomNav() {
  const { user, profile } = useAuth();
  const { pathname } = useLocation();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: conversations = [] } = useQuery(userConversationsQuery(user?.id));
  const unreadMessages = conversations.reduce((sum, c) => sum + (c.unread_count ?? 0), 0);

  const isExploreActive = pathname === "/explore" || pathname.startsWith("/explore/");
  const isInboxActive = isInboxPath(pathname);
  const isProfileActive =
    (user && profile && pathname === `/@${profile.username}`) || (!user && pathname === "/login");

  return (
    <>
      <nav
        aria-label="Primary"
        data-nav-mode="primary"
        className="fixed inset-x-0 bottom-0 z-50 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden"
      >
        <div className="glass mx-auto flex max-w-md items-center gap-1 rounded-3xl p-1.5 shadow-lift">
          <Link
            to="/"
            aria-current={pathname === "/" ? "page" : undefined}
            className={cn(item, pathname === "/" && activeClass)}
            activeOptions={{ exact: true, includeHash: false }}
          >
            <Home className="size-5" />
            <span>Home</span>
          </Link>

          <Link
            to="/explore"
            aria-current={isExploreActive ? "page" : undefined}
            className={cn(item, isExploreActive && activeClass)}
          >
            <Compass className="size-5" />
            <span>Explore</span>
          </Link>

          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            aria-label="Create a Ping, Moment, or Live session"
            className="flex min-h-14 min-w-12 flex-1 flex-col items-center justify-center gap-0.5"
          >
            <span className="-mt-3 flex size-12 items-center justify-center rounded-full bg-lime text-lime-foreground shadow-lift ring-4 ring-background transition-transform active:scale-95 motion-reduce:active:scale-100">
              <Plus className="size-6 stroke-[2.5]" />
            </span>
            <span className="text-[10px] font-semibold text-muted-foreground">Create</span>
          </button>

          <Link
            to="/inbox"
            aria-current={isInboxActive ? "page" : undefined}
            className={cn(item, "relative", isInboxActive && activeClass)}
          >
            <span className="relative inline-flex">
              <Inbox className="size-5" />
              {unreadMessages > 0 && (
                <span className="absolute -top-1.5 -right-2 inline-flex min-w-4 h-4 px-1 items-center justify-center rounded-full bg-primary text-primary-foreground text-[9px] font-bold tabular-nums">
                  {unreadMessages > 99 ? "99+" : unreadMessages}
                </span>
              )}
            </span>
            <span>Inbox</span>
          </Link>

          {user && profile ? (
            <Link
              to="/@{$username}"
              params={{ username: profile.username }}
              aria-current={isProfileActive ? "page" : undefined}
              className={cn(item, isProfileActive && activeClass)}
            >
              <FounderAvatar
                name={profile.display_name || profile.username}
                src={profile.avatar_url}
                size="sm"
                className="size-5 text-[9px]"
              />
              <span>Profile</span>
            </Link>
          ) : (
            <Link
              to="/login"
              aria-current={isProfileActive ? "page" : undefined}
              className={cn(item, isProfileActive && activeClass)}
            >
              <User className="size-5" />
              <span>Profile</span>
            </Link>
          )}
        </div>
      </nav>

      <CreateStackModal open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
