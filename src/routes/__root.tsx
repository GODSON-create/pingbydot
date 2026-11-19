import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useLocation,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { sanitizeErrorMessage } from "../lib/error-diagnostics";
import { initializeNativeApp, useNetworkStatus } from "@/lib/native";
import { useNavigate } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth";
import { useFocusedWorkspace } from "@/lib/draft-store";
import { NavOverlayProvider, useNavOverlay } from "@/lib/nav-overlay";
import { ThemeProvider } from "@/lib/theme";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { DesktopSidebar } from "@/components/layout/DesktopSidebar";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { BottomNav, shouldHideBottomNav } from "@/components/layout/BottomNav";
import { CreateStackModal } from "@/components/layout/CreateStackModal";
import { BootSplashScreen } from "@/components/layout/BootSplashScreen";
import { GestureLayer } from "@/components/layout/GestureLayer";
import { PingMark } from "@/components/BrandLogo";
import { Toaster } from "@/components/ui/sonner";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Keyboard, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SITE_NAME, siteJsonLd, siteUrl } from "@/lib/site";

function NotFoundComponent() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-5 text-center">
      <PingMark variant="silver" size="xl" alt="PING Silver Mark" />
      <h1 className="mt-5 font-display text-4xl font-extrabold">This Ping went quiet.</h1>
      <p className="mt-3 text-muted-foreground">
        The page you're looking for doesn't exist, or the Ping was deleted.
      </p>
      <div className="mt-8 flex gap-3">
        <Button asChild variant="hero">
          <Link to="/explore">Explore Pings</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/">Go home</Link>
        </Button>
      </div>
    </div>
  );
}

