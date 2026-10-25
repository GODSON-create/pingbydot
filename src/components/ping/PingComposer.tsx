import { useState } from "react";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CATEGORIES, PING_MAX, pingSchema, type Category } from "@/lib/validation";
import { cn } from "@/lib/utils";

export type PingDraft = { category: Category; content: string; cta_url: string; cta_label: string };

export function PingComposer({
  initial,
  submitLabel,
  pending,
  onSubmit,
}: {
  initial?: Partial<PingDraft>;
  submitLabel: string;
  pending: boolean;
  onSubmit: (d: PingDraft) => void;
}) {
  const [d, setD] = useState<PingDraft>({ category: "progress", content: "", cta_url: "", cta_label: "", ...initial });
  const [errors, setErrors] = useState<Partial<Record<keyof PingDraft, string>>>({});
  const [showCta, setShowCta] = useState(!!initial?.cta_url);

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
    onSubmit(r.data as PingDraft);
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
                d.category === c.value ? "border-foreground bg-lime text-lime-foreground shadow-[2px_2px_0_var(--foreground)]" : "border-border bg-card hover:bg-secondary",
              )}
            >
              <span aria-hidden>{c.emoji}</span> {c.label}
            </button>
          ))}
        </div>
      </fieldset>

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
            <Input id="cta_url" type="url" inputMode="url" placeholder="https://yourproduct.com/waitlist" value={d.cta_url} onChange={(e) => setD({ ...d, cta_url: e.target.value })} className="mt-1.5 rounded-xl bg-card" aria-invalid={!!errors.cta_url} />
            {errors.cta_url && <p className="mt-1 text-xs text-destructive">{errors.cta_url}</p>}
          </div>
          <div>
            <Label htmlFor="cta_label">Button label</Label>
            <Input id="cta_label" placeholder="Join the waitlist" value={d.cta_label} onChange={(e) => setD({ ...d, cta_label: e.target.value })} className="mt-1.5 rounded-xl bg-card" maxLength={40} />
            {errors.cta_label && <p className="mt-1 text-xs text-destructive">{errors.cta_label}</p>}
          </div>
          <button type="button" onClick={() => { setShowCta(false); setD({ ...d, cta_url: "", cta_label: "" }); }} className="justify-self-start text-xs text-muted-foreground underline">Remove link</button>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => setShowCta(true)}>
          <Link2 /> Add a link (website, waitlist, buy, contact)
        </Button>
      )}

      <div className="mt-6 flex items-center justify-end gap-3">
        <Button type="submit" variant="hero" size="lg" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
      </div>
    </form>
  );
}
