import { pageHead } from "@/lib/site";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { feedQuery } from "@/lib/pings";
import { ExploreDiscoveryView } from "@/components/explore/ExploreDiscoveryView";

export const Route = createFileRoute("/explore")({
  staticData: { sitemap: true },
  validateSearch: z.object({
    c: z
      .enum([
        "progress",
        "need",
        "offer",
        "opportunity",
        "idea",
        "question",
        "collaboration",
        "update",
        "launch",
        "milestone",
      ])
      .optional(),
    filter: z
      .enum(["all", "pings", "people", "moments", "communities", "signals", "opportunities"])
      .optional(),
    q: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(0).max(10000).optional(),
  }),
  loaderDeps: ({ search: { c, page } }) => ({ cat: c ?? null, page: page ?? 0 }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(feedQuery(deps.cat, deps.page)),
  head: () =>
    pageHead({
      title: "Explore — PING Network Discovery",
      description:
        "Discover people, Moments, Hubs, institutional Signals, open opportunities, and Pings on PING.",
      path: "/explore",
    }),
  component: ExplorePage,
});

function ExplorePage() {
  const { c, filter, q, page } = Route.useSearch();
  const initialPings = Route.useLoaderData();

  return (
    <ExploreDiscoveryView
      basePath="/explore"
      initialPings={initialPings}
      category={c ?? null}
      initialFilter={filter}
      initialQuery={q ?? ""}
      pageNum={page ?? 0}
    />
  );
}
