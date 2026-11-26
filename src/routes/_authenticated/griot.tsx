import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  Copy,
  History,
  Info,
  Lock,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  createDefaultGriotPreferences,
  executeGriotAssist,
  getGriotProviderStatus,
  griotAuditLogsQuery,
  griotPreferencesQuery,
  useUpdateGriotPreferences,
  type GriotActionType,
  type GriotAssistResult,
  type GriotTone,
} from "@/lib/griot";
import { SUPPORTED_LOCALES, useLocale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/griot")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "GRIOT AI — Permission-Bounded Assistant | Ping by DOT" },
    ],
  }),
  component: GriotWorkspacePage,
});

const GRIOT_ACTIONS: Array<{ id: GriotActionType; label: string; hint: string }> = [
  { id: "draft_ping", label: "Structure Ping Draft", hint: "Format ideas into a crisp Ping" },
  {
    id: "clarity_audit",
    label: "Clarity & Anti-Bait Audit",
    hint: "Score clarity and actionable scope",
  },
  { id: "hashtag_suggest", label: "Suggest Topics", hint: "Extract 2–5 relevant hashtags" },
  {
    id: "opportunity_pitch",
    label: "Opportunity Pitch",
    hint: "Structure a Signal opportunity post",
  },
  {
    id: "business_reply_draft",
    label: "Business Reply Draft",
    hint: "Draft a customer reply (never auto-sent)",
  },
  { id: "thread_summary", label: "Summarise Notes", hint: "Extract top 3 bullet takeaways" },
  {
    id: "translation_prep",
    label: "Localisation Brief",
    hint: "Prepare cross-language adaptation brief",
  },
];

function GriotWorkspacePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t, locale } = useLocale();
  const providerStatus = getGriotProviderStatus();

  const { data: prefs = createDefaultGriotPreferences(user?.id ?? "") } = useQuery(
    griotPreferencesQuery(user?.id),
  );
  const { data: auditLogs = [] } = useQuery(griotAuditLogsQuery(user?.id));
  const updatePrefs = useUpdateGriotPreferences(user?.id);

  const [action, setAction] = useState<GriotActionType>("draft_ping");
  const [tone, setTone] = useState<GriotTone>(prefs.preferred_tone || "concise");
  const [targetLocale, setTargetLocale] = useState<string>(locale === "en" ? "fr" : "en");
  const [inputText, setInputText] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<GriotAssistResult | null>(null);
  const [copied, setCopied] = useState(false);

  const togglePref = (
    key:
      | "enabled"
      | "allow_public_profile_context"
      | "allow_ping_composer_assist"
      | "allow_opportunity_matching"
      | "allow_business_reply_drafts",
  ) => {
    updatePrefs.mutate(
      { [key]: !prefs[key] },
      {
        onSuccess: () => toast.success("GRIOT AI permission updated"),
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Could not save consent"),
      },
    );
  };

  const handleRunAssist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prefs.enabled) {
      toast.info("Enable GRIOT AI opt-in consent first before running assistance.");
      return;
    }
    if (!inputText.trim()) {
      toast.error("Enter text you explicitly want GRIOT to process.");
      return;
    }
    setRunning(true);
    try {
      const out = await executeGriotAssist(
        {
          action,
          inputText,
          tone,
          targetLocale: action === "translation_prep" ? targetLocale : undefined,
          sourceSurface: "griot_workspace",
        },
        user?.id,
      );
      setResult(out);
      void qc.invalidateQueries({ queryKey: ["griot-audit-logs", user?.id] });
    } finally {
      setRunning(false);
    }
  };

  const handleCopyOutput = async () => {
    if (!result?.outputText) return;
    try {
      await navigator.clipboard.writeText(result.outputText);
      setCopied(true);
      toast.success("Copied GRIOT output");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Could not copy output");
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 pb-24 space-y-6">
      {/* Header & Layer Independence Banner */}
      <header className="surface-card rounded-3xl p-6 sm:p-8 border border-border/70 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
              <Sparkles className="size-3.5" /> GRIOT AI · Independent Intelligence Layer
            </span>
            <h1 className="mt-2 font-display text-2xl sm:text-3xl font-extrabold">
              {t("griot.title")}
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-muted-foreground max-w-2xl">
              Opt-in drafting, clarity checks, opportunity structuring, and business reply prep —
              strictly separated from Ping core social access, DOT credits, and Avantage.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
            <Lock className="size-3.5" /> {t("griot.privacy_badge")}
          </span>
        </div>

        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs flex items-start gap-2.5">
          <Info className="size-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-muted-foreground leading-relaxed">
            <strong className="text-foreground">
              Runtime Mode:{" "}
              {providerStatus.liveProviderConfigured
                ? "Live Server LLM Provider"
                : "Deterministic Local Assistant (Pre-LLM Credentials)"}
            </strong>{" "}
            —{" "}
            {providerStatus.liveProviderConfigured
              ? "Server-side AI provider credentials are active. Only text you explicitly submit is sent."
              : "No external LLM provider keys are provisioned yet. Local structuring, clarity scoring, and topic suggestions work offline immediately; live generative LLM reasoning awaits server AI provider credentials."}
          </div>
        </div>
      </header>

      {/* Permission & Consent Boundary Matrix */}
      <section className="surface-card rounded-3xl p-6 border border-border/70 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold flex items-center gap-2">
              <ShieldCheck className="size-5 text-primary" /> Explicit Consent &amp; Scope
              Boundaries
            </h2>
            <p className="text-xs text-muted-foreground">
              GRIOT starts disabled (`off`) and only operates within scopes you toggle on.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={prefs.enabled}
            data-testid="griot-master-optin"
            disabled={updatePrefs.isPending}
            onClick={() => togglePref("enabled")}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-bold transition-colors",
              prefs.enabled
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-secondary text-foreground",
            )}
          >
            {prefs.enabled ? "GRIOT Opted In" : "Enable GRIOT AI"}
          </button>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          {(
            [
              {
                key: "allow_ping_composer_assist",
                label: "Ping Composer Clarity Assist",
                desc: "Allow optional draft & hashtag suggestions inside /create.",
              },
              {
                key: "allow_opportunity_matching",
                label: "Opportunity Structuring",
                desc: "Help format Signals opportunities and application pitches.",
              },
              {
                key: "allow_business_reply_drafts",
                label: "Business Reply Prep",
                desc: "Draft suggested replies from explicitly pasted enquiries (never auto-sent).",
              },
              {
                key: "allow_public_profile_context",
                label: "Public Profile Context Only",
                desc: "Allow your public bio & interests to tailor tone (never private records).",
              },
            ] as const
          ).map((scope) => {
            const on = Boolean(prefs[scope.key]);
            return (
              <button
                key={scope.key}
                type="button"
                role="switch"
                aria-checked={on}
                disabled={!prefs.enabled || updatePrefs.isPending}
                onClick={() => togglePref(scope.key)}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-2xl border p-3.5 text-left transition-colors",
                  !prefs.enabled && "opacity-55 cursor-not-allowed",
                  on ? "border-primary/40 bg-primary/8" : "border-border/70 bg-secondary/25",
                )}
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground">{scope.label}</p>
                  <p className="text-[11px] text-muted-foreground">{scope.desc}</p>
                </div>
                <span
                  className={cn(
                    "inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
                    on ? "bg-primary justify-end" : "bg-muted justify-start",
                  )}
                >
                  <span className="size-4 rounded-full bg-background shadow-sm" />
                </span>
              </button>
            );
          })}
        </div>

        {/* Permanently Blocked Private DM Guarantee */}
        <div
          data-testid="griot-private-dm-lock"
          className="rounded-2xl border border-border bg-secondary/40 px-4 py-3 flex items-center justify-between gap-3 text-xs"
        >
          <div className="flex items-center gap-2.5">
            <Lock className="size-4 text-primary shrink-0" />
            <div>
              <p className="font-bold text-foreground">
                Private Direct Messages, Close Circle &amp; Internal CRM Notes
              </p>
              <p className="text-[11px] text-muted-foreground">
                Permanently excluded (`allow_private_messages_access = false` enforced in PostgreSQL
                &amp; runtime). Cannot be enabled.
              </p>
            </div>
          </div>
          <span className="rounded-full bg-destructive/15 text-destructive px-2.5 py-0.5 text-[10px] font-bold uppercase shrink-0">
            Locked Off
          </span>
        </div>
      </section>

      {/* Interactive Workbench */}
      <section className="grid gap-6 lg:grid-cols-[1.15fr_1fr] items-start">
        <form
          onSubmit={(e) => void handleRunAssist(e)}
          className="surface-card rounded-3xl p-6 border border-border/70 space-y-4"
        >
          <h2 className="font-display text-lg font-bold flex items-center gap-2">
            <Wand2 className="size-5 text-primary" /> Contextual Workbench
          </h2>

          <div className="flex flex-wrap gap-1.5">
            {GRIOT_ACTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setAction(item.id)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                  action === item.id
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
                title={item.hint}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="griot-tone" className="text-xs">
                Tone
              </Label>
              <select
                id="griot-tone"
                value={tone}
                onChange={(e) => setTone(e.target.value as GriotTone)}
                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs"
              >
                <option value="concise">Concise</option>
                <option value="structured">Structured (Bullets)</option>
                <option value="professional">Professional</option>
                <option value="warm">Warm &amp; Community</option>
              </select>
            </div>

            {action === "translation_prep" && (
              <div>
                <Label htmlFor="griot-target-locale" className="text-xs">
                  Target Locale
                </Label>
                <select
                  id="griot-target-locale"
                  value={targetLocale}
                  onChange={(e) => setTargetLocale(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs"
                >
                  {SUPPORTED_LOCALES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.nativeName} ({l.code.toUpperCase()})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="griot-input" className="text-xs">
              Explicit Text to Process (only this box is read)
            </Label>
            <Textarea
              id="griot-input"
              rows={5}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Paste a rough Ping idea, opportunity announcement, or customer question you want GRIOT to structure or review…"
              className="mt-1 rounded-2xl text-xs"
            />
          </div>

          <Button
            type="submit"
            variant="hero"
            disabled={running || !prefs.enabled}
            className="rounded-full text-xs gap-1.5"
          >
            <Sparkles className="size-3.5" />
            {running ? "Processing…" : "Run GRIOT Assist"}
          </Button>
        </form>

        {/* Output Panel */}
        <div className="surface-card rounded-3xl p-6 border border-border/70 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold">Output &amp; Suggestions</h2>
            {result?.clarityScore !== undefined && (
              <span className="rounded-full bg-primary/15 text-primary px-3 py-0.5 text-xs font-bold tabular-nums">
                Clarity: {result.clarityScore}/100
              </span>
            )}
          </div>

          {!result ? (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
              Enable GRIOT consent above, paste your draft text, and run an action to preview
              structured output here.
            </div>
          ) : (
            <div className="space-y-3" data-testid="griot-result-panel">
              <p className="text-[11px] text-muted-foreground bg-secondary/40 rounded-xl px-3 py-2">
                {result.providerNotice}
              </p>

              <pre className="whitespace-pre-wrap rounded-2xl border border-border/70 bg-background/70 p-4 text-xs font-sans leading-relaxed text-foreground">
                {result.outputText}
              </pre>

              {result.suggestedHashtags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {result.suggestedHashtags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-primary/12 text-primary px-2.5 py-0.5 text-[11px] font-semibold"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}

              {result.suggestions.length > 0 && (
                <ul className="space-y-1 text-xs text-muted-foreground list-disc pl-4">
                  {result.suggestions.map((s, idx) => (
                    <li key={idx}>{s}</li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleCopyOutput()}
                  className="rounded-full text-xs gap-1.5"
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  Copy Output
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="hero"
                  onClick={() =>
                    void navigate({
                      to: "/create",
                      search: {
                        quote: result.outputText.slice(0, 380),
                        ...(result.suggestedHeadline
                          ? { importTitle: result.suggestedHeadline.slice(0, 120) }
                          : {}),
                      },
                    })
                  }
                  className="rounded-full text-xs gap-1.5"
                >
                  Send to Ping Composer <ArrowUpRight className="size-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Transparent User-Owned Audit Log */}
      <section className="surface-card rounded-3xl p-6 border border-border/70 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-base font-bold flex items-center gap-2">
            <History className="size-4 text-primary" /> Your GRIOT Invocation Audit Log
          </h2>
          <Link to="/developers" className="text-xs font-semibold text-primary hover:underline">
            Explore Developer Platform →
          </Link>
        </div>
        {auditLogs.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No GRIOT invocations logged yet. Every explicit request you trigger is recorded here for
            full transparency.
          </p>
        ) : (
          <div className="space-y-2">
            {auditLogs.slice(0, 10).map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/60 bg-secondary/30 px-4 py-2.5 text-xs"
              >
                <div>
                  <span className="font-semibold text-foreground">
                    {entry.action_type.replace(/_/g, " ")}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {entry.input_char_count} chars · {entry.provider_mode}
                  </span>
                </div>
                <span className="text-[11px] text-primary font-semibold">
                  Private DMs accessed: No
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
