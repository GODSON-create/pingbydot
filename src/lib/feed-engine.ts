import { likeCount, replyCount, type Ping } from "@/lib/pings";
import { extractAllDiscoveryTags } from "@/lib/dot-tags";
import { parseStructuredPing } from "@/lib/validation";

export type FeedMode = "foryou" | "following" | "latest" | "trending" | "opportunities";

export interface FeedRankingContext {
  mode: FeedMode;
  viewerId?: string | null;
  interests?: string[];
  followedTopics?: string[];
  followedAuthorIds?: Set<string>;
  mutedUserIds?: Set<string>;
  blockedUserIds?: Set<string>;
  nowMs?: number;
}

/**
 * Relevance-first, anti-engagement-bait feed ranking engine (Phase 2.3).
 *
 * Principles:
 * - Never surfaces muted or blocked accounts.
 * - Filters out future-scheduled drafts authored by other users.
 * - Prioritises relevance (user interests, followed topics, relationships) and
 *   structured coordination clarity (headline, needs, offers, CTA, media) over raw virality.
 * - Applies logarithmic damping to likes/replies so engagement bait cannot dominate.
 */
export function scorePingForFeed(ping: Ping, ctx: FeedRankingContext): number {
  const nowMs = ctx.nowMs ?? Date.now();
  const createdMs = new Date(ping.created_at).getTime();
  const ageHours = Math.max(
    0,
    (nowMs - (Number.isFinite(createdMs) ? createdMs : nowMs)) / 3_600_000,
  );

  if (ctx.mode === "latest") {
    return createdMs;
  }

  const likes = likeCount(ping);
  const replies = replyCount(ping);
  // Logarithmic damping resists clickbait/engagement-bait spikes
  const dampedEngagement = Math.min(8, Math.log1p(likes + replies * 1.6) * 2.1);

  const recencyMultiplier =
    ctx.mode === "trending" ? 1 / Math.pow(ageHours + 2, 0.85) : 1 / Math.pow(ageHours + 3, 0.65);

  const structured = parseStructuredPing(ping);
  const discoveryTags = extractAllDiscoveryTags(ping.content);
  const textLower =
    `${ping.category} ${structured.headline ?? ""} ${structured.body}`.toLowerCase();

  let relevanceBonus = 0;
  const userTopics = new Set([
    ...(ctx.interests ?? []).map((t) => t.toLowerCase()),
    ...(ctx.followedTopics ?? []).map((t) => t.toLowerCase().replace(/^[.#]+/, "")),
  ]);

  for (const topic of userTopics) {
    if (!topic) continue;
    if (discoveryTags.includes(topic) || textLower.includes(topic)) {
      relevanceBonus += 4.5;
    }
  }

  let relationshipBonus = 0;
  if (ctx.followedAuthorIds?.has(ping.user_id)) {
    relationshipBonus += 3.5;
  }

  let qualityBonus = 0;
  if (structured.headline) qualityBonus += 1.0;
  if (structured.needs.length > 0 || structured.offers.length > 0) qualityBonus += 1.25;
  if (ping.cta_url) qualityBonus += 0.75;
  if (ping.image_url || (ping.media_urls && ping.media_urls.length > 0)) qualityBonus += 0.6;

  if (ctx.mode === "trending") {
    return (dampedEngagement * 2.2 + qualityBonus + relevanceBonus * 0.4) * recencyMultiplier;
  }

  if (ctx.mode === "opportunities") {
    const oppBoost =
      ["opportunity", "need", "offer", "collaboration"].includes(
        structured.intentFormat.toLowerCase(),
      ) || ping.category === "opportunity"
        ? 8
        : 0;
    return (oppBoost + relevanceBonus + qualityBonus + dampedEngagement) * recencyMultiplier;
  }

  return (
    (3 + relevanceBonus + relationshipBonus + qualityBonus + dampedEngagement) * recencyMultiplier
  );
}

export function rankFeedPings(pings: Ping[], ctx: FeedRankingContext): Ping[] {
  const nowMs = ctx.nowMs ?? Date.now();
  const visible = pings.filter((ping) => {
    if (ctx.mutedUserIds?.has(ping.user_id)) return false;
    if (ctx.blockedUserIds?.has(ping.user_id)) return false;

    const scheduledFor = (ping as Ping & { scheduled_for?: string | null }).scheduled_for;
    if (scheduledFor && ping.user_id !== ctx.viewerId) {
      const schedMs = new Date(scheduledFor).getTime();
      if (Number.isFinite(schedMs) && schedMs > nowMs) return false;
    }

    if (ctx.mode === "opportunities") {
      const structured = parseStructuredPing(ping);
      const intent = structured.intentFormat.toLowerCase();
      return (
        ping.category === "opportunity" ||
        intent === "opportunity" ||
        intent === "need" ||
        intent === "offer" ||
        intent === "collaboration"
      );
    }

    return true;
  });

  if (ctx.mode === "latest") {
    return [...visible].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }

  return [...visible].sort((a, b) => scorePingForFeed(b, ctx) - scorePingForFeed(a, ctx));
}

export function extractTrendingTopics(
  pings: Ping[],
  limit = 10,
): Array<{ slug: string; count: number }> {
  const counts = new Map<string, number>();
  for (const ping of pings) {
    for (const tag of extractAllDiscoveryTags(ping.content)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    if (ping.category) {
      const cat = ping.category.toLowerCase();
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([slug, count]) => ({ slug, count }))
    .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug))
    .slice(0, limit);
}
