import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calendar, Check, ExternalLink, MapPin, Plus, Sparkles, Users } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
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
import {
  hubEventsQuery,
  useCreateHubEvent,
  useRsvpHubEvent,
  type HubEventRsvpStatus,
} from "@/lib/hub-events";
import { cn } from "@/lib/utils";

export function HubEventsSection({
  hubId,
  hubName,
  userId,
  canManage,
}: {
  hubId: string;
  hubName: string;
  userId?: string | undefined;
  canManage: boolean;
}) {
  const { data: events = [], isLoading } = useQuery(hubEventsQuery(hubId, userId));
  const createEvent = useCreateHubEvent(hubId, userId);
  const rsvpEvent = useRsvpHubEvent(hubId, userId);

  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [locationLabel, setLocationLabel] = useState("Online on Ping");
  const [meetingUrl, setMeetingUrl] = useState("");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 3 || !startsAt) {
      toast.error("Provide an event title and date/time.");
      return;
    }
    try {
      await createEvent.mutateAsync({
        title,
        description,
        startsAt,
        locationLabel,
        meetingUrl: meetingUrl || undefined,
      });
      toast.success("Hub event scheduled");
      setTitle("");
      setDescription("");
      setStartsAt("");
      setLocationLabel("Online on Ping");
      setMeetingUrl("");
      setCreateOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not schedule event");
    }
  };

  const handleRsvp = async (eventId: string, status: HubEventRsvpStatus) => {
    if (!userId) {
      toast.error("Sign in to RSVP to Hub events.");
      return;
    }
    try {
      await rsvpEvent.mutateAsync({ eventId, status });
      toast.success(status === "going" ? "You're marked as Going" : "Marked as Interested");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update RSVP");
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold flex items-center gap-2">
            <Calendar className="size-4 text-primary" /> Events &amp; Gatherings
          </h2>
          <p className="text-xs text-muted-foreground">
            Workshops, community calls, meetups, and scheduled sessions in {hubName}.
          </p>
        </div>
        {canManage && (
          <Button
            type="button"
            variant="hero"
            size="sm"
            className="rounded-full gap-1.5"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="size-3.5" /> Schedule Event
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-2xl bg-secondary/50" />
        </div>
      ) : events.length === 0 ? (
        <div className="surface-card rounded-3xl p-8 text-center border border-border/60">
          <Calendar className="mx-auto size-8 text-muted-foreground/50" />
          <p className="mt-2 font-display text-sm font-bold text-foreground">
            No upcoming events yet
          </p>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
            {canManage
              ? "Schedule a community call, Q&A, demo day, or local meetup for members."
              : "Check back soon for upcoming events from this Hub's organisers."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {events.map((ev) => (
            <article
              key={ev.id}
              className="surface-card rounded-2xl p-4 border border-border/70 flex flex-col justify-between gap-3"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display text-sm font-bold text-foreground">{ev.title}</h3>
                  <span className="rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-[10px] font-bold shrink-0">
                    {format(new Date(ev.starts_at), "MMM d · h:mm a")}
                  </span>
                </div>
                {ev.description && (
                  <p className="mt-1.5 text-xs text-muted-foreground line-clamp-3">
                    {ev.description}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3 text-primary" /> {ev.location_label}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Users className="size-3" /> {ev.going_count} going · {ev.interested_count}{" "}
                    interested
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/50">
                <Button
                  type="button"
                  size="sm"
                  variant={ev.viewer_rsvp === "going" ? "hero" : "outline"}
                  className="h-7 rounded-full text-xs gap-1"
                  disabled={rsvpEvent.isPending}
                  onClick={() => void handleRsvp(ev.id, "going")}
                >
                  {ev.viewer_rsvp === "going" && <Check className="size-3" />} Going
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={ev.viewer_rsvp === "interested" ? "secondary" : "ghost"}
                  className={cn(
                    "h-7 rounded-full text-xs gap-1",
                    ev.viewer_rsvp === "interested" && "border border-primary/40 text-primary",
                  )}
                  disabled={rsvpEvent.isPending}
                  onClick={() => void handleRsvp(ev.id, "interested")}
                >
                  <Sparkles className="size-3" /> Interested
                </Button>
                {ev.meeting_url && /^https?:\/\//i.test(ev.meeting_url) && (
                  <a
                    href={ev.meeting_url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                  >
                    Join link <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-lg">Schedule Hub Event</DialogTitle>
            <DialogDescription className="text-xs">
              Publish a scheduled session, workshop, or meetup for {hubName}.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3 mt-2">
            <div>
              <Label htmlFor="hub-ev-title">Event title</Label>
              <Input
                id="hub-ev-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Weekly Community Demo & Q&A"
                className="mt-1 rounded-xl"
                required
                minLength={3}
                maxLength={140}
              />
            </div>
            <div>
              <Label htmlFor="hub-ev-starts">Start date &amp; time</Label>
              <Input
                id="hub-ev-starts"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="mt-1 rounded-xl"
                required
              />
            </div>
            <div>
              <Label htmlFor="hub-ev-loc">Location or venue</Label>
              <Input
                id="hub-ev-loc"
                value={locationLabel}
                onChange={(e) => setLocationLabel(e.target.value)}
                placeholder="Online on Ping / Lagos / London"
                className="mt-1 rounded-xl"
              />
            </div>
            <div>
              <Label htmlFor="hub-ev-url">External meeting or RSVP link (optional)</Label>
              <Input
                id="hub-ev-url"
                type="url"
                value={meetingUrl}
                onChange={(e) => setMeetingUrl(e.target.value)}
                placeholder="https://…"
                className="mt-1 rounded-xl"
              />
            </div>
            <div>
              <Label htmlFor="hub-ev-desc">Agenda / details</Label>
              <Textarea
                id="hub-ev-desc"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What will members discuss or learn?"
                className="mt-1 rounded-xl"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="hero"
                className="rounded-full"
                disabled={createEvent.isPending}
              >
                {createEvent.isPending ? "Scheduling…" : "Publish Event"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
