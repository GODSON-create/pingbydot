import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { ErrorComponent } from "./routes/__root";

function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  const status = Number((error as { status?: unknown } | null)?.status ?? 0);
  // Never waste retries on permission/RLS, missing table/RPC, or 4xx errors
  if (code === "42501" || code === "PGRST205" || code === "PGRST202" || code === "23505") {
    return false;
  }
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
    return false;
  }
  return true;
}

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 20_000,
        retry: shouldRetryQuery,
        refetchOnReconnect: true,
        refetchOnWindowFocus: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: ErrorComponent,
  });

  return router;
};
