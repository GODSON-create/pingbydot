import { Link } from "@tanstack/react-router";
import { formatDistanceToNowStrict } from "date-fns";
import { ArrowUpRight } from "lucide-react";
import type { Ping } from "@/lib/pings";
import { CATEGORIES } from "@/lib/validation";
import { FounderAvatar } from "./Avatar";
import { LikeButton, PingMenu, ShareMenu } from "./PingActions";
import { cn } from "@/lib/utils";

const CAT_TONE: Record<string, string> = {
  progress: "bg-accent text-accent-foreground",
  idea: "bg-sun/70 text-foreground",
  launch: "bg-lime text-lime-foreground",
  milestone: "bg-primary text-primary-foreground",
  question: "bg-blush text-blush-foreground",
  opportunity: "bg-secondary text-secondary-foreground",
};

export function CategoryTag({ value }: { value: string }) {
  const c = CATEGORIES.find((x) => x.value === value);
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", CAT_TONE[value])}>
      <span aria-hidden>{c?.emoji}</span>
      {c?.label ?? value}
    </span>
  );
}

export function CtaLink({ ping }: { ping: Ping }) {
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
      onClick={(e) => e.stopPropagation()}
      className="group/cta mt-4 flex items-center justify-between gap-3 rounded-2xl border border-border bg-secondary/60 px-4 py-3 text-sm transition-colors hover:border-primary hover:bg-accent"
    >
      <span className="min-w-0">
        <span className="block font-semibold">{ping.cta_label || "Visit link"}</span>
        <span className="block truncate text-xs text-muted-foreground">{host}</span>
      </span>
      <ArrowUpRight className="size-4 shrink-0 transition-transform group-hover/cta:-translate-y-0.5 group-hover/cta:translate-x-0.5" />
    </a>
  );
}

export function PingCard({ ping, linkToDetail = true }: { ping: Ping; linkToDetail?: boolean }) {
  const name = ping.author?.display_name || ping.author?.username || "Founder";
  return (
    <article className="surface-card lift relative flex flex-col rounded-3xl p-5 sm:p-6">
      <header className="relative z-10 flex items-start gap-3">
        {ping.author && (
          <Link to="/@{$username}" params={{ username: ping.author.username }} className="flex min-w-0 flex-1 items-center gap-3">
            <FounderAvatar name={name} src={ping.author.avatar_url} />
            <span className="min-w-0">
              <span className="block truncate font-semibold hover:underline">{name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                @{ping.author.username} · <time dateTime={ping.created_at}>{formatDistanceToNowStrict(new Date(ping.created_at))} ago</time>
              </span>
            </span>
          </Link>
        )}
        <CategoryTag value={ping.category} />
      </header>
      <div className="mt-4 flex-1">
        {linkToDetail ? (
          <Link to="/p/$id" params={{ id: ping.id }} className="block whitespace-pre-line break-words text-[15px] leading-relaxed after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring">
            {ping.content.length > 420 ? ping.content.slice(0, 420) + "…" : ping.content}
          </Link>
        ) : (
          <p className="whitespace-pre-line break-words text-lg leading-relaxed">{ping.content}</p>
        )}
        <div className="relative z-10"><CtaLink ping={ping} /></div>
      </div>
      <footer className="relative z-10 mt-4 flex items-center justify-between border-t border-border pt-3">
        <LikeButton ping={ping} />
        <div className="flex items-center">
          <ShareMenu ping={ping} />
          <PingMenu ping={ping} />
        </div>
      </footer>
    </article>
  );
}

export function PingCardSkeleton() {
  return (
    <div className="surface-card rounded-3xl p-6" aria-hidden>
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-full bg-muted" />
        <div className="space-y-2"><div className="h-3 w-28 rounded bg-muted" /><div className="h-2.5 w-20 rounded bg-muted" /></div>
      </div>
      <div className="mt-5 space-y-2"><div className="h-3 rounded bg-muted" /><div className="h-3 w-5/6 rounded bg-muted" /><div className="h-3 w-2/3 rounded bg-muted" /></div>
    </div>
  );
}
