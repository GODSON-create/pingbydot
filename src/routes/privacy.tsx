import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Shield, Lock, Eye, Trash2, Database, Globe } from "lucide-react";
import { pageHead } from "@/lib/site";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/privacy")({
  staticData: { sitemap: true },
  head: () =>
    pageHead({
      title: "Privacy Policy — Ping by DOT",
      description:
        "Learn how Ping by DOT protects your data, messages, privacy, and account security.",
      path: "/privacy",
    }),
  component: PrivacyPolicyPage,
});

function PrivacyPolicyPage() {
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
            <Shield className="size-3.5" /> Data Protection & Privacy
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
            Privacy Policy
          </h1>
          <p className="text-xs text-muted-foreground mt-2 font-mono">
            Last updated: November 12, 2026
          </p>
        </div>

        <section className="surface-card rounded-3xl p-6 sm:p-8 border border-border/70 space-y-4 text-sm leading-relaxed text-foreground/90">
          <h2 className="font-display font-bold text-lg text-foreground flex items-center gap-2">
            <Lock className="size-4 text-primary" /> 1. Commitment to Privacy
          </h2>
          <p>
            Ping by DOT (&ldquo;Ping&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is built on the
            principle that social interactions and institutional communications should never
            compromise personal privacy. We do not sell personal data, do not profile users for
            third-party advertising, and give you complete control over your content.
          </p>
        </section>

        <section className="surface-card rounded-3xl p-6 sm:p-8 border border-border/70 space-y-4 text-sm leading-relaxed text-foreground/90">
          <h2 className="font-display font-bold text-lg text-foreground flex items-center gap-2">
            <Database className="size-4 text-primary" /> 2. Information We Collect
          </h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>Account Information:</strong> When you register, we collect your email
              address, chosen username, display name, and optional avatar or biography.
            </li>
            <li>
              <strong>Pings & Moments:</strong> Public or audience-restricted posts, ephemeral
              Moments (auto-expiring after 24 hours unless saved as highlights), and interactions.
            </li>
            <li>
              <strong>Direct Messages & Hub Chat:</strong> Messages sent in private one-to-one
              conversations or joined Hubs. Private messages are strictly restricted via Row Level
              Security (RLS) so that only conversation participants can access them.
            </li>
            <li>
              <strong>Device & Analytics:</strong> Minimal crash diagnostic telemetry necessary to
              maintain service reliability across web, iOS, and Android clients.
            </li>
          </ul>
        </section>

        <section className="surface-card rounded-3xl p-6 sm:p-8 border border-border/70 space-y-4 text-sm leading-relaxed text-foreground/90">
          <h2 className="font-display font-bold text-lg text-foreground flex items-center gap-2">
            <Eye className="size-4 text-primary" /> 3. Read Receipts and Presence Controls
          </h2>
          <p>
            You have granular control over your activity indicators. In{" "}
            <em>Settings &gt; Privacy Preferences</em>, you can toggle read receipts and active
            presence on or off at any time. If you disable read receipts, other users will not see
            when you read their messages, and reciprocal indicators are honored.
          </p>
        </section>

        <section className="surface-card rounded-3xl p-6 sm:p-8 border border-border/70 space-y-4 text-sm leading-relaxed text-foreground/90">
          <h2 className="font-display font-bold text-lg text-foreground flex items-center gap-2">
            <Trash2 className="size-4 text-destructive" /> 4. Data Retention and Account Deletion
          </h2>
          <p>
            In compliance with Apple App Store Guideline 5.1.1(v) and GDPR/CCPA regulations, you
            have the right to delete your account and all associated personal data directly within
            the application:
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              Navigate to <strong>Settings</strong> &gt; <strong>Delete Account</strong>.
            </li>
            <li>
              Upon confirmation, all your Pings, comments, private message history, uploaded media,
              and profile data are permanently purged from active production databases.
            </li>
            <li>Ephemeral Moments automatically expire and become inaccessible after 24 hours.</li>
          </ul>
        </section>

        <section className="surface-card rounded-3xl p-6 sm:p-8 border border-border/70 space-y-4 text-sm leading-relaxed text-foreground/90">
          <h2 className="font-display font-bold text-lg text-foreground flex items-center gap-2">
            <Globe className="size-4 text-primary" /> 5. Contact & Support
          </h2>
          <p>
            If you have questions regarding this Privacy Policy or wish to request data export or
            deletion assistance, contact our privacy officer at{" "}
            <a href="mailto:privacy@pingbydot.app" className="text-primary underline font-medium">
              privacy@pingbydot.app
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
