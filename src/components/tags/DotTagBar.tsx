import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import {
  CURATED_DOT_TAGS,
  dotTagsDirectoryQuery,
  extractDotTags,
  suggestDotTags,
  type DotTagRecord,
} from "@/lib/dot-tags";
import { cn } from "@/lib/utils";

/**
 * Reusable DOT Tag Autocomplete Popover + Recommended Quick-Insert Bar (Section 7).
 * Encourages Ping's native `.tag` convention while remaining non-intrusive.
 */
export function DotTagAutocomplete({
  query,
  onSelect,
}: {
  query: string;
  onSelect: (tag: DotTagRecord) => void;
}) {
  const { data: directory = [...CURATED_DOT_TAGS] } = useQuery(dotTagsDirectoryQuery());
  const matches = suggestDotTags("", query, directory);
  if (matches.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="DOT Tag suggestions"
      data-testid="dot-tag-autocomplete"
      className="mt-1.5 rounded-2xl border border-border bg-popover p-2 shadow-lift space-y-0.5"
    >
      <p className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        DOT Tags
      </p>
      <div className="flex flex-wrap gap-1">
        {matches.map((tag) => (
          <button
            key={tag.slug}
            type="button"
            role="option"
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(tag);
            }}
            className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-secondary/60 hover:border-primary hover:bg-primary/15 px-2.5 py-1 text-xs font-semibold text-foreground transition-colors"
          >
            <span className="text-primary">{tag.display_tag}</span>
            <span className="text-[10px] text-muted-foreground">{tag.category}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function DotTagSuggestionBar({
  content,
  onInsertTag,
}: {
  content: string;
  onInsertTag: (displayTag: string) => void;
}) {
  const { data: directory = [...CURATED_DOT_TAGS] } = useQuery(dotTagsDirectoryQuery());
  const activeTags = extractDotTags(content);
  const recommended = suggestDotTags(content, "", directory)
    .filter((t) => !activeTags.includes(t.slug))
    .slice(0, 6);

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-2">
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground mr-0.5">
        <Sparkles className="size-3 text-primary" /> DOT Tags:
      </span>
      {recommended.map((tag) => (
        <button
          key={tag.slug}
          type="button"
          onClick={() => onInsertTag(tag.display_tag)}
          className={cn(
            "rounded-full border border-border/70 bg-secondary/45 px-2.5 py-0.5 text-[11px] font-semibold text-foreground hover:border-primary hover:text-primary transition-colors active:scale-95",
          )}
        >
          {tag.display_tag}
        </button>
      ))}
    </div>
  );
}
