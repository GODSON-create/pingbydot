import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate, type SearchSchemaInput } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { authDestination } from "@/lib/auth-return";
import { sanitizeErrorMessage } from "@/lib/error-diagnostics";
import {
  ONBOARDING_INTEREST_IDS,
  clearOnboardingDraft,
  loadOnboardingDraft,
  markWelcomeSeen,
  needsOnboarding,
  saveOnboardingDraft,
  type OnboardingInterestId,
  type OnboardingStepNumber,
  type ParticipationPathwayId,
} from "@/lib/pathways";
import { trackEvent, trackSessionRestoredOnce } from "@/lib/telemetry";
import { profileSchema, usernameSchema } from "@/lib/validation";
import { PingMark } from "@/components/BrandLogo";
import {
  ConnectionsStep,
  EnterPingStep,
  IdentityStep,
  InterestsStep,
  type UsernameCheckStatus,
} from "@/components/onboarding/OnboardingSteps";
import { Button } from "@/components/ui/button";
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
      { title: "Welcome to Ping — Quick Setup" },
    ],
  }),
  component: OnboardingPage,
});

const STEP_LABELS: Record<OnboardingStepNumber, string> = {
  1: "Identity",
  2: "Interests",
  3: "Connections",
  4: "Enter Ping",
};

