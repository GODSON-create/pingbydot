import { Link, useNavigate } from "@tanstack/react-router";
import { formatDistanceToNowStrict } from "date-fns";
import { ArrowUpRight, Bookmark, MessageCircle, MessageSquare, Repeat2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { mySavedPingsQuery, replyCount, useToggleSavePing, type Ping } from "@/lib/pings";
import { CATEGORIES, parseStructuredPing } from "@/lib/validation";
import { useAuth } from "@/lib/auth";
import { LEAD_ELIGIBLE_PING_CATEGORIES, recordNetworkEvent } from "@/lib/economic-events";
import { useGetOrCreateDirectConversation } from "@/lib/messages";
import { FounderAvatar } from "./Avatar";
import { LikeButton, PingMenu, ShareMenu } from "./PingActions";
import { PingPollCard } from "./PingPollCard";
import { PingReactionBar } from "./PingReactionBar";
import { RichPingText } from "./RichPingText";
import { MusicAttachmentBar } from "@/components/music/MusicAttachmentBar";
import { cn } from "@/lib/utils";
import { RepingAttribution } from "./Comments";
import { useState } from "react";
import { useLongPress } from "@/hooks/use-long-press";

const CAT_TONE: Record<string, string> = {
  progress: "bg-accent text-accent-foreground",
  building: "bg-accent text-accent-foreground",
  need: "bg-blush text-blush-foreground",
  offer: "bg-lime text-lime-foreground",
  opportunity: "bg-gold/15 text-gold border border-gold/30",
  idea: "bg-sun text-sun-foreground",
  question: "bg-secondary text-secondary-foreground",
  collaboration: "bg-primary/15 text-primary border border-primary/30",
  update: "bg-accent text-accent-foreground",
  launch: "bg-lime text-lime-foreground",
  milestone: "bg-primary text-primary-foreground",
};

export function CategoryTag({ value, labelOverride }: { value: string; labelOverride?: string }) {
  const normalized = value.toLowerCase();
  const c = CATEGORIES.find((x) => x.value === normalized);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        CAT_TONE[normalized] ?? "bg-secondary text-secondary-foreground",
      )}
    >
      {labelOverride ?? c?.label ?? value}
    </span>
  );
}

