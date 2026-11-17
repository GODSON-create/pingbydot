import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Building2,
  Compass,
  Home,
  Plus,
  Radio,
  Sparkles,
  User,
  Users,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { FounderAvatar } from "@/components/ping/Avatar";
import { CreateStackModal } from "./CreateStackModal";
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

/**
 * Mobile persistent bottom navigation:
 * - Primary 5-item bar: Home, Explore, Create (elevated central +), Community, Profile
 * - Contextual 4-item bar when inside Community: Back, Hub, Signal, Moment
 * Only one bottom navigation bar is ever rendered at a time.
 */
export function BottomNav() {
  const { user, profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [prevMainRoute, setPrevMainRoute] = useState<string>("/");

  const { pathname, searchStr } = location;
  const inCommunity = isCommunityPath(pathname);
  const isCommunityMomentsView = pathname === "/hubs" && searchStr.includes("view=moments");

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

  const isProfileActive =
    (user && profile && pathname === `/@${profile.username}`) || (!user && pathname === "/login");

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
              onClick={handleExitCommunity}
              aria-label="Back to main navigation"
              className={cn(item, "hover:bg-secondary hover:text-foreground")}
            >
              <ArrowLeft className="size-5" />
              <span>Back</span>
            </button>

            <Link
              to="/hubs"
              search={{}}
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
              className={cn(item, pathname.startsWith("/signals") && activeClass)}
            >
              <Radio className="size-5" />
              <span>Signal</span>
            </Link>

            <Link
              to="/hubs"
              search={{ view: "moments" }}
              className={cn(item, isCommunityMomentsView && activeClass)}
            >
              <Sparkles className="size-5" />
              <span>Moment</span>
            </Link>
          </div>
        </nav>
      ) : (
        /* PRIMARY 5-DESTINATION NAVIGATION BAR: Home, Explore, Create (+), Community, Profile */
        <nav
          aria-label="Primary"
          data-nav-mode="primary"
          className="fixed inset-x-0 bottom-0 z-50 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden"
        >
          <div className="glass mx-auto flex max-w-md items-center gap-1 rounded-3xl p-1.5 shadow-lift">
            <Link
              to="/"
              className={cn(item, pathname === "/" && activeClass)}
              activeOptions={{ exact: true, includeHash: false }}
            >
              <Home className="size-5" />
              <span>Home</span>
            </Link>

            <Link
              to="/explore"
              className={cn(item, pathname.startsWith("/explore") && activeClass)}
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

            <Link to="/hubs" search={{}} className={cn(item, inCommunity && activeClass)}>
              <Users className="size-5" />
              <span>Community</span>
            </Link>

            {user && profile ? (
              <Link
                to="/@{$username}"
                params={{ username: profile.username }}
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
              <Link to="/login" className={cn(item, isProfileActive && activeClass)}>
                <User className="size-5" />
                <span>Profile</span>
              </Link>
            )}
          </div>
        </nav>
      )}

      <CreateStackModal open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
