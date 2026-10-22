import { ArrowUpRight } from "lucide-react";

export function AriseCallout({ compact = false }: { compact?: boolean }) {
  return (
    <aside className={`bg-forest grain relative overflow-hidden rounded-3xl text-primary-foreground ${compact ? "p-5" : "p-8 sm:p-10"}`} aria-label="ARISE opportunity">
      <div className="absolute -right-10 -top-10 size-40 rounded-full bg-lime/30 blur-3xl animate-drift" aria-hidden />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl">
          <span className="sticker bg-lime text-lime-foreground">Opportunity</span>
          <h3 className={`mt-3 font-display font-bold ${compact ? "text-lg" : "text-2xl sm:text-3xl"}`}>Looking for founder programmes? Have a look at ARISE.</h3>
          <p className="mt-2 text-sm text-primary-foreground/80">
            ARISE is a separate opportunity with its own application and criteria. Activity on Ping, including likes or Pings, doesn't qualify you for or guarantee any funding.
          </p>
        </div>
        <a
          href="https://JoinArise.cv"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 shrink-0 items-center gap-2 self-start rounded-full bg-lime px-5 font-semibold text-lime-foreground transition-transform hover:-translate-y-0.5 sm:self-auto"
        >
          Visit JoinArise.cv <ArrowUpRight className="size-4" />
        </a>
      </div>
    </aside>
  );
}
