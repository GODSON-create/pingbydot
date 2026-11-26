import { useCallback, useEffect, useMemo } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Bell,
  Plus,
  LogOut,
  Settings,
  User,
  Users,
  Building2,
  Inbox,
  Radio,
  MessageSquare,
  Sun,
  Moon,
  Laptop,
  BarChart3,
  Coins,
  Crown,
  Clapperboard,
  Flame,
  GraduationCap,
  Megaphone,
  Heart,
  MessageCircle,
  UserPlus,
  Sparkles,
  Code2,
} from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { checkAdminAccess } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { QueryErrorCard } from "@/components/QueryErrorCard";
import { markIntentionalSignOut, useAuth } from "@/lib/auth";
import { useFocusedWorkspace } from "@/lib/draft-store";
import { isNative } from "@/lib/native";
import { markWelcomeSeen } from "@/lib/pathways";
import { useNavOverlay } from "@/lib/nav-overlay";
import { useTheme } from "@/lib/theme";
import { clearSessionRestoredFlag } from "@/lib/telemetry";
import { useInboxRealtime, userConversationsQuery } from "@/lib/messages";
import { dotSummaryQuery } from "@/lib/economy";
import {
  fetchUnifiedNotifications,
  groupNotifications,
  markCentralNotificationsRead,
  type GroupedNotification,
} from "@/lib/notifications";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { FounderAvatar } from "@/components/ping/Avatar";
import { BrandLogo } from "@/components/BrandLogo";
import { isInboxPath } from "./BottomNav";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export function Wordmark() {
  return (
    <Link to="/" className="inline-flex items-center" aria-label="Ping by DOT home">
      <BrandLogo />
    </Link>
  );
}

export function useSignOut() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    markIntentionalSignOut();
    markWelcomeSeen();
    clearSessionRestoredFlag();
    await qc.cancelQueries();
    qc.clear();
    try {
      await supabase.auth.signOut();
    } catch {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    }
    navigate({ to: "/login", replace: true });
  };
}

const NOTIF_SEEN_PREFIX = "ping_notif_seen_at:";

function readSeenTimestamp(userId?: string): string | null {
  if (!userId || typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(`${NOTIF_SEEN_PREFIX}${userId}`);
  } catch {
    return null;
  }
}

