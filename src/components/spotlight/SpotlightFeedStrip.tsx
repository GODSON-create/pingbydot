import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Flame } from "lucide-react";
import {
  PING_OFFICIAL_ACCOUNT,
  recordObservedSpotlightEvent,
  spotlightPublicationsQuery,
  type SpotlightChannel,
} from "@/lib/spotlight";
import { FounderAvatar } from "@/components/ping/Avatar";

/**
 * Live Ping Spotlight Distribution Strip (Addendum Section 12).
 *
 * Surfaces editorially published Spotlight features inside Home (`home_feed`)
 * and Explore (`explore`) ONLY when configured for that channel and backed by
 * real published records. Records observed impressions & clicks honestly — never
 * forces unapproved posts or fabricates metrics.
 */
export function SpotlightFeedStrip({
  channel,
  maxItems = 2,
}: {
  channel: Extract<SpotlightChannel, "home_feed" | "explore">;
  maxItems?: number;
}) {
  const { data } = useQuery(spotlightPublicationsQuery());
  const loggedImpressionsRef = useRef<Set<string>>(new Set());

  const eligible = (data?.publications ?? [])
    .filter((pub) => {
      if (pub.status !== "published" && pub.status !== "corrected") return false;
      const cfg = pub.distribution_config;
      if (!cfg) return true;
      return channel === "home_feed" ? cfg.home_feed !== false : cfg.explore !== false;
    })
    .slice(0, maxItems);

  useEffect(() => {
    for (const pub of eligible) {
      const key = `${channel}:${pub.id}`;
      if (loggedImpressionsRef.current.has(key)) continue;
      loggedImpressionsRef.current.add(key);
      void recordObservedSpotlightEvent(pub.id, channel, "impression");
    }
  }, [eligible, channel]);

  if (eligible.length === 0) return null;

  return (
    <section
      aria-label="Ping Spotlight Featured Stories"
      data-testid={`spotlight-strip-${channel}`}
      className="surface-card rounded-2xl border border-amber-500/35 bg-amber-500/5 p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-600 dark:text-amber-300">
          <Flame className="size-4" /> Ping Spotlight · @{PING_OFFICIAL_ACCOUNT.handle}
        </span>
        <Link
          to="/spotlight"
          className="text-[11px] font-semibold text-primary hover:underline inline-flex items-center gap-0.5"
        >
          All stories <ArrowUpRight className="size-3" />
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {eligible.map((pub) => {
          const founderName =
            pub.founder?.display_name || pub.founder?.username || "Featured Founder";
          return (
            <Link
              key={pub.id}
              to="/spotlight/$slug"
              params={{ slug: pub.slug }}
              onClick={() => void recordObservedSpotlightEvent(pub.id, channel, "click")}
              className="rounded-xl border border-border/70 bg-card/90 p-3.5 hover:border-amber-500/50 transition-colors flex items-start gap-3"
            >
              <FounderAvatar
                name={founderName}
                src={pub.founder_portrait_url || pub.founder?.avatar_url}
                size="sm"
              />
              <div className="min-w-0 space-y-1">
                <p className="font-display font-bold text-xs text-foreground line-clamp-2">
                  {pub.title}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {founderName}
                  {pub.business?.name ? ` · ${pub.business.name}` : ""}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
