import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/lib/pings";

export function deriveProfileUsernameBase(
  user: Pick<User, "id" | "email" | "user_metadata">,
): string {
  const meta = user.user_metadata;
  const metaUsername =
    typeof meta?.["username"] === "string"
      ? meta["username"]
      : typeof meta?.["preferred_username"] === "string"
        ? meta["preferred_username"]
        : typeof meta?.["full_name"] === "string"
          ? meta["full_name"]
          : "";
  const emailLocal = (user.email ?? "").split("@")[0] ?? "";
  const raw = (metaUsername || emailLocal || "builder").toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (raw.length >= 3) {
    return raw.slice(0, 20);
  }
  const cleanId = user.id
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase()
    .slice(0, 8);
  return `builder_${cleanId || "ping"}`.slice(0, 20);
}

/**
 * Ensures the authenticated user has a `public.profiles` row.
 * Uses `ensure_my_profile` RPC when available, and falls back to the 0000 RLS
 * `"Users insert own profile"` INSERT policy when remote migrations are behind.
 */
export async function ensureClientProfileRow(
  user?: Pick<User, "id" | "email" | "user_metadata"> | null,
): Promise<Profile | null> {
  let targetUser = user ?? null;
  if (!targetUser) {
    const { data: userRes } = await supabase.auth.getUser();
    targetUser = userRes.user ?? null;
  }
  if (!targetUser?.id) return null;

  const { data: existing, error: selectErr } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", targetUser.id)
    .maybeSingle();
  if (!selectErr && existing) {
    return existing as Profile;
  }

  const { data: ensured, error: rpcErr } = await supabase.rpc("ensure_my_profile");
  if (!rpcErr && ensured) {
    return ensured as Profile;
  }

  // Fallback for remote databases where 0022_stabilization ensure_my_profile() isn't deployed yet
  const base = deriveProfileUsernameBase(targetUser);
  const meta = targetUser.user_metadata;
  const metaName =
    typeof meta?.["display_name"] === "string"
      ? meta["display_name"]
      : typeof meta?.["full_name"] === "string"
        ? meta["full_name"]
        : typeof meta?.["name"] === "string"
          ? meta["name"]
          : base;
  const displayName = metaName.trim().slice(0, 60) || base;
  const rawAvatar = meta?.["avatar_url"];
  const avatarUrl =
    typeof rawAvatar === "string" && /^https?:\/\//i.test(rawAvatar) ? rawAvatar : null;

  for (let attempt = 0; attempt < 4; attempt++) {
    const suffix = attempt === 0 ? "" : `_${attempt}${Math.floor(10 + Math.random() * 89)}`;
    const candidate = `${base.slice(0, Math.max(3, 24 - suffix.length))}${suffix}`;
    const { data: inserted, error: insertErr } = await supabase
      .from("profiles")
      .insert({
        id: targetUser.id,
        username: candidate,
        display_name: displayName,
        bio: "",
        avatar_url: avatarUrl,
      })
      .select("*")
      .maybeSingle();

    if (!insertErr && inserted) {
      return inserted as Profile;
    }

    // Re-read in case a concurrent trigger/request inserted the profile row
    const { data: rechecked } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", targetUser.id)
      .maybeSingle();
    if (rechecked) {
      return rechecked as Profile;
    }

    const code = (insertErr as { code?: string } | null)?.code;
    if (code !== "23505") {
      break;
    }
  }

  return null;
}
