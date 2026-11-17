import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  staticData: { sitemap: "exclude-subtree" },
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data: sessionData } = await supabase.auth.getSession();
    let activeUser = sessionData.session?.user ?? null;

    if (!activeUser) {
      const { data: userData } = await supabase.auth.getUser();
      activeUser = userData.user ?? null;
    }

    if (!activeUser) {
      const intended = `${location.pathname}${location.searchStr || ""}`;
      throw redirect({
        to: "/login",
        search: intended && intended !== "/" ? { next: intended } : { next: "/" },
      });
    }
  },
  component: () => <Outlet />,
});
