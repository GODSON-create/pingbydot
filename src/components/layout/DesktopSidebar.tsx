import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Bell,
  Home,
  Compass,
  Building2,
  Radio,
  MessageSquare,
  Settings,
  Plus,
  ShieldCheck,
  Sun,
  Moon,
  Laptop,
  LogOut,
  User,
  Users,
  MoreVertical,
  BarChart3,
  Coins,
  Crown,
  Clapperboard,
  Flame,
  GraduationCap,
  Megaphone,
  Sparkles,
  Code2,
  Download,
  ArrowLeft,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { checkAdminAccess } from "@/lib/admin.functions";
import { useAuth } from "@/lib/auth";
import { isNative } from "@/lib/native";
import { useNavOverlay } from "@/lib/nav-overlay";
import { useTheme } from "@/lib/theme";
import { userConversationsQuery } from "@/lib/messages";
import { dotSummaryQuery } from "@/lib/economy";
import { FounderAvatar } from "@/components/ping/Avatar";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNotificationsState, useSignOut } from "./SiteHeader";
import { isCommunityPath } from "./BottomNav";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function DesktopSidebar() {
  const { user, profile, ready } = useAuth();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const {
    openOverlay,
    closeOverlays,
    isOpen,
    onOpenChangeFor,
    sidebarCollapsed,
    toggleSidebarCollapsed,
  } = useNavOverlay();
  const location = useLocation();
  const navigate = useNavigate();
  const signOut = useSignOut();

  const { pathname, searchStr } = location;
  const inChatWorkspace = pathname.startsWith("/messages") || pathname === "/signals";
  const inCommunity =
    pathname.startsWith("/hubs") ||
    pathname.startsWith("/signals/channels") ||
    pathname.startsWith("/signals/create") ||
    (pathname.startsWith("/signals/") && pathname !== "/signals");
  const effectiveCollapsed = sidebarCollapsed ?? inChatWorkspace;
  const isCommunityMoments = pathname === "/hubs" && searchStr.includes("view=moments");
  const isSignalChannels =
    pathname.startsWith("/signals/channels") ||
    pathname.startsWith("/signals/create") ||
    (pathname.startsWith("/signals/") && pathname !== "/signals");
  const isSignalChats = pathname === "/signals";

  const labelInline = effectiveCollapsed ? "hidden" : "hidden xl:inline truncate";
  const labelInlineBlock = effectiveCollapsed ? "hidden" : "hidden xl:inline-block truncate";
  const rowAlign = effectiveCollapsed ? "justify-center" : "justify-center xl:justify-start";
  const rowBetween = effectiveCollapsed ? "justify-center" : "justify-center xl:justify-between";

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
  const { hasUnread: hasUnreadNotifications } = useNotificationsState(user?.id);

  const toggleTheme = () => {
    const nextTheme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setTheme(nextTheme);
    toast.success(
      nextTheme === "system"
        ? "Theme: System Default"
        : `Theme: ${nextTheme.charAt(0).toUpperCase() + nextTheme.slice(1)} Mode`,
    );
  };

  const primaryItems: Array<{
    to: string;
    params?: { username: string };
    search?: Record<string, string>;
    label: string;
    icon: typeof Home;
    exact?: boolean;
    badge?: number;
  }> = [
    { to: "/", label: "Home", icon: Home, exact: true },
    { to: "/explore", label: "Explore", icon: Compass },
    { to: "/hubs", label: "Hubs", icon: Users },
    {
      to: user ? "/messages" : "/login",
      ...(user ? {} : { search: { next: "/messages" } }),
      label: "Inbox",
      icon: MessageSquare,
      ...(unreadMessages > 0 ? { badge: unreadMessages } : {}),
    },
  ];

  const ThemeIcon = theme === "system" ? Laptop : resolvedTheme === "dark" ? Moon : Sun;

  return (
    <>
      <aside
        aria-label="Desktop Navigation"
        data-collapsed={effectiveCollapsed ? "true" : "false"}
        className={cn(
          "hidden lg:flex flex-col justify-between h-screen sticky top-0 border-r border-border/60 bg-card/40 backdrop-blur-xl py-6 shrink-0 z-40 select-none overflow-y-auto transition-[width,padding] duration-200",
          effectiveCollapsed ? "w-20 px-3" : "w-20 xl:w-64 px-3 xl:px-5",
        )}
      >
        <div>
          <div
            className={cn(
              "flex items-center px-1 h-10",
              effectiveCollapsed ? "justify-center" : "justify-center xl:justify-between",
            )}
          >
            <Link to="/" className="inline-flex items-center" aria-label="Ping by DOT">
              <BrandLogo compact className={effectiveCollapsed ? "inline-flex" : "xl:hidden"} />
              {!effectiveCollapsed && <BrandLogo className="hidden xl:inline-flex" />}
            </Link>
            <button
              type="button"
              data-testid="desktop-sidebar-toggle"
              onClick={() => toggleSidebarCollapsed(effectiveCollapsed)}
              aria-label={
                effectiveCollapsed ? "Expand navigation sidebar" : "Collapse navigation sidebar"
              }
              title={
                effectiveCollapsed ? "Expand navigation sidebar" : "Collapse navigation sidebar"
              }
              className="hidden xl:inline-flex size-8 items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary/80 hover:text-foreground transition-colors"
            >
              {effectiveCollapsed ? (
                <PanelLeftOpen className="size-4" />
              ) : (
                <PanelLeftClose className="size-4" />
              )}
            </button>
          </div>

          {inCommunity ? (
            /* Contextual 4-Item Community Navigation on Desktop */
            <nav className="mt-7 space-y-1" aria-label="Community Navigation">
              <button
                type="button"
                onClick={() => navigate({ to: "/" })}
                className={cn(
                  "relative flex w-full items-center gap-3.5 h-11 rounded-2xl px-3.5 transition-all text-sm font-semibold text-muted-foreground hover:bg-secondary/80 hover:text-foreground",
                  rowAlign,
                )}
                title="Back to main navigation"
              >
                <ArrowLeft className="size-5 shrink-0" />
                <span className={labelInlineBlock}>Back</span>
              </button>

              <Link
                to="/hubs"
                search={{}}
                onClick={closeOverlays}
                aria-current={
                  pathname.startsWith("/hubs") && !isCommunityMoments ? "page" : undefined
                }
                className={cn(
                  "relative flex items-center gap-3.5 h-11 rounded-2xl px-3.5 transition-all text-sm font-semibold",
                  rowAlign,
                  pathname.startsWith("/hubs") && !isCommunityMoments
                    ? "bg-primary/15 text-primary border border-primary/25 shadow-soft"
                    : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground",
                )}
                title="Hub"
              >
                <Building2 className="size-5 shrink-0" />
                <span className={labelInlineBlock}>Hub</span>
              </Link>

              <Link
                to="/signals"
                onClick={closeOverlays}
                aria-current={isSignalChats ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-3 h-11 rounded-2xl px-3.5 transition-all text-sm font-semibold",
                  rowBetween,
                  isSignalChats
                    ? "bg-primary/15 text-primary border border-primary/25 shadow-soft"
                    : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground",
                )}
                title="Signal — 1-on-1 Chats"
              >
                <span className="flex items-center gap-3.5 min-w-0">
                  <MessageSquare className="size-5 shrink-0" />
                  <span className={labelInlineBlock}>Signal</span>
                </span>
                {unreadMessages > 0 ? (
                  <span
                    className={cn(
                      "inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold tabular-nums",
                      effectiveCollapsed
                        ? "absolute top-1.5 right-1.5"
                        : "xl:static absolute top-1.5 right-1.5",
                    )}
                  >
                    {unreadMessages > 99 ? "99+" : unreadMessages}
                  </span>
                ) : null}
              </Link>

              <Link
                to="/signals/channels"
                onClick={closeOverlays}
                aria-current={isSignalChannels ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-3.5 h-11 rounded-2xl px-3.5 transition-all text-sm font-semibold",
                  rowAlign,
                  isSignalChannels
                    ? "bg-primary/15 text-primary border border-primary/25 shadow-soft"
                    : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground",
                )}
                title="Institutional Signal Channels"
              >
                <Radio className="size-5 shrink-0" />
                <span className={labelInlineBlock}>Channels</span>
              </Link>

              <Link
                to="/hubs"
                search={{ view: "moments" }}
                onClick={closeOverlays}
                aria-current={isCommunityMoments ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-3.5 h-11 rounded-2xl px-3.5 transition-all text-sm font-semibold",
                  rowAlign,
                  isCommunityMoments
                    ? "bg-primary/15 text-primary border border-primary/25 shadow-soft"
                    : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground",
                )}
                title="Community Moments"
              >
                <Sparkles className="size-5 shrink-0" />
                <span className={labelInlineBlock}>Moment</span>
              </Link>
            </nav>
          ) : (
            <nav className="mt-7 space-y-1" aria-label="Desktop Main Navigation">
              {primaryItems.map((item) => {
                const targetPath = item.params ? `/@${item.params.username}` : item.to;
                const isActive = item.exact
                  ? pathname === targetPath
                  : item.to === "/hubs"
                    ? isCommunityPath(pathname) && pathname !== "/signals"
                    : item.label === "Inbox"
                      ? pathname.startsWith("/messages") || pathname === "/signals"
                      : pathname === targetPath || pathname.startsWith(`${targetPath}/`);
                const Icon = item.icon;

                return (
                  <Link
                    key={item.label}
                    to={item.to as any}
                    params={item.params as any}
                    search={item.search as any}
                    onClick={closeOverlays}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "relative flex items-center gap-3 h-11 rounded-2xl px-3.5 transition-all text-sm font-semibold group",
                      rowBetween,
                      isActive
                        ? "bg-primary/15 text-primary border border-primary/25 shadow-soft"
                        : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground",
                    )}
                    title={item.label}
                  >
                    <span className="flex items-center gap-3.5 min-w-0">
                      <Icon
                        className={cn(
                          "size-5 shrink-0 transition-transform group-hover:scale-105",
                          isActive
                            ? "text-primary"
                            : "text-muted-foreground group-hover:text-foreground",
                        )}
                      />
                      <span className={labelInlineBlock}>{item.label}</span>
                    </span>
                    {item.badge && item.badge > 0 ? (
                      <span
                        className={cn(
                          "inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold tabular-nums",
                          effectiveCollapsed
                            ? "absolute top-1.5 right-1.5"
                            : "xl:static absolute top-1.5 right-1.5",
                        )}
                      >
                        {item.badge > 99 ? "99+" : item.badge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </nav>
          )}

          {/* 3. PRIMARY ACTION: CREATE STACK */}
          <div className="mt-5">
            <Button
              type="button"
              variant="hero"
              onClick={() => openOverlay("create")}
              className={cn(
                "w-full h-11 rounded-2xl text-sm font-bold shadow-lift flex items-center justify-center gap-2",
                effectiveCollapsed ? "px-0" : "px-0 xl:px-4",
              )}
              title="Create"
            >
              <Plus className="size-5 shrink-0" />
              <span className={effectiveCollapsed ? "hidden" : "hidden xl:inline"}>Create</span>
            </Button>
          </div>
        </div>

        {/* 4. BOTTOM CONTROLS: NOTIFICATIONS, THEME TOGGLE & USER PROFILE */}
        <div className="space-y-2.5 pt-4 border-t border-border/50">
          <button
            type="button"
            onClick={() => openOverlay("notifications")}
            className={cn(
              "relative flex items-center gap-3 h-10 w-full rounded-2xl px-3 text-xs font-medium text-muted-foreground hover:bg-secondary/80 hover:text-foreground transition-all group",
              rowBetween,
            )}
            aria-label="Notifications"
            title="Notifications"
          >
            <span className="flex items-center gap-3 min-w-0">
              <Bell className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
              <span className={labelInline}>Notifications</span>
            </span>
            {hasUnreadNotifications && (
              <span
                data-testid="sidebar-notifications-unread-dot"
                className={cn(
                  "size-2 rounded-full bg-lime ring-2 ring-card",
                  effectiveCollapsed
                    ? "absolute top-2 right-2"
                    : "xl:static absolute top-2 right-2",
                )}
                aria-hidden="true"
              />
            )}
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            className={cn(
              "flex items-center gap-3 h-10 w-full rounded-2xl px-3 text-xs font-medium text-muted-foreground hover:bg-secondary/80 hover:text-foreground transition-all group",
              rowAlign,
            )}
            title={`Switch Theme (Current: ${theme})`}
          >
            <ThemeIcon className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-transform group-hover:rotate-12" />
            <span className={cn(labelInline, "capitalize")}>
              {theme === "system" ? "System Default" : `${theme} Mode`}
            </span>
          </button>

          {ready && user ? (
            <DropdownMenu
              open={isOpen("sidebar-account")}
              onOpenChange={onOpenChangeFor("sidebar-account")}
            >
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex items-center gap-3 w-full p-2 rounded-2xl hover:bg-secondary/80 text-left transition-all border border-border/40 hover:border-border",
                    rowBetween,
                  )}
                  aria-label="Account Settings"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FounderAvatar
                      name={profile?.display_name || profile?.username || "You"}
                      src={profile?.avatar_url}
                      size="sm"
                    />
                    {!effectiveCollapsed && (
                      <div className="hidden xl:block min-w-0">
                        <p className="font-semibold text-xs text-foreground truncate">
                          {profile?.display_name || profile?.username}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          @{profile?.username}
                        </p>
                      </div>
                    )}
                  </div>
                  {!effectiveCollapsed && (
                    <MoreVertical className="hidden xl:block size-4 text-muted-foreground shrink-0" />
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-60 rounded-2xl p-1.5 mb-2">
                {profile && (
                  <DropdownMenuItem asChild className="rounded-xl">
                    <Link
                      to="/@{$username}"
                      params={{ username: profile.username }}
                      onClick={closeOverlays}
                      className="flex items-center gap-2"
                    >
                      <User className="size-4" /> View profile
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
                        {dotSummary.wallet.balance} DOT
                      </span>
                    )}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="rounded-xl">
                  <Link to="/analytics" onClick={closeOverlays} className="flex items-center gap-2">
                    <BarChart3 className="size-4 text-primary" /> Analytics
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="rounded-xl">
                  <Link to="/upgrades" onClick={closeOverlays} className="flex items-center gap-2">
                    <Crown className="size-4 text-gold" /> DOT Memberships
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="rounded-xl">
                  <Link to="/learn" onClick={closeOverlays} className="flex items-center gap-2">
                    <GraduationCap className="size-4 text-primary" /> Ping Learn
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="rounded-xl">
                  <Link to="/spotlight" onClick={closeOverlays} className="flex items-center gap-2">
                    <Flame className="size-4 text-amber-500" /> Ping Spotlight
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="rounded-xl">
                  <Link to="/clips" onClick={closeOverlays} className="flex items-center gap-2">
                    <Clapperboard className="size-4 text-primary" /> Ping Clips
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="rounded-xl">
                  <Link to="/boosts" onClick={closeOverlays} className="flex items-center gap-2">
                    <Megaphone className="size-4 text-gold" /> Boost Campaigns
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="rounded-xl">
                  <Link to="/business" onClick={closeOverlays} className="flex items-center gap-2">
                    <Building2 className="size-4" /> Business Suite
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="rounded-xl">
                  <Link to="/griot" onClick={closeOverlays} className="flex items-center gap-2">
                    <Sparkles className="size-4 text-primary" /> GRIOT AI
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="rounded-xl">
                  <Link
                    to="/developers"
                    onClick={closeOverlays}
                    className="flex items-center gap-2"
                  >
                    <Code2 className="size-4" /> Developer Platform
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="rounded-xl">
                  <Link to="/download" onClick={closeOverlays} className="flex items-center gap-2">
                    <Download className="size-4" /> Download Ping App
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="rounded-xl">
                  <Link to="/settings" onClick={closeOverlays} className="flex items-center gap-2">
                    <Settings className="size-4" /> Settings
                  </Link>
                </DropdownMenuItem>
                {admin.data?.isAdmin && (
                  <DropdownMenuItem asChild className="rounded-xl">
                    <Link to="/admin" onClick={closeOverlays} className="flex items-center gap-2">
                      <ShieldCheck className="size-4" /> Admin Console
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    closeOverlays();
                    signOut();
                  }}
                  className="rounded-xl text-destructive flex items-center gap-2"
                >
                  <LogOut className="size-4" /> Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            !effectiveCollapsed && (
              <div className="hidden xl:flex flex-col gap-2">
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="w-full rounded-xl text-xs h-9"
                >
                  <Link to="/login" onClick={closeOverlays}>
                    Log in
                  </Link>
                </Button>
                <Button asChild variant="hero" size="sm" className="w-full rounded-xl text-xs h-9">
                  <Link to="/signup" onClick={closeOverlays}>
                    Join PING
                  </Link>
                </Button>
              </div>
            )
          )}
        </div>
      </aside>
    </>
  );
}
