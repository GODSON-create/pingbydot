import type { HubCategory } from "@/lib/hubs";
import type { Category } from "@/lib/validation";

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

export interface OnboardingInterest {
  id:
    | "technology"
    | "business"
    | "education"
    | "entertainment"
    | "lifestyle"
    | "communities"
    | "creativity"
    | "opportunities"
    | "culture"
    | "other";
  label: string;
  pingCategory: Category;
  hubCategory: HubCategory;
}

/**
 * 10 inclusive topic interests aligned cleanly with existing Ping feed categories
 * (`src/lib/validation.ts`) and Hub directory categories (`src/lib/hubs.ts`).
 */
export const ONBOARDING_INTERESTS: readonly OnboardingInterest[] = [
  { id: "technology", label: "Technology", pingCategory: "launch", hubCategory: "incubator" },
  { id: "business", label: "Business", pingCategory: "offer", hubCategory: "company" },
  { id: "education", label: "Education", pingCategory: "question", hubCategory: "university" },
  { id: "entertainment", label: "Entertainment", pingCategory: "update", hubCategory: "community" },
  { id: "lifestyle", label: "Lifestyle", pingCategory: "progress", hubCategory: "community" },
  {
    id: "communities",
    label: "Communities",
    pingCategory: "collaboration",
    hubCategory: "community",
  },
  { id: "creativity", label: "Creativity", pingCategory: "idea", hubCategory: "community" },
  {
    id: "opportunities",
    label: "Opportunities",
    pingCategory: "opportunity",
    hubCategory: "ecosystem",
  },
  { id: "culture", label: "Culture", pingCategory: "milestone", hubCategory: "association" },
  { id: "other", label: "Other", pingCategory: "need", hubCategory: "other" },
] as const;

export type OnboardingInterestId = OnboardingInterest["id"];

export const ONBOARDING_INTEREST_IDS = ONBOARDING_INTERESTS.map(
  (item) => item.id,
) as readonly OnboardingInterestId[];

export function formatInterestLabel(id: string): string {
  return ONBOARDING_INTERESTS.find((item) => item.id === id)?.label ?? id;
}

export function recommendedFeedCategoryForInterests(interests: readonly string[]): Category | null {
  for (const id of interests) {
    const match = ONBOARDING_INTERESTS.find((item) => item.id === id);
    if (match) return match.pingCategory;
  }
  return null;
}

export function recommendedHubCategoriesForInterests(
  interests: readonly string[],
): Set<HubCategory> {
  const set = new Set<HubCategory>();
  for (const id of interests) {
    const match = ONBOARDING_INTERESTS.find((item) => item.id === id);
    if (match) set.add(match.hubCategory);
  }
  return set;
}

export const ONBOARDING_COUNTRIES: readonly string[] = [
  "Afghanistan",
  "Albania",
  "Algeria",
  "Argentina",
  "Australia",
  "Austria",
  "Bangladesh",
  "Belgium",
  "Brazil",
  "Cameroon",
  "Canada",
  "Chile",
  "China",
  "Colombia",
  "Costa Rica",
  "Czechia",
  "Denmark",
  "Egypt",
  "Ethiopia",
  "Finland",
  "France",
  "Germany",
  "Ghana",
  "Greece",
  "India",
  "Indonesia",
  "Ireland",
  "Israel",
  "Italy",
  "Jamaica",
  "Japan",
  "Kenya",
  "Malaysia",
  "Mexico",
  "Morocco",
  "Netherlands",
  "New Zealand",
  "Nigeria",
  "Norway",
  "Pakistan",
  "Peru",
  "Philippines",
  "Poland",
  "Portugal",
  "Romania",
  "Rwanda",
  "Saudi Arabia",
  "Senegal",
  "Singapore",
  "South Africa",
  "South Korea",
  "Spain",
  "Sweden",
  "Switzerland",
  "Tanzania",
  "Thailand",
  "Turkey",
  "Uganda",
  "Ukraine",
  "United Arab Emirates",
  "United Kingdom",
  "United States",
  "Vietnam",
  "Zimbabwe",
  "Other",
];

const WELCOME_SEEN_KEY = "ping_welcome_seen_v1";
const ONBOARDING_DRAFT_PREFIX = "ping_onboarding_draft_v1:";

export type OnboardingStepNumber = 1 | 2 | 3 | 4;

export interface OnboardingDraft {
  step: OnboardingStepNumber;
  displayName: string;
  username: string;
  country: string;
  avatarUrl: string;
  bio: string;
  interests: OnboardingInterestId[];
  pathways: ParticipationPathwayId[];
}

export function loadOnboardingDraft(userId: string): Partial<OnboardingDraft> | null {
  if (typeof window === "undefined" || !userId) return null;
  try {
    const raw = window.localStorage.getItem(`${ONBOARDING_DRAFT_PREFIX}${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Partial<OnboardingDraft>;
  } catch {
    return null;
  }
}

export function saveOnboardingDraft(userId: string, draft: OnboardingDraft): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    window.localStorage.setItem(`${ONBOARDING_DRAFT_PREFIX}${userId}`, JSON.stringify(draft));
  } catch {
    // Ignore storage quota or private browsing errors
  }
}

export function clearOnboardingDraft(userId: string): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    window.localStorage.removeItem(`${ONBOARDING_DRAFT_PREFIX}${userId}`);
  } catch {
    // Ignore storage cleanup errors
  }
}

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
