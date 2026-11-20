/**
 * PING SPOTLIGHT — Merit-Based Founder Discovery, Editorial Evaluation & Official Distribution
 *
 * Implements Part B of the Ping Product Addendum:
 * - Strictly editorial recognition programme (NOT paid advertising; placement cannot be bought).
 * - Eligibility: Active qualifying Builder Pro membership ONLY; eligibility NEVER guarantees selection.
 * - Multi-channel discovery: Public Pings, Moments, Clips, Founder & Business profiles, Hubs,
 *   community nominations, and private founder submissions.
 * - Configurable 8-dimension merit rubric + mandatory human editorial approval + documented reason.
 * - AI may assist with advisory summarisation ONLY — never auto-determines final selection.
 * - Official Ping distribution engine respecting notification preferences, frequency caps,
 *   and real observed metrics (never fabricates impressions/views/reach/engagement).
 */

import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { NotificationPreferences } from "@/lib/notifications";

export const PING_OFFICIAL_ACCOUNT = {
  handle: "ping",
  displayName: "Ping Official",
  tagline: "Official Editorial & Founder Spotlight Channel on Ping by DOT",
} as const;

export type SpotlightSourceType =
  | "ping"
  | "moment"
  | "clip"
  | "profile"
  | "business"
  | "hub"
  | "community_nomination"
  | "founder_submission"
  | "editorial_discovery";

export type SpotlightCandidateStatus =
  | "discovered"
  | "submitted"
  | "under_review"
  | "shortlisted"
  | "selected"
  | "published"
  | "declined"
  | "retracted";

export type SpotlightPublicationStatus =
  "draft" | "scheduled" | "published" | "corrected" | "retracted";

export type SpotlightTemplateLayout =
  "editorial_feature" | "video_interview" | "builder_case_study";

export type SpotlightChannel =
  "official_account" | "home_feed" | "explore" | "topic_feed" | "clip_promo" | "notification";

export interface SpotlightRubricDimension {
  key: string;
  label: string;
  weight: number; // Percentage sum = 100
}

export const DEFAULT_SPOTLIGHT_RUBRIC: readonly SpotlightRubricDimension[] = [
  { key: "story_authenticity", label: "Story Quality & Authenticity", weight: 15 },
  { key: "execution_evidence", label: "Evidence of Actual Execution", weight: 20 },
  { key: "innovation_originality", label: "Innovation & Originality", weight: 12 },
  { key: "business_traction", label: "Business Progress & Traction", weight: 15 },
  { key: "problem_relevance", label: "Relevance of Problem Addressed", weight: 12 },
  { key: "economic_social_impact", label: "Economic or Social Impact", weight: 10 },
  { key: "growth_potential", label: "Potential for Future Growth", weight: 8 },
  { key: "documentation_quality", label: "Communication & Documentation", weight: 8 },
] as const;

export interface SpotlightCandidate {
  id: string;
  founder_id: string;
  business_id: string | null;
  source_type: SpotlightSourceType;
  source_ref_id: string | null;
  headline: string;
  story_pitch: string;
  problem_statement: string;
  traction_evidence: string;
  evidence_urls: string[];
  is_private_submission: boolean;
  status: SpotlightCandidateStatus;
  pro_verified_at: string | null;
  ai_advisory_summary: string | null;
  human_approved_by: string | null;
  human_approved_at: string | null;
  selection_reason: string;
  created_at: string;
  updated_at: string;
  founder?: {
    username: string;
    display_name: string;
    avatar_url: string | null;
  } | null;
}

export interface SpotlightDistributionRecord {
  channel: SpotlightChannel;
  impressions_count: number;
  views_count: number;
  clicks_count: number;
  shares_count: number;
  notifications_sent: number;
}

export interface SpotlightPublication {
  id: string;
  slug: string;
  candidate_id: string | null;
  founder_id: string;
  business_id: string | null;
  title: string;
  editorial_intro: string;
  founder_portrait_url: string | null;
  founder_story: string;
  business_description: string;
  problem_solved: string;
  product_solution: string;
  evidence_achievements: string[];
  media_urls: string[];
  video_interview_url: string | null;
  featured_ping_ids: string[];
  featured_clip_ids: string[];
  featured_moment_ids: string[];
  dot_tags: string[];
  template_layout: SpotlightTemplateLayout;
  status: SpotlightPublicationStatus;
  published_by_official_account: boolean;
  distribution_config: {
    home_feed?: boolean;
    explore?: boolean;
    official_account?: boolean;
    notify_eligible?: boolean;
    frequency_cap_days?: number;
  };
  published_at: string | null;
  retracted_at: string | null;
  correction_note: string;
  founder?: {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
  } | null;
  business?: {
    id: string;
    name: string;
    slug: string;
    verified_status?: string;
  } | null;
  distribution?: SpotlightDistributionRecord[];
}

