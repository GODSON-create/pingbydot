export const PARTICIPATION_PATHWAYS = [
  {
    id: "general",
    label: "General User",
    description: "Explore the feed, connect with people, and follow updates.",
  },
  {
    id: "creator",
    label: "Creator",
    description: "Share Moments, media, ideas, and stories with the network.",
  },
  {
    id: "business",
    label: "Business",
    description: "Showcase products, services, offers, and customer channels.",
  },
  {
    id: "community",
    label: "Community Member",
    description: "Join Hubs, participate in topic forums, and meet peers.",
  },
  {
    id: "builder",
    label: "Builder",
    description: "Share projects, collaborate on work, and ship updates.",
  },
  {
    id: "investor",
    label: "Investor",
    description: "Follow emerging projects, signals, launches, and teams.",
  },
] as const;

export type ParticipationPathwayId = (typeof PARTICIPATION_PATHWAYS)[number]["id"];

export const PARTICIPATION_PATHWAY_IDS = PARTICIPATION_PATHWAYS.map(
  (p) => p.id,
) as readonly ParticipationPathwayId[];

const WELCOME_SEEN_KEY = "ping_welcome_seen_v1";

export function hasSeenWelcome(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(WELCOME_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markWelcomeSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WELCOME_SEEN_KEY, "1");
  } catch {
    // Ignore storage quota or private browsing errors
  }
}

export function formatPathwayLabel(id: string): string {
  return PARTICIPATION_PATHWAYS.find((p) => p.id === id)?.label ?? id;
}

/**
 * Only brand-new accounts whose `onboarding_completed_at` column exists and is
 * explicitly `null` should enter universal onboarding. Returning users (including
 * environments where migration 0023 has not yet added the column) pass straight through.
 */
export function needsOnboarding(
  profile: { onboarding_completed_at?: string | null | undefined } | null | undefined,
): boolean {
  if (!profile) return false;
  if (!("onboarding_completed_at" in profile)) return false;
  return profile.onboarding_completed_at === null;
}
