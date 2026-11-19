import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  PING_REACTIONS,
  pingReactionsQuery,
  useTogglePingReaction,
  type PingReactionKey,
} from "@/lib/social";
import { cn } from "@/lib/utils";

export function PingReactionBar({ pingId }: { pingId: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: summary } = useQuery(pingReactionsQuery(pingId, user?.id));
  const toggleMutation = useTogglePingReaction(pingId, user?.id);

  const handleReact = (reaction: PingReactionKey, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) {
      toast("Sign in to react to Pings", {
        action: { label: "Log in", onClick: () => navigate({ to: "/login" }) },
      });
      return;
    }
    toggleMutation.mutate(reaction, {
      onError: (err) => toast.error(err instanceof Error ? err.message : "Could not react"),
    });
  };

  return (
    <div
      className="relative z-10 mt-2.5 flex flex-wrap items-center gap-1"
      onClick={(e) => e.stopPropagation()}
      aria-label="Ping reactions"
    >
      {PING_REACTIONS.filter((r) => r.key !== "like").map((option) => {
        const count = summary?.counts[option.key] ?? 0;
        const active = Boolean(summary?.viewerReactions.includes(option.key));
        return (
          <button
            key={option.key}
            type="button"
            disabled={toggleMutation.isPending}
            onClick={(e) => handleReact(option.key, e)}
            aria-pressed={active}
            title={option.label}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
              active
                ? "border-primary/50 bg-primary/15 text-foreground font-semibold"
                : "border-border/60 bg-secondary/40 text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            <span aria-hidden="true">{option.emoji}</span>
            {count > 0 && <span className="tabular-nums">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
