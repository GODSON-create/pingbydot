import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PingComposer, type PingDraft } from "@/components/ping/PingComposer";
import { clearPingComposerDraft } from "@/lib/draft-store";
import { attachMusicToContent } from "@/lib/music";
import { createPingPoll, extractHashtags, extractMentions } from "@/lib/social";
import { pingSchema } from "@/lib/validation";
import { ensureClientProfileRow } from "@/lib/ensure-profile";
import { sanitizeErrorMessage } from "@/lib/error-diagnostics";

function describePublishError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message)
        : error;
  const message = sanitizeErrorMessage(raw);
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "Network request failed while reaching PING servers. Check your connection or ad-blocker and try again.";
  }
  return message || "Couldn't publish your Ping. Try again.";
}

export const Route = createFileRoute("/_authenticated/create")({
  staticData: { sitemap: false },
  validateSearch: z.object({
    hub: z.string().optional(),
    quote: z.string().max(400).optional(),
    importUrl: z.string().max(1000).optional(),
    importTitle: z.string().max(240).optional(),
    importPlatform: z.string().max(80).optional(),
  }),
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Create a Ping — PING" },
      {
        name: "description",
        content: "Share an intention. Find the people and resources to make it happen.",
      },
      { property: "og:title", content: "Create a Ping" },
      { property: "og:description", content: "Share your intention on PING." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Create,
});

function Create() {
  const { user } = useAuth();
  const {
    hub: initialHubId,
    quote: initialQuote,
    importUrl,
    importTitle,
    importPlatform,
  } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: async (d: PingDraft) => {
      let authorId = user?.id;
      if (!authorId) {
        const { data: sessionRes } = await supabase.auth.getSession();
        authorId = sessionRes.session?.user?.id;
      }
      if (!authorId) {
        throw new Error("Your session expired. Please sign in again before publishing.");
      }

      const draft = pingSchema.parse(d);
      const mediaUrls =
        d.media_urls && d.media_urls.length > 0
          ? d.media_urls
          : d.image_url?.trim()
            ? [d.image_url.trim()]
            : null;
      const imageUrl = mediaUrls?.[0] ?? null;
      const hashtags = extractHashtags(draft.content);
      const mentions = extractMentions(draft.content);
      const baseInsertPayload = {
        user_id: authorId,
        category: draft.category,
        content: draft.content,
        headline: d.headline?.trim() || null,
        needs: d.needs && d.needs.length > 0 ? d.needs : null,
        offers: d.offers && d.offers.length > 0 ? d.offers : null,
        desired_outcome: d.desired_outcome?.trim() || null,
        image_url: imageUrl,
        media_urls: mediaUrls,
        visibility: (d.hub_id ? "hub" : "public") as "public" | "hub",
        cta_url: draft.cta_url || null,
        cta_label: draft.cta_label || null,
      };
      const extendedInsertPayload = {
        ...baseInsertPayload,
        ...(d.scheduled_for ? { scheduled_for: d.scheduled_for } : {}),
        ...(hashtags.length > 0 ? { hashtags } : {}),
        ...(mentions.length > 0 ? { mentions } : {}),
        ...(d.content_format ? { content_format: d.content_format } : {}),
        ...(d.poster_url ? { poster_url: d.poster_url } : {}),
        ...(d.captions_text ? { captions_text: d.captions_text } : {}),
        ...(typeof d.media_duration_sec === "number"
          ? { media_duration_sec: d.media_duration_sec }
          : {}),
        ...(d.location_tag ? { location_tag: d.location_tag } : {}),
        ...(d.imported_source_url ? { imported_source_url: d.imported_source_url } : {}),
        ...(d.imported_source_platform
          ? { imported_source_platform: d.imported_source_platform }
          : {}),
      };

      let { data, error } = await (supabase as any)
        .from("pings")
        .insert(extendedInsertPayload)
        .select("id")
        .single();

      // Gracefully retry without Phase 2/3 columns if remote DB hasn't applied migrations 0029–0030 yet
      if (
        error &&
        (error.code === "PGRST204" ||
          error.code === "42703" ||
          String(error.message ?? "")
            .toLowerCase()
            .includes("column"))
      ) {
        const fallback = await supabase
          .from("pings")
          .insert(baseInsertPayload)
          .select("id")
          .single();
        data = fallback.data;
        error = fallback.error;
      }

      // Recover automatically if OAuth/signup triggered before public.profiles row finished syncing
      if (error && error.code === "23503") {
        const { error: profileErr } = await supabase.rpc("ensure_my_profile");
        const recovered = profileErr ? await ensureClientProfileRow(user) : true;
        if (recovered) {
          const retry = await supabase
            .from("pings")
            .insert(baseInsertPayload)
            .select("id")
            .single();
          data = retry.data;
          error = retry.error;
        }
      }

      if (error || !data) {
        throw error ?? new Error("Database did not return the published Ping ID.");
      }

      if (d.poll && d.poll.question && d.poll.options.length >= 2) {
        await createPingPoll({
          pingId: data.id,
          userId: authorId,
          question: d.poll.question,
          options: d.poll.options,
          expiresAt: d.poll.expires_at ?? null,
        }).catch(() => {});
      }

      if (d.music?.track) {
        await attachMusicToContent({
          userId: authorId,
          targetType: "ping",
          targetId: data.id,
          track: d.music.track,
          clipStartSec: d.music.clipStartSec,
          clipDurationSec: d.music.clipDurationSec,
        }).catch(() => {});
      }

      let hubShareError: string | null = null;
      if (d.hub_id) {
        const { error: hubError } = await supabase.rpc("share_ping_to_hub", {
          _hub: d.hub_id,
          _ping: data.id,
          ...(d.hub_intent ? { _intent: d.hub_intent } : {}),
        });
        if (hubError) {
          hubShareError = hubError.message;
        }
      }

      return { id: data.id, hubShareError, scheduled: Boolean(d.scheduled_for) };
    },
    onSuccess: ({ id, hubShareError, scheduled }) => {
      clearPingComposerDraft(initialHubId ? `hub:${initialHubId}` : "new");
      qc.invalidateQueries();
      if (hubShareError) {
        toast.warning(`Ping published, but sharing to the Hub failed: ${hubShareError}`);
      } else {
        toast.success(scheduled ? "Your Ping has been scheduled" : "Your Ping is live");
      }
      navigate({ to: "/p/$id", params: { id } });
    },
    onError: (err) => toast.error(describePublishError(err)),
  });

  const hasInitialPrefill = Boolean(initialHubId || initialQuote || importUrl);

  return (
    <div className="mx-auto max-w-2xl px-5 py-10 pb-24">
      <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
        Create a Ping
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Publish text, photo galleries, or video — with optional polls, music, scheduling, and links.
      </p>
      <div className="mt-6">
        <PingComposer
          initial={
            hasInitialPrefill
              ? {
                  ...(initialHubId ? { hub_id: initialHubId } : {}),
                  ...(initialQuote ? { content: `\n\n> ${initialQuote}` } : {}),
                  ...(importTitle ? { headline: importTitle } : {}),
                  ...(importUrl
                    ? {
                        cta_url: importUrl,
                        cta_label: importPlatform
                          ? `View on ${importPlatform}`
                          : "Open source link",
                        imported_source_url: importUrl,
                        imported_source_platform: importPlatform ?? "Web",
                      }
                    : {}),
                }
              : undefined
          }
          draftKey={
            initialQuote || importUrl ? undefined : initialHubId ? `hub:${initialHubId}` : "new"
          }
          submitLabel="Publish Ping"
          pending={m.isPending}
          onSubmit={(d) => m.mutate(d)}
        />
      </div>
    </div>
  );
}