export function ErrorComponent({ error, reset }: ErrorComponentProps) {
  const sanitizedDetail = sanitizeErrorMessage(error);
  console.error("[RouteError]", sanitizedDetail);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, {
      boundary: "tanstack_root_error_component",
      pathname: typeof window !== "undefined" ? window.location.pathname : undefined,
    });
  }, [error]);
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-2xl font-bold">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. Try again or head back home.
        </p>
        {import.meta.env.DEV && sanitizedDetail && (
          <p
            data-testid="dev-error-detail"
            className="mt-3 rounded-xl border border-destructive/20 bg-secondary/70 px-3 py-2 font-mono text-xs text-destructive break-words text-left"
          >
            {sanitizedDetail}
          </p>
        )}
        <div className="mt-6 flex justify-center gap-2">
          <Button
            onClick={() => {
              router.invalidate();
              reset();
            }}
          >
            Try again
          </Button>
          <Button asChild variant="outline">
            <a href="/">Go home</a>
          </Button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
      },
      { title: "Ping — Build in public. Share your story." },
      {
        name: "description",
        content:
          "Social, communication, discovery, and economic network for everyone. Share Pings, Moments, join Hubs, and message 1-on-1 in Signal.",
      },
      { property: "og:title", content: "Ping — Build in public. Share your story." },
      {
        property: "og:description",
        content: "Share progress, ideas and milestones as Pings with public links.",
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:image", content: siteUrl("/brand/ping-logo.svg") },
      { name: "twitter:image", content: siteUrl("/brand/ping-logo.svg") },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#173C32" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Hanken+Grotesk:wght@400;500;600;700&display=swap",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/brand/ping-mark-lime.png", type: "image/png" },
      { rel: "icon", href: "/brand/ping-icon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/brand/ping-mark-lime.png" },
    ],
    scripts: [{ type: "application/ld+json", children: JSON.stringify(siteJsonLd()) }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('ping-theme');var d=t==='dark'||(!t||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches;if(d){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark';var m=document.querySelector('meta[name=\"theme-color\"]');if(m)m.setAttribute('content','#090b0a');}}catch(e){}})();",
          }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootShellContent() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { connected } = useNetworkStatus();
  const { helpOpen, setHelpOpen } = useKeyboardShortcuts();
  const { activeOverlay, isOpen, onOpenChangeFor, closeOverlays } = useNavOverlay();

  useEffect(() => {
    void initializeNativeApp(
      (path) => navigate({ to: path as any }),
      () => {
        if (helpOpen) {
          setHelpOpen(false);
          return true;
        }
        if (activeOverlay !== "none") {
          closeOverlays();
          return true;
        }
        return false;
      },
    );
  }, [navigate, helpOpen, setHelpOpen, activeOverlay, closeOverlays]);

  useEffect(() => {
    if (helpOpen) closeOverlays();
  }, [helpOpen, closeOverlays]);

  const focusedWorkspace = useFocusedWorkspace();
  const hideBottomBar = shouldHideBottomNav(pathname) || focusedWorkspace;
  const hideFooter =
    pathname.startsWith("/messages") || pathname === "/signals" || shouldHideBottomNav(pathname);

  return (
    <>
      <BootSplashScreen />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-lime focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <SiteHeader />
      {!connected && (
        <div
          role="status"
          aria-live="polite"
          className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-foreground"
        >
          <span className="inline-flex items-center gap-2 font-medium">
            <WifiOff className="size-3.5 text-amber-500 shrink-0" />
            You appear to be offline. Cached views stay readable and updates resume automatically on
            reconnect.
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void qc.invalidateQueries()}
            className="h-7 rounded-full px-3 text-[11px] shrink-0"
          >
            Retry
          </Button>
        </div>
      )}
      <div className="mx-auto w-full max-w-7xl flex flex-col lg:flex-row items-start min-h-screen overflow-x-clip">
        <DesktopSidebar />
        <div
          className={`flex-1 min-w-0 w-full flex flex-col min-h-screen${
            !hideBottomBar ? " pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0" : ""
          }`}
        >
          <main
            id="main"
            key={pathname}
            className="animate-page-in flex-1 w-full min-w-0 overflow-x-clip"
          >
            <Outlet />
          </main>
          {!hideFooter && <SiteFooter />}
        </div>
      </div>
      <BottomNav />
      <CreateStackModal open={isOpen("create")} onOpenChange={onOpenChangeFor("create")} />
      <GestureLayer />

      {/* Keyboard Shortcuts Overlay */}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-sm rounded-3xl p-6 bg-card text-card-foreground">
          <DialogHeader>
            <div className="flex items-center gap-2 text-primary font-bold text-sm">
              <Keyboard className="size-4" />
              <span>Keyboard Navigation</span>
            </div>
            <DialogTitle className="font-display text-lg">Shortcuts</DialogTitle>
          </DialogHeader>

          <div className="mt-4 space-y-2.5 text-xs">
            <div className="flex items-center justify-between py-1 border-b border-border/40">
              <span className="text-muted-foreground">Post a new Ping</span>
              <kbd className="px-2 py-0.5 rounded bg-secondary border border-border font-mono font-bold">
                C
              </kbd>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-border/40">
              <span className="text-muted-foreground">Explore directory</span>
              <kbd className="px-2 py-0.5 rounded bg-secondary border border-border font-mono font-bold">
                /
              </kbd>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-border/40">
              <span className="text-muted-foreground">Go to Home</span>
              <kbd className="px-2 py-0.5 rounded bg-secondary border border-border font-mono font-bold">
                G H
              </kbd>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-border/40">
              <span className="text-muted-foreground">Go to Messages</span>
              <kbd className="px-2 py-0.5 rounded bg-secondary border border-border font-mono font-bold">
                G M
              </kbd>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-border/40">
              <span className="text-muted-foreground">Go to Hubs</span>
              <kbd className="px-2 py-0.5 rounded bg-secondary border border-border font-mono font-bold">
                G B
              </kbd>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-border/40">
              <span className="text-muted-foreground">Go to Signals</span>
              <kbd className="px-2 py-0.5 rounded bg-secondary border border-border font-mono font-bold">
                G S
              </kbd>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-muted-foreground">Toggle this help</span>
              <kbd className="px-2 py-0.5 rounded bg-secondary border border-border font-mono font-bold">
                ?
              </kbd>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Toaster />
    </>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <NavOverlayProvider>
            <RootShellContent />
          </NavOverlayProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
