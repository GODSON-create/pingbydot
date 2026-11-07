import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Check, LockKeyhole, Save, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  PLATFORMS,
  PLATFORM_LABEL,
  normalizeConnection,
  connectionDisplay,
  connectionUrl,
  type Connection,
  type Platform,
} from "@/lib/connections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PlatformIcon } from "./PlatformIcon";

const placeholders: Record<Platform, string> = {
  whatsapp: "+44 7700 900123",
  snapchat: "username or snapchat.com/add/username",
  instagram: "@username or instagram.com/username",
  x: "@username or x.com/username",
};

function ConnectionRow({
  platform,
  saved,
  userId,
  onChanged,
}: {
  platform: Platform;
  saved: Connection | undefined;
  userId: string;
  onChanged: () => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const [visible, setVisible] = useState(false);
  const [primary, setPrimary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const savedHandle = saved?.handle;
  const savedPublic = saved?.is_public ?? false;
  const savedPrimary = saved?.is_primary ?? false;
  useEffect(() => {
    setInput(savedHandle ? connectionDisplay(platform, savedHandle) : "");
    setVisible(savedPublic);
    setPrimary(savedPrimary);
  }, [savedHandle, savedPublic, savedPrimary, platform]);
  const normalized = normalizeConnection(platform, input);
  const destination = normalized.ok ? connectionUrl(platform, normalized.handle) : null;
  const label = PLATFORM_LABEL[platform];
  const changed =
    (normalized.ok && normalized.handle !== saved?.handle) ||
    visible !== (saved?.is_public ?? false) ||
    primary !== (saved?.is_primary ?? false);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!normalized.ok) {
      setError(normalized.error);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error: failure } = await supabase.rpc("save_profile_connection", {
        _platform: platform,
        _handle: normalized.handle,
        _is_public: visible,
        _is_primary: primary,
      });
      if (failure) throw failure;
      await onChanged();
      toast.success(`${label} saved`);
    } catch {
      setError("Couldn't save this connection. Your changes are still here; try again.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      const { error: failure } = await supabase
        .from("profile_connections")
        .delete()
        .eq("user_id", userId)
        .eq("platform", platform)
        .select("id");
      if (failure) throw failure;
      setInput("");
      setVisible(false);
      setPrimary(false);
      setConfirmRemove(false);
      await onChanged();
      toast.success(`${label} removed`);
    } catch {
      setError("Couldn't remove this connection. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={save}
      className="border-b py-6 last:border-b-0"
      noValidate
      data-no-gesture
      aria-label={`${label} connection`}
    >
      <fieldset disabled={busy} className="min-w-0">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-secondary">
            <PlatformIcon platform={platform} />
          </span>
          <h3 className="font-display text-lg font-bold">{label}</h3>
          {saved && (
            <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
              <Check className="size-3" /> Saved
            </span>
          )}
        </div>
        <Label htmlFor={`connection-${platform}`}>
          {platform === "whatsapp" ? "International phone number" : "Username or profile link"}
        </Label>
        <Input
          id={`connection-${platform}`}
          type="text"
          inputMode={platform === "whatsapp" ? "tel" : "text"}
          autoComplete="off"
          maxLength={200}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            setError("");
          }}
          placeholder={placeholders[platform]}
          aria-invalid={!!error}
          aria-describedby={error ? `error-${platform}` : `visibility-${platform}`}
          className="mt-2"
        />
        {error && (
          <p id={`error-${platform}`} role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {input && !normalized.ok && !error && (
          <p className="mt-2 text-xs text-muted-foreground">{normalized.error}</p>
        )}
        {destination && (
          <a
            href={destination}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            className="mt-3 flex min-h-10 items-center gap-2 text-sm text-primary underline underline-offset-4"
            aria-label={`Preview ${label} destination (opens in a new tab)`}
          >
            <span className="min-w-0 break-all">{destination}</span>
            <ArrowUpRight className="size-4 shrink-0" />
          </a>
        )}
        <div className="mt-4 flex items-start justify-between gap-4">
          <div>
            <Label htmlFor={`public-${platform}`}>Visible on public profile</Label>
            <p
              id={`visibility-${platform}`}
              className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"
            >
              {visible ? (
                platform === "whatsapp" ? (
                  "Anyone can see this phone number after saving."
                ) : (
                  "Anyone can open this connection after saving."
                )
              ) : (
                <>
                  <LockKeyhole className="size-3 shrink-0" />
                  Only you can see this connection.
                </>
              )}
            </p>
          </div>
          <Switch
            id={`public-${platform}`}
            checked={visible}
            onCheckedChange={setVisible}
            aria-label={`Make ${label} public`}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={primary ? "secondary" : "ghost"}
            aria-pressed={primary}
            onClick={() => setPrimary(!primary)}
            className="min-h-11"
          >
            <Star className={primary ? "fill-current" : ""} />
            {primary ? "Primary contact" : "Set as primary"}
          </Button>
          <Button
            type="submit"
            disabled={busy || !input.trim() || (!changed && !!saved)}
            className="ml-auto min-h-11"
          >
            <Save />
            {busy ? "Saving…" : "Save"}
          </Button>
          {saved && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 text-destructive"
              title={`Remove ${label}`}
              aria-label={`Remove ${label}`}
              onClick={() => setConfirmRemove(true)}
            >
              <Trash2 />
            </Button>
          )}
        </div>
        {confirmRemove && (
          <div
            role="group"
            aria-label={`Confirm removing ${label}`}
            className="mt-3 flex flex-wrap items-center gap-2"
          >
            <p className="w-full text-sm">Remove your {label} connection?</p>
            <Button type="button" variant="destructive" onClick={remove}>
              Remove connection
            </Button>
            <Button type="button" variant="outline" onClick={() => setConfirmRemove(false)}>
              Keep connection
            </Button>
          </div>
        )}
      </fieldset>
    </form>
  );
}

export function ConnectionsEditor({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["my-connections", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profile_connections")
        .select("platform,handle,is_public,is_primary")
        .eq("user_id", userId);
      if (error) throw error;
      return (data ?? []).filter((row): row is typeof row & { platform: Platform } =>
        PLATFORMS.includes(row.platform as Platform),
      );
    },
  });
  const changed = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["my-connections", userId] }),
      queryClient.invalidateQueries({ queryKey: ["profile"] }),
    ]);
  };
  return (
    <section aria-labelledby="connections-heading" className="mt-10" data-no-gesture>
      <h2 id="connections-heading" className="font-display text-2xl font-bold">
        Social connections
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Choose where people can reach you. Each connection stays private until you make it public.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        One primary contact can be highlighted; your other public links stay visible. Links open the
        app when available, or its website.
      </p>
      {query.isPending ? (
        <p role="status" className="py-6 text-muted-foreground">
          Loading connections…
        </p>
      ) : query.isError ? (
        <div role="alert" className="py-6">
          <p>Couldn't load your connections. No changes have been made.</p>
          <Button variant="outline" className="mt-3" onClick={() => query.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        PLATFORMS.map((platform) => (
          <ConnectionRow
            key={platform}
            platform={platform}
            saved={query.data.find((row) => row.platform === platform)}
            userId={userId}
            onChanged={changed}
          />
        ))
      )}
    </section>
  );
}
