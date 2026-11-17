import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, Clock, Globe, Radio, Users, Building2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { myHubsQuery } from "@/lib/hub-queries";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface GoLiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GoLiveDialog({ open, onOpenChange }: GoLiveDialogProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: myHubs = [] } = useQuery(myHubsQuery(user?.id));

  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState<"public" | "followers" | "hub">("public");
  const [selectedHubId, setSelectedHubId] = useState<string>("");
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [roomUrl, setRoomUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      toast.error("Please sign in to host or schedule a live session.");
      onOpenChange(false);
      navigate({ to: "/login" });
      return;
    }
    if (!title.trim()) {
      toast.error("Add a title for your live session.");
      return;
    }
    if (audience === "hub" && !selectedHubId) {
      toast.error("Select a Community Hub for this session.");
      return;
    }
    if (mode === "schedule" && !scheduledAt) {
      toast.error("Choose a date and time to schedule your session.");
      return;
    }

    setSubmitting(true);
    try {
      const selectedHub = myHubs.find((h) => h.hub.id === selectedHubId)?.hub;
      const scheduleLabel =
        mode === "schedule" && scheduledAt
          ? `Scheduled for ${new Date(scheduledAt).toLocaleString()}`
          : "Live coordination session active now";

      const composedContent = [
        `🔴 ${mode === "schedule" ? "Upcoming Live Session" : "Live Now"}: ${title.trim()}`,
        topic.trim() ? `\nTopic: ${topic.trim()}` : "",
        `\nStatus: ${scheduleLabel}`,
      ]
        .filter(Boolean)
        .join("");

      const { data: createdPing, error } = await supabase
        .from("pings")
        .insert({
          user_id: user.id,
          category: "opportunity",
          content: composedContent,
          cta_url:
            roomUrl.trim() && /^https?:\/\//i.test(roomUrl.trim())
              ? roomUrl.trim()
              : selectedHub
                ? `${window.location.origin}/hubs/${selectedHub.slug}?tab=chat`
                : null,
          cta_label: mode === "schedule" ? "RSVP / Join Room" : "Join Live Room",
        })
        .select("id")
        .single();

      if (error) throw error;

      if (audience === "hub" && selectedHubId && createdPing?.id) {
        await supabase.rpc("share_ping_to_hub", {
          _hub: selectedHubId,
          _ping: createdPing.id,
          _intent: "feedback",
        });
      }

      qc.invalidateQueries({ queryKey: ["feed"] });
      toast.success(
        mode === "schedule"
          ? "Live session scheduled and announced to your network."
          : "Live coordination room announced.",
      );
      onOpenChange(false);
      setTitle("");
      setTopic("");
      setRoomUrl("");
      if (audience === "hub" && selectedHub) {
        navigate({
          to: "/hubs/$slug",
          params: { slug: selectedHub.slug },
          search: { tab: "chat" },
        });
      } else if (createdPing?.id) {
        navigate({ to: "/p/$id", params: { id: createdPing.id } });
      }
    } catch (err: any) {
      toast.error(err?.message || "Could not publish live session.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-3xl p-6 sm:p-7">
        <DialogHeader>
          <div className="inline-flex w-fit items-center gap-2 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
            <Radio className="size-3.5" />
            Real-Time Coordination
          </div>
          <DialogTitle className="mt-2 font-display text-2xl font-extrabold">Go Live</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Bring people together in real time. Host a live room inside a Community Hub or announce
            a scheduled coordination session.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <Label htmlFor="live-title" className="text-xs font-semibold">
              Live title
            </Label>
            <Input
              id="live-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Weekly Founder Standup & Architecture Review"
              maxLength={100}
              required
              className="mt-1.5 rounded-xl"
            />
          </div>

          <div>
            <Label htmlFor="live-topic" className="text-xs font-semibold">
              Topic & agenda
            </Label>
            <Textarea
              id="live-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="What will participants coordinate on or discuss?"
              rows={3}
              maxLength={500}
              className="mt-1.5 rounded-xl resize-none"
            />
          </div>

          <div>
            <Label className="text-xs font-semibold">Audience</Label>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {(
                [
                  { id: "public", label: "Public", icon: Globe },
                  { id: "followers", label: "Followers", icon: Users },
                  { id: "hub", label: "Community Hub", icon: Building2 },
                ] as const
              ).map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setAudience(opt.id)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors",
                      audience === opt.id
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-card text-muted-foreground hover:bg-secondary",
                    )}
                  >
                    <Icon className="size-3.5" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {audience === "hub" && (
            <div>
              <Label htmlFor="live-hub" className="text-xs font-semibold">
                Select Community Hub
              </Label>
              {myHubs.length === 0 ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Join or create a Hub first to host a Hub-scoped live room.
                </p>
              ) : (
                <select
                  id="live-hub"
                  value={selectedHubId}
                  onChange={(e) => setSelectedHubId(e.target.value)}
                  className="mt-1.5 flex h-10 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground"
                >
                  <option value="">Choose a Hub…</option>
                  {myHubs.map((h) => (
                    <option key={h.hub.id} value={h.hub.id}>
                      {h.hub.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <div>
            <Label className="text-xs font-semibold">Timing</Label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("now")}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors",
                  mode === "now"
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card text-muted-foreground hover:bg-secondary",
                )}
              >
                <Clock className="size-3.5" /> Start Now
              </button>
              <button
                type="button"
                onClick={() => setMode("schedule")}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors",
                  mode === "schedule"
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card text-muted-foreground hover:bg-secondary",
                )}
              >
                <Calendar className="size-3.5" /> Schedule
              </button>
            </div>
          </div>

          {mode === "schedule" && (
            <div>
              <Label htmlFor="live-schedule-time" className="text-xs font-semibold">
                Scheduled date & time
              </Label>
              <Input
                id="live-schedule-time"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="mt-1.5 rounded-xl"
              />
            </div>
          )}

          <div>
            <Label htmlFor="live-room-url" className="text-xs font-semibold">
              External room or stream link (optional)
            </Label>
            <Input
              id="live-room-url"
              type="url"
              value={roomUrl}
              onChange={(e) => setRoomUrl(e.target.value)}
              placeholder="https://meet.google.com/… or leave blank to use Hub room"
              className="mt-1.5 rounded-xl"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="hero"
              disabled={submitting}
              className="rounded-xl font-bold"
            >
              {submitting
                ? "Publishing…"
                : mode === "schedule"
                  ? "Schedule Session"
                  : "Start Live Session"}
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
