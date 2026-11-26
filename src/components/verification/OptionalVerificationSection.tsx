import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BadgeCheck,
  Building2,
  CheckCircle2,
  Clock,
  Info,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import {
  IDENTITY_VERIFICATION_PATHWAY,
  PROFESSIONAL_VERIFICATION_PATHWAYS,
  formatVerificationStatusLabel,
  myVerificationsQuery,
  submitVerificationRequestSchema,
  useSubmitVerificationRequest,
  type ProfessionalVerificationPathway,
  type VerificationDomain,
} from "@/lib/verification";
import { cn } from "@/lib/utils";

export function OptionalVerificationSection() {
  const { user } = useAuth();
  const { data: verificationsState, isLoading } = useQuery(myVerificationsQuery(user?.id));
  const submitMutation = useSubmitVerificationRequest();

  const [domain, setDomain] = useState<VerificationDomain>("identity");
  const [pathway, setPathway] = useState<ProfessionalVerificationPathway>("creator");
  const [organizationName, setOrganizationName] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [submissionNote, setSubmissionNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const records = verificationsState?.records ?? [];
  const identityRecord = records.find((r) => r.verification_domain === "identity");
  const professionalRecord = records.find((r) => r.verification_domain === "professional");
  const selectedProfessionalMeta = PROFESSIONAL_VERIFICATION_PATHWAYS.find((p) => p.id === pathway);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (verificationsState && !verificationsState.migrated) {
      toast.info("Optional verification reviews unlock once database migration 0026 is applied.");
      return;
    }

    const parsed = submitVerificationRequestSchema.safeParse({
      verificationDomain: domain,
      pathwayType: domain === "identity" ? "identity_standard" : pathway,
      organizationName,
      evidenceUrl,
      submissionNote,
    });

    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message || "Check your verification details.");
      return;
    }

    try {
      await submitMutation.mutateAsync(parsed.data);
      toast.success("Verification request submitted for administrator review.");
      setSubmissionNote("");
      setEvidenceUrl("");
      setOrganizationName("");
    } catch (err: any) {
      setFormError(err?.message || "Couldn't submit verification request. Please try again.");
    }
  };

  return (
    <section
      aria-labelledby="optional-verification-heading"
      className="surface-card mt-10 rounded-[2rem] p-6 sm:p-8"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-[11px] font-semibold text-secondary-foreground">
            <BadgeCheck className="size-3.5 text-primary" />
            Voluntary · Never Required
          </span>
          <h2
            id="optional-verification-heading"
            className="mt-3 font-display text-2xl font-extrabold tracking-tight"
          >
            Optional Verification Pathways
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Establish additional trust for your identity or professional account type if helpful.
            Unverified accounts enjoy full access to ordinary Ping features with no restrictions.
          </p>
        </div>
      </div>

      {/* Role & Permission Separation Notice */}
      <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-border/70 bg-secondary/40 p-3.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>
          Identity verification, professional account verification, and platform role permissions
          are strictly separate. Selecting an account category (such as Business or Investor) does
          not grant administrative permissions or self-approval authority.
        </p>
      </div>

      {/* Current Separate Status Cards */}
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-border/70 bg-card/60 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <UserCheck className="size-4 text-primary" /> Identity Verification
            </span>
            <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-semibold">
              {isLoading ? "…" : formatVerificationStatusLabel(identityRecord?.status)}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {IDENTITY_VERIFICATION_PATHWAY.description}
          </p>
          {identityRecord?.reviewer_note && (
            <p className="mt-2 text-xs text-foreground/80">
              Review note: {identityRecord.reviewer_note}
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-border/70 bg-card/60 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Building2 className="size-4 text-gold" /> Professional / Account-Type
            </span>
            <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-semibold">
              {isLoading ? "…" : formatVerificationStatusLabel(professionalRecord?.status)}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Optional review for Creators, Businesses, Communities/Organizations, Builders, and
            Investors.
          </p>
          {professionalRecord?.pathway_type && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
              {professionalRecord.status === "verified" ? (
                <CheckCircle2 className="size-3.5 text-primary" />
              ) : (
                <Clock className="size-3.5 text-muted-foreground" />
              )}
              Pathway: {professionalRecord.pathway_type.replace("_", " ")}
              {professionalRecord.organization_name
                ? ` · ${professionalRecord.organization_name}`
                : ""}
            </p>
          )}
        </div>
      </div>

      {/* Optional Submission Form */}
      <form onSubmit={handleSubmit} className="mt-6 space-y-4 border-t border-border/60 pt-5">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Verification domain">
          <button
            type="button"
            onClick={() => {
              setDomain("identity");
              setFormError(null);
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors",
              domain === "identity"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-secondary text-foreground",
            )}
          >
            <UserCheck className="size-3.5" /> Identity Verification
          </button>
          <button
            type="button"
            onClick={() => {
              setDomain("professional");
              setFormError(null);
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors",
              domain === "professional"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-secondary text-foreground",
            )}
          >
            <ShieldCheck className="size-3.5" /> Professional / Account-Type
          </button>
        </div>

        {domain === "professional" && (
          <div>
            <Label htmlFor="verification-pathway" className="text-xs font-semibold">
              Account-Type Pathway
            </Label>
            <select
              id="verification-pathway"
              value={pathway}
              onChange={(e) => setPathway(e.target.value as ProfessionalVerificationPathway)}
              className="mt-1.5 flex h-10 w-full rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {PROFESSIONAL_VERIFICATION_PATHWAYS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} — {p.description}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="verification-org-name" className="text-xs font-semibold">
              {domain === "professional" && selectedProfessionalMeta?.requiresOrganizationName
                ? "Organization, Business, or Fund Name"
                : "Display or Brand Name (Optional)"}
            </Label>
            <Input
              id="verification-org-name"
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              maxLength={120}
              placeholder={
                domain === "identity"
                  ? "Optional personal/project reference"
                  : "e.g., Horizon Studio LLC"
              }
              className="mt-1.5 rounded-xl text-xs"
            />
          </div>

          <div>
            <Label htmlFor="verification-evidence-url" className="text-xs font-semibold">
              Official Website or Public Profile (HTTPS, Optional)
            </Label>
            <Input
              id="verification-evidence-url"
              type="url"
              value={evidenceUrl}
              onChange={(e) => setEvidenceUrl(e.target.value)}
              maxLength={400}
              placeholder="https://example.com/about"
              className="mt-1.5 rounded-xl text-xs"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="verification-note" className="text-xs font-semibold">
            Context for Reviewer (Optional — No ID numbers or sensitive documents)
          </Label>
          <Textarea
            id="verification-note"
            value={submissionNote}
            onChange={(e) => setSubmissionNote(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Share public links or domain context showing authentic ownership."
            className="mt-1.5 rounded-xl text-xs"
          />
        </div>

        {formError && (
          <p role="alert" className="text-xs font-medium text-destructive">
            {formError}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground">
            Submitted requests enter administrator review (<Sparkles className="inline size-3" />{" "}
            optional &amp; free of charge).
          </p>
          <Button
            type="submit"
            size="sm"
            disabled={submitMutation.isPending}
            className="rounded-full px-5 font-semibold"
          >
            {submitMutation.isPending ? "Submitting…" : "Request Optional Review"}
          </Button>
        </div>
      </form>
    </section>
  );
}
