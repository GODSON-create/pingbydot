import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Camera,
  Check,
  Compass,
  Globe,
  Loader2,
  MapPin,
  Search,
  Sparkles,
  Upload,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { hubError, hubsQuery, myHubsQuery, myPendingHubsQuery } from "@/lib/hub-queries";
import { HUB_CATEGORIES, type Hub } from "@/lib/hubs";
import {
  ONBOARDING_COUNTRIES,
  ONBOARDING_INTERESTS,
  formatInterestLabel,
  recommendedHubCategoriesForInterests,
  type OnboardingInterestId,
} from "@/lib/pathways";
import type { Profile } from "@/lib/pings";
import { validateMediaUpload } from "@/lib/shield";
import { FounderAvatar } from "@/components/ping/Avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type UsernameCheckStatus = "idle" | "checking" | "available" | "taken" | "invalid" | "error";

export function IdentityStep({
  userId,
  displayName,
  username,
  country,
  avatarUrl,
  errors,
  usernameStatus,
  saving,
  onChangeDisplayName,
  onChangeUsername,
  onChangeCountry,
  onChangeAvatarUrl,
  onSubmit,
}: {
  userId: string;
  displayName: string;
  username: string;
  country: string;
  avatarUrl: string;
  errors: Record<string, string>;
  usernameStatus: UsernameCheckStatus;
  saving: boolean;
  onChangeDisplayName: (val: string) => void;
  onChangeUsername: (val: string) => void;
  onChangeCountry: (val: string) => void;
  onChangeAvatarUrl: (val: string) => void;
  onSubmit: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const uploadAvatarFile = async (file: File) => {
    const validation = validateMediaUpload(file, "image");
    if (!validation.valid) {
      toast.error(validation.error || "Select a valid image (PNG, JPG, WEBP, GIF).");
      return;
    }
    try {
      setUploadingAvatar(true);
      const { uploadUserMedia } = await import("@/lib/storage");
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${userId}/avatar/${Date.now()}.${ext}`;
      const publicUrl = await uploadUserMedia(path, file, { cacheControl: "3600", upsert: false });
      onChangeAvatarUrl(publicUrl);
      toast.success("Profile photo uploaded");
    } catch (err) {
      const { formatStorageUploadError } = await import("@/lib/storage");
      toast.error(formatStorageUploadError(err, "Could not upload profile photo."));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await uploadAvatarFile(file);
    e.target.value = "";
  };

  const handleAvatarButtonClick = async () => {
    const { pickOrCaptureImage } = await import("@/lib/native");
    await pickOrCaptureImage(fileInputRef.current, uploadAvatarFile);
  };

  const handleTakePhotoClick = async () => {
    const { takePhoto } = await import("@/lib/native");
    const file = await takePhoto();
    if (file) await uploadAvatarFile(file);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-5"
      noValidate
    >
      <div>
        <h2 className="font-display text-xl sm:text-2xl font-extrabold text-foreground">
          Set up your identity
        </h2>
        <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
          Choose how people recognize you on Ping. Adding a photo or country is optional.
        </p>
      </div>

      {/* Optional Profile Picture */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl border border-border/60 bg-secondary/35 p-4">
        <FounderAvatar
          name={displayName || username || "Ping Member"}
          src={avatarUrl || null}
          size="lg"
        />
        <div className="flex-1 min-w-0 space-y-2">
          <p className="text-xs font-semibold text-foreground">Profile picture (optional)</p>
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
              disabled={uploadingAvatar || saving}
              onClick={() => void handleAvatarButtonClick()}
              className="rounded-full text-xs gap-1.5 min-h-9"
            >
              {uploadingAvatar ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              {uploadingAvatar ? "Uploading…" : "Upload photo"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploadingAvatar || saving}
              onClick={() => void handleTakePhotoClick()}
              className="rounded-full text-xs gap-1.5 min-h-9"
            >
              <Camera className="size-3.5" /> Take photo
            </Button>
            {avatarUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChangeAvatarUrl("")}
                className="rounded-full text-xs text-muted-foreground min-h-9"
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
            onChange={(e) => onChangeDisplayName(e.target.value)}
            placeholder="Your name"
            maxLength={60}
            className="mt-1.5 h-11 rounded-xl"
          />
          {errors["display_name"] && (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {errors["display_name"]}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="onb-username">Username</Label>
          <div className="mt-1.5 flex h-11 items-center rounded-xl border border-input bg-card pl-3 focus-within:ring-2 focus-within:ring-ring">
            <span className="text-muted-foreground">@</span>
            <input
              id="onb-username"
              value={username}
              onChange={(e) => onChangeUsername(e.target.value.toLowerCase().replace(/\s+/g, ""))}
              placeholder="yourhandle"
              className="h-full w-full bg-transparent px-1.5 text-sm outline-none"
            />
          </div>
          {errors["username"] ? (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {errors["username"]}
            </p>
          ) : usernameStatus === "checking" ? (
            <p className="mt-1 text-xs text-muted-foreground">Checking availability…</p>
          ) : usernameStatus === "taken" ? (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {`@${username} is already taken. Try another.`}
            </p>
          ) : usernameStatus === "available" ? (
            <p className="mt-1 text-xs text-primary">{`@${username} is available`}</p>
          ) : usernameStatus === "error" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Couldn&apos;t check availability right now — we&apos;ll verify when you save.
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">3–24 letters, numbers, or _</p>
          )}
        </div>
      </div>

      <div>
        <Label htmlFor="onb-country" className="inline-flex items-center gap-1.5">
          <MapPin className="size-3.5 text-muted-foreground" />
          Country <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <select
          id="onb-country"
          value={country}
          onChange={(e) => onChangeCountry(e.target.value)}
          className="mt-1.5 h-11 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Select country (optional)</option>
          {ONBOARDING_COUNTRIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {errors["country"] && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {errors["country"]}
          </p>
        )}
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-2">
        <Button
          type="submit"
          variant="hero"
          size="lg"
          disabled={saving || uploadingAvatar || usernameStatus === "taken"}
          className="w-full sm:w-auto min-h-11 rounded-full gap-2 px-7"
        >
          {saving ? "Saving…" : "Save & continue"}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </form>
  );
}

export function InterestsStep({
  selectedInterests,
  saving,
  onToggleInterest,
  onBack,
  onSkipStep,
  onContinue,
}: {
  selectedInterests: OnboardingInterestId[];
  saving: boolean;
  onToggleInterest: (id: OnboardingInterestId) => void;
  onBack: () => void;
  onSkipStep: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl sm:text-2xl font-extrabold text-foreground">
          What are you interested in?
        </h2>
        <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
          Pick one or more topics to personalize feed and community recommendations, or skip for
          now.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {ONBOARDING_INTERESTS.map((interest) => {
          const active = selectedInterests.includes(interest.id);
          return (
            <button
              key={interest.id}
              type="button"
              aria-pressed={active}
              onClick={() => onToggleInterest(interest.id)}
              className={cn(
                "flex min-h-12 items-center justify-between gap-2 rounded-2xl border px-3.5 py-3 text-left text-xs sm:text-sm font-semibold transition-colors",
                active
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-border/80 bg-card text-foreground/90 hover:bg-secondary/60",
              )}
            >
              <span>{interest.label}</span>
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/35",
                )}
              >
                {active && <Check className="size-3" />}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2.5 pt-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            disabled={saving}
            className="min-h-11 rounded-full gap-1.5"
          >
            <ArrowLeft className="size-4" /> Back
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onSkipStep}
            disabled={saving}
            className="min-h-11 rounded-full text-xs text-muted-foreground"
          >
            Skip this step
          </Button>
        </div>

        <Button
          type="button"
          variant="hero"
          size="lg"
          disabled={saving}
          onClick={onContinue}
          className="w-full sm:w-auto min-h-11 rounded-full gap-2 px-7"
        >
          {saving ? "Saving…" : "Save & continue"}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function ConnectionsStep({
  userId,
  country,
  selectedInterests,
  onFollowedCountChange,
  onJoinedCountChange,
  onBack,
  onSkipStep,
  onContinue,
}: {
  userId: string;
  country: string;
  selectedInterests: OnboardingInterestId[];
  onFollowedCountChange: (count: number) => void;
  onJoinedCountChange: (count: number) => void;
  onBack: () => void;
  onSkipStep: () => void;
  onContinue: () => void;
}) {
  const qc = useQueryClient();
  const [filterText, setFilterText] = useState("");
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);
  const [joiningHubId, setJoiningHubId] = useState<string | null>(null);

  const {
    data: peopleData,
    isLoading: peopleLoading,
    isError: peopleError,
    refetch: refetchPeople,
  } = useQuery({
    queryKey: ["onboarding-suggested-people", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const [profilesRes, followsRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("*")
          .neq("id", userId)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase.from("follows").select("following_id").eq("follower_id", userId),
      ]);
      if (profilesRes.error) throw profilesRes.error;
      const followedIds = new Set((followsRes.data ?? []).map((r) => r.following_id));
      onFollowedCountChange(followedIds.size);
      return {
        profiles: (profilesRes.data ?? []) as unknown as Profile[],
        followedIds,
      };
    },
  });

  const {
    data: hubs = [],
    isLoading: hubsLoading,
    isError: hubsError,
    refetch: refetchHubs,
  } = useQuery(hubsQuery("", null, 0));
  const { data: myHubs = [] } = useQuery(myHubsQuery(userId));
  const { data: myPendingHubs = new Set<string>() } = useQuery(myPendingHubsQuery(userId));

  const myHubIds = useMemo(() => new Set(myHubs.map((m) => m.hub.id)), [myHubs]);

  useEffect(() => {
    onJoinedCountChange(myHubIds.size);
  }, [myHubIds.size, onJoinedCountChange]);

  const sortedPeople = useMemo(() => {
    const raw = peopleData?.profiles ?? [];
    const needle = filterText.trim().toLowerCase();
    const interestSet = new Set<string>(selectedInterests);
    const filtered = needle
      ? raw.filter(
          (p) =>
            p.display_name.toLowerCase().includes(needle) ||
            p.username.toLowerCase().includes(needle) ||
            (p.bio ?? "").toLowerCase().includes(needle),
        )
      : raw;

    return [...filtered].sort((a, b) => {
      const score = (p: Profile) => {
        let s = 0;
        if (country && p.country && p.country.toLowerCase() === country.toLowerCase()) s += 2;
        for (const item of p.interests ?? []) {
          if (interestSet.has(item)) s += 3;
        }
        return s;
      };
      return score(b) - score(a);
    });
  }, [peopleData?.profiles, filterText, selectedInterests, country]);

  const sortedCommunities = useMemo(() => {
    const preferredCats = recommendedHubCategoriesForInterests(selectedInterests);
    const needle = filterText.trim().toLowerCase();
    const filtered = needle
      ? hubs.filter(
          (h) =>
            h.name.toLowerCase().includes(needle) ||
            h.tagline.toLowerCase().includes(needle) ||
            h.category.toLowerCase().includes(needle),
        )
      : hubs;
    return [...filtered].sort((a, b) => {
      const aMatch = preferredCats.has(a.category) ? 1 : 0;
      const bMatch = preferredCats.has(b.category) ? 1 : 0;
      return bMatch - aMatch || b.member_count - a.member_count;
    });
  }, [hubs, selectedInterests, filterText]);

  const followedIds = peopleData?.followedIds ?? new Set<string>();

  const handleToggleFollow = async (target: Profile) => {
    const isFollowed = followedIds.has(target.id);
    setTogglingUserId(target.id);
    try {
      if (isFollowed) {
        const { error } = await supabase
          .from("follows")
          .delete()
          .eq("follower_id", userId)
          .eq("following_id", target.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("follows")
          .insert({ follower_id: userId, following_id: target.id });
        if (error && error.code !== "23505") throw error;
      }
      await qc.invalidateQueries({ queryKey: ["onboarding-suggested-people", userId] });
      toast.success(
        isFollowed ? `Unfollowed @${target.username}` : `Following @${target.username}`,
      );
    } catch {
      toast.error("Couldn't update connection. Check your connection and try again.");
    } finally {
      setTogglingUserId(null);
    }
  };

  const joinHubMutation = useMutation({
    mutationFn: async (hub: Hub) => {
      setJoiningHubId(hub.id);
      const { data, error } = await supabase.rpc("join_hub", { _hub: hub.id });
      if (error) throw error;
      return { hub, status: data };
    },
    onSuccess: ({ hub, status }) => {
      qc.invalidateQueries({ queryKey: ["my-hubs", userId] });
      qc.invalidateQueries({ queryKey: ["my-pending-hubs", userId] });
      qc.invalidateQueries({ queryKey: ["hubs"] });
      toast.success(
        status === "active" ? `Joined ${hub.name}` : `Join request sent to ${hub.name}`,
      );
    },
    onError: (err) => {
      toast.error(hubError(err, "Couldn't join community. Try again."));
    },
    onSettled: () => {
      setJoiningHubId(null);
    },
  });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl sm:text-2xl font-extrabold text-foreground">
          Discover people & communities
        </h2>
        <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
          Follow accounts and join communities that fit your interests — or skip and explore later.
        </p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Filter people or communities…"
          className="h-11 rounded-xl pl-10"
        />
      </div>

      {/* People to Follow */}
      <section aria-label="Suggested people" className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <Users className="size-3.5 text-primary" /> Suggested people ({followedIds.size}{" "}
            following)
          </h3>
        </div>

        {peopleLoading ? (
          <p className="text-xs text-muted-foreground py-3">Loading suggested accounts…</p>
        ) : peopleError ? (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-border p-3.5 text-xs">
            <span className="flex items-center gap-2 text-muted-foreground">
              <AlertCircle className="size-4 text-destructive shrink-0" /> Could not load suggested
              people right now.
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => refetchPeople()}>
              Retry
            </Button>
          </div>
        ) : sortedPeople.length === 0 ? (
          <p className="rounded-2xl border border-border/60 bg-secondary/30 p-4 text-xs text-muted-foreground">
            No matching profiles yet. You can discover more people in Explore anytime.
          </p>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {sortedPeople.slice(0, 6).map((person) => {
              const isFollowed = followedIds.has(person.id);
              const busy = togglingUserId === person.id;
              return (
                <div
                  key={person.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card p-3"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FounderAvatar
                      name={person.display_name || person.username}
                      src={person.avatar_url}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-foreground">
                        {person.display_name || person.username}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        @{person.username}
                        {person.country ? ` · ${person.country}` : ""}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={isFollowed ? "outline" : "hero"}
                    disabled={busy}
                    onClick={() => void handleToggleFollow(person)}
                    className="h-9 shrink-0 rounded-full px-3 text-xs gap-1"
                  >
                    {isFollowed ? (
                      <>
                        <UserCheck className="size-3.5" /> Following
                      </>
                    ) : (
                      <>
                        <UserPlus className="size-3.5" /> Follow
                      </>
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Communities */}
      <section aria-label="Suggested communities" className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <Building2 className="size-3.5 text-primary" /> Communities ({myHubIds.size} joined)
          </h3>
        </div>

        {hubsLoading ? (
          <p className="text-xs text-muted-foreground py-3">Loading communities…</p>
        ) : hubsError ? (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-border p-3.5 text-xs">
            <span className="flex items-center gap-2 text-muted-foreground">
              <AlertCircle className="size-4 text-destructive shrink-0" /> Could not load
              communities right now.
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => refetchHubs()}>
              Retry
            </Button>
          </div>
        ) : sortedCommunities.length === 0 ? (
          <p className="rounded-2xl border border-border/60 bg-secondary/30 p-4 text-xs text-muted-foreground">
            No public communities yet. You can create or discover Hubs once inside Ping.
          </p>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {sortedCommunities.slice(0, 4).map((hub) => {
              const joined = myHubIds.has(hub.id);
              const pendingReq = myPendingHubs.has(hub.id);
              const cat = HUB_CATEGORIES.find((c) => c.value === hub.category);
              return (
                <div
                  key={hub.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card p-3"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-lg">
                      {cat?.emoji ?? "🌍"}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-foreground">{hub.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {cat?.label ?? hub.category} · {hub.member_count} members
                      </p>
                    </div>
                  </div>
                  {joined ? (
                    <span className="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] font-semibold text-primary">
                      Joined
                    </span>
                  ) : pendingReq ? (
                    <span className="shrink-0 rounded-full border border-border bg-secondary px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
                      Pending
                    </span>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={joiningHubId === hub.id}
                      onClick={() => joinHubMutation.mutate(hub)}
                      className="h-9 shrink-0 rounded-full px-3 text-xs"
                    >
                      {hub.access === "private" ? "Request" : "Join"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2.5 pt-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            className="min-h-11 rounded-full gap-1.5"
          >
            <ArrowLeft className="size-4" /> Back
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onSkipStep}
            className="min-h-11 rounded-full text-xs text-muted-foreground"
          >
            Skip this step
          </Button>
        </div>

        <Button
          type="button"
          variant="hero"
          size="lg"
          onClick={onContinue}
          className="w-full sm:w-auto min-h-11 rounded-full gap-2 px-7"
        >
          Continue <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function EnterPingStep({
  displayName,
  username,
  country,
  avatarUrl,
  selectedInterests,
  followedCount,
  joinedHubsCount,
  saving,
  onBack,
  onFinish,
}: {
  displayName: string;
  username: string;
  country: string;
  avatarUrl: string;
  selectedInterests: OnboardingInterestId[];
  followedCount: number;
  joinedHubsCount: number;
  saving: boolean;
  onBack: () => void;
  onFinish: (destination: "/" | "/create" | "/explore") => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-3 py-1 text-[11px] font-bold text-primary">
          <Sparkles className="size-3" /> Ready for Ping
        </span>
        <h2 className="mt-2 font-display text-xl sm:text-2xl font-extrabold text-foreground">
          You&apos;re set up — enter Ping
        </h2>
        <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
          Head straight to the main feed with personalized picks, or start with a quick action
          below. You can edit any of these details in Settings anytime.
        </p>
      </div>

      {/* Profile Summary */}
      <div className="rounded-2xl border border-border/70 bg-secondary/35 p-4 space-y-3">
        <div className="flex items-center gap-3">
          <FounderAvatar name={displayName || username} src={avatarUrl || null} size="md" />
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-bold text-foreground">
              {displayName || username}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              @{username}
              {country ? ` · ${country}` : ""}
            </p>
          </div>
        </div>

        {selectedInterests.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Selected interests">
            {selectedInterests.map((id) => (
              <span
                key={id}
                className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-foreground"
              >
                {formatInterestLabel(id)}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Users className="size-3.5 text-primary" /> {followedCount} people followed
          </span>
          <span className="inline-flex items-center gap-1">
            <Globe className="size-3.5 text-primary" /> {joinedHubsCount} communities joined
          </span>
        </div>
      </div>

      {/* Clear First Actions */}
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={() => onFinish("/create")}
          className="min-h-11 rounded-2xl justify-start gap-2 px-4 text-xs font-semibold"
        >
          <Sparkles className="size-4 text-primary shrink-0" /> Write your first Ping
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={() => onFinish("/explore")}
          className="min-h-11 rounded-2xl justify-start gap-2 px-4 text-xs font-semibold"
        >
          <Compass className="size-4 text-primary shrink-0" /> Discover Explore directory
        </Button>
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2.5 pt-2">
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={onBack}
          className="min-h-11 rounded-full gap-1.5"
        >
          <ArrowLeft className="size-4" /> Back
        </Button>

        <Button
          type="button"
          variant="hero"
          size="lg"
          disabled={saving}
          onClick={() => onFinish("/")}
          className="w-full sm:w-auto min-h-11 rounded-full gap-2 px-8"
        >
          {saving ? "Entering Ping…" : "Enter Ping"}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
