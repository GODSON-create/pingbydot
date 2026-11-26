import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Building2, CalendarClock, Info, ShieldCheck } from "lucide-react";
import { format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  formatProfessionalBadgeLabel,
  isVerificationExpired,
  publicVerificationQuery,
  type PublicVerificationBadges,
} from "@/lib/verification";
import { cn } from "@/lib/utils";

interface VerificationBadgeProps {
  /** Pass userId to auto-load public verification badges, OR pass explicit `badges` / `businessVerified`. */
  userId?: string | null | undefined;
  badges?: PublicVerificationBadges | null | undefined;
  businessVerified?: boolean | undefined;
  businessName?: string | undefined;
  size?: "xs" | "sm" | "md" | undefined;
  showLabel?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Canonical, reusable Ping Verification Badge (Section 2 & 10).
 *
 * - Distinguishes Verified Individual (`identity_verified`) from Verified Business /
 *   Organization (`professional_verified` / `businessVerified`).
 * - Tapping/clicking opens an accessible explanation popover detailing what was
 *   verified, verification/expiry dates, and confirming that identity verification
 *   is strictly separate from paid DOT subscriptions.
 * - Never renders for unverified accounts or expired credentials.
 */
export function VerificationBadge({
  userId,
  badges: explicitBadges,
  businessVerified = false,
  businessName,
  size = "sm",
  showLabel = false,
  className,
}: VerificationBadgeProps) {
  const shouldFetch = Boolean(userId && !explicitBadges && !businessVerified);
  const { data: fetchedBadges } = useQuery({
    ...publicVerificationQuery(shouldFetch ? (userId ?? undefined) : undefined),
    staleTime: 120_000,
  });

  const resolved = explicitBadges ?? fetchedBadges;
  const identityOk = Boolean(
    resolved?.identity_verified && !isVerificationExpired(resolved.identity_expires_at),
  );
  const profOk = Boolean(
    resolved?.professional_verified && !isVerificationExpired(resolved.professional_expires_at),
  );

  if (!businessVerified && !identityOk && !profOk) {
    return null;
  }

  const isOrgOrBiz =
    businessVerified ||
    resolved?.professional_pathway === "business" ||
    resolved?.professional_pathway === "community_org" ||
    resolved?.professional_pathway === "investor";

  const label = businessVerified
    ? "Verified Business"
    : profOk
      ? (formatProfessionalBadgeLabel(resolved?.professional_pathway) ?? "Verified Account")
      : "Verified Identity";

  const verifiedAt = businessVerified
    ? null
    : profOk
      ? resolved?.professional_verified_at
      : resolved?.identity_verified_at;
  const expiresAt = businessVerified
    ? null
    : profOk
      ? resolved?.professional_expires_at
      : resolved?.identity_expires_at;

  const iconSize = size === "xs" ? "size-3.5" : size === "md" ? "size-4.5" : "size-4";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          data-testid="verification-badge-trigger"
          aria-label={`${label} — click for verification details`}
          title={label}
          className={cn(
            "relative z-20 inline-flex items-center gap-1 rounded-full align-middle transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            showLabel
              ? isOrgOrBiz
                ? "border border-gold/40 bg-gold/15 px-2.5 py-0.5 text-[11px] font-bold text-gold"
                : "border border-primary/35 bg-primary/12 px-2.5 py-0.5 text-[11px] font-bold text-primary"
              : "p-0.5",
            className,
          )}
        >
          {isOrgOrBiz ? (
            <ShieldCheck className={cn(iconSize, "text-gold shrink-0")} />
          ) : (
            <BadgeCheck className={cn(iconSize, "text-primary shrink-0")} />
          )}
          {showLabel && <span>{label}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        onClick={(e) => e.stopPropagation()}
        className="w-72 rounded-2xl p-4 text-xs space-y-2.5 shadow-lift"
      >
        <div className="flex items-start gap-2.5">
          <div
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-xl",
              isOrgOrBiz ? "bg-gold/15 text-gold" : "bg-primary/15 text-primary",
            )}
          >
            {isOrgOrBiz ? <Building2 className="size-4" /> : <BadgeCheck className="size-4" />}
          </div>
          <div className="min-w-0">
            <p className="font-display font-bold text-sm text-foreground">{label}</p>
            <p className="text-[11px] text-muted-foreground">
              {businessVerified
                ? `${businessName || "This business"} passed authentic organisation review on Ping.`
                : isOrgOrBiz
                  ? `Confirmed ${resolved?.organization_name || "organisation"} ownership via administrator review.`
                  : "Confirmed authentic individual identity through Ping's optional verification review."}
            </p>
          </div>
        </div>

        {(verifiedAt || expiresAt) && (
          <div className="rounded-xl bg-secondary/45 px-3 py-2 text-[11px] space-y-1 text-muted-foreground">
            {verifiedAt && (
              <p className="flex items-center gap-1.5">
                <CalendarClock className="size-3 text-primary shrink-0" />
                Verified: {format(new Date(verifiedAt), "MMM d, yyyy")}
              </p>
            )}
            {expiresAt && (
              <p className="flex items-center gap-1.5">
                <CalendarClock className="size-3 text-gold shrink-0" />
                Valid until: {format(new Date(expiresAt), "MMM d, yyyy")}
              </p>
            )}
          </div>
        )}

        <div className="flex items-start gap-1.5 pt-1 border-t border-border/60 text-[11px] text-muted-foreground">
          <Info className="size-3.5 text-primary shrink-0 mt-0.5" />
          <span>
            Verification is granted strictly via review and anti-impersonation checks — never
            purchased or automatically granted by spending DOT credits.
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
