import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { profileSchema, type ProfileVisibility } from "@/lib/validation";
import {
  buildAccountDataExport,
  mutedUsersQuery,
  triggerAccountExportDownload,
  useUnmuteUser,
} from "@/lib/mutes";
import {
  ONBOARDING_COUNTRIES,
  ONBOARDING_INTERESTS,
  PARTICIPATION_PATHWAYS,
  type OnboardingInterestId,
  type ParticipationPathwayId,
} from "@/lib/pathways";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FounderAvatar } from "@/components/ping/Avatar";
import { ImageUploadField } from "@/components/media/ImageUploadField";
import { useSignOut } from "@/components/layout/SiteHeader";
import { ConnectionsEditor } from "@/components/connections/ConnectionsEditor";
import { PingActivityPrivacy } from "@/components/settings/PingActivityPrivacy";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { CloseCircleDialog } from "@/components/moments/CloseCircleDialog";
import { blockedUsersQuery, useUnblockUser } from "@/lib/messages";
import { dotSummaryQuery } from "@/lib/economy";
import { closeCircleQuery } from "@/lib/moments";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Bell,
  Download,
  Globe,
  ShieldAlert,
  FileText,
  Shield,
  Trash2,
  Coins,
  BarChart3,
  Crown,
  Users,
  ShieldBan,
  VolumeX,
} from "lucide-react";
import { enablePushNotifications, getNativePushState, isNative } from "@/lib/native";

export const Route = createFileRoute("/_authenticated/settings")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "Settings — Ping" },
      { name: "description", content: "Edit your Ping profile and account." },
      { property: "og:title", content: "Settings — Ping" },
      { property: "og:description", content: "Manage your Ping profile." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Settings,
});

function MobilePushNotificationsCard() {
  const [pushState, setPushState] = useState<"granted" | "denied" | "prompt" | "web">("web");
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    void getNativePushState().then(setPushState);
  }, []);

  if (!isNative && pushState === "web") return null;

  return (
    <div className="surface-card mt-6 rounded-3xl p-6 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-sm font-bold flex items-center gap-2">
            <Bell className="size-4 text-primary" /> Mobile Push Notifications
          </p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            {pushState === "granted"
              ? "Push notifications are enabled on this device."
              : pushState === "denied"
                ? "Notifications are disabled in system Settings. Enable them in your phone Settings to receive alerts."
                : "Get notified about direct messages, replies, and mentions only after you opt in."}
          </p>
        </div>
        {pushState !== "granted" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={enabling || pushState === "denied"}
            onClick={async () => {
              setEnabling(true);
              try {
                const res = await enablePushNotifications();
                if (res.status === "granted") {
                  setPushState("granted");
                  toast.success("Push notifications enabled.");
                } else if (res.status === "denied") {
                  setPushState("denied");
                  toast.error("Push notifications permission was declined.");
                } else {
                  toast.error(res.reason);
                }
              } finally {
                setEnabling(false);
              }
            }}
            className="rounded-xl shrink-0"
          >
            {enabling ? "Enabling…" : "Enable"}
          </Button>
        )}
      </div>
    </div>
  );
}

