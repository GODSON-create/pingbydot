import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { DesktopSidebar } from "@/components/layout/DesktopSidebar";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { BottomNav } from "@/components/layout/BottomNav";
import { GestureLayer } from "@/components/layout/GestureLayer";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { SITE_NAME, siteJsonLd } from "@/lib/site";

function NotFoundComponent() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-5 text-center">
      <span className="sticker -rotate-3 bg-blush text-blush-foreground">404 · lost signal</span>
      <h1 className="mt-6 font-display text-5xl font-extrabold">This Ping went quiet.</h1>
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
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-2xl font-bold">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. Try again or head back home.
        </p>
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
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Ping — Build in public. Share your story." },
      {
        name: "description",
        content:
          "Ping is where founders share progress, ideas, launches and milestones with a public link anyone can open.",
      },
      { property: "og:title", content: "Ping — Build in public. Share your story." },
      {
        property: "og:description",
        content: "Share progress, ideas and milestones as Pings with public links.",
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: SITE_NAME },
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
      // PENDING OFFICIAL LOGO: swap to the official favicon/app icons once installed.
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
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
    <html lang="en">
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('ping-theme');var d=t==='dark'||(!t||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();",
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

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const { pathname } = useLocation();
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-lime focus:px-4 focus:py-2"
          >
            Skip to content
          </a>
          <SiteHeader />
          <div className="mx-auto w-full max-w-7xl flex flex-col lg:flex-row items-start min-h-screen">
            <DesktopSidebar />
            <div className="flex-1 min-w-0 w-full flex flex-col min-h-screen">
              <main id="main" key={pathname} className="animate-page-in">
                <Outlet />
              </main>
              <div className="pb-24 lg:pb-0">
                <SiteFooter />
              </div>
            </div>
          </div>
          <BottomNav />
          <GestureLayer />
          <Toaster position="bottom-center" />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
