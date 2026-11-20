import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Coins,
  Flag,
  Info,
  Megaphone,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { dotSummaryQuery } from "@/lib/economy";
import { CURATED_DOT_TAGS } from "@/lib/dot-tags";
import {
  BOOST_AUDIENCE_OPTIONS,
  BOOST_DURATION_OPTIONS,
  calculateBoostDotPrice,
  estimateBoostDelivery,
  generateBoostIdempotencyKey,
  myBoostCampaignsQuery,
  PERMITTED_BOOST_REGIONS,
  useCreateBoostCampaign,
  useReportBoostCampaign,
  validateMomentBoostEligibility,
  type BoostAudience,
  type BoostCampaign,
  type BoostContentType,
  type BoostDurationHours,
} from "@/lib/boosts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface BoostTargetItem {
  contentType: BoostContentType;
  contentId: string;
  previewText: string;
  momentExpiresAt?: string | null | undefined;
  momentAudience?: string | null | undefined;
}

export function BoostContentDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: BoostTargetItem | null;
}) {
  const { user } = useAuth();
  const { data: dotSummary } = useQuery(dotSummaryQuery(user?.id));
  const { data: campaignsState } = useQuery(myBoostCampaignsQuery(user?.id));
  const createBoost = useCreateBoostCampaign();

  const [step, setStep] = useState<"configure" | "review" | "done">("configure");
  const [durationHours, setDurationHours] = useState<BoostDurationHours>(24);
  const [audience, setAudience] = useState<BoostAudience>("everyone");
  const [selectedInterests, setSelectedInterests] = useState<string[]>(["technology", "africa"]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>(["GLOBAL"]);
  const [idempotencyKey, setIdempotencyKey] = useState<string>("");
  const [createdCampaign, setCreatedCampaign] = useState<BoostCampaign | null>(null);

  const balance = dotSummary?.wallet.balance ?? 0;
  const exactPrice = calculateBoostDotPrice(durationHours, audience);
  const insufficientBalance = balance < exactPrice;

  const momentEligibility = useMemo(() => {
    if (!target || target.contentType !== "moment") {
      return { eligible: true, remainingHours: 999 };
    }
    return validateMomentBoostEligibility({
      audience: target.momentAudience,
      expiresAt: target.momentExpiresAt,
      durationHours,
    });
  }, [target, durationHours]);

  const deliveryEstimate = useMemo(
    () =>
      estimateBoostDelivery(
        (campaignsState?.campaigns ?? []).filter((c) => c.status === "completed"),
      ),
    [campaignsState?.campaigns],
  );

  if (!target) return null;

  const toggleInterest = (slug: string) => {
    setSelectedInterests((prev) =>
      prev.includes(slug) ? prev.filter((x) => x !== slug) : [...prev, slug].slice(0, 6),
    );
  };

  const toggleRegion = (code: string) => {
    setSelectedRegions((prev) => {
      if (code === "GLOBAL") return ["GLOBAL"];
      const withoutGlobal = prev.filter((r) => r !== "GLOBAL");
      const next = withoutGlobal.includes(code)
        ? withoutGlobal.filter((r) => r !== code)
        : [...withoutGlobal, code].slice(0, 6);
      return next.length > 0 ? next : ["GLOBAL"];
    });
  };

  const proceedToReview = () => {
    if (!momentEligibility.eligible) {
      toast.error(
        momentEligibility.reason || "Moment lifetime is incompatible with this duration.",
      );
      return;
    }
    if (!idempotencyKey && user?.id) {
      setIdempotencyKey(generateBoostIdempotencyKey(user.id, target.contentType, target.contentId));
    }
    setStep("review");
  };

  const handleConfirmPurchase = async () => {
    if (!user?.id) {
      toast.error("Sign in to boost content.");
      return;
    }
    if (!momentEligibility.eligible) {
      toast.error(momentEligibility.reason || "Ineligible for boost.");
      return;
    }
    const key =
      idempotencyKey || generateBoostIdempotencyKey(user.id, target.contentType, target.contentId);
    setIdempotencyKey(key);

    try {
      const res = await createBoost.mutateAsync({
        contentType: target.contentType,
        contentId: target.contentId,
        durationHours,
        audience,
        targetInterests: audience === "interest_matched" ? selectedInterests : [],
        targetRegions: audience === "regional" ? selectedRegions : ["GLOBAL"],
        idempotencyKey: key,
      });
      setCreatedCampaign(res.campaign);
      setStep("done");
      toast.success(
        res.idempotent_replay
          ? "Boost campaign already active (duplicate charge prevented)"
          : `Boost activated! Receipt ${res.campaign.receipt_number}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not activate boost campaign.");
    }
  };

  const resetAndClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setStep("configure");
      setIdempotencyKey("");
      setCreatedCampaign(null);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogContent className="sm:max-w-lg rounded-3xl p-6 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <Megaphone className="size-5 text-primary" /> Boost{" "}
            {target.contentType === "moment" ? "Moment" : "Ping"} with DOT
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Transparent DOT-powered promotion. Promoted items are clearly labelled and tracked using
            real observed events only.
          </DialogDescription>
        </DialogHeader>

        {/* Selected Content Preview */}
        <div className="rounded-2xl border border-border/70 bg-secondary/40 p-3 text-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
            Selected {target.contentType}
          </span>
          <p className="mt-1 text-foreground line-clamp-2">{target.previewText || "Media item"}</p>
        </div>

        {step === "configure" && (
          <div className="space-y-4">
            {/* Step 2: Duration */}
            <div>
              <Label className="text-xs font-bold flex items-center gap-1.5">
                <Clock className="size-3.5 text-primary" /> Campaign Duration
              </Label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {BOOST_DURATION_OPTIONS.map((opt) => {
                  const momentCheck =
                    target.contentType === "moment"
                      ? validateMomentBoostEligibility({
                          audience: target.momentAudience,
                          expiresAt: target.momentExpiresAt,
                          durationHours: opt.hours,
                        })
                      : { eligible: true };
                  return (
                    <button
                      key={opt.hours}
                      type="button"
                      disabled={!momentCheck.eligible}
                      onClick={() => setDurationHours(opt.hours)}
                      className={cn(
                        "rounded-2xl border px-3 py-2 text-left text-xs transition-all",
                        durationHours === opt.hours
                          ? "border-primary bg-primary/15 text-foreground font-bold"
                          : "border-border bg-card hover:bg-secondary",
                        !momentCheck.eligible && "opacity-40 cursor-not-allowed",
                      )}
                    >
                      <span className="block">{opt.label}</span>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {opt.baseDotPrice} DOT
                      </span>
                    </button>
                  );
                })}
              </div>
              {!momentEligibility.eligible && (
                <p
                  role="alert"
                  className="mt-2 flex items-start gap-1.5 rounded-xl border border-destructive/30 bg-destructive/10 p-2.5 text-[11px] text-destructive"
                >
                  <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                  <span>{momentEligibility.reason}</span>
                </p>
              )}
            </div>

            {/* Step 3: Audience */}
            <div>
              <Label className="text-xs font-bold">Audience Targeting</Label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {BOOST_AUDIENCE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setAudience(opt.id)}
                    className={cn(
                      "rounded-2xl border p-3 text-left text-xs transition-all",
                      audience === opt.id
                        ? "border-primary bg-primary/12"
                        : "border-border bg-card hover:bg-secondary/60",
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-bold text-foreground">{opt.label}</span>
                      {opt.surchargeDots > 0 && (
                        <span className="text-[10px] font-semibold text-primary">
                          +{opt.surchargeDots} DOT
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{opt.description}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Step 4: Permitted DOT Tags or Geographic Regions */}
            {audience === "interest_matched" && (
              <div>
                <Label className="text-xs font-bold">Permitted DOT Tags / Interests</Label>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {CURATED_DOT_TAGS.slice(0, 12).map((tag) => (
                    <button
                      key={tag.slug}
                      type="button"
                      onClick={() => toggleInterest(tag.slug)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                        selectedInterests.includes(tag.slug)
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-card text-muted-foreground",
                      )}
                    >
                      {tag.display_tag}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {audience === "regional" && (
              <div>
                <Label className="text-xs font-bold">Permitted Geographic Regions</Label>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {PERMITTED_BOOST_REGIONS.map((code) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => toggleRegion(code)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                        selectedRegions.includes(code)
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-card text-muted-foreground",
                      )}
                    >
                      {code}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 5 & 6: Honest Delivery Estimate + Exact DOT Price */}
            <div className="rounded-2xl border border-border/70 bg-secondary/35 p-3.5 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Exact DOT Price</span>
                <span className="font-display text-base font-extrabold text-foreground tabular-nums flex items-center gap-1">
                  <Coins className="size-4 text-gold" /> {exactPrice} DOT
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Your DOT Wallet</span>
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    insufficientBalance ? "text-destructive" : "text-primary",
                  )}
                >
                  {balance.toLocaleString()} DOT
                </span>
              </div>
              <div className="pt-2 border-t border-border/50 flex items-start gap-2 text-[11px] text-muted-foreground">
                <Info className="size-3.5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-foreground">{deliveryEstimate.label}</p>
                  <p>{deliveryEstimate.disclaimer}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => resetAndClose(false)}
                className="rounded-full text-xs"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="hero"
                disabled={!momentEligibility.eligible}
                onClick={proceedToReview}
                className="rounded-full text-xs gap-1.5"
              >
                Review Campaign <ArrowRight className="size-3.5" />
              </Button>
            </div>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-border/70 bg-secondary/40 p-4 space-y-2 text-xs">
              <p className="font-display font-bold text-sm text-foreground">Campaign Review</p>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Duration</span>
                <span className="font-semibold">{durationHours} hours</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Audience</span>
                <span className="font-semibold capitalize">{audience.replace(/_/g, " ")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total DOT Debit</span>
                <span className="font-bold text-gold tabular-nums">{exactPrice} DOT</span>
              </div>
              <p className="pt-2 border-t border-border/50 text-[11px] text-muted-foreground">
                This debit is verified atomically on the server with idempotency protection.
                Promoted content is visibly labelled and subject to community moderation.
              </p>
            </div>

            {insufficientBalance && (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center justify-between gap-2">
                <span>Need {exactPrice - balance} more DOT in your wallet.</span>
                <Button asChild size="sm" variant="outline" className="rounded-full text-xs">
                  <Link to="/balance" onClick={() => resetAndClose(false)}>
                    Open Wallet
                  </Link>
                </Button>
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep("configure")}
                className="rounded-full text-xs"
              >
                Back
              </Button>
              <Button
                type="button"
                variant="hero"
                disabled={createBoost.isPending || insufficientBalance}
                onClick={() => void handleConfirmPurchase()}
                className="rounded-full text-xs gap-1.5"
              >
                <Sparkles className="size-3.5" />
                {createBoost.isPending ? "Activating…" : `Confirm & Spend ${exactPrice} DOT`}
              </Button>
            </div>
          </div>
        )}

        {step === "done" && createdCampaign && (
          <div className="space-y-4 text-center py-3">
            <CheckCircle2 className="mx-auto size-11 text-primary" />
            <div>
              <h3 className="font-display text-lg font-extrabold">Campaign Activated</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Receipt{" "}
                <span className="font-mono font-bold">{createdCampaign.receipt_number}</span> ·{" "}
                {createdCampaign.dot_cost} DOT · {createdCampaign.duration_hours}h active window.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild variant="hero" size="sm" className="rounded-full text-xs">
                <Link to="/boosts" onClick={() => resetAndClose(false)}>
                  Track Performance on Dashboard
                </Link>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => resetAndClose(false)}
                className="rounded-full text-xs"
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Honest Promoted label + Report Promotion control for boosted Pings and Moments.
 */
export function PromotedBadge({ campaignId }: { campaignId: string }) {
  const { user } = useAuth();
  const reportBoost = useReportBoostCampaign(user?.id);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        data-testid="promoted-content-badge"
        className="relative z-20 inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gold hover:bg-gold/25 transition-colors"
        title="Promoted with DOT — click to inspect or report"
      >
        <Megaphone className="size-2.5" /> Promoted
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onClick={(e) => e.stopPropagation()} className="sm:max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-lg flex items-center gap-2">
              <Flag className="size-4 text-primary" /> About This Promoted Post
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              The author boosted this post using DOT credits. Report promotions that violate Ping
              community or anti-spam rules.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (reason.trim().length < 3) return;
              try {
                await reportBoost.mutateAsync({ campaignId, reason, details });
                toast.success("Promotion report submitted for moderation review.");
                setOpen(false);
                setReason("");
                setDetails("");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Could not submit report.");
              }
            }}
            className="space-y-3 mt-2"
          >
            <div>
              <Label className="text-xs">Reason</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Misleading claim, spam, impersonation"
                required
                minLength={3}
                className="mt-1 rounded-xl text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">Details (optional)</Label>
              <Textarea
                rows={2}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                className="mt-1 rounded-xl text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                className="rounded-full text-xs"
              >
                Close
              </Button>
              <Button
                type="submit"
                variant="hero"
                size="sm"
                disabled={reportBoost.isPending || !user}
                className="rounded-full text-xs"
              >
                {user ? "Submit Report" : "Sign in to Report"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