export function CtaLink({ ping }: { ping: Ping }) {
  const { user } = useAuth();
  if (!ping.cta_url) return null;
  let host = "";
  try {
    host = new URL(ping.cta_url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  return (
    <a
      href={ping.cta_url}
      target="_blank"
      rel="noopener noreferrer nofollow ugc"
      onClick={(e) => {
        e.stopPropagation();
        if (user?.id && user.id !== ping.user_id) {
          void recordNetworkEvent({
            eventType: "business_lead_generated",
            targetType: "ping",
            targetId: ping.id,
            source: "ping_cta",
            metadata: { ping_category: ping.category, cta_host: host },
          });
        }
      }}
      className="group/cta mt-3.5 flex items-center justify-between gap-3 rounded-2xl border border-border bg-secondary/50 px-4 py-3 text-sm transition-colors hover:border-primary hover:bg-accent"
    >
      <span className="min-w-0">
        <span className="block font-semibold text-foreground">
          {ping.cta_label || "Open resource"}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{host}</span>
      </span>
      <ArrowUpRight className="size-4 shrink-0 text-primary transition-transform group-hover/cta:-translate-y-0.5 group-hover/cta:translate-x-0.5" />
    </a>
  );
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?.*)?$/i.test(url);
}

export function PingCard({
  ping,
  linkToDetail = true,
  hubBadge,
}: {
  ping: Ping;
  linkToDetail?: boolean;
  hubBadge?: { name: string; slug: string; intent?: string | null };
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const startChatMutation = useGetOrCreateDirectConversation();
  const { data: savedSet } = useQuery(mySavedPingsQuery(user?.id));
  const toggleSaveMutation = useToggleSavePing(user?.id);

  const name = ping.author?.display_name || ping.author?.username || "Founder";
  const [actions, setActions] = useState(false);
  const [failedMedia, setFailedMedia] = useState<Set<string>>(() => new Set());
  const press = useLongPress(() => setActions(true));

  const structured = parseStructuredPing(ping);
  const isSaved = Boolean(savedSet?.has(ping.id));
  const isAuthor = Boolean(user?.id && ping.user_id === user.id);

  const mediaList: string[] = [];
  if (ping.image_url) mediaList.push(ping.image_url);
  if (Array.isArray(ping.media_urls)) {
    for (const u of ping.media_urls) {
      if (u && !mediaList.includes(u)) mediaList.push(u);
    }
  }

  const isSharePageUrl = (url: string) => /^https?:\/\/photos\.app\.goo\.gl\//i.test(url);
  const markMediaFailed = (url: string) => {
    setFailedMedia((prev) => {
      if (prev.has(url)) return prev;
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  };
  const visibleMedia = mediaList
    .slice(0, 4)
    .filter((url) => !failedMedia.has(url) && !isSharePageUrl(url));
  const shareLinks = mediaList.slice(0, 4).filter((url) => isSharePageUrl(url));

  const handleRespondConnect = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) {
      navigate({ to: "/login", search: { next: `/p/${ping.id}` } });
      return;
    }
    if (isAuthor) {
      navigate({ to: "/p/$id", params: { id: ping.id } });
      return;
    }
    try {
      if (LEAD_ELIGIBLE_PING_CATEGORIES.has(ping.category.toLowerCase())) {
        void recordNetworkEvent({
          eventType: "business_lead_generated",
          targetType: "ping",
          targetId: ping.id,
          source: "ping_direct_reply",
          metadata: { ping_category: ping.category },
        });
      }
      const convId = await startChatMutation.mutateAsync(ping.user_id);
      navigate({ to: "/messages", search: { conversationId: convId } });
    } catch {
      navigate({ to: "/p/$id", params: { id: ping.id }, hash: "replies-title" });
    }
  };

  const handleToggleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) {
      toast("Sign in to save Pings", {
        action: { label: "Log in", onClick: () => navigate({ to: "/login" }) },
      });
      return;
    }
    toggleSaveMutation.mutate(
      { pingId: ping.id, currentlySaved: isSaved },
      {
        onSuccess: (saved) => {
          toast.success(saved ? "Saved to your bookmarks" : "Removed from saved Pings");
        },
      },
    );
  };

  return (
    <article
      {...press}
      className="surface-card lift relative flex flex-col rounded-3xl p-5 sm:p-6 transition-all"
    >
      {/* Card Header: Author Identity, Timestamp & Intent Category */}
      <header className="relative z-10 flex items-start justify-between gap-3">
        {ping.author ? (
          <Link
            to="/@{$username}"
            params={{ username: ping.author.username }}
            className="flex min-w-0 flex-1 items-center gap-3"
          >
            <FounderAvatar name={name} src={ping.author.avatar_url} />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5">
                <span className="truncate font-semibold text-foreground hover:underline">
                  {name}
                </span>
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                @{ping.author.username} ·{" "}
                <time dateTime={ping.created_at}>
                  {formatDistanceToNowStrict(new Date(ping.created_at))} ago
                </time>
              </span>
            </span>
          </Link>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <FounderAvatar name={name} src={null} />
            <span className="text-sm font-semibold">{name}</span>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-1.5">
          {hubBadge && (
            <Link
              to="/hubs/$slug"
              params={{ slug: hubBadge.slug }}
              search={hubBadge.intent ? { intent: hubBadge.intent } : {}}
              className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-semibold hover:bg-secondary/80"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="truncate max-w-28">{hubBadge.name}</span>
            </Link>
          )}
          <CategoryTag value={structured.intentFormat} labelOverride={structured.intentLabel} />
        </div>
      </header>

      {/* Card Body: Intent Headline, Description, Needs/Offers & Media */}
      <div className="mt-3.5 flex-1">
        {structured.headline && (
          <h3 className="mb-1.5 font-display text-base sm:text-lg font-bold tracking-tight text-foreground">
            {structured.headline}
          </h3>
        )}

        {linkToDetail ? (
          <Link
            to="/p/$id"
            params={{ id: ping.id }}
            className="block whitespace-pre-line break-words text-[15px] leading-relaxed text-foreground/95 after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RichPingText
              text={
                structured.body.length > 420 ? structured.body.slice(0, 420) + "…" : structured.body
              }
            />
          </Link>
        ) : (
          <p className="whitespace-pre-line break-words text-base sm:text-lg leading-relaxed text-foreground">
            <RichPingText text={structured.body} />
          </p>
        )}

        {/* Structured Coordination Requirements: Needs, Offers, Outcome */}
        {(structured.needs.length > 0 ||
          structured.offers.length > 0 ||
          Boolean(structured.desiredOutcome)) && (
          <div className="relative z-10 mt-3.5 space-y-2 rounded-2xl border border-border/70 bg-secondary/35 p-3 text-xs">
            {structured.needs.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-muted-foreground">Needs:</span>
                {structured.needs.map((need) => (
                  <span
                    key={need}
                    className="rounded-lg border border-border bg-card px-2 py-0.5 font-medium text-foreground"
                  >
                    {need}
                  </span>
                ))}
              </div>
            )}
            {structured.offers.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-muted-foreground">Offers:</span>
                {structured.offers.map((offer) => (
                  <span
                    key={offer}
                    className="rounded-lg border border-primary/30 bg-primary/10 px-2 py-0.5 font-medium text-primary"
                  >
                    {offer}
                  </span>
                ))}
              </div>
            )}
            {structured.desiredOutcome && (
              <p className="text-muted-foreground">
                <span className="font-semibold text-foreground">Outcome:</span>{" "}
                {structured.desiredOutcome}
              </p>
            )}
          </div>
        )}

        {/* Responsive Media Preview (Single, Multi-Image Gallery up to 4, or Video) */}
        {visibleMedia.length > 0 && (
          <div
            className={cn(
              "relative z-10 mt-3.5 overflow-hidden rounded-2xl border border-border/60 bg-secondary/30",
              visibleMedia.length > 1 && "grid grid-cols-2 gap-1",
            )}
          >
            {visibleMedia.map((url) =>
              isVideoUrl(url) ? (
                <video
                  key={url}
                  src={url}
                  controls
                  playsInline
                  preload="metadata"
                  onClick={(e) => e.stopPropagation()}
                  onError={() => markMediaFailed(url)}
                  className={cn(
                    "w-full object-cover",
                    visibleMedia.length > 1 ? "h-44 sm:h-52" : "max-h-80",
                  )}
                />
              ) : (
                <img
                  key={url}
                  src={url}
                  alt={structured.headline || `Media shared by ${name}`}
                  loading="lazy"
                  onError={() => markMediaFailed(url)}
                  className={cn(
                    "w-full object-cover",
                    visibleMedia.length > 1 ? "h-44 sm:h-52" : "max-h-80",
                  )}
                />
              ),
            )}
          </div>
        )}
        {shareLinks.length > 0 && (
          <div className="relative z-10 mt-3 flex flex-wrap gap-2">
            {shareLinks.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-secondary/40 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Open attached photo album
                <ArrowUpRight className="size-3.5" />
              </a>
            ))}
          </div>
        )}

        <MusicAttachmentBar targetType="ping" targetId={ping.id} />
        <PingPollCard pingId={ping.id} />
        <RepingAttribution ping={ping} />
        <div className="relative z-10">
          <CtaLink ping={ping} />
        </div>
        <PingReactionBar pingId={ping.id} />
      </div>

      {/* Card Footer: Likes, Comments, Quote/Re-Ping, Share, Save, Respond/Connect, Menu */}
      <footer className="relative z-10 mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
        <div className="flex items-center gap-1 tabular-nums">
          <LikeButton ping={ping} />
          <Link
            to="/p/$id"
            params={{ id: ping.id }}
            hash="replies-title"
            aria-label={`${replyCount(ping)} comments`}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <MessageCircle className="size-4" />
            <span>{replyCount(ping)}</span>
          </Link>
          <Link
            to="/create"
            search={{
              quote: `@${ping.author?.username ?? "member"}: "${structured.body.slice(0, 120)}"`,
            }}
            onClick={(e) => e.stopPropagation()}
            aria-label="Quote Ping"
            title="Quote & Re-Ping"
            className="inline-flex items-center justify-center rounded-full p-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Repeat2 className="size-4" />
          </Link>
          <ShareMenu ping={ping} />
          <button
            type="button"
            onClick={handleToggleSave}
            aria-label={isSaved ? "Remove from saved Pings" : "Save Ping"}
            aria-pressed={isSaved}
            title={isSaved ? "Saved" : "Save Ping"}
            className={cn(
              "inline-flex items-center justify-center rounded-full p-1.5 text-sm transition-colors hover:bg-secondary",
              isSaved ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Bookmark className={cn("size-4", isSaved && "fill-current")} />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {!isAuthor && (
            <button
              type="button"
              onClick={handleRespondConnect}
              disabled={startChatMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/35 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
            >
              <MessageSquare className="size-3.5" />
              <span>Respond</span>
            </button>
          )}
          <PingMenu ping={ping} open={actions} onOpenChange={setActions} />
        </div>
      </footer>
    </article>
  );
}

export function PingCardSkeleton() {
  return (
    <div className="surface-card rounded-3xl p-6" aria-hidden>
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-full bg-muted animate-pulse" />
        <div className="space-y-2">
          <div className="h-3 w-28 rounded bg-muted animate-pulse" />
          <div className="h-2.5 w-20 rounded bg-muted animate-pulse" />
        </div>
      </div>
      <div className="mt-5 space-y-2">
        <div className="h-3 rounded bg-muted animate-pulse" />
        <div className="h-3 w-5/6 rounded bg-muted animate-pulse" />
        <div className="h-3 w-2/3 rounded bg-muted animate-pulse" />
      </div>
    </div>
  );
}
