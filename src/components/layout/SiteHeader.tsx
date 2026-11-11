import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, LogOut, Settings, User, Building2, Radio } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { checkAdminAccess } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
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

const navLink = "rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground";

export function SiteHeader() {
  const { user, profile, ready } = useAuth();
  const signOut = useSignOut();
  const verifyAdmin = useServerFn(checkAdminAccess);
  const admin = useQuery({ queryKey: ["admin-access", user?.id], queryFn: () => verifyAdmin(), enabled: ready && !!user, retry: false, staleTime: 0 });

  return (
    <header className="sticky top-0 z-50 px-3 pt-3 sm:px-5">
      <div className="glass mx-auto flex h-16 max-w-6xl items-center justify-between rounded-full px-4 sm:px-6">
        <Wordmark />
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          <Link to="/explore" className={navLink} activeProps={{ className: "text-foreground bg-secondary" }}>Explore</Link>
          <Link to="/hubs" className={navLink} activeProps={{ className: "text-foreground bg-secondary" }}>Hubs</Link>
          <Link to="/signals" className={navLink} activeProps={{ className: "text-foreground bg-secondary" }}>Signals</Link>
          <Link to="/" hash="how" className={navLink}>How it works</Link>
          <Link to="/" hash="demo" className={navLink}>Demo</Link>
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          {ready && user ? (
            <>
              <Button asChild size="sm" variant="hero">
                <Link to="/create"><Plus /> New Ping</Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Account menu">
                  <FounderAvatar name={profile?.display_name || profile?.username || "You"} src={profile?.avatar_url} size="sm" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52 rounded-2xl">
                  {profile && (
                    <DropdownMenuItem asChild>
                      <Link to="/@{$username}" params={{ username: profile.username }}><User /> My profile</Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem asChild>
                    <Link to="/hubs"><Building2 /> Hubs</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/signals"><Radio /> Signals</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/settings"><Settings /> Settings</Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {admin.data?.isAdmin && <DropdownMenuItem asChild><Link to="/admin"><Settings /> Administration</Link></DropdownMenuItem>}
                  <DropdownMenuItem onSelect={signOut}><LogOut /> Log out</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Link to="/login" className={navLink}>Log in</Link>
              <Button asChild size="sm" variant="hero">
                <Link to="/signup">Create your first Ping</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
