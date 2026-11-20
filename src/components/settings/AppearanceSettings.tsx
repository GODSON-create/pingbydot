import { Check, Eye, Palette, PlayCircle, Sparkles, Type } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  CURATED_ACCENT_OPTIONS,
  CURATED_THEME_OPTIONS,
  useTheme,
  type AccentPreset,
  type MediaAutoplayMode,
  type TextScale,
  type ThemePreset,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

export function AppearanceSettings() {
  const { user } = useAuth();
  const {
    theme,
    resolvedTheme,
    preset,
    accent,
    reducedMotion,
    mediaAutoplay,
    textScale,
    setPreset,
    updateAppearance,
  } = useTheme();

  const activeThemeCardId: ThemePreset | "system" = theme === "system" ? "system" : preset;

  const handleSelectTheme = (id: ThemePreset | "system", label: string) => {
    setPreset(id, user?.id);
    toast.success(`Theme updated to ${label}`);
  };

  const handleSelectAccent = (nextAccent: AccentPreset, label: string) => {
    updateAppearance({ accent: nextAccent }, user?.id);
    toast.success(`Accent colour set to ${label}`);
  };

  const handleToggleReducedMotion = () => {
    const next = !reducedMotion;
    updateAppearance({ reducedMotion: next }, user?.id);
    toast.success(next ? "Reduced motion enabled" : "Standard subtle transitions restored");
  };

  const handleAutoplayChange = (mode: MediaAutoplayMode) => {
    updateAppearance({ mediaAutoplay: mode }, user?.id);
    toast.success(`Media autoplay set to ${mode.replace("_", " ")}`);
  };

  const handleTextScaleChange = (scale: TextScale) => {
    updateAppearance({ textScale: scale }, user?.id);
    toast.success(`Text size set to ${scale}`);
  };

  return (
    <section
      aria-labelledby="appearance-settings-heading"
      className="surface-card mt-6 rounded-3xl p-6 sm:p-8 space-y-6"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Palette className="h-5 w-5" />
        </div>
        <div>
          <h2 id="appearance-settings-heading" className="font-display text-lg font-bold">
            Appearance &amp; Display
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Curated themes, accessible accent colours, motion, text sizing, and media autoplay.
            Currently resolved as{" "}
            <strong className="text-foreground capitalize">{resolvedTheme}</strong>.
          </p>
        </div>
      </div>

      {/* 1. Curated Theme Cards with Live Mini Preview */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
          Theme Preset
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {CURATED_THEME_OPTIONS.map((opt) => {
            const isSelected = activeThemeCardId === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                data-testid={`theme-preset-${opt.id}`}
                onClick={() => handleSelectTheme(opt.id, opt.name)}
                className={cn(
                  "flex flex-col items-start justify-between rounded-2xl border p-3.5 text-left transition-all active:scale-[0.98]",
                  isSelected
                    ? "border-primary bg-primary/10 ring-2 ring-primary/25 shadow-sm"
                    : "border-border hover:bg-muted/50",
                )}
              >
                {/* Mini Theme Surface Preview */}
                <div
                  className="w-full rounded-xl p-2.5 border border-black/10 dark:border-white/10"
                  style={{ backgroundColor: opt.swatches.bg }}
                  aria-hidden="true"
                >
                  <div
                    className="rounded-lg p-2 space-y-1.5"
                    style={{ backgroundColor: opt.swatches.card }}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className="h-1.5 w-10 rounded-full"
                        style={{ backgroundColor: opt.swatches.text, opacity: 0.85 }}
                      />
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: opt.swatches.primary }}
                      />
                    </div>
                    <span
                      className="block h-1 w-14 rounded-full"
                      style={{ backgroundColor: opt.swatches.text, opacity: 0.35 }}
                    />
                  </div>
                </div>

                <div className="mt-3 w-full">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-display text-xs font-bold text-foreground">
                      {opt.name}
                    </span>
                    {isSelected && <Check className="size-3.5 text-primary shrink-0" />}
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2 leading-snug">
                    {opt.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Curated Accent Swatches */}
      <div className="pt-4 border-t border-border/60">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2.5 flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-primary" /> Curated Accent Colour
        </p>
        <div className="flex flex-wrap gap-2">
          {CURATED_ACCENT_OPTIONS.map((opt) => {
            const active = accent === opt.id;
            const swatch = resolvedTheme === "dark" ? opt.darkHex : opt.lightHex;
            return (
              <button
                key={opt.id}
                type="button"
                data-testid={`accent-option-${opt.id}`}
                onClick={() => handleSelectAccent(opt.id, opt.label)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all active:scale-[0.98]",
                  active
                    ? "border-primary bg-primary/12 text-foreground ring-1 ring-primary/30"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className="size-3.5 rounded-full border border-black/20 shrink-0"
                  style={{ backgroundColor: swatch }}
                  aria-hidden="true"
                />
                <span>{opt.label}</span>
                {active && <Check className="size-3 text-primary" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Text Scale, Reduced Motion & Media Autoplay */}
      <div className="grid gap-4 sm:grid-cols-3 pt-4 border-t border-border/60">
        {/* Text Size */}
        <div className="rounded-2xl border border-border/70 bg-secondary/30 p-3.5 space-y-2">
          <p className="text-xs font-bold flex items-center gap-1.5">
            <Type className="size-3.5 text-primary" /> Text Size
          </p>
          <div className="flex gap-1">
            {(["compact", "default", "large"] as const).map((sz) => (
              <button
                key={sz}
                type="button"
                data-testid={`text-scale-${sz}`}
                onClick={() => handleTextScaleChange(sz)}
                className={cn(
                  "flex-1 rounded-xl py-1.5 text-[11px] font-semibold capitalize transition-colors",
                  textScale === sz
                    ? "bg-foreground text-background"
                    : "bg-card text-muted-foreground hover:text-foreground border border-border/60",
                )}
              >
                {sz}
              </button>
            ))}
          </div>
        </div>

        {/* Media Autoplay */}
        <div className="rounded-2xl border border-border/70 bg-secondary/30 p-3.5 space-y-2">
          <p className="text-xs font-bold flex items-center gap-1.5">
            <PlayCircle className="size-3.5 text-primary" /> Media Autoplay
          </p>
          <div className="flex gap-1">
            {(
              [
                { id: "always", label: "Always" },
                { id: "wifi_only", label: "Wi-Fi" },
                { id: "off", label: "Off" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                data-testid={`autoplay-${opt.id}`}
                onClick={() => handleAutoplayChange(opt.id)}
                className={cn(
                  "flex-1 rounded-xl py-1.5 text-[11px] font-semibold transition-colors",
                  mediaAutoplay === opt.id
                    ? "bg-foreground text-background"
                    : "bg-card text-muted-foreground hover:text-foreground border border-border/60",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Reduced Motion */}
        <div className="rounded-2xl border border-border/70 bg-secondary/30 p-3.5 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold flex items-center gap-1.5">
              <Eye className="size-3.5 text-primary" /> Reduced Motion
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Minimise interface animations
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={reducedMotion}
            data-testid="reduced-motion-switch"
            onClick={handleToggleReducedMotion}
            className={cn(
              "inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors",
              reducedMotion ? "bg-primary justify-end" : "bg-muted justify-start",
            )}
          >
            <span className="size-5 rounded-full bg-background shadow-sm" />
          </button>
        </div>
      </div>
    </section>
  );
}
