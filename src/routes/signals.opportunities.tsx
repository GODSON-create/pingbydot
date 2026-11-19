import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Briefcase,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  MapPin,
  MessageSquare,
  Plus,
  Radio,
  Search,
  Send,
  Share2,
  Sparkles,
  Users,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { z } from "zod";
import { pageHead } from "@/lib/site";
import { useAuth } from "@/lib/auth";
import { useGetOrCreateDirectConversation } from "@/lib/messages";
import {
  OPPORTUNITY_CATEGORIES,
  mySignalApplicationsQuery,
  publisherApplicationsQuery,
  signalOpportunitiesQuery,
  useCreateSignalOpportunity,
  useSubmitSignalApplication,
  useUpdateSignalApplicationStatus,
  useUpdateSignalOpportunityStatus,
  type ApplicationStatus,
  type OpportunityCategory,
  type SignalOpportunity,
} from "@/lib/opportunities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QueryErrorCard } from "@/components/QueryErrorCard";
import { FounderAvatar } from "@/components/ping/Avatar";
import { UniversalShareDialog } from "@/components/sharing/UniversalShareDialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/signals/opportunities")({
  staticData: { sitemap: true },
  validateSearch: z.object({
    cat: z.string().optional(),
    q: z.string().optional(),
  }),
  head: () =>
    pageHead({
      title: "Signals Opportunities — Ping by DOT",
      description:
        "Discover and publish funding, jobs, grants, partnerships, mentorship, procurement, research, and collaboration opportunities on Ping.",
      path: "/signals/opportunities",
    }),
  component: SignalsOpportunitiesPage,
});

const STATUS_BADGE: Record<ApplicationStatus, string> = {
  submitted: "bg-secondary text-foreground",
  reviewing: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  shortlisted: "bg-primary/15 text-primary",
  accepted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  declined: "bg-destructive/15 text-destructive",
  withdrawn: "bg-muted text-muted-foreground",
};

function SignalsOpportunitiesPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const startChat = useGetOrCreateDirectConversation();

  const [selectedCategory, setSelectedCategory] = useState<OpportunityCategory | "all">(
    OPPORTUNITY_CATEGORIES.some((c) => c.value === search.cat)
      ? (search.cat as OpportunityCategory)
      : "all",
  );
  const [queryText, setQueryText] = useState(search.q ?? "");
  const [activeView, setActiveView] = useState<"browse" | "my_applications" | "publisher">(
    "browse",
  );

  const [publishOpen, setPublishOpen] = useState(false);
  const [applyTarget, setApplyTarget] = useState<SignalOpportunity | null>(null);
  const [shareTarget, setShareTarget] = useState<SignalOpportunity | null>(null);

  // Publish form state
  const [pubCategory, setPubCategory] = useState<OpportunityCategory>("partnerships");
  const [pubTitle, setPubTitle] = useState("");
  const [pubDescription, setPubDescription] = useState("");
  const [pubLocation, setPubLocation] = useState("Remote / Global");
  const [pubEligibility, setPubEligibility] = useState("");
  const [pubRequiredInfo, setPubRequiredInfo] = useState("");
  const [pubExpiresAt, setPubExpiresAt] = useState("");

  // Application form state
  const [coverNote, setCoverNote] = useState("");
  const [portfolioUrl, setPortfolioUrl] = useState("");

  const {
    data: opportunities = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery(signalOpportunitiesQuery(selectedCategory, queryText));

  const myPublished = useMemo(
    () => opportunities.filter((o) => user?.id && o.publisher_id === user.id),
    [opportunities, user?.id],
  );
  const myPublishedIds = useMemo(() => myPublished.map((o) => o.id), [myPublished]);

  const { data: myApplications = [] } = useQuery(mySignalApplicationsQuery(user?.id));
  const { data: incomingApplications = [] } = useQuery(
    publisherApplicationsQuery(myPublishedIds, user?.id),
  );

  const createOpp = useCreateSignalOpportunity(user?.id, profile);
  const updateOppStatus = useUpdateSignalOpportunityStatus();
  const submitApplication = useSubmitSignalApplication(user?.id, profile);
  const updateApplicationStatus = useUpdateSignalApplicationStatus();

  const appliedMap = useMemo(
    () => new Map(myApplications.map((a) => [a.opportunity_id, a])),
    [myApplications],
  );

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      navigate({ to: "/login", search: { next: "/signals/opportunities" } });
      return;
    }
    if (pubTitle.trim().length < 4 || pubDescription.trim().length < 10) {
      toast.error("Provide a clear title (4+ chars) and description (10+ chars).");
      return;
    }
    try {
      await createOpp.mutateAsync({
        category: pubCategory,
        title: pubTitle,
        description: pubDescription,
        location: pubLocation,
        eligibility: pubEligibility,
        required_info: pubRequiredInfo,
        expires_at: pubExpiresAt ? new Date(pubExpiresAt).toISOString() : null,
      });
      toast.success("Opportunity published");
      setPubTitle("");
      setPubDescription("");
      setPubLocation("Remote / Global");
      setPubEligibility("");
      setPubRequiredInfo("");
      setPubExpiresAt("");
      setPublishOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not publish opportunity");
    }
  };

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!applyTarget || !user) return;
    if (coverNote.trim().length < 5) {
      toast.error("Write a brief note explaining your interest or fit.");
      return;
    }
    try {
      await submitApplication.mutateAsync({
        opportunityId: applyTarget.id,
        coverNote,
        portfolioUrl: portfolioUrl || undefined,
      });
      toast.success("Application submitted");
      setCoverNote("");
      setPortfolioUrl("");
      setApplyTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit application");
    }
  };

  const handleMessageUser = async (targetUserId: string) => {
    if (!user) {
      navigate({ to: "/login", search: { next: "/signals/opportunities" } });
      return;
    }
    try {
      const convId = await startChat.mutateAsync(targetUserId);
      navigate({ to: "/messages", search: { conversationId: convId } });
    } catch {
      toast.error("Could not start private conversation.");
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 pb-24 space-y-6">
      {/* Header */}
      <header className="surface-card rounded-3xl p-6 sm:p-8 border border-border/70">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
              <Sparkles className="size-3.5" /> Signals Opportunity Network
            </span>
            <h1 className="mt-3 font-display text-3xl sm:text-4xl font-extrabold tracking-tight">
              Structured Opportunities
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Discover and publish funding, jobs, grants, partnerships, procurement, mentorship,
              research, and collaboration requests — open to everyone on Ping.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm" className="rounded-full gap-1.5">
              <Link to="/signals/channels">
                <Radio className="size-3.5" /> Signal Channels
              </Link>
            </Button>
            <Button
              type="button"
              variant="hero"
              size="sm"
              className="rounded-full gap-1.5"
              onClick={() => {
                if (!user) {
                  navigate({ to: "/login", search: { next: "/signals/opportunities" } });
                  return;
                }
                setPublishOpen(true);
              }}
            >
              <Plus className="size-4" /> Publish Opportunity
            </Button>
          </div>
        </div>

        {/* View switcher + Search */}
        <div className="mt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-border/60">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveView("browse")}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
                activeView === "browse"
                  ? "bg-foreground text-background"
                  : "bg-secondary/70 text-muted-foreground hover:text-foreground",
              )}
            >
              Browse ({opportunities.length})
            </button>
            {user && (
              <>
                <button
                  type="button"
                  onClick={() => setActiveView("my_applications")}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
                    activeView === "my_applications"
                      ? "bg-foreground text-background"
                      : "bg-secondary/70 text-muted-foreground hover:text-foreground",
                  )}
                >
                  My Applications ({myApplications.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView("publisher")}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
                    activeView === "publisher"
                      ? "bg-foreground text-background"
                      : "bg-secondary/70 text-muted-foreground hover:text-foreground",
                  )}
                >
                  Publisher Dashboard ({incomingApplications.length})
                </button>
              </>
            )}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="Search title, location, eligibility…"
              className="pl-9 h-9 rounded-full text-xs bg-secondary/50"
            />
          </div>
        </div>
      </header>

      {/* 14-Category Filter Rail */}
      {activeView === "browse" && (
        <nav
          aria-label="Opportunity categories"
          className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none"
        >
          <button
            type="button"
            onClick={() => setSelectedCategory("all")}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
              selectedCategory === "all"
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card hover:bg-secondary",
            )}
          >
            All Categories
          </button>
          {OPPORTUNITY_CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              type="button"
              onClick={() => setSelectedCategory(cat.value)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors inline-flex items-center gap-1.5",
                selectedCategory === cat.value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card hover:bg-secondary",
              )}
            >
              <span aria-hidden="true">{cat.emoji}</span>
              <span>{cat.label}</span>
            </button>
          ))}
        </nav>
      )}

      {/* BROWSE VIEW */}
      {activeView === "browse" && (
        <>
          {isError ? (
            <QueryErrorCard
              title="Couldn't load opportunities"
              error={error}
              onRetry={() => void refetch()}
            />
          ) : isLoading ? (
            <div className="grid gap-4 md:grid-cols-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-48 animate-pulse rounded-3xl bg-secondary/50" />
              ))}
            </div>
          ) : opportunities.length === 0 ? (
            <div className="surface-card rounded-3xl p-10 text-center border border-border/70">
              <Briefcase className="mx-auto size-10 text-muted-foreground/50" />
              <h2 className="mt-3 font-display text-lg font-bold">
                No opportunities listed here yet
              </h2>
              <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
                Be the first to publish a structured opportunity in this category — funding, jobs,
                grants, partnerships, mentorship, or services.
              </p>
              <Button
                type="button"
                variant="hero"
                size="sm"
                className="mt-4 rounded-full gap-1.5"
                onClick={() => {
                  if (!user) {
                    navigate({ to: "/login", search: { next: "/signals/opportunities" } });
                    return;
                  }
                  setPublishOpen(true);
                }}
              >
                <Plus className="size-3.5" /> Publish Opportunity
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {opportunities.map((opp) => {
                const catMeta = OPPORTUNITY_CATEGORIES.find((c) => c.value === opp.category);
                const isMine = Boolean(user?.id && opp.publisher_id === user.id);
                const myApp = appliedMap.get(opp.id);
                const expired = Boolean(
                  opp.expires_at && new Date(opp.expires_at).getTime() < Date.now(),
                );
                const openForApply = opp.status === "open" && !expired;

                return (
                  <article
                    key={opp.id}
                    className="surface-card rounded-3xl p-5 border border-border/70 flex flex-col justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-[11px] font-semibold">
                          <span>{catMeta?.emoji ?? "✨"}</span>
                          <span>{catMeta?.label ?? opp.category}</span>
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase",
                            openForApply
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {expired ? "Expired" : opp.status}
                        </span>
                      </div>

                      <h2 className="mt-2.5 font-display text-lg font-bold text-foreground">
                        {opp.title}
                      </h2>
                      <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed whitespace-pre-line line-clamp-4">
                        {opp.description}
                      </p>

                      <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
                        <p className="flex items-center gap-1.5">
                          <MapPin className="size-3.5 text-primary shrink-0" />
                          <span>{opp.location}</span>
                        </p>
                        {opp.eligibility && (
                          <p>
                            <strong className="text-foreground">Eligibility:</strong>{" "}
                            {opp.eligibility}
                          </p>
                        )}
                        {opp.required_info && (
                          <p>
                            <strong className="text-foreground">Required info:</strong>{" "}
                            {opp.required_info}
                          </p>
                        )}
                        {opp.expires_at && (
                          <p className="flex items-center gap-1.5">
                            <Calendar className="size-3.5 shrink-0" />
                            <span>Closes {format(new Date(opp.expires_at), "MMM d, yyyy")}</span>
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-border/60 flex flex-wrap items-center justify-between gap-2">
                      {opp.publisher ? (
                        <Link
                          to="/@{$username}"
                          params={{ username: opp.publisher.username }}
                          className="flex items-center gap-2 min-w-0"
                        >
                          <FounderAvatar
                            name={opp.publisher.display_name || opp.publisher.username}
                            src={opp.publisher.avatar_url}
                            size="sm"
                          />
                          <span className="text-xs font-medium text-muted-foreground truncate hover:underline">
                            @{opp.publisher.username}
                          </span>
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">Ping Publisher</span>
                      )}

                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 rounded-full px-2.5 text-xs"
                          aria-label={`Share ${opp.title}`}
                          onClick={() => setShareTarget(opp)}
                        >
                          <Share2 className="size-3.5" />
                        </Button>
                        {!isMine && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-full text-xs gap-1"
                            onClick={() => void handleMessageUser(opp.publisher_id)}
                          >
                            <MessageSquare className="size-3.5" /> Follow up
                          </Button>
                        )}
                        {isMine ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-full text-xs"
                            onClick={() =>
                              updateOppStatus.mutate(
                                {
                                  opportunityId: opp.id,
                                  status: opp.status === "open" ? "closed" : "open",
                                },
                                {
                                  onSuccess: () =>
                                    toast.success(
                                      opp.status === "open"
                                        ? "Opportunity closed"
                                        : "Opportunity reopened",
                                    ),
                                },
                              )
                            }
                          >
                            {opp.status === "open" ? "Close" : "Reopen"}
                          </Button>
                        ) : myApp ? (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold capitalize",
                              STATUS_BADGE[myApp.status],
                            )}
                          >
                            <CheckCircle2 className="size-3.5" /> {myApp.status}
                          </span>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="hero"
                            disabled={!openForApply}
                            className="h-8 rounded-full text-xs gap-1"
                            onClick={() => {
                              if (!user) {
                                navigate({
                                  to: "/login",
                                  search: { next: "/signals/opportunities" },
                                });
                                return;
                              }
                              setApplyTarget(opp);
                            }}
                          >
                            <Send className="size-3" /> Apply
                          </Button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* MY APPLICATIONS VIEW */}
      {activeView === "my_applications" && (
        <section className="space-y-3">
          {myApplications.length === 0 ? (
            <div className="surface-card rounded-3xl p-8 text-center">
              <Clock className="mx-auto size-8 text-muted-foreground/50" />
              <p className="mt-2 font-display text-sm font-bold">No applications submitted yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Browse open opportunities and express interest or apply with a note.
              </p>
            </div>
          ) : (
            myApplications.map((app) => {
              const opp = opportunities.find((o) => o.id === app.opportunity_id);
              return (
                <article
                  key={app.id}
                  className="surface-card rounded-2xl p-4 border border-border/70 flex flex-wrap items-start justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-display text-sm font-bold">
                        {opp?.title ?? "Opportunity"}
                      </h3>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-[10px] font-bold capitalize",
                          STATUS_BADGE[app.status],
                        )}
                      >
                        {app.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground whitespace-pre-line">
                      {app.cover_note}
                    </p>
                  </div>
                  {app.status !== "withdrawn" && app.status !== "accepted" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 rounded-full text-xs"
                      onClick={() =>
                        updateApplicationStatus.mutate(
                          { applicationId: app.id, status: "withdrawn" },
                          { onSuccess: () => toast.success("Application withdrawn") },
                        )
                      }
                    >
                      Withdraw
                    </Button>
                  )}
                </article>
              );
            })
          )}
        </section>
      )}

      {/* PUBLISHER DASHBOARD VIEW */}
      {activeView === "publisher" && (
        <section className="space-y-4">
          {incomingApplications.length === 0 ? (
            <div className="surface-card rounded-3xl p-8 text-center">
              <Users className="mx-auto size-8 text-muted-foreground/50" />
              <p className="mt-2 font-display text-sm font-bold">No incoming applications yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Applications to your published opportunities will appear here for review.
              </p>
            </div>
          ) : (
            incomingApplications.map((app) => {
              const opp = myPublished.find((o) => o.id === app.opportunity_id);
              return (
                <article
                  key={app.id}
                  className="surface-card rounded-2xl p-4 border border-border/70 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-semibold text-primary">
                        {opp?.title ?? "Published Opportunity"}
                      </p>
                      <p className="text-sm font-bold">
                        {app.applicant?.display_name ||
                          `@${app.applicant?.username || "Applicant"}`}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[10px] font-bold capitalize",
                        STATUS_BADGE[app.status],
                      )}
                    >
                      {app.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground whitespace-pre-line">
                    {app.cover_note}
                  </p>
                  {app.portfolio_url && /^https?:\/\//i.test(app.portfolio_url) && (
                    <a
                      href={app.portfolio_url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                    >
                      Supporting link <ExternalLink className="size-3" />
                    </a>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-border/50">
                    {(
                      ["reviewing", "shortlisted", "accepted", "declined"] as ApplicationStatus[]
                    ).map((st) => (
                      <Button
                        key={st}
                        type="button"
                        size="sm"
                        variant={app.status === st ? "hero" : "outline"}
                        className="h-7 rounded-full text-[11px] capitalize"
                        onClick={() =>
                          updateApplicationStatus.mutate(
                            { applicationId: app.id, status: st },
                            { onSuccess: () => toast.success(`Marked as ${st}`) },
                          )
                        }
                      >
                        {st}
                      </Button>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-7 rounded-full text-xs gap-1"
                      onClick={() => void handleMessageUser(app.applicant_id)}
                    >
                      <MessageSquare className="size-3.5" /> Message applicant
                    </Button>
                  </div>
                </article>
              );
            })
          )}
        </section>
      )}

      {/* PUBLISH OPPORTUNITY MODAL */}
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="sm:max-w-lg rounded-3xl p-6 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Publish an Opportunity</DialogTitle>
            <DialogDescription className="text-xs">
              Create a structured Signal opportunity so qualified people can apply or follow up.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handlePublish} className="space-y-3 mt-2">
            <div>
              <Label htmlFor="opp-cat" className="text-xs">
                Category
              </Label>
              <select
                id="opp-cat"
                value={pubCategory}
                onChange={(e) => setPubCategory(e.target.value as OpportunityCategory)}
                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              >
                {OPPORTUNITY_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.emoji} {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="opp-title" className="text-xs">
                Opportunity title
              </Label>
              <Input
                id="opp-title"
                value={pubTitle}
                onChange={(e) => setPubTitle(e.target.value)}
                placeholder="Seed Grant for Climate & Energy Builders"
                required
                minLength={4}
                maxLength={160}
                className="mt-1 rounded-xl"
              />
            </div>
            <div>
              <Label htmlFor="opp-desc" className="text-xs">
                Description
              </Label>
              <Textarea
                id="opp-desc"
                rows={4}
                value={pubDescription}
                onChange={(e) => setPubDescription(e.target.value)}
                placeholder="Describe the opportunity, deliverables, compensation or terms…"
                required
                minLength={10}
                className="mt-1 rounded-xl"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="opp-loc" className="text-xs">
                  Location
                </Label>
                <Input
                  id="opp-loc"
                  value={pubLocation}
                  onChange={(e) => setPubLocation(e.target.value)}
                  placeholder="Remote / Lagos / Global"
                  className="mt-1 rounded-xl"
                />
              </div>
              <div>
                <Label htmlFor="opp-exp" className="text-xs">
                  Application deadline (optional)
                </Label>
                <Input
                  id="opp-exp"
                  type="datetime-local"
                  value={pubExpiresAt}
                  onChange={(e) => setPubExpiresAt(e.target.value)}
                  className="mt-1 rounded-xl"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="opp-elig" className="text-xs">
                Eligibility criteria (optional)
              </Label>
              <Input
                id="opp-elig"
                value={pubEligibility}
                onChange={(e) => setPubEligibility(e.target.value)}
                placeholder="Early-stage teams, independent designers, registered NGOs…"
                className="mt-1 rounded-xl"
              />
            </div>
            <div>
              <Label htmlFor="opp-req" className="text-xs">
                Required information from applicants (optional)
              </Label>
              <Input
                id="opp-req"
                value={pubRequiredInfo}
                onChange={(e) => setPubRequiredInfo(e.target.value)}
                placeholder="Portfolio link, 1-paragraph pitch, timeline…"
                className="mt-1 rounded-xl"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => setPublishOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="hero"
                className="rounded-full"
                disabled={createOpp.isPending}
              >
                {createOpp.isPending ? "Publishing…" : "Publish Opportunity"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* APPLY MODAL */}
      {shareTarget && (
        <UniversalShareDialog
          open={Boolean(shareTarget)}
          onOpenChange={(o) => !o && setShareTarget(null)}
          payload={{
            targetType: "opportunity",
            targetId: shareTarget.id,
            title: shareTarget.title,
            description: shareTarget.description.slice(0, 160),
            path: `/signals/opportunities?cat=${shareTarget.category}`,
          }}
        />
      )}

      <Dialog open={Boolean(applyTarget)} onOpenChange={(o) => !o && setApplyTarget(null)}>
        <DialogContent className="sm:max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-lg">Apply · {applyTarget?.title}</DialogTitle>
            <DialogDescription className="text-xs">
              {applyTarget?.required_info
                ? `Requested: ${applyTarget.required_info}`
                : "Share a brief introduction and link so the publisher can review your fit."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleApply} className="space-y-3 mt-2">
            <div>
              <Label htmlFor="app-note" className="text-xs">
                Cover note / expression of interest
              </Label>
              <Textarea
                id="app-note"
                rows={4}
                value={coverNote}
                onChange={(e) => setCoverNote(e.target.value)}
                placeholder="Explain why you're a strong match and your availability…"
                required
                minLength={5}
                className="mt-1 rounded-xl"
              />
            </div>
            <div>
              <Label htmlFor="app-url" className="text-xs">
                Portfolio, CV, or supporting link (optional)
              </Label>
              <Input
                id="app-url"
                type="url"
                value={portfolioUrl}
                onChange={(e) => setPortfolioUrl(e.target.value)}
                placeholder="https://…"
                className="mt-1 rounded-xl"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => setApplyTarget(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="hero"
                className="rounded-full"
                disabled={submitApplication.isPending}
              >
                {submitApplication.isPending ? "Submitting…" : "Submit Application"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
