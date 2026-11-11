import { Sun, Moon, Laptop, Palette } from "lucide-react";
import { useTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function AppearanceSettings() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  const handleSelect = (t: Theme) => {
    setTheme(t);
    toast.success(
      t === "system"
        ? "Appearance set to System Default"
        : `Theme set to ${t.charAt(0).toUpperCase() + t.slice(1)} Mode`,
    );
  };

  const options: Array<{
    value: Theme;
    label: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      value: "light",
      label: "Light Theme",
      description: "Warm paper & forest ink aesthetic",
      icon: Sun,
    },
    {
      value: "dark",
      label: "Dark Theme",
      description: "Deep obsidian night with Ping emerald accents",
      icon: Moon,
    },
    {
      value: "system",
      label: "System Default",
      description: "Automatically matches your device display preference",
      icon: Laptop,
    },
  ];

  return (
    <div className="surface-card mt-6 rounded-3xl p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Palette className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-display text-lg font-bold">Appearance</h2>
          <p className="text-sm text-muted-foreground">
            Customize how Ping looks on your screen. Currently resolved as{" "}
            <strong className="text-foreground capitalize">{resolvedTheme}</strong>.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {options.map((opt) => {
          const Icon = opt.icon;
          const isSelected = theme === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleSelect(opt.value)}
              className={cn(
                "flex flex-col items-start justify-between rounded-2xl border p-4 text-left transition-all",
                isSelected
                  ? "border-primary bg-primary/10 text-foreground ring-2 ring-primary/20 shadow-sm"
                  : "border-border hover:bg-muted/50 text-muted-foreground",
              )}
            >
              <div className="flex w-full items-center justify-between">
                <div
                  className={cn(
                    "flex size-9 items-center justify-center rounded-xl",
                    isSelected ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
                  )}
                >
                  <Icon className="size-4" />
                </div>
                {isSelected && (
                  <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary">
                    Active
                  </span>
                )}
              </div>
              <div className="mt-4">
                <p className="font-display text-sm font-bold text-foreground">{opt.label}</p>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{opt.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
