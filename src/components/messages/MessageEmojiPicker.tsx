import { useState } from "react";
import { SmilePlus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const RECENT_EMOJIS_KEY = "ping_recent_emojis_v1";

export const EMOJI_CATEGORIES: ReadonlyArray<{
  id: string;
  label: string;
  emojis: readonly string[];
}> = [
  {
    id: "quick",
    label: "Quick",
    emojis: ["❤️", "👍", "🔥", "😂", "🙌", "🚀", "👏", "💯", "🎉", "💡", "🙏", "👀"],
  },
  {
    id: "faces",
    label: "Expressions",
    emojis: ["😊", "😁", "🥹", "😎", "🤩", "🤔", "😮", "😢", "😅", "🤝", "🫡", "🥳"],
  },
  {
    id: "work",
    label: "Builders",
    emojis: ["⚡", "🛠️", "📈", "🎯", "🧠", "🌍", "💎", "📌", "📣", "✨", "🎵", "📸"],
  },
] as const;

export function readRecentEmojis(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_EMOJIS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string").slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

export function recordRecentEmoji(emoji: string): string[] {
  const prev = readRecentEmojis().filter((e) => e !== emoji);
  const next = [emoji, ...prev].slice(0, 8);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
  }
  return next;
}

export function MessageEmojiPicker({
  onSelect,
  triggerClassName,
  ariaLabel = "Pick emoji reaction",
}: {
  onSelect: (emoji: string) => void;
  triggerClassName?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => readRecentEmojis());
  const [activeTab, setActiveTab] = useState<string>("quick");

  const handlePick = (emoji: string) => {
    setRecent(recordRecentEmoji(emoji));
    onSelect(emoji);
    setOpen(false);
  };

  const currentGroup = EMOJI_CATEGORIES.find((c) => c.id === activeTab) ?? EMOJI_CATEGORIES[0]!;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          title={ariaLabel}
          className={cn(
            "p-1 rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors",
            triggerClassName,
          )}
        >
          <SmilePlus className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 rounded-2xl p-3 space-y-2.5 shadow-lift">
        {recent.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Recent
            </p>
            <div className="flex flex-wrap gap-1">
              {recent.map((emoji) => (
                <button
                  key={`rec-${emoji}`}
                  type="button"
                  onClick={() => handlePick(emoji)}
                  className="size-7 rounded-lg hover:bg-secondary flex items-center justify-center text-sm transition-transform hover:scale-110 active:scale-95"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-1 border-b border-border/60 pb-1.5">
          {EMOJI_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveTab(cat.id)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[10px] font-bold transition-colors",
                activeTab === cat.id
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-secondary",
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-6 gap-1">
          {currentGroup.emojis.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => handlePick(emoji)}
              className="size-8 rounded-lg hover:bg-secondary flex items-center justify-center text-base transition-transform hover:scale-110 active:scale-95"
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
