import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate, type SearchSchemaInput } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Loader2, ShieldCheck, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { authDestination } from "@/lib/auth-return";
import { sanitizeErrorMessage } from "@/lib/error-diagnostics";
import {
  PARTICIPATION_PATHWAYS,
  markWelcomeSeen,
  needsOnboarding,
  type ParticipationPathwayId,
} from "@/lib/pathways";
import { validateMediaUpload } from "@/lib/shield";
import { profileSchema } from "@/lib/validation";
import { PingMark } from "@/components/BrandLogo";
import { FounderAvatar } from "@/components/ping/Avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/onboarding")({
  staticData: { sitemap: false },
  validateSearch: (search: SearchSchemaInput & { next?: unknown }) => ({
    next:
      typeof search.next === "string" && search.next.trim() ? authDestination(search.next) : "/",
  }),
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Welcome to Ping — Set up your profile" },
    ],
  }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const { user, ready, profile, profileLoading, refreshProfile } = useAuth();
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [selectedPathways, setSelectedPathways] = useState<ParticipationPathwayId[]>([]);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Returning or already-onboarded users never get held at onboarding
  useEffect(() => {
    if (!ready || !user || profileLoading) return;
    markWelcomeSeen();
    if (profile && !needsOnboarding(profile)) {
      navigate({ to: next, replace: true });
    }
  }, [ready, user, profile, profileLoading, next, navigate]);

  useEffect(() => {
    if (!user && !profile) return;
    const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
    const metaName =
      typeof meta["display_name"] === "string"
        ? meta["display_name"]
        : typeof meta["full_name"] === "string"
          ? meta["full_name"]
          : typeof meta["name"] === "string"
            ? meta["name"]
            : "";
    setDisplayName((prev) => prev || profile?.display_name || metaName || "");
    setUsername((prev) => prev || profile?.username || "");
    setBio((prev) => prev || profile?.bio || "");
    setAvatarUrl(
      (prev) =>
        prev ||
        profile?.avatar_url ||
        (typeof meta["avatar_url"] === "string" ? meta["avatar_url"] : "") ||
        "",
    );
    if (profile?.participation_pathways && selectedPathways.length === 0) {
      setSelectedPathways(
        profile.participation_pathways.filter((id): id is ParticipationPathwayId =>
          PARTICIPATION_PATHWAYS.some((p) => p.id === id),
        ),
      );
    }
  }, [user, profile, selectedPathways.length]);

  const togglePathway = (id: ParticipationPathwayId) => {
    setSelectedPathways((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    const validation = validateMediaUpload(file, "image");
    if (!validation.valid) {
      toast.error(validation.error || "Select a valid image (PNG, JPG, WEBP, GIF).");
      e.target.value = "";
      return;
    }
    try {
      setUploadingAvatar(true);
      const { uploadUserMedia } = await import("@/lib/storage");
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${user.id}/avatar/${Date.now()}.${ext}`;
      const publicUrl = await uploadUserMedia(path, file, { cacheControl: "3600", upsert: false });
      setAvatarUrl(publicUrl);
      toast.success("Profile photo uploaded");
    } catch (err) {
      const { formatStorageUploadError } = await import("@/lib/storage");
      toast.error(formatStorageUploadError(err, "Could not upload profile photo."));
    } finally {
      setUploadingAvatar(false);
      e.target.value = "";
    }
  };

  const finishOnboarding = async (skip: boolean) => {
    if (!user) return;
    setErrs({});

    if (!skip) {
      const parsed = profileSchema.safeParse({
        username: username || profile?.username || "",
        display_name: displayName || profile?.display_name || "Member",
        bio,
        avatar_url: avatarUrl,
        participation_pathways: selectedPathways,
      });
      if (!parsed.success) {
        const nextErrs: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          nextErrs[String(issue.path[0])] ??= issue.message;
        }
        setErrs(nextErrs);
        return;
      }
    }

    if (skip) setSkipping(true);
    else setSaving(true);

    try {
      const { error } = await supabase.rpc("complete_my_onboarding", {
        _display_name: skip ? null : displayName.trim() || null,
        _username: skip ? null : username.trim().toLowerCase() || null,
        _bio: skip ? null : bio.trim(),
        _avatar_url: skip ? null : avatarUrl.trim() || null,
        _participation_pathways: skip ? null : selectedPathways,
        _skip: skip,
      });

      if (error) {
        const isMissingRpc =
          error.code === "PGRST202" ||
          error.code === "42883" ||
          error.message?.toLowerCase().includes("does not exist");

        if (!isMissingRpc) {
          if (error.code === "23505") {
            setErrs({ username: "That username is already taken. Try another." });
            return;
          }
          throw error;
        }

        // Fallback if migration 0023 has not yet executed on remote environment
        if (!skip) {
          const { error: updateErr } = await supabase
            .from("profiles")
            .update({
              display_name: displayName.trim() || profile?.display_name || "Member",
              username: (username.trim() || profile?.username || "").toLowerCase(),
              bio: bio.trim(),
              avatar_url: avatarUrl.trim() || null,
            })
            .eq("id", user.id);
          if (updateErr) {
            if (updateErr.code === "23505") {
              setErrs({ username: "That username is already taken. Try another." });
              return;
            }
            throw updateErr;
          }
        }
      }

      markWelcomeSeen();
      await qc.invalidateQueries({ queryKey: ["my-profile", user.id] });
      refreshProfile();
      toast.success(
        skip ? "You're all set — welcome to Ping!" : "Profile saved — welcome to Ping!",
      );
      navigate({ to: next, replace: true });
    } catch (err) {
      toast.error(sanitizeErrorMessage(err));
    } finally {
      setSaving(false);
      setSkipping(false);
    }
  };

  if (profileLoading) {
    return (
      <div className="mx-auto max-w-xl px-5 py-20 text-center text-sm text-muted-foreground">
        Preparing your Ping profile…
      </div>
    );
  }

  return (
    <div className="bg-hero min-h-[calc(100dvh-5rem)] px-4 sm:px-6 py-10 pb-24">
      <div className="mx-auto max-w-2xl">
        <div className="surface-card rounded-[2rem] border border-border/80 bg-card p-6 sm:p-9 shadow-lift">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <PingMark variant="lime" size="lg" alt="Ping by DOT" />
              <div>
                <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-primary">
                  <Sparkles className="size-3" /> Quick setup
                </span>
                <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                  Make Ping yours
                </h1>
              </div>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving || skipping}
              onClick={() => void finishOnboarding(true)}
              className="rounded-full text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              {skipping ? "Skipping…" : "Skip for now"}
            </Button>
          </div>

          <p className="mt-2 text-sm text-muted-foreground">
            Confirm how you appear on Ping. Every field below can be updated later — and
            verification or upgrades are always optional.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void finishOnboarding(false);
            }}
            className="mt-6 space-y-6"
            noValidate
          >
            {/* Avatar + Basic Identity */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl border border-border/60 bg-secondary/35 p-4">
              <FounderAvatar
                name={displayName || username || "Ping Member"}
                src={avatarUrl || null}
                size="lg"
              />
              <div className="flex-1 min-w-0 space-y-2">
                <p className="text-xs font-semibold text-foreground">Profile photo (optional)</p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={handleAvatarUpload}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploadingAvatar}
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-full text-xs gap-1.5"
                  >
                    {uploadingAvatar ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Upload className="size-3.5" />
                    )}
                    {uploadingAvatar ? "Uploading…" : "Upload photo"}
                  </Button>
                  {avatarUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setAvatarUrl("")}
                      className="rounded-full text-xs text-muted-foreground"
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="onb-name">Display name</Label>
                <Input
                  id="onb-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name or handle"
                  maxLength={60}
                  className="mt-1.5 rounded-xl"
                />
                {errs["display_name"] && (
                  <p className="mt-1 text-xs text-destructive">{errs["display_name"]}</p>
                )}
              </div>

              <div>
                <Label htmlFor="onb-username">Username</Label>
                <div className="mt-1.5 flex items-center rounded-xl border border-input bg-card pl-3 focus-within:ring-2 focus-within:ring-ring">
                  <span className="text-muted-foreground">@</span>
                  <input
                    id="onb-username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase())}
                    placeholder="yourhandle"
                    className="h-9 w-full bg-transparent px-1 text-sm outline-none"
                  />
                </div>
                {errs["username"] && (
                  <p className="mt-1 text-xs text-destructive">{errs["username"]}</p>
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="onb-bio">
                Short bio <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="onb-bio"
                rows={2}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={280}
                placeholder="Say a little about yourself, what you enjoy, or what you're up to…"
                className="mt-1.5 rounded-xl resize-none"
              />
              {errs["bio"] && <p className="mt-1 text-xs text-destructive">{errs["bio"]}</p>}
            </div>

            {/* Optional Participation Pathways */}
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-sm font-semibold">
                  How do you plan to participate?{" "}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                {selectedPathways.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedPathways([])}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    Clear selection
                  </button>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Pick any combination that fits you — or select none at all. Ping never locks
                features behind a role choice.
              </p>

              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                {PARTICIPATION_PATHWAYS.map((pathway) => {
                  const selected = selectedPathways.includes(pathway.id);
                  return (
                    <button
                      key={pathway.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => togglePathway(pathway.id)}
                      className={cn(
                        "flex items-start gap-2.5 rounded-2xl border p-3.5 text-left transition-colors",
                        selected
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border/80 bg-card hover:bg-secondary/60",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
                          selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/40",
                        )}
                      >
                        {selected && <Check className="size-3" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-bold text-foreground">
                          {pathway.label}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                          {pathway.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-start gap-2.5 rounded-2xl border border-border/60 bg-secondary/40 px-4 py-3 text-xs text-muted-foreground">
              <ShieldCheck className="size-4 text-primary shrink-0 mt-0.5" />
              <span>
                Ordinary access to feeds, Pings, Moments, Hubs, and Signal DMs is free. Profile or
                channel verification and DOT subscriptions remain 100% optional.
              </span>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={saving || skipping}
                onClick={() => void finishOnboarding(true)}
                className="rounded-full"
              >
                {skipping ? "Entering Ping…" : "Skip & enter Ping"}
              </Button>
              <Button
                type="submit"
                variant="hero"
                size="lg"
                disabled={saving || skipping}
                className="rounded-full gap-2 px-7"
              >
                {saving ? "Saving…" : "Continue to Ping"}
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
