import { Award, Building2, Crown, Flame, Sparkles } from "lucide-react";
import { VerificationBadge } from "@/components/verification/VerificationBadge";
import type { PublicVerificationBadges } from "@/lib/verification";
import type { AccountTier } from "@/lib/economy";
import { cn } from "@/lib/utils";

export interface AccountStatusBadgesProps {
  /** Paid subscription tier — NEVER uses checkmark/shield icons to avoid implying verification */
  membershipTier?: AccountTier | "business" | null | undefined;
  /** Separate identity / professional verification record */
  userId?: string | null | undefined;
  verificationBadges?: PublicVerificationBadges | null | undefined;
  businessVerified?: boolean | undefined;
  businessName?: string | undefined;
  /** Completed Ping Learn courses (e.g. Leapfrog Graduate) */
  completedCoursesCount?: number | undefined;
  /** Editorial merit selection for Ping Spotlight */
  isSpotlightHonoree?: boolean | undefined;
  compact?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Unified, Visually Distinct Status Badge Bar (Addendum Section 5).
 *
 * Guarantees six unmistakable visual states:
 * 1. Builder Plus membership     -> Sparkles outline pill (lime accent, NO checkmark)
 * 2. Builder Pro membership      -> Crown pill (champagne gold, NO checkmark)
 * 3. Identity verification       -> BadgeCheck popover via VerificationBadge (Ping Green)
 * 4. Business verification       -> Building2/ShieldCheck popover via VerificationBadge (Gold)
 * 5. Course completion           -> Award/Graduation pill (emerald/secondary, learning achievement)
 * 6. Ping Spotlight selection    -> Flame editorial ribbon (merit-selected, never purchasable)
 */
export function AccountStatusBadges({
  membershipTier,
  userId,
  verificationBadges,
  businessVerified = false,
  businessName,
  completedCoursesCount = 0,
  isSpotlightHonoree = false,
  compact = false,
  className,
}: AccountStatusBadgesProps) {
  const pillBase = compact
    ? "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
    : "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold";

  return (
    <span
      data-testid="account-status-badges"
      className={cn("inline-flex flex-wrap items-center gap-1.5", className)}
    >
      {/* 1 & 2. Membership Tier Badges (Explicitly distinct from verification checkmarks!) */}
      {membershipTier === "plus" && (
        <span
          data-testid="badge-builder-plus"
          title="Builder Plus paid membership — separate from identity verification"
          className={cn(
            pillBase,
            "border border-lime/40 bg-lime/15 text-lime-foreground dark:text-lime",
          )}
        >
          <Sparkles className="size-3 shrink-0" aria-hidden="true" />
          Builder Plus
        </span>
      )}
      {membershipTier === "pro" && (
        <span
          data-testid="badge-builder-pro"
          title="Builder Pro paid membership — separate from identity verification"
          className={cn(pillBase, "border border-gold/40 bg-gold/15 text-gold")}
        >
          <Crown className="size-3 shrink-0" aria-hidden="true" />
          Builder Pro
        </span>
      )}
      {(membershipTier === "institution" || membershipTier === "business") && (
        <span
          data-testid="badge-organization-plan"
          title="Organization / Business membership plan — separate from identity verification"
          className={cn(pillBase, "border border-border bg-secondary text-secondary-foreground")}
        >
          <Building2 className="size-3 shrink-0" aria-hidden="true" />
          Organization Plan
        </span>
      )}

      {/* 3 & 4. Separate Identity & Business Verification Popover Badge */}
      <VerificationBadge
        userId={userId}
        badges={verificationBadges}
        businessVerified={businessVerified}
        businessName={businessName}
        showLabel={!compact}
        size={compact ? "xs" : "sm"}
      />

      {/* 5. Ping Learn Course Completion Achievement */}
      {completedCoursesCount > 0 && (
        <span
          data-testid="badge-course-completion"
          title={`Completed ${completedCoursesCount} Ping Learn course${completedCoursesCount === 1 ? "" : "s"}`}
          className={cn(
            pillBase,
            "border border-emerald-500/35 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
          )}
        >
          <Award className="size-3 shrink-0" aria-hidden="true" />
          {completedCoursesCount === 1
            ? "Ping Learn Certified"
            : `${completedCoursesCount} Courses Certified`}
        </span>
      )}

      {/* 6. Ping Spotlight Merit Honoree */}
      {isSpotlightHonoree && (
        <span
          data-testid="badge-spotlight-honoree"
          title="Selected on merit by the Ping Spotlight Editorial Team — never purchasable"
          className={cn(
            pillBase,
            "border border-amber-500/45 bg-amber-500/15 text-amber-700 dark:text-amber-300",
          )}
        >
          <Flame className="size-3 shrink-0" aria-hidden="true" />
          Ping Spotlight
        </span>
      )}
    </span>
  );
}
