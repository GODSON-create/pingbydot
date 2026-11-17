import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Shield, AlertTriangle, Users, FileText, Ban } from "lucide-react";
import { pageHead } from "@/lib/site";

export const Route = createFileRoute("/terms")({
  staticData: { sitemap: true },
  head: () =>
    pageHead({
      title: "Terms of Service & EULA — Ping by DOT",
      description:
        "Terms of service, community safety guidelines, and user agreement for Ping by DOT.",
      path: "/terms",
    }),
  component: TermsOfServicePage,
});

function TermsOfServicePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="size-4" /> Back to Home
      </Link>

      <div className="space-y-8">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold mb-3">
            <FileText className="size-3.5" /> End User License Agreement
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
            Terms of Service & EULA
          </h1>
          <p className="text-xs text-muted-foreground mt-2 font-mono">
            Last updated: November 12, 2026
          </p>
        </div>

        <section className="surface-card rounded-3xl p-6 sm:p-8 border border-border/70 space-y-4 text-sm leading-relaxed text-foreground/90">
          <h2 className="font-display font-bold text-lg text-foreground flex items-center gap-2">
            <Users className="size-4 text-primary" /> 1. Acceptance of Terms
          </h2>
          <p>
            By accessing or using Ping by DOT (via web, iOS, Android, or related APIs), you agree to
            be bound by these Terms of Service. If you do not agree to these terms, do not access or
            use Ping by DOT.
          </p>
        </section>

        <section className="surface-card rounded-3xl p-6 sm:p-8 border border-border/70 space-y-4 text-sm leading-relaxed text-foreground/90">
          <h2 className="font-display font-bold text-lg text-foreground flex items-center gap-2 text-destructive">
            <Ban className="size-4" /> 2. Zero Tolerance for Objectionable Content (EULA)
          </h2>
          <p>
            In accordance with App Store Review Guideline 1.2 and Google Play Developer Policies:
          </p>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>No Abusive Behavior:</strong> Harassment, hate speech, bullying, defamation,
              threats of violence, non-consensual imagery, and sexually explicit content are
              strictly prohibited.
            </li>
            <li>
              <strong>Immediate Removal:</strong> Any content found in violation of these standards
              will be removed immediately upon review.
            </li>
            <li>
              <strong>Account Suspension:</strong> Users who post objectionable content or engage in
              abusive conduct will have their accounts immediately suspended or terminated.
            </li>
          </ul>
        </section>

        <section className="surface-card rounded-3xl p-6 sm:p-8 border border-border/70 space-y-4 text-sm leading-relaxed text-foreground/90">
          <h2 className="font-display font-bold text-lg text-foreground flex items-center gap-2">
            <AlertTriangle className="size-4 text-primary" /> 3. Reporting and Blocking Controls
          </h2>
          <p>
            Ping by DOT provides built-in tools on every post, comment, Moment, Hub, and direct
            message:
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <strong>One-Click Reporting:</strong> Tap the &ldquo;Report&rdquo; option from the
              options menu on any item to submit it to our moderation team. Reports are reviewed
              within 24 hours.
            </li>
            <li>
              <strong>Instant Blocking:</strong> Tap &ldquo;Block User&rdquo; on any profile or
              direct conversation to immediately prevent that user from contacting you, viewing your
              profile, or exchanging messages.
            </li>
          </ul>
        </section>

        <section className="surface-card rounded-3xl p-6 sm:p-8 border border-border/70 space-y-4 text-sm leading-relaxed text-foreground/90">
          <h2 className="font-display font-bold text-lg text-foreground flex items-center gap-2">
            <Shield className="size-4 text-primary" /> 4. Institutional Verification
          </h2>
          <p>
            Official institutional Signals displaying Champagne Gold verification badges have
            verified their affiliation with accredited academic institutions, enterprises, or
            organizations. Impersonating official institutions or misrepresenting authorized
            publisher status is grounds for immediate permanent account bans.
          </p>
        </section>

        <section className="surface-card rounded-3xl p-6 sm:p-8 border border-border/70 space-y-4 text-sm leading-relaxed text-foreground/90">
          <h2 className="font-display font-bold text-lg text-foreground flex items-center gap-2">
            5. Contact Information
          </h2>
          <p>
            For legal inquiries or terms enforcement:{" "}
            <a href="mailto:support@pingbydot.app" className="text-primary underline font-medium">
              support@pingbydot.app
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
