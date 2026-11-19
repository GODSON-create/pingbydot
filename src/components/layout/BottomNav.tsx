import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  Compass,
  Home,
  MessageSquare,
  Plus,
  Sparkles,
  Users,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useFocusedWorkspace } from "@/lib/draft-store";
import { userConversationsQuery } from "@/lib/messages";
import { useKeyboardOpen } from "@/lib/native";
import { useNavOverlay } from "@/lib/nav-overlay";
import { cn } from "@/lib/utils";

const item =
  "flex min-h-14 min-w-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[10px] font-semibold text-muted-foreground transition-colors active:scale-95 motion-reduce:active:scale-100";
const activeClass = "text-primary bg-primary/15 font-bold";

const PREV_MAIN_ROUTE_KEY = "ping_prev_main_route";

export function isCommunityPath(pathname: string): boolean {
  return (
    pathname === "/hubs" ||
    pathname.startsWith("/hubs/") ||
    pathname === "/signals" ||
    pathname.startsWith("/signals/")
  );
}

const HIDE_BOTTOM_NAV_PREFIXES = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/welcome",
  "/onboarding",
];

export function shouldHideBottomNav(pathname: string): boolean {
  return HIDE_BOTTOM_NAV_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Mobile persistent bottom navigation:
 * - Primary 5-destination bar: Home, Explore, Create (elevated central +), Hubs, Inbox
 * - Contextual 4-item bar when inside Hubs/Community sub-views: Back, Hub, Signal, Moment
 * Only one bottom navigation bar is ever rendered at a time, and automatically yields
 * on auth/onboarding screens, open soft keyboards, or active full-screen chat threads.
 */
export function BottomNav() {
  const { user } = useAuth();
  const { openOverlay, closeOverlays } = useNavOverlay();
  const keyboardOpen = useKeyboardOpen();
  const focusedWorkspace = useFocusedWorkspace();
  const location = useLocation();
  const navigate = useNavigate();
  const [prevMainRoute, setPrevMainRoute] = useState<string>("/");

  const { data: conversations = [] } = useQuery(userConversationsQuery(user?.id));
  const unreadInbox = conversations.reduce((sum, c) => sum + (c.unread_count ?? 0), 0);

  const { pathname, searchStr } = location;
  const inCommunity = isCommunityPath(pathname);
  const isCommunityMomentsView = pathname === "/hubs" && searchStr.includes("view=moments");
  const isInboxActive = pathname.startsWith("/messages");

  useEffect(() => {
    if (!inCommunity) {
      const fullPath = `${pathname}${searchStr || ""}`;
      setPrevMainRoute(fullPath);
      try {
        sessionStorage.setItem(PREV_MAIN_ROUTE_KEY, fullPath);
      } catch {
        // Ignore storage errors
      }
    } else {
      try {
        const stored = sessionStorage.getItem(PREV_MAIN_ROUTE_KEY);
        if (stored && !isCommunityPath(stored.split("?")[0] || "/")) {
          setPrevMainRoute(stored);
        }
      } catch {
        // Ignore storage errors
      }
    }
  }, [inCommunity, pathname, searchStr]);

  const handleExitCommunity = () => {
    const target =
      prevMainRoute && !isCommunityPath(prevMainRoute.split("?")[0] || "/") ? prevMainRoute : "/";
    navigate({ to: target as any });
  };

  if (keyboardOpen || focusedWorkspace || shouldHideBottomNav(pathname)) return null;

  return (
    <>
      {inCommunity ? (
        /* CONTEXTUAL 4-ITEM COMMUNITY NAVIGATION BAR: Back, Hub, Signal, Moment */
        <nav
          aria-label="Community navigation"
          data-nav-mode="community"
          className="fixed inset-x-0 bottom-0 z-50 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden"
        >
          <div className="glass mx-auto flex max-w-md items-center gap-1 rounded-3xl p-1.5 shadow-lift">
            <button
              type="button"
              onClick={() => {
                closeOverlays();
                handleExitCommunity();
              }}
              aria-label="Back to main navigation"
              className={cn(item, "hover:bg-secondary hover:text-foreground")}
            >
              <ArrowLeft className="size-5" />
              <span>Back</span>
            </button>

            <Link
              to="/hubs"
              search={{}}
              onClick={closeOverlays}
              aria-current={
                pathname.startsWith("/hubs") && !isCommunityMomentsView ? "page" : undefined
              }
              className={cn(
                item,
                pathname.startsWith("/hubs") && !isCommunityMomentsView && activeClass,
              )}
            >
              <Building2 className="size-5" />
              <span>Hub</span>
            </Link>

            <Link
              to="/signals"
              onClick={closeOverlays}
              aria-label="Signal — 1-on-1 Chats"
              aria-current={pathname === "/signals" ? "page" : undefined}
              className={cn(item, pathname.startsWith("/signals") && activeClass)}
            >
              <MessageSquare className="size-5" />
              <span>Signal</span>
            </Link>

            <Link
              to="/hubs"
              search={{ view: "moments" }}
              onClick={closeOverlays}
              aria-current={isCommunityMomentsView ? "page" : undefined}
              className={cn(item, isCommunityMomentsView && activeClass)}
            >
              <Sparkles className="size-5" />
              <span>Moment</span>
            </Link>
          </div>
        </nav>
      ) : (
        /* PRIMARY 5-DESTINATION NAVIGATION BAR: Home, Explore, Create (+), Hubs, Inbox */
        <nav
          aria-label="Primary"
          data-nav-mode="primary"
          className="fixed inset-x-0 bottom-0 z-50 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden"
        >
          <div className="glass mx-auto flex max-w-md items-center gap-1 rounded-3xl p-1.5 shadow-lift">
            <Link
              to="/"
              onClick={closeOverlays}
              aria-current={pathname === "/" ? "page" : undefined}
              className={cn(item, pathname === "/" && activeClass)}
              activeOptions={{ exact: true, includeHash: false }}
            >
              <Home className="size-5" />
              <span>Home</span>
            </Link>

            <Link
              to="/explore"
              onClick={closeOverlays}
              aria-current={pathname.startsWith("/explore") ? "page" : undefined}
              className={cn(item, pathname.startsWith("/explore") && activeClass)}
            >
              <Compass className="size-5" />
              <span>Explore</span>
            </Link>

            <button
              type="button"
              onClick={() => openOverlay("create")}
              aria-label="Create a Ping, Moment, Signal, Hub, or Live session"
              className="flex min-h-14 min-w-12 flex-1 flex-col items-center justify-center gap-0.5"
            >
              <span className="-mt-3 flex size-12 items-center justify-center rounded-full bg-lime text-lime-foreground shadow-lift ring-4 ring-background transition-transform active:scale-95 motion-reduce:active:scale-100">
                <Plus className="size-6 stroke-[2.5]" />
              </span>
              <span className="text-[10px] font-semibold text-muted-foreground">Create</span>
            </button>

            <Link
              to="/hubs"
              search={{}}
              onClick={closeOverlays}
              aria-current={inCommunity ? "page" : undefined}
              className={cn(item, inCommunity && activeClass)}
            >
              <Users className="size-5" />
              <span>Hubs</span>
            </Link>

            <Link
              to={user ? "/messages" : "/login"}
              search={user ? {} : ({ next: "/messages" } as any)}
              onClick={closeOverlays}
              aria-current={isInboxActive ? "page" : undefined}
              className={cn(item, "relative", isInboxActive && activeClass)}
            >
              <span className="relative inline-flex">
                <MessageSquare className="size-5" />
                {unreadInbox > 0 && (
                  <span className="absolute -top-1.5 -right-2 inline-flex min-w-4 h-4 px-1 items-center justify-center rounded-full bg-primary text-primary-foreground text-[9px] font-bold tabular-nums">
                    {unreadInbox > 99 ? "99+" : unreadInbox}
                  </span>
                )}
              </span>
              <span>Inbox</span>
            </Link>
          </div>
        </nav>
      )}
    </>
  );
}