function Settings() {
  const { user, profile, refreshProfile } = useAuth();
  const signOut = useSignOut();
  const [f, setF] = useState({
    username: "",
    display_name: "",
    bio: "",
    location: "",
    country: "",
    website_url: "",
    profile_visibility: "public" as ProfileVisibility,
    avatar_url: "",
    interests: [] as OnboardingInterestId[],
    participation_pathways: [] as ParticipationPathwayId[],
  });
  const [errs, setErrs] = useState<
    Partial<
      Record<
        "username" | "display_name" | "bio" | "location" | "country" | "website_url" | "avatar_url",
        string
      >
    >
  >({});
  const [saving, setSaving] = useState(false);

  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isExportingData, setIsExportingData] = useState(false);
  const [closeCircleOpen, setCloseCircleOpen] = useState(false);
  const { data: dotSummary } = useQuery(dotSummaryQuery(user?.id));
  const { data: closeCircleMembers = [] } = useQuery(closeCircleQuery(user?.id));
  const { data: blockedUsers = [] } = useQuery(blockedUsersQuery(user?.id));
  const { data: mutedUsers = [] } = useQuery(mutedUsersQuery(user?.id));
  const unblockUser = useUnblockUser();
  const unmuteUser = useUnmuteUser();

  const handleExportData = async () => {
    if (!user) return;
    try {
      setIsExportingData(true);
      const bundle = await buildAccountDataExport(user.id);
      triggerAccountExportDownload(bundle);
      toast.success("Your account data export has been downloaded.");
    } catch (err: any) {
      toast.error(err?.message || "Couldn't export your account data. Please try again.");
    } finally {
      setIsExportingData(false);
    }
  };

  const handleDeleteAccount = async () => {
    try {
      setIsDeletingAccount(true);
      const { error } = await supabase.rpc("delete_user_account");
      if (error) throw error;
      toast.success("Your account and data have been permanently deleted.");
      signOut();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete account. Please try again.");
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const [pw, setPw] = useState({ current: "", next: "" });

  useEffect(() => {
    if (profile)
      setF({
        username: profile.username,
        display_name: profile.display_name,
        bio: profile.bio,
        location: profile.location ?? "",
        country: profile.country ?? "",
        website_url: profile.website_url ?? "",
        profile_visibility: (profile.profile_visibility ?? "public") as ProfileVisibility,
        avatar_url: profile.avatar_url ?? "",
        interests: (profile.interests ?? []).filter((id): id is OnboardingInterestId =>
          ONBOARDING_INTERESTS.some((i) => i.id === id),
        ),
        participation_pathways: (profile.participation_pathways ?? []).filter(
          (id): id is ParticipationPathwayId => PARTICIPATION_PATHWAYS.some((p) => p.id === id),
        ),
      });
  }, [profile]);

  const toggleInterest = (id: OnboardingInterestId) => {
    setF((prev) => ({
      ...prev,
      interests: prev.interests.includes(id)
        ? prev.interests.filter((item) => item !== id)
        : [...prev.interests, id],
    }));
  };

  const togglePathway = (id: ParticipationPathwayId) => {
    setF((prev) => ({
      ...prev,
      participation_pathways: prev.participation_pathways.includes(id)
        ? prev.participation_pathways.filter((p) => p !== id)
        : [...prev.participation_pathways, id],
    }));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = profileSchema.safeParse(f);
    if (!r.success) {
      const x: Record<string, string> = {};
      r.error.issues.forEach((i) => (x[String(i.path[0])] ??= i.message));
      return setErrs(x);
    }
    setErrs({});
    if (!user) {
      toast.error("Please log in again before saving.");
      return;
    }
    setSaving(true);
    try {
      const baseUpdate = {
        username: r.data.username,
        display_name: r.data.display_name,
        bio: r.data.bio,
        avatar_url: r.data.avatar_url || null,
      };
      const supportsPathways = Boolean(profile && "participation_pathways" in profile);
      const supportsCountry = Boolean(profile && "country" in profile);
      const supportsInterests = Boolean(profile && "interests" in profile);
      const supportsLocation = Boolean(profile && "location" in profile);
      const supportsWebsite = Boolean(profile && "website_url" in profile);
      const supportsVisibility = Boolean(profile && "profile_visibility" in profile);
      const { error } = await supabase
        .from("profiles")
        .update({
          ...baseUpdate,
          ...(supportsPathways ? { participation_pathways: f.participation_pathways } : {}),
          ...(supportsCountry ? { country: f.country.trim() } : {}),
          ...(supportsInterests ? { interests: f.interests } : {}),
          ...(supportsLocation ? { location: f.location.trim() } : {}),
          ...(supportsWebsite ? { website_url: r.data.website_url || null } : {}),
          ...(supportsVisibility ? { profile_visibility: r.data.profile_visibility } : {}),
        } as any)
        .eq("id", user.id)
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505") return setErrs({ username: "That username is taken." });
        return toast.error("Couldn't save your profile.");
      }
      toast.success("Profile saved");
      refreshProfile();
    } catch {
      toast.error("Couldn't connect. Please try saving again.");
    } finally {
      setSaving(false);
    }
  };

  const changePw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.next.length < 8) {
      toast.error("Use at least 8 characters.");
      return;
    }
    const { error } = await supabase.auth.updateUser({
      password: pw.next,
      current_password: pw.current,
    } as never);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPw({ current: "", next: "" });
    toast.success("Password changed");
  };

  if (!profile)
    return (
      <div className="mx-auto max-w-2xl px-5 py-16 text-muted-foreground">
        Loading your profile…
      </div>
    );

  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="font-display text-4xl font-extrabold">Settings</h1>

      {/* Builder Tools & Account Shortcuts */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link
          to="/balance"
          className="surface-card rounded-2xl p-4 transition-transform hover:-translate-y-0.5 hover:border-primary"
        >
          <Coins className="size-4 text-primary" />
          <p className="mt-2 text-xs text-muted-foreground">DOT Balance</p>
          <p className="font-display text-lg font-bold tabular-nums">
            {(dotSummary?.wallet.balance ?? 0).toLocaleString()} DOT
          </p>
        </Link>
        <Link
          to="/analytics"
          className="surface-card rounded-2xl p-4 transition-transform hover:-translate-y-0.5 hover:border-primary"
        >
          <BarChart3 className="size-4 text-primary" />
          <p className="mt-2 text-xs text-muted-foreground">Creator Telemetry</p>
          <p className="font-display text-lg font-bold">Analytics</p>
        </Link>
        <Link
          to="/upgrades"
          className="surface-card rounded-2xl p-4 transition-transform hover:-translate-y-0.5 hover:border-primary"
        >
          <Crown className="size-4 text-gold" />
          <p className="mt-2 text-xs text-muted-foreground">Current Tier</p>
          <p className="font-display text-lg font-bold capitalize">
            {dotSummary?.subscription.tier ?? "free"}
          </p>
        </Link>
        <button
          type="button"
          onClick={() => setCloseCircleOpen(true)}
          className="surface-card rounded-2xl p-4 text-left transition-transform hover:-translate-y-0.5 hover:border-primary"
        >
          <Users className="size-4 text-primary" />
          <p className="mt-2 text-xs text-muted-foreground">Close Circle</p>
          <p className="font-display text-lg font-bold tabular-nums">
            {closeCircleMembers.length} members
          </p>
        </button>
      </div>

      <form
        onSubmit={save}
        className="surface-card mt-6 grid gap-5 rounded-3xl p-6 sm:p-8"
        noValidate
      >
        <div className="flex items-center gap-4">
          <FounderAvatar name={f.display_name || f.username} src={f.avatar_url || null} size="lg" />
          <div>
            <p className="font-display text-lg font-bold">Public profile</p>
            <Link
              to="/@{$username}"
              params={{ username: profile.username }}
              className="text-sm text-muted-foreground underline"
            >
              View @{profile.username}
            </Link>
          </div>
        </div>
        <div>
          <Label htmlFor="dn">Display name</Label>
          <Input
            id="dn"
            value={f.display_name}
            onChange={(e) => setF({ ...f, display_name: e.target.value })}
            className="mt-1.5 rounded-xl"
          />
          {errs.display_name && (
            <p className="mt-1 text-xs text-destructive">{errs.display_name}</p>
          )}
        </div>
        <div>
          <Label htmlFor="un">Username</Label>
          <Input
            id="un"
            value={f.username}
            onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })}
            className="mt-1.5 rounded-xl"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Changing it changes your profile link.
          </p>
          {errs.username && <p className="mt-1 text-xs text-destructive">{errs.username}</p>}
        </div>
        <div>
          <Label htmlFor="bio">Short bio</Label>
          <Textarea
            id="bio"
            rows={3}
            value={f.bio}
            onChange={(e) => setF({ ...f, bio: e.target.value })}
            placeholder="Share what you're into, what you're working on, or how people can connect…"
            className="mt-1.5 rounded-xl"
          />
          <p className="mt-1 text-right text-xs text-muted-foreground">{280 - f.bio.length}</p>
          {errs.bio && <p className="text-xs text-destructive">{errs.bio}</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="settings-location">
              Location <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="settings-location"
              value={f.location}
              onChange={(e) => setF({ ...f, location: e.target.value })}
              placeholder="e.g. Lagos, Nairobi, London"
              maxLength={100}
              className="mt-1.5 rounded-xl"
            />
            {errs.location && <p className="mt-1 text-xs text-destructive">{errs.location}</p>}
          </div>
          <div>
            <Label htmlFor="settings-country">
              Country <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <select
              id="settings-country"
              value={f.country}
              onChange={(e) => setF({ ...f, country: e.target.value })}
              className="mt-1.5 h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Not specified</option>
              {ONBOARDING_COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {errs.country && <p className="mt-1 text-xs text-destructive">{errs.country}</p>}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="settings-website">
              Website <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="settings-website"
              type="url"
              value={f.website_url}
              onChange={(e) => setF({ ...f, website_url: e.target.value })}
              placeholder="https://yoursite.com"
              maxLength={300}
              className="mt-1.5 rounded-xl"
            />
            {errs.website_url && (
              <p className="mt-1 text-xs text-destructive">{errs.website_url}</p>
            )}
          </div>
          <div>
            <Label htmlFor="settings-visibility">Account visibility</Label>
            <select
              id="settings-visibility"
              value={f.profile_visibility}
              onChange={(e) =>
                setF({ ...f, profile_visibility: e.target.value as ProfileVisibility })
              }
              className="mt-1.5 h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="public">Public — anyone can discover your profile</option>
              <option value="followers">Followers — limited visibility</option>
              <option value="private">Private — approval-oriented presence</option>
            </select>
          </div>
        </div>
        <div>
          <Label>
            Interests <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Choose topics that shape recommendations on your Ping feed.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {ONBOARDING_INTERESTS.map((interest) => {
              const active = f.interests.includes(interest.id);
              return (
                <button
                  key={interest.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleInterest(interest.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                    active
                      ? "border-primary bg-primary/15 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`}
                >
                  {interest.label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <Label>
            Participation pathways{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Choose any optional labels you want to highlight on your profile, or leave empty.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PARTICIPATION_PATHWAYS.map((pathway) => {
              const active = f.participation_pathways.includes(pathway.id);
              return (
                <button
                  key={pathway.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => togglePathway(pathway.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                    active
                      ? "border-primary bg-primary/15 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`}
                >
                  {pathway.label}
                </button>
              );
            })}
          </div>
        </div>
        <ImageUploadField
          folder="avatars"
          userId={user?.id}
          value={f.avatar_url}
          onChange={(url) => setF({ ...f, avatar_url: url })}
          label="Profile picture (optional)"
          placeholder="https://…/me.jpg"
          fallbackName={f.display_name || f.username || "You"}
          shape="circle"
          inputId="av"
          error={errs.avatar_url}
          disabled={saving}
        />
        <Button type="submit" variant="hero" className="justify-self-start" disabled={saving}>
          {saving ? "Saving…" : "Save profile"}
        </Button>
      </form>

      {user && <ConnectionsEditor userId={user.id} />}

      {user && <PingActivityPrivacy userId={user.id} />}

      <AppearanceSettings />

      {/* Blocked Users Manager */}
      <section className="surface-card mt-6 rounded-3xl p-6 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-display text-base font-bold flex items-center gap-2">
              <ShieldBan className="size-4 text-primary" /> Blocked Users
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Blocked builders cannot message you or interact across your private threads.
            </p>
          </div>
          <span className="text-xs font-semibold text-muted-foreground">{blockedUsers.length}</span>
        </div>

        {blockedUsers.length === 0 ? (
          <p className="text-xs text-muted-foreground">You haven't blocked anyone.</p>
        ) : (
          <div className="divide-y divide-border/60">
            {blockedUsers.map((entry) => {
              const pName =
                entry.profile?.display_name || entry.profile?.username || "Blocked user";
              return (
                <div
                  key={entry.blocked_id}
                  className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FounderAvatar name={pName} src={entry.profile?.avatar_url} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{pName}</p>
                      {entry.profile?.username && (
                        <p className="text-xs text-muted-foreground truncate">
                          @{entry.profile.username}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={unblockUser.isPending}
                    onClick={() =>
                      unblockUser.mutate(entry.blocked_id, {
                        onSuccess: () => toast.success(`Unblocked ${pName}`),
                        onError: (e: any) => toast.error(e?.message || "Could not unblock user."),
                      })
                    }
                    className="rounded-xl shrink-0"
                  >
                    Unblock
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Muted Accounts Manager */}
      <section className="surface-card mt-6 rounded-3xl p-6 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-display text-base font-bold flex items-center gap-2">
              <VolumeX className="size-4 text-primary" /> Muted Accounts
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Muted accounts stay quiet in your personal feed without blocking them.
            </p>
          </div>
          <span className="text-xs font-semibold text-muted-foreground">{mutedUsers.length}</span>
        </div>

        {mutedUsers.length === 0 ? (
          <p className="text-xs text-muted-foreground">You haven&apos;t muted any accounts.</p>
        ) : (
          <div className="divide-y divide-border/60">
            {mutedUsers.map((entry) => {
              const pName =
                entry.profile?.display_name || entry.profile?.username || "Muted account";
              return (
                <div
                  key={entry.muted_id}
                  className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FounderAvatar name={pName} src={entry.profile?.avatar_url} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{pName}</p>
                      {entry.profile?.username && (
                        <p className="text-xs text-muted-foreground truncate">
                          @{entry.profile.username}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={unmuteUser.isPending || !user}
                    onClick={() =>
                      user &&
                      unmuteUser.mutate(
                        { userId: user.id, targetUserId: entry.muted_id },
                        {
                          onSuccess: () => toast.success(`Unmuted ${pName}`),
                          onError: (e: any) => toast.error(e?.message || "Could not unmute user."),
                        },
                      )
                    }
                    className="rounded-xl shrink-0"
                  >
                    Unmute
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Account Data Export (Self-Service JSON Portability) */}
      <section className="surface-card mt-6 rounded-3xl p-6 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="font-display text-base font-bold flex items-center gap-2">
              <Globe className="size-4 text-primary" /> Your Data &amp; Portability
            </p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Download a JSON archive of your Ping profile, Pings, Moments, connections, Hub
              memberships, privacy preferences, and safety lists.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isExportingData || !user}
            onClick={() => void handleExportData()}
            className="rounded-xl shrink-0 gap-1.5"
          >
            <Download className="size-4" />
            {isExportingData ? "Preparing…" : "Export My Data"}
          </Button>
        </div>
      </section>

      <CloseCircleDialog open={closeCircleOpen} onOpenChange={setCloseCircleOpen} />

      {user?.app_metadata?.provider === "email" && (
        <form onSubmit={changePw} className="surface-card mt-6 grid gap-4 rounded-3xl p-6 sm:p-8">
          <p className="font-display text-lg font-bold">Password</p>
          <div>
            <Label htmlFor="cp">Current password</Label>
            <Input
              id="cp"
              type="password"
              autoComplete="current-password"
              value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })}
              className="mt-1.5 rounded-xl"
            />
          </div>
          <div>
            <Label htmlFor="np">New password</Label>
            <Input
              id="np"
              type="password"
              autoComplete="new-password"
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
              className="mt-1.5 rounded-xl"
            />
          </div>
          <Button type="submit" variant="outline" className="justify-self-start">
            Change password
          </Button>
        </form>
      )}

      <MobilePushNotificationsCard />

      {/* Legal & Compliance Disclosures (App Store & Google Play) */}
      <div className="surface-card mt-6 rounded-3xl p-6 space-y-3">
        <p className="font-display text-sm font-bold flex items-center gap-2">
          <FileText className="size-4 text-primary" /> Legal & Terms
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Review Ping by DOT community standards, user-generated content policies, and data handling
          practices.
        </p>
        <div className="flex flex-wrap gap-4 pt-1 text-xs">
          <Link
            to="/privacy"
            className="text-primary hover:underline font-semibold flex items-center gap-1"
          >
            <Shield className="size-3.5" /> Privacy Policy
          </Link>
          <span className="text-muted-foreground">•</span>
          <Link
            to="/terms"
            className="text-primary hover:underline font-semibold flex items-center gap-1"
          >
            <FileText className="size-3.5" /> Terms of Service & EULA
          </Link>
        </div>
      </div>

      {/* Danger Zone: Account Deletion (Apple App Store Guideline 5.1.1(v)) */}
      <div className="surface-card mt-6 rounded-3xl p-6 border border-destructive/30 bg-destructive/5 space-y-4">
        <div>
          <p className="font-display text-base font-bold text-destructive flex items-center gap-2">
            <ShieldAlert className="size-5" /> Danger Zone
          </p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Permanently delete your Ping account, profile, all published Pings, comments, private
            conversations, and uploaded media. This action is irreversible.
          </p>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" className="rounded-xl font-bold">
              <Trash2 className="size-4 mr-1.5" /> Delete Account
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="rounded-3xl border border-destructive/30 bg-card">
            <AlertDialogHeader>
              <AlertDialogTitle className="font-display text-lg font-bold text-destructive flex items-center gap-2">
                <ShieldAlert className="size-5" /> Permanently Delete Account?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-xs text-muted-foreground leading-relaxed">
                Are you absolutely sure? This will instantly and permanently erase your account
                credentials, username, profile details, pings, comments, private direct messages,
                and storage assets. There is no recovery.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-4">
              <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteAccount}
                disabled={isDeletingAccount}
                className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90 font-bold"
              >
                {isDeletingAccount ? "Deleting..." : "Yes, Delete Everything"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="surface-card mt-6 flex items-center justify-between rounded-3xl p-6">
        <div>
          <p className="font-semibold">Signed in as</p>
          <p className="text-sm text-muted-foreground">{user?.email}</p>
        </div>
        <Button variant="outline" onClick={signOut}>
          Log out
        </Button>
      </div>
    </div>
  );
}
