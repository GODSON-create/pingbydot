import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  staticData: { sitemap: "exclude-subtree" },
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    let activeUser = sessionData.session?.user ?? null;
    let expired = Boolean(sessionErr);

    if (
      activeUser &&
      sessionData.session?.expires_at &&
      sessionData.session.expires_at * 1000 <= Date.now()
    ) {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) {
        expired = true;
        activeUser = null;
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      } else {
        activeUser = userData.user;
      }
    } else if (!activeUser && !sessionErr) {
      const { data: userData } = await supabase.auth.getUser();
      activeUser = userData.user ?? null;
    }

    if (!activeUser) {
      const intended = `${location.pathname}${location.searchStr || ""}`;
      throw redirect({
        to: "/login",
        search: {
          next: intended && intended !== "/" ? intended : "/",
          ...(expired ? { reason: "expired" as const } : {}),
        },
      });
    }
  },
  component: () => <Outlet />,
});
