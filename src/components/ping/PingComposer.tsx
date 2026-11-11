import { useState } from "react";
import { Link2, Building2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CATEGORIES, PING_MAX, pingSchema, type Category } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { myHubsQuery } from "@/lib/hub-queries";
import { HUB_INTENTS, type HubIntent } from "@/lib/hubs";

export type PingDraft = {
  category: Category;
  content: string;
  cta_url: string;
  cta_label: string;
  hub_id?: string | null;
  hub_intent?: HubIntent | null;
};

export function PingComposer({
  initial,
  submitLabel,
  pending,
  onSubmit,
}: {
  initial?: Partial<PingDraft> | undefined;
  submitLabel: string;
  pending: boolean;
  onSubmit: (d: PingDraft) => void;
}) {
  const { user } = useAuth();
  const [d, setD] = useState<PingDraft>({
    category: "progress",
    content: "",
    cta_url: "",
    cta_label: "",
    hub_id: null,
    hub_intent: null,
    ...initial,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof PingDraft, string>>>({});
  const [showCta, setShowCta] = useState(!!initial?.cta_url);

  // User's active hubs
  const { data: myHubs } = useQuery(myHubsQuery(user?.id));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = pingSchema.safeParse(showCta ? d : { ...d, cta_url: "", cta_label: "" });
    if (!r.success) {
      const errs: Record<string, string> = {};
      r.error.issues.forEach((i) => (errs[String(i.path[0])] ??= i.message));
      setErrors(errs);
      return;
    }
    setErrors({});
    onSubmit({
      ...(r.data as PingDraft),
      hub_id: d.hub_id || null,
      hub_intent: d.hub_id ? d.hub_intent || null : null,
    });
  };

  const left = PING_MAX - d.content.length;

  return (
    <form onSubmit={submit} className="surface-card rounded-3xl p-5 sm:p-7" noValidate>
      <fieldset>
        <legend className="text-sm font-semibold">What kind of Ping is this?</legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              type="button"
              key={c.value}
              onClick={() => setD({ ...d, category: c.value })}
              aria-pressed={d.category === c.value}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all active:scale-95",
                d.category === c.value
                  ? "border-foreground bg-lime text-lime-foreground shadow-[2px_2px_0_var(--foreground)]"
                  : "border-border bg-card hover:bg-secondary",
              )}
            >
              <span aria-hidden>{c.emoji}</span> {c.label}
            </button>
          ))}
        </div>
      </fieldset>

      {/* Optional Post to Hub Selector */}
      {myHubs && myHubs.length > 0 && (
        <div className="mt-6 rounded-2xl bg-secondary/50 p-4 border border-border">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Building2 className="size-4 text-primary" />
            <span>Post to a Hub (optional)</span>
          </div>

          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setD({ ...d, hub_id: null, hub_intent: null })}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold transition-all",
                !d.hub_id
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card hover:bg-secondary",
              )}
            >
              Public Feed Only
            </button>
            {myHubs.map((h) => (
              <button
                type="button"
                key={h.hub.id}
                onClick={() => setD({ ...d, hub_id: h.hub.id })}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold transition-all",
                  d.hub_id === h.hub.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:bg-secondary",
                )}
              >
                {h.hub.name}
              </button>
            ))}
          </div>

          {/* When hub is selected, choose intent tag */}
          {d.hub_id && (
            <div className="mt-3 pt-3 border-t border-border">
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Tag your post with an Intent:
              </label>
              <div className="flex flex-wrap gap-1.5">
                {HUB_INTENTS.map((intent) => (
                  <button
                    type="button"
                    key={intent.value}
                    onClick={() =>
                      setD({
                        ...d,
                        hub_intent: d.hub_intent === intent.value ? null : intent.value,
                      })
                    }
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs font-medium transition-all",
                      d.hub_intent === intent.value
                        ? "border-foreground bg-lime text-lime-foreground font-bold"
                        : "border-border bg-card hover:bg-secondary",
                    )}
                  >
                    <span>{intent.emoji}</span> #{intent.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-6">
        <Label htmlFor="content" className="text-sm font-semibold">Your story</Label>
        <Textarea
          id="content"
          value={d.content}
          onChange={(e) => setD({ ...d, content: e.target.value })}
          rows={7}
          placeholder="Shipped onboarding v2 today. Signup takes 40 seconds instead of 3 minutes. Next up: …"
          className="mt-2 resize-y rounded-2xl text-base leading-relaxed"
          aria-invalid={!!errors.content}
          aria-describedby="content-help"
        />
        <div id="content-help" className="mt-1.5 flex justify-between text-xs">
          <span className="text-destructive">{errors.content}</span>
          <span className={cn("tabular-nums", left < 0 ? "text-destructive" : "text-muted-foreground")}>{left}</span>
        </div>
      </div>

      {showCta ? (
        <div className="mt-4 grid gap-4 rounded-2xl bg-secondary/60 p-4 sm:grid-cols-[2fr_1fr]">
          <div>
            <Label htmlFor="cta_url">Link</Label>
            <Input
              id="cta_url"
              type="url"
              inputMode="url"
              placeholder="https://yourproduct.com/waitlist"
              value={d.cta_url}
              onChange={(e) => setD({ ...d, cta_url: e.target.value })}
              className="mt-1.5 rounded-xl bg-card"
              aria-invalid={!!errors.cta_url}
            />
            {errors.cta_url && <p className="mt-1 text-xs text-destructive">{errors.cta_url}</p>}
          </div>
          <div>
            <Label htmlFor="cta_label">Button label</Label>
            <Input
              id="cta_label"
              placeholder="Join the waitlist"
              value={d.cta_label}
              onChange={(e) => setD({ ...d, cta_label: e.target.value })}
              className="mt-1.5 rounded-xl bg-card"
              maxLength={40}
            />
            {errors.cta_label && <p className="mt-1 text-xs text-destructive">{errors.cta_label}</p>}
          </div>
          <button
            type="button"
            onClick={() => {
              setShowCta(false);
              setD({ ...d, cta_url: "", cta_label: "" });
            }}
            className="justify-self-start text-xs text-muted-foreground underline"
          >
            Remove link
          </button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => setShowCta(true)}
        >
          <Link2 className="size-4" /> Add a link (website, waitlist, buy, contact)
        </Button>
      )}

      <div className="mt-6 flex items-center justify-end gap-3">
        <Button type="submit" variant="hero" size="lg" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
