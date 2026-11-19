import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, ExternalLink, Globe, ShieldCheck, Share2 } from "lucide-react";
import { z } from "zod";
import { pageHead } from "@/lib/site";
import { parseExternalShareImport } from "@/lib/sharing/universal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/share-target")({
  staticData: { sitemap: false },
  validateSearch: z.object({
    url: z.string().max(1000).optional(),
    title: z.string().max(240).optional(),
    text: z.string().max(1000).optional(),
  }),
  head: () =>
    pageHead({
      title: "Share into Ping — Cross-Platform Content Import",
      description:
        "Bring links from X, YouTube, Snapchat, WhatsApp, or the web into Ping with preserved source attribution.",
      path: "/share-target",
    }),
  component: ShareTargetPage,
});

function ShareTargetPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();

  const [rawUrl, setRawUrl] = useState(search.url ?? "");
  const [rawTitle, setRawTitle] = useState(search.title ?? "");
  const [rawText, setRawText] = useState(search.text ?? "");

  const parsed = parseExternalShareImport({
    url: rawUrl,
    title: rawTitle,
    text: rawText,
  });

  const handleContinueToComposer = () => {
    if (!parsed) return;
    navigate({
      to: "/create",
      search: {
        importUrl: parsed.url,
        importTitle: parsed.title,
        importPlatform: parsed.platformLabel,
        ...(parsed.note ? { quote: parsed.note.slice(0, 360) } : {}),
      },
    });
  };

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6 py-10 pb-24 space-y-6">
      <header className="space-y-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
          <Share2 className="size-3.5" /> Cross-Platform Share Target
        </span>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          Share External Content into Ping
        </h1>
        <p className="text-sm text-muted-foreground">
          Bring a link shared from X, Snapchat, YouTube, WhatsApp, LinkedIn, or any website into a
          Ping with clear source attribution.
        </p>
      </header>

      <div className="surface-card rounded-3xl p-6 space-y-4 border border-border/70">
        <div>
          <Label htmlFor="import-url" className="text-xs">
            External link URL
          </Label>
          <Input
            id="import-url"
            type="url"
            value={rawUrl}
            onChange={(e) => setRawUrl(e.target.value)}
            placeholder="https://x.com/..., https://youtu.be/..., https://example.com/article"
            className="mt-1.5 rounded-xl"
          />
        </div>

        <div>
          <Label htmlFor="import-title" className="text-xs">
            Headline / source title (optional)
          </Label>
          <Input
            id="import-title"
            value={rawTitle}
            onChange={(e) => setRawTitle(e.target.value)}
            placeholder="Article or post title"
            className="mt-1.5 rounded-xl"
          />
        </div>

        <div>
          <Label htmlFor="import-note" className="text-xs">
            Your commentary (optional)
          </Label>
          <Textarea
            id="import-note"
            rows={3}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Add context for your network on Ping…"
            className="mt-1.5 rounded-xl"
          />
        </div>

        {parsed ? (
          <div className="rounded-2xl border border-primary/30 bg-primary/8 p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-primary">
                <Globe className="size-3.5" /> {parsed.platformLabel}
              </span>
              <a
                href={parsed.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
              >
                {parsed.hostname} <ExternalLink className="size-3" />
              </a>
            </div>
            <p className="font-display text-sm font-bold text-foreground">{parsed.title}</p>
            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="size-3.5 shrink-0 mt-0.5 text-emerald-500" />
              <span>{parsed.attributionNotice}</span>
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Paste a public `http://` or `https://` URL above to preview its source attribution.
          </p>
        )}

        <div className="flex justify-end pt-2">
          <Button
            type="button"
            variant="hero"
            disabled={!parsed}
            onClick={handleContinueToComposer}
            className="rounded-full gap-1.5"
          >
            Continue to Ping Composer <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
