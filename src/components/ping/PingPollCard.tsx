import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { BarChart2, Check } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { pingPollQuery, useVotePingPoll } from "@/lib/social";
import { cn } from "@/lib/utils";

export function PingPollCard({ pingId }: { pingId: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: poll } = useQuery(pingPollQuery(pingId, user?.id));
  const voteMutation = useVotePingPoll(pingId, user?.id);

  if (!poll || poll.options.length < 2) return null;

  const isClosed = Boolean(poll.expires_at && new Date(poll.expires_at).getTime() < Date.now());
  const showResults = Boolean(poll.viewer_option_id || isClosed);

  const handleVote = (optionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) {
      toast("Sign in to vote in polls", {
        action: { label: "Log in", onClick: () => navigate({ to: "/login" }) },
      });
      return;
    }
    if (isClosed) {
      toast.info("This poll has closed.");
      return;
    }
    voteMutation.mutate(
      { pollId: poll.id, optionId },
      {
        onSuccess: () => toast.success("Vote recorded"),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Could not record vote"),
      },
    );
  };

  return (
    <div
      className="relative z-10 mt-3.5 rounded-2xl border border-border/70 bg-secondary/35 p-3.5 space-y-2.5"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-foreground flex items-center gap-1.5">
          <BarChart2 className="size-3.5 text-primary" /> {poll.question}
        </span>
        <span className="text-[11px] text-muted-foreground shrink-0">
          {poll.total_votes} {poll.total_votes === 1 ? "vote" : "votes"}
          {isClosed ? " · Closed" : ""}
        </span>
      </div>

      <div className="space-y-1.5">
        {poll.options.map((opt) => {
          const pct = poll.total_votes > 0 ? Math.round((opt.votes / poll.total_votes) * 100) : 0;
          const selected = poll.viewer_option_id === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={voteMutation.isPending || isClosed}
              onClick={(e) => handleVote(opt.id, e)}
              className={cn(
                "relative w-full overflow-hidden rounded-xl border px-3 py-2 text-left text-xs transition-colors",
                selected
                  ? "border-primary bg-primary/10 font-semibold text-foreground"
                  : "border-border/70 bg-card/80 hover:border-primary/50 text-foreground",
              )}
            >
              {showResults && (
                <span
                  className={cn(
                    "pointer-events-none absolute inset-y-0 left-0 transition-all duration-300",
                    selected ? "bg-primary/20" : "bg-secondary/80",
                  )}
                  style={{ width: `${pct}%` }}
                />
              )}
              <span className="relative flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 truncate">
                  {selected && <Check className="size-3.5 text-primary shrink-0" />}
                  <span className="truncate">{opt.label}</span>
                </span>
                {showResults && (
                  <span className="font-mono text-[11px] font-semibold text-muted-foreground shrink-0">
                    {pct}%
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