function OnboardingPage() {
  const { user, ready, profile, profileLoading, refreshProfile } = useAuth();
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [step, setStep] = useState<OnboardingStepNumber>(1);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [country, setCountry] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [selectedInterests, setSelectedInterests] = useState<OnboardingInterestId[]>([]);
  const [selectedPathways] = useState<ParticipationPathwayId[]>([]);
  const [followedCount, setFollowedCount] = useState(0);
  const [joinedHubsCount, setJoinedHubsCount] = useState(0);

  const [errs, setErrs] = useState<Record<string, string>>({});
  const [usernameStatus, setUsernameStatus] = useState<UsernameCheckStatus>("idle");
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);
  const [saving, setSaving] = useState(false);
  const [skipping, setSkipping] = useState(false);

  const hydratedUserRef = useRef<string | null>(null);

  // Returning users who already finished onboarding must never repeat it
  useEffect(() => {
    if (!ready || !user || profileLoading) return;
    markWelcomeSeen();
    if (profile && !needsOnboarding(profile)) {
      clearOnboardingDraft(user.id);
      trackSessionRestoredOnce(false);
      navigate({ to: next, replace: true });
    }
  }, [ready, user, profile, profileLoading, next, navigate]);

  // Hydrate once per user from saved profile + local draft so refreshes never lose progress
  useEffect(() => {
    if (!user || hydratedUserRef.current === user.id) return;
    if (profileLoading) return;

    hydratedUserRef.current = user.id;
    const draft = loadOnboardingDraft(user.id);
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const metaName =
      typeof meta["display_name"] === "string"
        ? meta["display_name"]
        : typeof meta["full_name"] === "string"
          ? meta["full_name"]
          : typeof meta["name"] === "string"
            ? meta["name"]
            : "";

    const initialName = draft?.displayName ?? profile?.display_name ?? metaName ?? "";
    const initialUsername = draft?.username ?? profile?.username ?? "";
    const initialCountry = draft?.country ?? profile?.country ?? "";
    const initialBio = draft?.bio ?? profile?.bio ?? "";
    const initialAvatar =
      draft?.avatarUrl ??
      profile?.avatar_url ??
      (typeof meta["avatar_url"] === "string" ? meta["avatar_url"] : "") ??
      "";
    const rawInterests = draft?.interests ?? profile?.interests ?? [];
    const validInterests = rawInterests.filter((id): id is OnboardingInterestId =>
      ONBOARDING_INTEREST_IDS.includes(id as OnboardingInterestId),
    );

    setDisplayName(initialName);
    setUsername(initialUsername);
    setCountry(initialCountry);
    setBio(initialBio);
    setAvatarUrl(initialAvatar);
    setSelectedInterests(validInterests);

    if (draft?.step && draft.step >= 1 && draft.step <= 4) {
      setStep(draft.step);
    }
  }, [user, profile, profileLoading]);

  // Persist local draft automatically so refreshing mid-flow preserves state reliably
  useEffect(() => {
    if (!user || hydratedUserRef.current !== user.id) return;
    saveOnboardingDraft(user.id, {
      step,
      displayName,
      username,
      country,
      avatarUrl,
      bio,
      interests: selectedInterests,
      pathways: selectedPathways,
    });
  }, [
    user,
    step,
    displayName,
    username,
    country,
    avatarUrl,
    bio,
    selectedInterests,
    selectedPathways,
  ]);

  // Live debounced username validation & availability check
  useEffect(() => {
    if (!user || step !== 1) return;
    const clean = username.trim().toLowerCase();
    if (!clean) {
      setUsernameStatus("idle");
      return;
    }
    const parsed = usernameSchema.safeParse(clean);
    if (!parsed.success) {
      setUsernameStatus("invalid");
      return;
    }
    if (profile?.username && profile.username.toLowerCase() === parsed.data) {
      setUsernameStatus("available");
      return;
    }

    let cancelled = false;
    setUsernameStatus("checking");
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id")
          .eq("username", parsed.data)
          .neq("id", user.id)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          setUsernameStatus("error");
          return;
        }
        setUsernameStatus(data ? "taken" : "available");
      } catch {
        if (!cancelled) setUsernameStatus("error");
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [user, step, username, profile?.username]);

  const toggleInterest = (id: OnboardingInterestId) => {
    setSelectedInterests((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const persistOnboarding = async ({
    skip,
    markComplete,
    nextStep,
    destination,
  }: {
    skip: boolean;
    markComplete: boolean;
    nextStep?: OnboardingStepNumber;
    destination?: "/" | "/create" | "/explore";
  }) => {
    if (!user) return;
    setErrs({});
    setNetworkError(null);
    setRetryAction(null);

    if (!skip) {
      const normalizedUsername = (username || profile?.username || "").trim().toLowerCase();
      const parsed = profileSchema.safeParse({
        username: normalizedUsername,
        display_name: displayName || profile?.display_name || "",
        bio,
        country,
        avatar_url: avatarUrl,
        interests: selectedInterests,
        participation_pathways: selectedPathways,
      });
      if (!parsed.success) {
        const nextErrs: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          nextErrs[String(issue.path[0])] ??= issue.message;
        }
        setErrs(nextErrs);
        if (nextErrs["display_name"] || nextErrs["username"] || nextErrs["country"]) {
          setStep(1);
        }
        return;
      }
    }

    if (skip) setSkipping(true);
    else setSaving(true);

    const runAction = () =>
      void persistOnboarding({
        skip,
        markComplete,
        ...(nextStep ? { nextStep } : {}),
        ...(destination ? { destination } : {}),
      });

    try {
      const cleanName = displayName.trim() || profile?.display_name || "Member";
      const cleanUsername = (username.trim() || profile?.username || "").toLowerCase();

      if (!skip && cleanUsername && cleanUsername !== profile?.username) {
        const { data: conflict, error: conflictErr } = await supabase
          .from("profiles")
          .select("id")
          .eq("username", cleanUsername)
          .neq("id", user.id)
          .maybeSingle();
        if (conflictErr) throw conflictErr;
        if (conflict) {
          setStep(1);
          setUsernameStatus("taken");
          setErrs({ username: "That username is already taken. Choose another." });
          return;
        }
      }

      const { error } = await supabase.rpc("complete_my_onboarding", {
        _display_name: skip ? null : cleanName,
        _username: skip ? null : cleanUsername || null,
        _bio: skip ? null : bio.trim(),
        _avatar_url: skip ? null : avatarUrl.trim() || null,
        _participation_pathways: skip ? null : selectedPathways,
        _skip: skip,
        _country: skip ? null : country.trim(),
        _interests: skip ? null : selectedInterests,
        _mark_complete: markComplete,
      });

      if (error) {
        const msg = (error.message ?? "").toLowerCase();
        const isMissingOrLegacyRpc =
          error.code === "PGRST202" ||
          error.code === "42883" ||
          msg.includes("does not exist") ||
          msg.includes("could not find the function");

        if (!isMissingOrLegacyRpc) {
          if (error.code === "23505") {
            setStep(1);
            setUsernameStatus("taken");
            setErrs({ username: "That username is already taken. Choose another." });
            return;
          }
          throw error;
        }

        // Backward-compatible fallback if migration 0024/0023 has not executed yet remotely
        if (!skip) {
          const basePayload = {
            display_name: cleanName,
            username: cleanUsername,
            bio: bio.trim(),
            avatar_url: avatarUrl.trim() || null,
          };
          const extendedPayload = {
            ...basePayload,
            ...(profile && "country" in profile ? { country: country.trim() } : {}),
            ...(profile && "interests" in profile ? { interests: selectedInterests } : {}),
            ...(markComplete && profile && "onboarding_completed_at" in profile
              ? { onboarding_completed_at: new Date().toISOString() }
              : {}),
          };
          const { error: writeErr } = profile
            ? await supabase.from("profiles").update(extendedPayload).eq("id", user.id)
            : await supabase
                .from("profiles")
                .upsert({ id: user.id, ...basePayload }, { onConflict: "id" });
          if (writeErr) {
            if (writeErr.code === "23505") {
              setStep(1);
              setUsernameStatus("taken");
              setErrs({ username: "That username is already taken. Choose another." });
              return;
            }
            throw writeErr;
          }
        }
      }

      if (markComplete || skip) {
        markWelcomeSeen();
        clearOnboardingDraft(user.id);
        trackEvent(skip ? "onboarding_skipped" : "onboarding_completed", {
          interest_count: selectedInterests.length,
          interests: selectedInterests.join(",") || "none",
          has_country: Boolean(country.trim()),
        });
        await qc.invalidateQueries({ queryKey: ["my-profile", user.id] });
        refreshProfile();
        toast.success(
          skip ? "You're all set — welcome to Ping!" : "Profile saved — welcome to Ping!",
        );
        const targetRoute = destination ?? (next !== "/" ? next : "/");
        navigate({ to: targetRoute as any, replace: true });
      } else if (nextStep) {
        trackEvent("onboarding_step_saved", { step });
        await qc.invalidateQueries({ queryKey: ["my-profile", user.id] });
        setStep(nextStep);
      }
    } catch (err) {
      const safeMsg = sanitizeErrorMessage(err);
      setNetworkError(
        safeMsg.includes("fetch") || safeMsg.includes("network")
          ? "Network interruption while saving your progress. Your edits are kept safe locally — retry when ready."
          : safeMsg,
      );
      setRetryAction(() => runAction);
    } finally {
      setSaving(false);
      setSkipping(false);
    }
  };

  if (profileLoading) {
    return (
      <div className="mx-auto max-w-xl px-5 py-20 text-center text-sm text-muted-foreground">
        Preparing your Ping setup…
      </div>
    );
  }

  return (
    <div className="bg-hero min-h-[calc(100dvh-5rem)] px-3.5 sm:px-6 py-5 pb-28 sm:py-10">
      <div className="mx-auto max-w-2xl">
        <div className="surface-card rounded-[2rem] border border-border/80 bg-card p-5 sm:p-8 shadow-lift">
          {/* Card Header + Skip Escape */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <PingMark variant="lime" size="md" alt="Ping by DOT" />
              <div>
                <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-primary">
                  <Sparkles className="size-3" /> Step {step} of 4 · {STEP_LABELS[step]}
                </span>
                <h1 className="font-display text-lg sm:text-xl font-extrabold tracking-tight text-foreground">
                  Quick setup for Ping
                </h1>
              </div>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving || skipping}
              onClick={() =>
                void persistOnboarding({ skip: true, markComplete: true, destination: "/" })
              }
              className="rounded-full text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              {skipping ? "Skipping…" : "Skip for now"}
            </Button>
          </div>

          {/* 4-Step Progress Bar */}
          <div
            className="mt-4 grid grid-cols-4 gap-1.5"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={4}
            aria-valuenow={step}
            aria-label="Onboarding progress"
          >
            {([1, 2, 3, 4] as const).map((s) => (
              <div
                key={s}
                className={cn(
                  "h-1.5 rounded-full transition-colors",
                  s <= step ? "bg-primary" : "bg-secondary",
                )}
              />
            ))}
          </div>

          {/* Reliable Network Recovery Banner */}
          {networkError && (
            <div
              role="alert"
              className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-3.5 text-xs text-destructive"
            >
              <span className="flex items-start gap-2">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <span>{networkError}</span>
              </span>
              {retryAction && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={retryAction}
                  className="shrink-0 rounded-full text-xs gap-1 border-destructive/40 text-foreground"
                >
                  <RefreshCw className="size-3" /> Retry save
                </Button>
              )}
            </div>
          )}

          {/* Active Step Body */}
          <div className="mt-6">
            {step === 1 && user && (
              <IdentityStep
                userId={user.id}
                displayName={displayName}
                username={username}
                country={country}
                avatarUrl={avatarUrl}
                errors={errs}
                usernameStatus={usernameStatus}
                saving={saving}
                onChangeDisplayName={(val) => {
                  setDisplayName(val);
                  setNetworkError(null);
                  setErrs((prev) => ({ ...prev, display_name: "" }));
                }}
                onChangeUsername={(val) => {
                  setUsername(val);
                  setNetworkError(null);
                  setErrs((prev) => ({ ...prev, username: "" }));
                }}
                onChangeCountry={(val) => {
                  setCountry(val);
                  setNetworkError(null);
                  setErrs((prev) => ({ ...prev, country: "" }));
                }}
                onChangeAvatarUrl={setAvatarUrl}
                onSubmit={() =>
                  void persistOnboarding({ skip: false, markComplete: false, nextStep: 2 })
                }
              />
            )}

            {step === 2 && (
              <InterestsStep
                selectedInterests={selectedInterests}
                saving={saving}
                onToggleInterest={toggleInterest}
                onBack={() => setStep(1)}
                onSkipStep={() => setStep(3)}
                onContinue={() =>
                  void persistOnboarding({ skip: false, markComplete: false, nextStep: 3 })
                }
              />
            )}

            {step === 3 && user && (
              <ConnectionsStep
                userId={user.id}
                country={country}
                selectedInterests={selectedInterests}
                onFollowedCountChange={setFollowedCount}
                onJoinedCountChange={setJoinedHubsCount}
                onBack={() => setStep(2)}
                onSkipStep={() => setStep(4)}
                onContinue={() => setStep(4)}
              />
            )}

            {step === 4 && (
              <EnterPingStep
                displayName={displayName}
                username={username}
                country={country}
                avatarUrl={avatarUrl}
                selectedInterests={selectedInterests}
                followedCount={followedCount}
                joinedHubsCount={joinedHubsCount}
                saving={saving}
                onBack={() => setStep(3)}
                onFinish={(destination) =>
                  void persistOnboarding({
                    skip: false,
                    markComplete: true,
                    destination,
                  })
                }
              />
            )}
          </div>

          <div className="mt-6 flex items-start gap-2.5 rounded-2xl border border-border/60 bg-secondary/35 px-4 py-3 text-[11px] text-muted-foreground">
            <ShieldCheck className="size-4 text-primary shrink-0 mt-0.5" />
            <span>
              Ordinary access to feeds, Pings, Moments, Hubs, and Signal chats is free. Verification
              or upgrades are always optional.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
