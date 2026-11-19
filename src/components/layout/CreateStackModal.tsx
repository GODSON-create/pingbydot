import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ArrowUpRight, Briefcase, Building2, Radio } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { PingMark } from "@/components/BrandLogo";
import { MomentComposer } from "@/components/moments/MomentComposer";
import { GoLiveDialog } from "@/components/live/GoLiveDialog";

interface CreateStackModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateStackModal({ open, onOpenChange }: CreateStackModalProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [momentOpen, setMomentOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);

  // Close secondary modals immediately whenever the user navigates.
  useEffect(() => {
    setMomentOpen(false);
    setLiveOpen(false);
  }, [location.pathname, location.searchStr]);

  const requireAuthOrRun = (nextPath: string, action: () => void) => {
    if (!user) {
      onOpenChange(false);
      navigate({ to: "/login", search: { next: nextPath } });
      return;
    }
    action();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md rounded-[2rem] border border-border/80 bg-card p-6 sm:p-7 shadow-lift">
          <DialogHeader className="text-left">
            <DialogTitle className="font-display text-2xl font-extrabold tracking-tight">
              Create on PING
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Choose how you want to coordinate with the network.
            </DialogDescription>
          </DialogHeader>

          {/* Unified Creation Deck: Ping, Moment, Signal, Hub & Go Live */}
          <div
            className="mt-4 space-y-2.5 max-h-[70dvh] overflow-y-auto pr-0.5"
            role="list"
            aria-label="Creation options"
          >
            {/* CARD 1 — CREATE A PING (Official Lime Mark) */}
            <button
              type="button"
              role="listitem"
              onClick={() =>
                requireAuthOrRun("/create", () => {
                  onOpenChange(false);
                  navigate({ to: "/create" });
                })
              }
              className="group relative flex w-full items-start gap-4 rounded-3xl border border-primary/35 bg-primary/10 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PingMark variant="lime" size="lg" alt="Create a Ping" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-base font-extrabold text-foreground">
                    Create a Ping
                  </span>
                  <ArrowUpRight className="size-4 text-primary transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Share an intention. Find the people and resources to make it happen.
                </p>
              </div>
            </button>

            {/* CARD 2 — CREATE A MOMENT (Official Silver Mark) */}
            <button
              type="button"
              role="listitem"
              onClick={() =>
                requireAuthOrRun("/", () => {
                  onOpenChange(false);
                  setMomentOpen(true);
                })
              }
              className="group relative flex w-full items-start gap-4 rounded-3xl border border-border bg-secondary/50 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PingMark variant="silver" size="lg" alt="Create a Moment" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-base font-extrabold text-foreground">
                    Create a Moment
                  </span>
                  <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Share what's happening around you.
                </p>
              </div>
            </button>

            {/* CARD 3 — CREATE A SIGNAL */}
            <button
              type="button"
              role="listitem"
              onClick={() =>
                requireAuthOrRun("/signals/create", () => {
                  onOpenChange(false);
                  navigate({ to: "/signals/create" });
                })
              }
              className="group relative flex w-full items-start gap-4 rounded-3xl border border-border bg-secondary/40 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:bg-secondary/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <Radio className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-base font-extrabold text-foreground">
                    Create a Signal
                  </span>
                  <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Launch a structured broadcast or opportunity channel.
                </p>
              </div>
            </button>

            {/* CARD 4 — PUBLISH AN OPPORTUNITY */}
            <button
              type="button"
              role="listitem"
              onClick={() =>
                requireAuthOrRun("/signals/opportunities", () => {
                  onOpenChange(false);
                  navigate({ to: "/signals/opportunities" });
                })
              }
              className="group relative flex w-full items-start gap-4 rounded-3xl border border-border bg-secondary/40 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:bg-secondary/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <Briefcase className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-base font-extrabold text-foreground">
                    Publish an Opportunity
                  </span>
                  <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Post funding, jobs, grants, mentorship, partnerships, or requests.
                </p>
              </div>
            </button>

            {/* CARD 5 — CREATE A HUB */}
            <button
              type="button"
              role="listitem"
              onClick={() =>
                requireAuthOrRun("/hubs/create", () => {
                  onOpenChange(false);
                  navigate({ to: "/hubs/create" });
                })
              }
              className="group relative flex w-full items-start gap-4 rounded-3xl border border-border bg-secondary/40 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:bg-secondary/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-secondary text-foreground">
                <Building2 className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-base font-extrabold text-foreground">
                    Create a Hub
                  </span>
                  <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Build a community, forum, or collaborative space.
                </p>
              </div>
            </button>

            {/* CARD 5 — GO LIVE (Official Gold Mark) */}
            <button
              type="button"
              role="listitem"
              onClick={() =>
                requireAuthOrRun("/", () => {
                  onOpenChange(false);
                  setLiveOpen(true);
                })
              }
              className="group relative flex w-full items-start gap-4 rounded-3xl border border-gold/30 bg-gold/10 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-gold/60 hover:bg-gold/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PingMark variant="gold" size="lg" alt="Go Live" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-base font-extrabold text-foreground">
                    Go Live
                  </span>
                  <ArrowUpRight className="size-4 text-gold transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Bring people together in real time.
                </p>
              </div>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <MomentComposer open={momentOpen} onOpenChange={setMomentOpen} />
      <GoLiveDialog open={liveOpen} onOpenChange={setLiveOpen} />
    </>
  );
}