/**
 * Computes weighted merit evaluation score (0–100) from 1–10 dimension ratings.
 */
export function computeSpotlightMeritScore(
  scores: Record<string, number>,
  rubric: readonly SpotlightRubricDimension[] = DEFAULT_SPOTLIGHT_RUBRIC,
): number {
  const totalWeight = rubric.reduce((sum, d) => sum + d.weight, 0);
  if (totalWeight <= 0) return 0;
  let weightedSum = 0;
  for (const dim of rubric) {
    const raw = Math.max(0, Math.min(10, Number(scores[dim.key] ?? 0)));
    weightedSum += (raw / 10) * dim.weight;
  }
  return Math.round((weightedSum / totalWeight) * 1000) / 10;
}

/**
 * Validates that a Spotlight eligibility check or final editorial selection complies
 * strictly with Part B rules (Pro membership required, human approval mandatory,
 * AI advisory cannot auto-approve, and documented selection reason required).
 */
export function validateSpotlightSelectionDecision(input: {
  candidateHasActivePro: boolean;
  actorIsSpotlightEditor: boolean;
  actorIsAiOnly: boolean;
  decision: "shortlisted" | "selected" | "declined" | "retracted";
  reason: string;
}): { allowed: boolean; error?: string } {
  if (input.actorIsAiOnly) {
    return {
      allowed: false,
      error:
        "AI may only assist with discovery and summarisation — human editorial approval is mandatory for final Ping Spotlight selection.",
    };
  }
  if (!input.actorIsSpotlightEditor) {
    return {
      allowed: false,
      error: "Only authorised Ping Spotlight editors may record selection decisions.",
    };
  }
  if (input.decision === "selected" && !input.candidateHasActivePro) {
    return {
      allowed: false,
      error:
        "Only members with an active Builder Pro membership can be selected for Ping Spotlight.",
    };
  }
  if (input.reason.trim().length < 8) {
    return {
      allowed: false,
      error: "A documented editorial reason (minimum 8 characters) is required.",
    };
  }
  return { allowed: true };
}

/**
 * Deterministic advisory summary helper (explicitly non-decisional!).
 */
export function generateAdvisoryEditorialSummary(candidate: {
  headline: string;
  problem_statement: string;
  traction_evidence: string;
  evidence_urls: string[];
}): string {
  const parts = [
    `Advisory Brief (Non-Decisional): "${candidate.headline.trim()}".`,
    candidate.problem_statement.trim()
      ? `Problem focus: ${candidate.problem_statement.trim().slice(0, 140)}.`
      : "Problem statement not yet documented.",
    candidate.traction_evidence.trim()
      ? `Reported execution evidence: ${candidate.traction_evidence.trim().slice(0, 140)}.`
      : "No traction evidence supplied yet.",
    `Supporting links attached: ${candidate.evidence_urls.length}. Human editorial review required.`,
  ];
  return parts.join(" ");
}

/**
 * Evaluates whether a Spotlight notification may be sent to a specific user,
 * respecting opt-out notification preferences AND frequency caps (no mass blasting!).
 */
export function evaluateSpotlightNotificationDelivery(input: {
  preferences: Partial<NotificationPreferences>;
  lastSpotlightNotificationAt?: string | null | undefined;
  frequencyCapDays?: number | undefined;
  nowMs?: number | undefined;
}): { send: boolean; reason: string } {
  if (input.preferences.spotlight === false) {
    return { send: false, reason: "User opted out of Ping Spotlight notifications." };
  }
  const capDays = Math.max(1, input.frequencyCapDays ?? 7);
  if (input.lastSpotlightNotificationAt) {
    const lastMs = new Date(input.lastSpotlightNotificationAt).getTime();
    const nowMs = input.nowMs ?? Date.now();
    const elapsedDays = (nowMs - lastMs) / 86_400_000;
    if (elapsedDays < capDays) {
      return {
        send: false,
        reason: `Frequency cap active (${capDays}-day minimum interval between Spotlight alerts).`,
      };
    }
  }
  return { send: true, reason: "Eligible under user preference and frequency cap." };
}

function isMissingSpotlightSchema(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? "").toLowerCase();
  const code = String((err as { code?: string })?.code ?? "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "42883" ||
    code === "PGRST202" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

const LOCAL_SPOTLIGHT_PUBS_KEY = "ping:spotlight:local-publications";

function readLocalSpotlightPubs(): SpotlightPublication[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_SPOTLIGHT_PUBS_KEY);
    return raw ? (JSON.parse(raw) as SpotlightPublication[]) : [];
  } catch {
    return [];
  }
}

