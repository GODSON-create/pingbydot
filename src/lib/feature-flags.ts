/**
 * PING Feature Flags — Controlled Rollout Registry (Phases 1–5)
 *
 * UI/experience rollout flags only. Server-side authorization, RLS,
 * verification review, and real-money payment gates are ALWAYS enforced
 * on the backend and can never be bypassed by client feature flags.
 */

export type PingFeatureFlag =
  | "five_destination_nav"
  | "ping_composer_drafts"
  | "account_data_export"
  | "account_mutes"
  | "media_upload_retry"
  | "multimedia_feeds_v3"
  | "music_attachments_v3"
  | "business_profiles_v4"
  | "griot_ai_v5"
  | "developer_api_v5";

export interface FeatureFlagMeta {
  defaultEnabled: boolean;
  phase: 1 | 2 | 3 | 4 | 5;
  description: string;
}

export const FEATURE_FLAGS: Record<PingFeatureFlag, FeatureFlagMeta> = {
  five_destination_nav: {
    defaultEnabled: true,
    phase: 1,
    description:
      "Unified five-destination primary navigation (Home, Explore, Create, Hubs, Inbox).",
  },
  ping_composer_drafts: {
    defaultEnabled: true,
    phase: 1,
    description: "Preserves unfinished Ping composer drafts across navigation.",
  },
  account_data_export: {
    defaultEnabled: true,
    phase: 1,
    description: "Self-service JSON account data export in Settings.",
  },
  account_mutes: {
    defaultEnabled: true,
    phase: 1,
    description: "User mute/unmute controls for profiles and feeds.",
  },
  media_upload_retry: {
    defaultEnabled: true,
    phase: 1,
    description: "Exponential backoff retries for transient media upload failures.",
  },
  multimedia_feeds_v3: {
    defaultEnabled: false,
    phase: 3,
    description: "Dedicated Video, Image, and Text multimedia feeds (Phase 3).",
  },
  music_attachments_v3: {
    defaultEnabled: false,
    phase: 3,
    description: "Licensed music attachments on Pings and Moments (Phase 3 — licensing required).",
  },
  business_profiles_v4: {
    defaultEnabled: false,
    phase: 4,
    description: "Business storefronts, team inboxes, and lead workflows (Phase 4).",
  },
  griot_ai_v5: {
    defaultEnabled: false,
    phase: 5,
    description: "GRIOT AI contextual intelligence layer (Phase 5).",
  },
  developer_api_v5: {
    defaultEnabled: false,
    phase: 5,
    description: "Public Ping Developer Portal, OAuth, and Webhooks (Phase 5).",
  },
};

const FLAG_OVERRIDE_STORAGE_KEY = "ping_feature_flag_overrides_v1";

function readLocalOverrides(): Partial<Record<PingFeatureFlag, boolean>> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(FLAG_OVERRIDE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Record<PingFeatureFlag, boolean>> = {};
    for (const key of Object.keys(FEATURE_FLAGS) as PingFeatureFlag[]) {
      if (typeof parsed[key] === "boolean") {
        out[key] = parsed[key];
      }
    }
    return out;
  } catch {
    return {};
  }
}

function readEnvOverride(flag: PingFeatureFlag): boolean | undefined {
  const envKey = `VITE_FLAG_${flag.toUpperCase()}`;
  const raw = (import.meta.env as Record<string, unknown> | undefined)?.[envKey];
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return undefined;
}

export function isFeatureEnabled(flag: PingFeatureFlag): boolean {
  const localOverrides = readLocalOverrides();
  if (typeof localOverrides[flag] === "boolean") {
    return localOverrides[flag];
  }
  const envOverride = readEnvOverride(flag);
  if (typeof envOverride === "boolean") {
    return envOverride;
  }
  return FEATURE_FLAGS[flag].defaultEnabled;
}

export function setFeatureFlagOverride(flag: PingFeatureFlag, value: boolean | null): void {
  if (typeof window === "undefined") return;
  try {
    const current = readLocalOverrides();
    if (value === null) {
      delete current[flag];
    } else {
      current[flag] = value;
    }
    window.localStorage.setItem(FLAG_OVERRIDE_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Ignore storage access errors in restricted webviews.
  }
}

export function getFeatureFlagsSnapshot(): Record<PingFeatureFlag, boolean> {
  const out = {} as Record<PingFeatureFlag, boolean>;
  for (const key of Object.keys(FEATURE_FLAGS) as PingFeatureFlag[]) {
    out[key] = isFeatureEnabled(key);
  }
  return out;
}
