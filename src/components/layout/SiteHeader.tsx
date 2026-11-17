import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  Bell,
  Plus,
  LogOut,
  Settings,
  User,
  Building2,
  Radio,
  MessageSquare,
  Sun,
  Moon,
  Laptop,
  BarChart3,
  Coins,
  Crown,
  Heart,
  MessageCircle,
  UserPlus,
} from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { checkAdminAccess } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { userConversationsQuery } from "@/lib/messages";
import { dotSummaryQuery } from "@/lib/economy";
import { supabase } from "@/integrations/supabase/client";
import { FounderAvatar } from "@/components/ping/Avatar";
import { BrandLogo } from "@/components/BrandLogo";
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
import { CreateStackModal } from "./CreateStackModal";

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
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  };
}

interface NotificationItem {
  id: string;
  kind: "like" | "comment" | "follow";
  text: string;
  href: string;
  created_at: string;
}

function useNotificationsQuery(userId?: string) {
  return useQuery({
    queryKey: ["header-notifications", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<NotificationItem[]> => {
      if (!userId) return [];
      const { data: myPings } = await supabase
        .from("pings")
        .select("id, content")
        .eq("user_id", userId)
        .is("hidden_at", null)
        .order("created_at", { ascending: false })
        .limit(20);

      const pingIds = (myPings ?? []).map((p) => p.id);
      const pingExcerpt = new Map((myPings ?? []).map((p) => [p.id, p.content.slice(0, 48)]));

      const [commentsRes, followsRes] = await Promise.all([
        pingIds.length > 0
          ? supabase
              .from("comments")
              .select(
                "id, ping_id, user_id, content, created_at, author:profiles!comments_user_id_fkey(username, display_name)",
              )
              .in("ping_id", pingIds)
              .neq("user_id", userId)
              .order("created_at", { ascending: false })
              .limit(10)
          : Promise.resolve({ data: [] as any[] }),
        supabase
          .from("follows")
          .select(
            "follower_id, created_at, follower:profiles!follows_follower_id_fkey(username, display_name)",
          )
          .eq("following_id", userId)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);

      const items: NotificationItem[] = [];
      for (const c of (commentsRes.data ?? []) as any[]) {
        const actor = c.author?.display_name || `@${c.author?.username || "builder"}`;
        items.push({
          id: `comment-${c.id}`,
          kind: "comment",
          text: `${actor} replied to "${pingExcerpt.get(c.ping_id) ?? "your Ping"}…"`,
          href: `/p/${c.ping_id}`,
          created_at: c.created_at,
        });
      }
      for (const f of (followsRes.data ?? []) as any[]) {
        const actor = f.follower?.display_name || `@${f.follower?.username || "builder"}`;
        const uname = f.follower?.username;
        items.push({
          id: `follow-${f.follower_id}-${f.created_at}`,
          kind: "follow",
          text: `${actor} started following you`,
          href: uname ? `/@${uname}` : "/explore",
          created_at: f.created_at,
        });
      }

      return items
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 12);
    },
  });
}

const navLink =
  "rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground";

export function SiteHeader() {
  const { user, profile, ready } = useAuth();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const signOut = useSignOut();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const verifyAdmin = useServerFn(checkAdminAccess);
  const admin = useQuery({
    queryKey: ["admin-access", user?.id],
    queryFn: () => verifyAdmin(),
    enabled: ready && !!user,
    retry: false,
    staleTime: 0,
  });

  const { data: conversations = [] } = useQuery(userConversationsQuery(user?.id));
  const unreadMessages = conversations.reduce((sum, c) => sum + (c.unread_count ?? 0), 0);
  const { data: dotSummary } = useQuery(dotSummaryQuery(user?.id));
  const { data: notifications = [] } = useNotificationsQuery(user?.id);

  const toggleTheme = () => {
    const nextTheme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setTheme(nextTheme);
  };
  const ThemeIcon = theme === "system" ? Laptop : resolvedTheme === "dark" ? Moon : Sun;

  return (
    <>
      <header className="sticky top-0 z-50 px-3 pt-2.5 sm:px-5 lg:hidden">
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
              to="/hubs"
              className={navLink}
              activeProps={{ className: "text-foreground bg-secondary" }}
            >
              Community
            </Link>
            {user && (
              <Link
                to="/messages"
                className={`${navLink} relative inline-flex items-center gap-1.5`}
                activeProps={{ className: "text-foreground bg-secondary" }}
              >
                Messages
                {unreadMessages > 0 && (
                  <span className="inline-flex min-w-4 h-4 px-1 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold tabular-nums">
                    {unreadMessages > 99 ? "99+" : unreadMessages}
                  </span>
                )}
              </Link>
            )}
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Notification Access */}
            <button
              type="button"
              onClick={() => setNotificationsOpen(true)}
              className="relative flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground transition-all"
              aria-label="Notifications"
              title="Notifications"
            >
              <Bell className="size-4" />
              {notifications.length > 0 && (
                <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-lime ring-2 ring-card" />
              )}
            </button>

            {/* Private Direct Messages Entry Point */}
            {ready && user && (
              <Link
                to="/messages"
                className="relative flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground transition-all md:hidden"
                aria-label="Direct Messages"
                title="Direct Messages"
              >
                <MessageSquare className="size-4" />
                {unreadMessages > 0 && (
                  <span className="absolute top-1 right-1 size-2 rounded-full bg-primary ring-2 ring-card" />
                )}
              </Link>
            )}

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

            <div className="hidden items-center gap-2 md:flex">
              {ready && user ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="hero"
                    onClick={() => setCreateOpen(true)}
                  >
                    <Plus /> Create
                  </Button>
                  <DropdownMenu>
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
                          <Link to="/@{$username}" params={{ username: profile.username }}>
                            <User /> My profile
                          </Link>
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem asChild className="rounded-xl">
                        <Link to="/balance" className="flex items-center justify-between">
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
                        <Link to="/analytics">
                          <BarChart3 className="text-primary" /> Analytics
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild className="rounded-xl">
                        <Link to="/upgrades">
                          <Crown className="text-gold" /> Account Upgrades
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild className="rounded-xl">
                        <Link to="/hubs">
                          <Building2 /> Community Hubs
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild className="rounded-xl">
                        <Link to="/signals">
                          <Radio /> Signals
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild className="rounded-xl">
                        <Link to="/messages">
                          <MessageSquare /> Direct Messages
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild className="rounded-xl">
                        <Link to="/settings">
                          <Settings /> Settings
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {admin.data?.isAdmin && (
                        <DropdownMenuItem asChild className="rounded-xl">
                          <Link to="/admin">
                            <Settings /> Administration
                          </Link>
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={signOut} className="rounded-xl text-destructive">
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
      <Sheet open={notificationsOpen} onOpenChange={setNotificationsOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md rounded-l-3xl p-6">
          <SheetHeader className="text-left">
            <SheetTitle className="font-display text-xl font-bold flex items-center gap-2">
              <Bell className="size-5 text-primary" /> Notifications
            </SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              Replies, followers, and coordination activity on your Pings.
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
                  onClick={() => setNotificationsOpen(false)}
                >
                  <Link to="/login">Sign in</Link>
                </Button>
              </div>
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
                  onClick={() => setNotificationsOpen(false)}
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

      <CreateStackModal open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
