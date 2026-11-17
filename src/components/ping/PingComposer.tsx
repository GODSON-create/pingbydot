import { useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Link2,
  Sparkles,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  INTENT_FORMATS,
  PING_MAX,
  pingSchema,
  serializeStructuredPing,
  type Category,
} from "@/lib/validation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { myHubsQuery } from "@/lib/hub-queries";
import { HUB_INTENTS, type HubIntent } from "@/lib/hubs";

export type PingDraft = {
  category: Category;
  content: string;
  cta_url: string;
  cta_label: string;
  image_url?: string | null;
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
    image_url: null,
    hub_id: null,
    hub_intent: null,
    ...initial,
  });

  // Structured intent coordination fields (progressive disclosure)
  const [headline, setHeadline] = useState("");
  const [needsInput, setNeedsInput] = useState("");
  const [offersInput, setOffersInput] = useState("");
  const [desiredOutcome, setDesiredOutcome] = useState("");
  const [mediaUrl, setMediaUrl] = useState(initial?.image_url ?? "");
  const [showCoordinationDetails, setShowCoordinationDetails] = useState(false);

  const [errors, setErrors] = useState<Partial<Record<keyof PingDraft, string>>>({});
  const [showCta, setShowCta] = useState(!!initial?.cta_url);

  const { data: myHubs } = useQuery(myHubsQuery(user?.id));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();

    const needsList = needsInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const offersList = offersInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const hasStructuredExtras =
      Boolean(headline.trim()) ||
      needsList.length > 0 ||
      offersList.length > 0 ||
      Boolean(desiredOutcome.trim()) ||
      (d.category !== "progress" &&
        d.category !== "idea" &&
        d.category !== "question" &&
        d.category !== "opportunity" &&
        d.category !== "launch" &&
        d.category !== "milestone");

    const finalContent = hasStructuredExtras
      ? serializeStructuredPing({
          intentFormat: d.category,
          headline,
          description: d.content,
          needs: needsList,
          offers: offersList,
          desiredOutcome,
        })
      : d.content;

    const selectedIntentMeta = INTENT_FORMATS.find((f) => f.value === d.category);
    const dbCompatibleCategory: Category = selectedIntentMeta
      ? selectedIntentMeta.dbCategory
      : d.category;

    const r = pingSchema.safeParse(
      showCta
        ? { ...d, category: dbCompatibleCategory, content: finalContent }
        : {
            ...d,
            category: dbCompatibleCategory,
            content: finalContent,
            cta_url: "",
            cta_label: "",
          },
    );

    if (!r.success) {
      const errs: Record<string, string> = {};
      r.error.issues.forEach((i) => (errs[String(i.path[0])] ??= i.message));
      setErrors(errs);
      return;
    }
    setErrors({});
    onSubmit({
      ...(r.data as PingDraft),
      image_url: mediaUrl.trim() || null,
      hub_id: d.hub_id || null,
      hub_intent: d.hub_id ? d.hub_intent || null : null,
    });
  };

  const left = PING_MAX - d.content.length;

  return (
    <form onSubmit={submit} className="surface-card rounded-3xl p-5 sm:p-7" noValidate>
      {/* 1. Intent Type Selector */}
      <fieldset>
        <legend className="text-sm font-semibold text-foreground">Intent type</legend>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Choose the intention behind your Ping so the right people can coordinate with you.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {INTENT_FORMATS.map((c) => {
            const selected = d.category === c.value;
            return (
              <button
                type="button"
                key={c.value}
                onClick={() => setD({ ...d, category: c.value })}
                aria-pressed={selected}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all active:scale-95",
                  selected
                    ? "border-primary bg-lime text-lime-foreground shadow-sm"
                    : "border-border bg-card text-foreground hover:bg-secondary",
                )}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* 2. Objective / Intent Headline (Optional, lightweight) */}
      <div className="mt-5">
        <Label htmlFor="ping-headline" className="text-sm font-semibold">
          Objective / Headline <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="ping-headline"
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          placeholder="e.g. Looking for a design partner for our clinical AI workflow"
          maxLength={110}
          className="mt-1.5 rounded-2xl bg-card"
        />
      </div>

      {/* 3. Natural-Language Description */}
      <div className="mt-5">
        <Label htmlFor="content" className="text-sm font-semibold">
          Description
        </Label>
        <Textarea
          id="content"
          value={d.content}
          onChange={(e) => setD({ ...d, content: e.target.value })}
          rows={6}
          placeholder="Share what you're building, what you need, or how others can collaborate with you…"
          className="mt-1.5 resize-y rounded-2xl text-base leading-relaxed"
          aria-invalid={!!errors.content}
          aria-describedby="content-help"
        />
        <div id="content-help" className="mt-1.5 flex justify-between text-xs">
          <span className="text-destructive">{errors.content}</span>
          <span
            className={cn("tabular-nums", left < 0 ? "text-destructive" : "text-muted-foreground")}
          >
            {left}
          </span>
        </div>
      </div>

      {/* 4. Progressive Disclosure: Needs, Offers, Media & Desired Outcome */}
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setShowCoordinationDetails((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-3.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-secondary"
        >
          <Sparkles className="size-3.5 text-primary" />
          <span>Add needs, offers, media & desired outcome</span>
          {showCoordinationDetails ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </button>

        {showCoordinationDetails && (
          <div className="mt-3 grid gap-4 rounded-2xl border border-border/70 bg-secondary/30 p-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ping-needs" className="text-xs font-semibold">
                Skills or resources needed
              </Label>
              <Input
                id="ping-needs"
                value={needsInput}
                onChange={(e) => setNeedsInput(e.target.value)}
                placeholder="e.g. Rust engineer, Beta testers, Seed intro"
                className="mt-1 rounded-xl bg-card text-xs"
              />
            </div>

            <div>
              <Label htmlFor="ping-offers" className="text-xs font-semibold">
                Contributions or value offered
              </Label>
              <Input
                id="ping-offers"
                value={offersInput}
                onChange={(e) => setOffersInput(e.target.value)}
                placeholder="e.g. Equity, Early API access, Paid contract"
                className="mt-1 rounded-xl bg-card text-xs"
              />
            </div>

            <div>
              <Label htmlFor="ping-outcome" className="text-xs font-semibold">
                Desired outcome
              </Label>
              <Input
                id="ping-outcome"
                value={desiredOutcome}
                onChange={(e) => setDesiredOutcome(e.target.value)}
                placeholder="e.g. Onboard 5 pilot teams by Friday"
                className="mt-1 rounded-xl bg-card text-xs"
              />
            </div>

            <div>
              <Label htmlFor="ping-media" className="text-xs font-semibold flex items-center gap-1">
                <ImageIcon className="size-3.5 text-primary" /> Optional media URL (image/video)
              </Label>
              <Input
                id="ping-media"
                type="url"
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder="https://…/preview.png"
                className="mt-1 rounded-xl bg-card text-xs"
              />
            </div>
          </div>
        )}
      </div>

      {/* 5. Visibility / Community Hub Selector */}
      {myHubs && myHubs.length > 0 && (
        <div className="mt-5 rounded-2xl bg-secondary/40 p-4 border border-border/70">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <Building2 className="size-4 text-primary" />
            <span>Visibility & Community Hub</span>
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
              Public Feed
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

          {d.hub_id && (
            <div className="mt-3 pt-3 border-t border-border/60">
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Hub discussion tag:
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
                    #{intent.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 6. Optional CTA Link */}
      {showCta ? (
        <div className="mt-4 grid gap-4 rounded-2xl bg-secondary/50 p-4 sm:grid-cols-[2fr_1fr]">
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
            {errors.cta_label && (
              <p className="mt-1 text-xs text-destructive">{errors.cta_label}</p>
            )}
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
          className="mt-3 rounded-full"
          onClick={() => setShowCta(true)}
        >
          <Link2 className="size-4" /> Add a link (website, waitlist, repo, calendar)
        </Button>
      )}

      <div className="mt-6 flex items-center justify-end gap-3">
        <Button type="submit" variant="hero" size="lg" disabled={pending} className="rounded-full">
          {pending ? "Publishing…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