function writeSeenTimestamp(userId: string, iso: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${NOTIF_SEEN_PREFIX}${userId}`, iso);
  } catch {
    // Ignore storage errors in restricted environments
  }
}

function useNotificationsQuery(userId?: string) {
  return useQuery({
    queryKey: ["header-notifications", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      if (!userId) return [];
      return fetchUnifiedNotifications(userId);
    },
    staleTime: 30_000,
  });
}

export function useNotificationsState(userId?: string) {
  const qc = useQueryClient();
  const query = useNotificationsQuery(userId);
  const rawNotifications = useMemo(() => query.data ?? [], [query.data]);

  const { data: seenAt = null } = useQuery<string | null>({
    queryKey: ["notif-seen-at", userId],
    enabled: Boolean(userId),
    queryFn: () => readSeenTimestamp(userId),
    initialData: () => readSeenTimestamp(userId),
    staleTime: Infinity,
  });

  const notifications: GroupedNotification[] = useMemo(
    () => groupNotifications(rawNotifications, seenAt),
    [rawNotifications, seenAt],
  );

  const markSeen = useCallback(() => {
    if (!userId) return;
    const latestCreatedAt = rawNotifications[0]?.created_at ?? new Date().toISOString();
    const nextSeen =
      seenAt && new Date(seenAt).getTime() > new Date(latestCreatedAt).getTime()
        ? seenAt
        : latestCreatedAt;
    if (nextSeen !== seenAt) {
      writeSeenTimestamp(userId, nextSeen);
      qc.setQueryData(["notif-seen-at", userId], nextSeen);
    }
    void markCentralNotificationsRead().catch(() => {});
  }, [userId, rawNotifications, seenAt, qc]);

  const unreadCount = notifications.filter((n) => n.unread).length;
  const hasUnread = unreadCount > 0;

  return {
    ...query,
    notifications,
    unreadCount,
    hasUnread,
    markSeen,
  };
}

const navLink =
  "rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground";

export function SiteHeader() {
  const { user, profile, ready } = useAuth();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { pathname } = useLocation();
  const { openOverlay, closeOverlays, isOpen, onOpenChangeFor } = useNavOverlay();
  const focusedWorkspace = useFocusedWorkspace();
  const signOut = useSignOut();
  const inInbox = isInboxPath(pathname);
  const isProfileActive =
    (Boolean(user && profile) && pathname === `/@${profile!.username}`) ||
    (!user && pathname === "/login");

  useInboxRealtime(user?.id);

  const verifyAdmin = useServerFn(checkAdminAccess);
  const admin = useQuery({
    queryKey: ["admin-access", user?.id],
    queryFn: async () => (isNative ? { isAdmin: false } : verifyAdmin()),
    enabled: ready && !!user,
    retry: false,
    staleTime: 0,
  });

  const { data: conversations = [] } = useQuery(userConversationsQuery(user?.id));
  const unreadMessages = conversations.reduce((sum, c) => sum + (c.unread_count ?? 0), 0);
  const { data: dotSummary } = useQuery(dotSummaryQuery(user?.id));
  const {
    notifications,
    hasUnread: hasUnreadNotifications,
    markSeen,
    isLoading: isNotifLoading,
    isError: isNotifError,
    error: notifError,
    refetch: refetchNotifications,
  } = useNotificationsState(user?.id);

  const notificationsOpen = isOpen("notifications");
  useEffect(() => {
    if (notificationsOpen && !isNotifLoading && !isNotifError) {
      markSeen();
    }
  }, [notificationsOpen, isNotifLoading, isNotifError, markSeen]);

  const toggleTheme = () => {
    const nextTheme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setTheme(nextTheme);
  };
  const ThemeIcon = theme === "system" ? Laptop : resolvedTheme === "dark" ? Moon : Sun;

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-50 px-3 pt-[max(0.625rem,env(safe-area-inset-top))] sm:px-5 lg:hidden",
          focusedWorkspace && "hidden md:block",
        )}
      >
        <div className="glass mx-auto flex h-14 max-w-6xl items-center justify-between rounded-full px-4 sm:px-6">
          <Wordmark />

          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            <Link
              to="/"
              activeOptions={{ exact: true }}
              className={navLink}
              activeProps={{ className: "text-foreground bg-secondary" }}
            >
              Home
            </Link>
            <Link
              to="/explore"
              className={navLink}
              activeProps={{ className: "text-foreground bg-secondary" }}
            >
              Explore
            </Link>
            <Link
              to="/inbox"
              search={{}}
              aria-current={inInbox ? "page" : undefined}
              className={cn(
                `${navLink} relative inline-flex items-center gap-1.5`,
                inInbox && "text-foreground bg-secondary",
              )}
            >
              Inbox
              {unreadMessages > 0 && (
                <span className="inline-flex min-w-4 h-4 px-1 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold tabular-nums">
                  {unreadMessages > 99 ? "99+" : unreadMessages}
                </span>
              )}
            </Link>
            {user && profile ? (
              <Link
                to="/@{$username}"
                params={{ username: profile.username }}
                aria-current={isProfileActive ? "page" : undefined}
                className={cn(navLink, isProfileActive && "text-foreground bg-secondary")}
              >
                Profile
              </Link>
            ) : (
              <Link
                to={user ? "/settings" : "/login"}
                aria-current={isProfileActive ? "page" : undefined}
                className={cn(navLink, isProfileActive && "text-foreground bg-secondary")}
              >
                Profile
              </Link>
            )}
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Notification Access */}
            <button
              type="button"
              onClick={() => openOverlay("notifications")}
              className="relative flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground transition-all"
              aria-label="Notifications"
              title="Notifications"
            >
              <Bell className="size-4" />
              {hasUnreadNotifications && (
                <span
                  data-testid="notifications-unread-dot"
                  className="absolute top-1.5 right-1.5 size-2 rounded-full bg-lime ring-2 ring-card"
                  aria-hidden="true"
                />
              )}
            </button>

            {/* Quick Theme Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground transition-all"
              title={`Theme: ${theme}`}
              aria-label="Toggle theme"
            >
              <ThemeIcon className="size-4" />
            </button>

            {/* Mobile compact Sign in CTA when signed out */}
            {ready && !user && (
              <Button
                asChild
                size="sm"
                variant="hero"
                className="h-8 rounded-full px-3 text-xs md:hidden"
              >
                <Link to="/login">Sign in</Link>
              </Button>
            )}

            <div className="hidden items-center gap-2 md:flex">
              {ready && user ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="hero"
                    onClick={() => openOverlay("create")}
                  >
                    <Plus /> Create
                  </Button>
                  <DropdownMenu
                    open={isOpen("header-account")}
                    onOpenChange={onOpenChangeFor("header-account")}
                  >
                    <DropdownMenuTrigger
                      className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="Account menu"
                    >
                      <FounderAvatar
                        name={profile?.display_name || profile?.username || "You"}
                        src={profile?.avatar_url}
                        size="sm"
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56 rounded-2xl p-1.5">
                      {profile && (
                        <DropdownMenuItem asChild className="rounded-xl">
                          <Link
                            to="/@{$username}"
                            params={{ username: profile.username }}
                            onClick={closeOverlays}
                          >
                            <User /> My profile
                          </Link>
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem asChild className="rounded-xl">
                        <Link
                          to="/balance"
                          onClick={closeOverlays}
                          className="flex items-center justify-between"
                        >
                          <span className="flex items-center gap-2">
                            <Coins className="size-4 text-gold" /> DOT Balance
                          </span>
                          {dotSummary && (
                            <span className="rounded-full bg-gold/15 text-gold border border-gold/30 px-2 py-0.5 text-[10px] font-bold tabular-nums">
                              {dotSummary.wallet.balance}
                            </span>
                          )}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild className="rounded-xl">
                        <Link to="/analytics" onClick={closeOverlays}>
                          <BarChart3 className="text-primary" /> Analytics
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild className="rounded-xl">
                        <Link to="/upgrades" onClick={closeOverlays}>
                          <Crown className="text-gold" /> DOT Memberships
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild className="rounded-xl">
                        <Link to="/learn" onClick={closeOverlays}>
                          <GraduationCap className="text-primary" /> Ping Learn
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild className="rounded-xl">
                        <Link to="/spotlight" onClick={closeOverlays}>
                          <Flame className="text-amber-500" /> Ping Spotlight
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild className="rounded-xl">
                        <Link to="/clips" onClick={closeOverlays}>
                          <Clapperboard className="text-primary" /> Ping Clips
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild className="rounded-xl">
                        <Link to="/boosts" onClick={closeOverlays}>
                          <Megaphone className="text-gold" /> Boost Campaigns
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild className="rounded-xl">
                        <Link to="/inbox" search={{}} onClick={closeOverlays}>
                          <Inbox /> Inbox
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild className="rounded-xl">
                        <Link to="/messages" onClick={closeOverlays}>
                          <MessageSquare /> Chats
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild className="rounded-xl">
                        <Link to="/inbox" search={{ section: "hubs" }} onClick={closeOverlays}>
                          <Users /> Hubs
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild className="rounded-xl">
                        <Link to="/inbox" search={{ section: "signals" }} onClick={closeOverlays}>
                          <Radio /> Signals
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild className="rounded-xl">
                        <Link to="/business" onClick={closeOverlays}>
                          <Building2 /> Business Suite
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild className="rounded-xl">
                        <Link to="/griot" onClick={closeOverlays}>
                          <Sparkles className="text-primary" /> GRIOT AI
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild className="rounded-xl">
                        <Link to="/developers" onClick={closeOverlays}>
                          <Code2 /> Developer Platform
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild className="rounded-xl">
                        <Link to="/settings" onClick={closeOverlays}>
                          <Settings /> Settings
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {admin.data?.isAdmin && (
                        <DropdownMenuItem asChild className="rounded-xl">
                          <Link to="/admin" onClick={closeOverlays}>
                            <Settings /> Administration
                          </Link>
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onSelect={() => {
                          closeOverlays();
                          signOut();
                        }}
                        className="rounded-xl text-destructive"
                      >
                        <LogOut /> Log out
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : (
                <>
                  <Link to="/login" className={navLink}>
                    Log in
                  </Link>
                  <Button asChild size="sm" variant="hero">
                    <Link to="/signup">Join PING</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Notifications Sheet */}
      <Sheet open={isOpen("notifications")} onOpenChange={onOpenChangeFor("notifications")}>
        <SheetContent side="right" className="w-full sm:max-w-md rounded-l-3xl p-6 overflow-y-auto">
          <SheetHeader className="text-left">
            <div className="flex items-center justify-between gap-2 pr-6">
              <SheetTitle className="font-display text-xl font-bold flex items-center gap-2">
                <Bell className="size-5 text-primary" /> Notifications
              </SheetTitle>
              {user && (
                <div className="flex items-center gap-2">
                  {notifications.length > 0 && (
                    <button
                      type="button"
                      onClick={markSeen}
                      className="text-[11px] font-semibold text-primary hover:underline"
                    >
                      Mark all read
                    </button>
                  )}
                  <Link
                    to="/settings"
                    onClick={closeOverlays}
                    className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
                  >
                    Preferences
                  </Link>
                </div>
              )}
            </div>
            <SheetDescription className="text-xs text-muted-foreground">
              Grouped replies, reactions, followers, Hub activity, and opportunity updates.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-5 space-y-2.5">
            {!user ? (
              <div className="rounded-2xl border border-border/70 p-6 text-center">
                <p className="text-sm font-medium">Sign in to view your notifications</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Track responses to your intentions, new followers, and Hub updates.
                </p>
                <Button
                  asChild
                  variant="hero"
                  size="sm"
                  className="mt-4 rounded-full"
                  onClick={closeOverlays}
                >
                  <Link to="/login">Sign in</Link>
                </Button>
              </div>
            ) : isNotifLoading ? (
              <div className="space-y-2.5" aria-label="Loading notifications">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-16 rounded-2xl bg-muted/60 animate-pulse" />
                ))}
              </div>
            ) : isNotifError ? (
              <QueryErrorCard
                compact
                title="Couldn't load notifications"
                error={notifError}
                onRetry={() => void refetchNotifications()}
              />
            ) : notifications.length === 0 ? (
              <div className="rounded-2xl border border-border/60 p-8 text-center">
                <Bell className="mx-auto size-8 text-muted-foreground/40" />
                <p className="mt-3 text-sm font-semibold">You're all caught up</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  New replies, connections, and community broadcasts will appear here.
                </p>
              </div>
            ) : (
              notifications.map((n) => (
                <Link
                  key={n.id}
                  to={n.href as any}
                  onClick={closeOverlays}
                  className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card/60 p-3.5 transition-colors hover:bg-secondary/70"
                >
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    {n.kind === "comment" ? (
                      <MessageCircle className="size-4" />
                    ) : n.kind === "follow" ? (
                      <UserPlus className="size-4" />
                    ) : (
                      <Heart className="size-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground leading-relaxed">{n.text}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {formatDistanceToNowStrict(new Date(n.created_at))} ago
                    </p>
                  </div>
                </Link>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
