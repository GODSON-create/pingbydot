import { Globe, Wifi } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  formatRegionalCurrency,
  SUPPORTED_LOCALES,
  useLocale,
  useLowBandwidthMode,
  type SupportedLocale,
} from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function LanguageSettings() {
  const { user } = useAuth();
  const { locale, t, setLocale } = useLocale();
  const { lowBandwidth, setLowBandwidth } = useLowBandwidthMode();

  const handleSelectLocale = (next: SupportedLocale) => {
    setLocale(next, user?.id);
    const chosen = SUPPORTED_LOCALES.find((l) => l.code === next);
    toast.success(`Language updated to ${chosen?.nativeName ?? next}`);
  };

  const handleToggleDataSaver = () => {
    const next = !lowBandwidth;
    setLowBandwidth(next, user?.id);
    toast.success(
      next
        ? "Data Saver enabled — video autoplay paused for low-bandwidth networks"
        : "Data Saver disabled — standard media loading active",
    );
  };

  return (
    <section className="surface-card mt-6 rounded-3xl p-6 sm:p-8 space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Globe className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-display text-lg font-bold">{t("settings.language_title")}</h2>
          <p className="text-xs text-muted-foreground">
            African &amp; global language support with regional formatting and automatic RTL layout
            for Arabic.
          </p>
        </div>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {SUPPORTED_LOCALES.map((item) => {
          const active = locale === item.code;
          return (
            <button
              key={item.code}
              type="button"
              data-testid={`locale-option-${item.code}`}
              onClick={() => handleSelectLocale(item.code)}
              className={cn(
                "flex flex-col items-start rounded-2xl border p-3.5 text-left transition-all",
                active
                  ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                  : "border-border hover:bg-muted/50",
              )}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="font-display text-sm font-bold text-foreground">
                  {item.nativeName}
                </span>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                  {item.code}
                  {item.dir === "rtl" ? " · RTL" : ""}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{item.regionHint}</p>
              <p className="mt-1.5 text-[10px] font-mono text-primary">
                Sample: {formatRegionalCurrency(2500, item.defaultCurrency, item.code)}
              </p>
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4 flex items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Wifi className="size-4 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-foreground">{t("settings.data_saver_title")}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {t("settings.data_saver_desc")}
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={lowBandwidth}
          data-testid="data-saver-switch"
          onClick={handleToggleDataSaver}
          className={cn(
            "inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors",
            lowBandwidth ? "bg-primary justify-end" : "bg-muted justify-start",
          )}
        >
          <span className="size-5 rounded-full bg-background shadow-sm" />
        </button>
      </div>
    </section>
  );
}