export function spotlightPublicationsQuery() {
  return queryOptions({
    queryKey: ["spotlight-publications"],
    staleTime: 30_000,
    queryFn: async (): Promise<{ migrated: boolean; publications: SpotlightPublication[] }> => {
      const { data, error } = await (supabase as any)
        .from("spotlight_publications")
        .select(
          `*,
           founder:profiles!spotlight_publications_founder_id_fkey(id,username,display_name,avatar_url),
           business:business_profiles!spotlight_publications_business_id_fkey(id,name,slug,verified_status),
           distribution:spotlight_distribution_records(channel,impressions_count,views_count,clicks_count,shares_count,notifications_sent)`,
        )
        .in("status", ["published", "corrected"])
        .order("published_at", { ascending: false })
        .limit(30);

      if (error) {
        if (!isMissingSpotlightSchema(error)) throw error;
        return { migrated: false, publications: readLocalSpotlightPubs() };
      }
      return { migrated: true, publications: (data ?? []) as SpotlightPublication[] };
    },
  });
}

export function spotlightBySlugQuery(slug: string) {
  return queryOptions({
    queryKey: ["spotlight-publication", slug],
    enabled: Boolean(slug),
    staleTime: 30_000,
    queryFn: async (): Promise<SpotlightPublication | null> => {
      const { data, error } = await (supabase as any)
        .from("spotlight_publications")
        .select(
          `*,
           founder:profiles!spotlight_publications_founder_id_fkey(id,username,display_name,avatar_url),
           business:business_profiles!spotlight_publications_business_id_fkey(id,name,slug,verified_status),
           distribution:spotlight_distribution_records(channel,impressions_count,views_count,clicks_count,shares_count,notifications_sent)`,
        )
        .eq("slug", slug)
        .maybeSingle();

      if (error) {
        if (!isMissingSpotlightSchema(error)) throw error;
        return readLocalSpotlightPubs().find((p) => p.slug === slug) ?? null;
      }
      return (data as SpotlightPublication | null) ?? null;
    },
  });
}

export function mySpotlightSubmissionsQuery(userId?: string) {
  return queryOptions({
    queryKey: ["my-spotlight-submissions", userId],
    enabled: Boolean(userId),
    staleTime: 20_000,
    queryFn: async (): Promise<SpotlightCandidate[]> => {
      if (!userId) return [];
      const { data, error } = await (supabase as any)
        .from("spotlight_candidates")
        .select("*")
        .eq("founder_id", userId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) {
        if (!isMissingSpotlightSchema(error)) throw error;
        return [];
      }
      return (data ?? []) as SpotlightCandidate[];
    },
  });
}

export function useSubmitSpotlightStory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      headline: string;
      storyPitch: string;
      problemStatement: string;
      tractionEvidence: string;
      businessId?: string | null | undefined;
      evidenceUrls?: string[] | undefined;
    }) => {
      const { data, error } = await (supabase as any).rpc("submit_spotlight_story", {
        p_headline: input.headline.trim(),
        p_story_pitch: input.storyPitch.trim(),
        p_problem_statement: input.problemStatement.trim(),
        p_traction_evidence: input.tractionEvidence.trim(),
        p_business_id: input.businessId ?? null,
        p_evidence_urls: input.evidenceUrls ?? [],
      });
      if (error) throw error;
      return data as SpotlightCandidate;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["my-spotlight-submissions"] });
    },
  });
}

export function useNominateForSpotlight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      founderId: string;
      reason: string;
      sourceType?: SpotlightSourceType | undefined;
      sourceRefId?: string | null | undefined;
      supportingLinks?: string[] | undefined;
    }) => {
      const { data, error } = await (supabase as any).rpc("nominate_for_spotlight", {
        p_founder_id: input.founderId,
        p_reason: input.reason.trim(),
        p_source_type: input.sourceType ?? "community_nomination",
        p_source_ref_id: input.sourceRefId ?? null,
        p_business_id: null,
        p_supporting_links: input.supportingLinks ?? [],
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["spotlight-editorial-candidates"] });
    },
  });
}

export async function recordObservedSpotlightEvent(
  publicationId: string,
  channel: SpotlightChannel,
  eventType: "impression" | "view" | "click" | "share",
): Promise<void> {
  await (supabase as any)
    .rpc("record_spotlight_event", {
      p_publication_id: publicationId,
      p_channel: channel,
      p_event_type: eventType,
    })
    .then(
      () => {},
      () => {},
    );
}
