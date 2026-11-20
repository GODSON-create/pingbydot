import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

export const VERIFICATION_DOMAINS = ["identity", "professional"] as const;
export type VerificationDomain = (typeof VERIFICATION_DOMAINS)[number];

export const VERIFICATION_STATUSES = [
  "unverified",
  "pending",
  "verified",
  "rejected",
  "revoked",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const PROFESSIONAL_VERIFICATION_PATHWAYS = [
  {
    id: "creator",
    label: "Creator",
    badgeLabel: "Verified Creator",
    description:
      "Confirm original creator ownership of an active channel, portfolio, or public publication.",
    requiresOrganizationName: false,
  },
  {
    id: "business",
    label: "Business",
    badgeLabel: "Verified Business",
    description: "Confirm an active company, studio, shop, or commercial service domain.",
    requiresOrganizationName: true,
  },
  {
    id: "community_org",
    label: "Community / Organization",
    badgeLabel: "Verified Organization",
    description:
      "Confirm an institution, school, accelerator, association, or community collective.",
    requiresOrganizationName: true,
  },
  {
    id: "builder",
    label: "Builder",
    badgeLabel: "Verified Builder",
    description:
      "Confirm active software, hardware, or product authorship tied to an official repository or site.",
    requiresOrganizationName: false,
  },
  {
    id: "investor",
    label: "Investor",
    badgeLabel: "Verified Investor",
    description:
      "Optional credential review for active angels, funds, or grantmakers. Does not grant platform admin roles.",
    requiresOrganizationName: true,
  },
] as const;

export type ProfessionalVerificationPathway =
  (typeof PROFESSIONAL_VERIFICATION_PATHWAYS)[number]["id"];

export const IDENTITY_VERIFICATION_PATHWAY = {
  id: "identity_standard",
  label: "Identity Verification",
  badgeLabel: "Verified Identity",
  description:
    "Optional review confirming authentic personal identity or official domain ownership. Unverified accounts retain full core Ping access.",
} as const;

export type VerificationPathway =
  (typeof IDENTITY_VERIFICATION_PATHWAY)["id"] | ProfessionalVerificationPathway;

export interface AccountVerificationRecord {
  id: string;
  user_id: string;
  verification_domain: VerificationDomain;
  pathway_type: VerificationPathway;
  status: VerificationStatus;
  organization_name: string;
  evidence_url: string | null;
  submission_note: string;
  reviewer_id: string | null;
  reviewer_note: string;
  verified_at: string | null;
  expires_at?: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicVerificationBadges {
  identity_verified: boolean;
  professional_verified: boolean;
  professional_pathway: ProfessionalVerificationPathway | null;
  identity_verified_at?: string | null;
  identity_expires_at?: string | null;
  professional_verified_at?: string | null;
  professional_expires_at?: string | null;
  organization_name?: string | null;
}

export function isVerificationExpired(expiresAt?: string | null, nowMs = Date.now()): boolean {
  if (!expiresAt) return false;
  const ts = new Date(expiresAt).getTime();
  return Number.isFinite(ts) && ts <= nowMs;
}

const RESERVED_IMPERSONATION_PATTERNS = [
  /^(ping|dot)[_.-]?(official|support|staff|admin|team|security|verify)$/i,
  /^official[_.-]?(ping|dot)/i,
  /^verified[_.-]/i,
  /\bverified\s+(account|user|profile|business|badge)\b/i,
  /[✓✔☑✅]/,
];

/**
 * Anti-impersonation check preventing misleading official/verified handles or checkmark glyphs.
 */
export function detectImpersonationRisk(
  username?: string | null,
  displayName?: string | null,
): { risky: boolean; reason?: string } {
  const u = (username ?? "").trim();
  const d = (displayName ?? "").trim();
  if (/[✓✔☑✅]/.test(d)) {
    return {
      risky: true,
      reason: "Display names cannot include verification checkmark symbols.",
    };
  }
  if (RESERVED_IMPERSONATION_PATTERNS.some((re) => re.test(u) || re.test(d))) {
    return {
      risky: true,
      reason:
        "This username or display name resembles an official Ping system or verification label.",
    };
  }
  return { risky: false };
}

export interface MyVerificationsState {
  migrated: boolean;
  records: AccountVerificationRecord[];
}

export function formatProfessionalBadgeLabel(pathway: string | null | undefined): string | null {
  if (!pathway) return null;
  return PROFESSIONAL_VERIFICATION_PATHWAYS.find((p) => p.id === pathway)?.badgeLabel ?? null;
}

export function formatVerificationStatusLabel(status?: VerificationStatus | null): string {
  switch (status) {
    case "verified":
      return "Verified";
    case "pending":
      return "Under review";
    case "rejected":
      return "Not approved";
    case "revoked":
      return "Revoked";
    default:
      return "Not requested (optional)";
  }
}

export const submitVerificationRequestSchema = z
  .object({
    verificationDomain: z.enum(VERIFICATION_DOMAINS),
    pathwayType: z.enum([
      "identity_standard",
      "creator",
      "business",
      "community_org",
      "builder",
      "investor",
    ]),
    organizationName: z
      .string()
      .trim()
      .max(120, "Organization name must be 120 characters or fewer"),
    evidenceUrl: z
      .string()
      .trim()
      .max(400, "Evidence URL must be 400 characters or fewer")
      .refine(
        (v) => v === "" || /^https:\/\/[^\s]+$/i.test(v),
        "Provide an https:// link to your official site, portfolio, or registry page",
      ),
    submissionNote: z.string().trim().max(500, "Summary note must be 500 characters or fewer"),
  })
  .superRefine((val, ctx) => {
    if (val.verificationDomain === "identity" && val.pathwayType !== "identity_standard") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Identity verification must use the standard identity pathway.",
        path: ["pathwayType"],
      });
    }
    if (val.verificationDomain === "professional" && val.pathwayType === "identity_standard") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select an account-type verification pathway.",
        path: ["pathwayType"],
      });
    }
    const pathwayMeta = PROFESSIONAL_VERIFICATION_PATHWAYS.find((p) => p.id === val.pathwayType);
    if (
      val.verificationDomain === "professional" &&
      pathwayMeta?.requiresOrganizationName &&
      val.organizationName.trim().length < 2
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Add the name of your ${pathwayMeta.label.toLowerCase()} entity for review.`,
        path: ["organizationName"],
      });
    }
  });

export type SubmitVerificationRequestInput = z.infer<typeof submitVerificationRequestSchema>;

function isMissingMigrationError(
  err: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!err) return false;
  const msg = (err.message ?? "").toLowerCase();
  return (
    err.code === "PGRST202" ||
    err.code === "PGRST205" ||
    err.code === "42883" ||
    err.code === "42P01" ||
    msg.includes("does not exist") ||
    msg.includes("could not find")
  );
}

export function publicVerificationQuery(userId?: string) {
  return queryOptions({
    queryKey: ["public-verification", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<PublicVerificationBadges> => {
      const empty: PublicVerificationBadges = {
        identity_verified: false,
        professional_verified: false,
        professional_pathway: null,
      };
      if (!userId || typeof supabase?.rpc !== "function") return empty;

      const { data, error } = await supabase.rpc("get_public_verification_badges", {
        _user_id: userId,
      });

      if (error) {
        if (isMissingMigrationError(error)) return empty;
        throw error;
      }
      if (!data || typeof data !== "object") return empty;

      const raw = data as Record<string, unknown>;
      const rawPathway =
        typeof raw["professional_pathway"] === "string" ? raw["professional_pathway"] : null;
      const pathway = PROFESSIONAL_VERIFICATION_PATHWAYS.some((p) => p.id === rawPathway)
        ? (rawPathway as ProfessionalVerificationPathway)
        : null;

      const identityExpiresAt =
        typeof raw["identity_expires_at"] === "string" ? raw["identity_expires_at"] : null;
      const profExpiresAt =
        typeof raw["professional_expires_at"] === "string" ? raw["professional_expires_at"] : null;
      const identityValid =
        raw["identity_verified"] === true && !isVerificationExpired(identityExpiresAt);
      const profValid =
        raw["professional_verified"] === true &&
        pathway !== null &&
        !isVerificationExpired(profExpiresAt);

      return {
        identity_verified: identityValid,
        professional_verified: profValid,
        professional_pathway: profValid ? pathway : null,
        identity_verified_at:
          typeof raw["identity_verified_at"] === "string" ? raw["identity_verified_at"] : null,
        identity_expires_at: identityExpiresAt,
        professional_verified_at:
          typeof raw["professional_verified_at"] === "string"
            ? raw["professional_verified_at"]
            : null,
        professional_expires_at: profExpiresAt,
        organization_name:
          typeof raw["organization_name"] === "string" ? raw["organization_name"] : null,
      };
    },
  });
}

export function myVerificationsQuery(userId?: string) {
  return queryOptions({
    queryKey: ["my-verifications", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<MyVerificationsState> => {
      if (!userId) return { migrated: true, records: [] };

      const { data, error } = await supabase
        .from("account_verifications")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });

      if (error) {
        if (isMissingMigrationError(error)) {
          return { migrated: false, records: [] };
        }
        throw error;
      }

      return {
        migrated: true,
        records: (data ?? []) as unknown as AccountVerificationRecord[],
      };
    },
  });
}

export function useSubmitVerificationRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rawInput: SubmitVerificationRequestInput) => {
      const parsed = submitVerificationRequestSchema.parse(rawInput);
      const { data, error } = await supabase.rpc("submit_verification_request", {
        _verification_domain: parsed.verificationDomain,
        _pathway_type: parsed.pathwayType,
        _organization_name: parsed.organizationName,
        _evidence_url: parsed.evidenceUrl || null,
        _submission_note: parsed.submissionNote,
      });
      if (error) throw error;
      return data as unknown as AccountVerificationRecord;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-verifications"] });
      qc.invalidateQueries({ queryKey: ["public-verification"] });
    },
  });
}
