import { Link, useLocation } from "@tanstack/react-router";
import {
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
  MoreVertical,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { checkAdminAccess } from "@/lib/admin.functions";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
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
import { useSignOut } from "./SiteHeader";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function DesktopSidebar() {
  const { user, profile, ready } = useAuth();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { pathname } = useLocation();
  const signOut = useSignOut();
  const verifyAdmin = useServerFn(checkAdminAccess);

  const admin = useQuery({
    queryKey: ["admin-access", user?.id],
    queryFn: () => verifyAdmin(),
    enabled: ready && !!user,
    retry: false,
    staleTime: 0,
  });

  const toggleTheme = () => {
    const nextTheme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setTheme(nextTheme);
    toast.success(
      nextTheme === "system"
        ? "Theme: System Default"
        : `Theme: ${nextTheme.charAt(0).toUpperCase() + nextTheme.slice(1)} Mode`,
    );
  };

  const navItems = [
    { to: "/", label: "Home", icon: Home, exact: true },
    { to: "/explore", label: "Explore", icon: Compass },
    { to: "/hubs", label: "Hubs", icon: Building2 },
    { to: "/signals", label: "Signals", icon: Radio },
    ...(user ? [{ to: "/messages", label: "Messages", icon: MessageSquare }] : []),
    ...(user ? [{ to: "/settings", label: "Settings", icon: Settings }] : []),
    ...(admin.data?.isAdmin ? [{ to: "/admin", label: "Administration", icon: ShieldCheck }] : []),
  ];

  const ThemeIcon = theme === "system" ? Laptop : resolvedTheme === "dark" ? Moon : Sun;

  return (
    <aside
      aria-label="Desktop Navigation"
      className="hidden lg:flex flex-col justify-between h-screen sticky top-0 w-20 xl:w-64 border-r border-border/60 bg-card/40 backdrop-blur-xl px-3 xl:px-5 py-6 shrink-0 z-40 select-none"
    >
      {/* 1. TOP BRAND LOGO */}
      <div>
        <div className="flex items-center justify-center xl:justify-start px-1 h-10">
          <Link to="/" className="inline-flex items-center gap-2 group" aria-label="Ping by DOT">
            <BrandLogo />
            <span className="hidden xl:inline-block font-display font-extrabold text-lg text-foreground tracking-tight group-hover:text-primary transition-colors">
              Ping{" "}
              <span className="text-[10px] text-muted-foreground font-sans font-normal uppercase">
                by DOT
              </span>
            </span>
          </Link>
        </div>

        {/* 2. MAIN NAVIGATION DESTINATIONS */}
        <nav className="mt-8 space-y-1.5" aria-label="Desktop Main Navigation">
          {navItems.map((item) => {
            const isActive = item.exact
              ? pathname === item.to
              : pathname === item.to || pathname.startsWith(`${item.to}/`);
            const Icon = item.icon;

            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3.5 h-12 rounded-2xl px-3.5 transition-all text-sm font-semibold group",
                  isActive
                    ? "bg-primary/15 text-primary border border-primary/25 shadow-soft"
                    : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground",
                )}
                title={item.label}
              >
                <Icon
                  className={cn(
                    "size-5 shrink-0 transition-transform group-hover:scale-105",
                    isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                  )}
                />
                <span className="hidden xl:inline-block truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* 3. PRIMARY ACTION: POST A PING (ELECTRIC PING GREEN) */}
        <div className="mt-6">
          <Button
            asChild
            variant="hero"
            className="w-full h-12 rounded-2xl text-sm font-bold shadow-lift flex items-center justify-center gap-2"
          >
            <Link to="/create" title="Post a Ping">
              <Plus className="size-5 shrink-0" />
              <span className="hidden xl:inline">Post a Ping</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* 4. BOTTOM CONTROLS: THEME TOGGLE & USER PROFILE */}
      <div className="space-y-3 pt-4 border-t border-border/50">
        {/* Quick Theme Switcher */}
        <button
          type="button"
          onClick={toggleTheme}
          className="flex items-center gap-3 h-10 w-full rounded-2xl px-3 text-xs font-medium text-muted-foreground hover:bg-secondary/80 hover:text-foreground transition-all group"
          title={`Switch Theme (Current: ${theme})`}
        >
          <ThemeIcon className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-transform group-hover:rotate-12" />
          <span className="hidden xl:inline truncate capitalize">
            {theme === "system" ? "System Default" : `${theme} Mode`}
          </span>
        </button>

        {/* User Account / Profile Card */}
        {ready && user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center justify-between gap-3 w-full p-2 rounded-2xl hover:bg-secondary/80 text-left transition-all border border-border/40 hover:border-border"
                aria-label="Account Settings"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <FounderAvatar
                    name={profile?.display_name || profile?.username || "You"}
                    src={profile?.avatar_url}
                    size="sm"
                  />
                  <div className="hidden xl:block min-w-0">
                    <p className="font-semibold text-xs text-foreground truncate">
                      {profile?.display_name || profile?.username}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      @{profile?.username}
                    </p>
                  </div>
                </div>
                <MoreVertical className="hidden xl:block size-4 text-muted-foreground shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-56 rounded-2xl p-1.5 mb-2">
              {profile && (
                <DropdownMenuItem asChild className="rounded-xl">
                  <Link
                    to="/@{$username}"
                    params={{ username: profile.username }}
                    className="flex items-center gap-2"
                  >
                    <User className="size-4" /> View profile
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem asChild className="rounded-xl">
                <Link to="/settings" className="flex items-center gap-2">
                  <Settings className="size-4" /> Settings
                </Link>
              </DropdownMenuItem>
              {admin.data?.isAdmin && (
                <DropdownMenuItem asChild className="rounded-xl">
                  <Link to="/admin" className="flex items-center gap-2">
                    <ShieldCheck className="size-4" /> Admin Console
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={signOut}
                className="rounded-xl text-destructive flex items-center gap-2"
              >
                <LogOut className="size-4" /> Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="hidden xl:flex flex-col gap-2">
            <Button asChild variant="outline" size="sm" className="w-full rounded-xl text-xs h-9">
              <Link to="/login">Log in</Link>
            </Button>
            <Button asChild variant="hero" size="sm" className="w-full rounded-xl text-xs h-9">
              <Link to="/signup">Join Ping</Link>
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}
