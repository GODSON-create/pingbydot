import { Link, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Compass,
  Home,
  LayoutGrid,
  LogIn,
  LogOut,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  User,
  UserPlus,
  Building2,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { checkAdminAccess } from "@/lib/admin.functions";
import { useSignOut } from "./SiteHeader";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const item =
  "flex min-h-14 min-w-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[10px] font-semibold text-muted-foreground transition-colors active:scale-95 motion-reduce:active:scale-100";
const active = { className: "text-foreground bg-secondary" };
const row =
  "flex min-h-12 items-center gap-3 rounded-2xl px-4 py-3 font-medium hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Mobile-only persistent navigation; desktop keeps the header nav. */
export function BottomNav() {
  const { user, profile, ready } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const signOut = useSignOut();
  const verifyAdmin = useServerFn(checkAdminAccess);
  const admin = useQuery({
    queryKey: ["admin-access", user?.id],
    queryFn: () => verifyAdmin(),
    enabled: ready && !!user,
    retry: false,
    staleTime: 0,
  });
  const close = () => setOpen(false);

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-50 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden"
      >
        <div className="glass mx-auto flex max-w-md items-center gap-1 rounded-3xl p-1.5">
          <Link
            to="/"
            className={item}
            activeProps={active}
            activeOptions={{ exact: true, includeHash: false }}
          >
            <Home className="size-5" />
            Home
          </Link>
          <Link to="/explore" className={item} activeProps={active}>
            <Compass className="size-5" />
            Explore
          </Link>
          <Link to="/hubs" className={item} activeProps={active}>
            <Building2 className="size-5" />
            Hubs
          </Link>
          <Link
            to={user ? "/create" : "/signup"}
            aria-label={user ? "New Ping" : "Create your first Ping"}
            className="flex min-h-14 min-w-12 flex-1 items-center justify-center"
          >
            <span className="flex size-11 items-center justify-center rounded-full bg-lime text-lime-foreground shadow-lift transition-transform active:scale-95 motion-reduce:active:scale-100">
              <Plus className="size-5" />
            </span>
          </Link>
          {user && profile ? (
            <Link
              to="/@{$username}"
              params={{ username: profile.username }}
              className={item}
              activeProps={active}
            >
              <User className="size-5" />
              Profile
            </Link>
          ) : (
            <Link to="/login" className={item} activeProps={active}>
              <LogIn className="size-5" />
              Log in
            </Link>
          )}
          <Button
            variant="ghost"
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={open}
            className={cn(
              item,
              "h-auto whitespace-normal px-0",
              open && "bg-secondary text-foreground",
            )}
          >
            <LayoutGrid className="size-5" />
            More
          </Button>
        </div>
      </nav>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-3xl pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="text-left">
            <SheetTitle className="font-display">Quick actions</SheetTitle>
            <SheetDescription>
              {pathname.startsWith("/p/")
                ? "Share or report this Ping with the buttons on the page."
                : "Everything else on Ping, one tap away."}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-2 grid gap-1" onClick={close}>
            <Link to="/hubs" className={row}>
              <Building2 className="size-5" /> Discover Hubs
            </Link>
            {user && (
              <Link to="/hubs/create" className={row}>
                <Plus className="size-5" /> Create a Hub
              </Link>
            )}
            <Link to="/" hash="how" className={row}>
              <Sparkles className="size-5" /> How it works
            </Link>
            {user ? (
              <>
                <Link to="/settings" className={row}>
                  <Settings className="size-5" /> Settings & connections
                </Link>
                {admin.data?.isAdmin && (
                  <Link to="/admin" className={row}>
                    <ShieldCheck className="size-5" /> Administration
                  </Link>
                )}
                <Button
                  variant="ghost"
                  type="button"
                  onClick={signOut}
                  className={cn(row, "h-auto justify-start text-left")}
                >
                  <LogOut className="size-5" /> Log out
                </Button>
              </>
            ) : (
              <Link to="/signup" className={row}>
                <UserPlus className="size-5" /> Sign up
              </Link>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
