import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Briefcase,
  Calendar,
  CheckCircle2,
  Clock,
  Globe,
  Info,
  Mail,
  MapPin,
  MessageSquare,
  Share2,
  Star,
  Store,
} from "lucide-react";
import { toast } from "sonner";
import { pageHead } from "@/lib/site";
import { useAuth } from "@/lib/auth";
import {
  BUSINESS_CATEGORIES,
  businessBySlugQuery,
  businessOfferingsQuery,
  businessReviewsQuery,
  computeBusinessReputation,
  useSubmitBusinessEnquiry,
  useSubmitBusinessReview,
  type BusinessOffering,
  type EnquiryType,
} from "@/lib/business";
import { UniversalShareDialog } from "@/components/sharing/UniversalShareDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/b/$slug")({
  staticData: { sitemap: true },
  head: () =>
    pageHead({
      title: "Business Storefront — Ping by DOT",
      description: "Products, services, bookings, reviews, and direct enquiries on Ping.",
      path: "/businesses",
    }),
  component: BusinessStorefrontPage,
});

function BusinessStorefrontPage() {
  const { slug } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: business, isLoading } = useQuery(businessBySlugQuery(slug));
  const { data: offerings = [] } = useQuery(businessOfferingsQuery(business?.id));
  const { data: reviews = [] } = useQuery(businessReviewsQuery(business?.id));

  const submitEnquiry = useSubmitBusinessEnquiry(business?.id ?? "", user?.id);
  const submitReview = useSubmitBusinessReview(business?.id ?? "", user?.id);

  const [shareOpen, setShareOpen] = useState(false);
  const [enquiryOpen, setEnquiryOpen] = useState(false);
  const [selectedOffering, setSelectedOffering] = useState<BusinessOffering | null>(null);
  const [enquiryType, setEnquiryType] = useState<EnquiryType>("general");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [preferredDate, setPreferredDate] = useState("");

  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-12">
        <div className="h-48 animate-pulse rounded-3xl bg-secondary/60" />
      </div>
    );
  }

  if (!business) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16 text-center space-y-3">
        <Store className="mx-auto size-10 text-muted-foreground/50" />
        <h1 className="font-display text-2xl font-bold">Business page not found</h1>
        <p className="text-xs text-muted-foreground">
          This storefront does not exist or has been removed.
        </p>
        <Button asChild variant="outline" className="rounded-full">
          <Link to="/businesses">Browse Businesses</Link>
        </Button>
      </div>
    );
  }

  const activeOfferings = offerings.filter((o) => o.status === "active");
  const reputation = computeBusinessReputation(reviews);
  const isOwner = Boolean(user?.id && business.owner_id === user.id);
  const catLabel =
    BUSINESS_CATEGORIES.find((c) => c.value === business.category)?.label ?? business.category;

  const openEnquiryModal = (offering?: BusinessOffering) => {
    if (!user) {
      navigate({ to: "/login", search: { next: `/b/${business.slug}` } });
      return;
    }
    setSelectedOffering(offering ?? null);
    setEnquiryType(
      offering?.booking_enabled ? "appointment_booking" : offering ? "product_enquiry" : "general",
    );
    setSubject(offering ? `Enquiry: ${offering.title}` : "");
    setEnquiryOpen(true);
  };

  const handleEnquirySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await submitEnquiry.mutateAsync({
        enquiryType,
        subject,
        message,
        offeringId: selectedOffering?.id,
        preferredDate: preferredDate || undefined,
      });
      toast.success(
        business.auto_reply_enabled
          ? `Sent! Auto-reply: "${business.auto_reply_message}"`
          : `Enquiry delivered to ${business.name}'s team inbox.`,
      );
      setEnquiryOpen(false);
      setSubject("");
      setMessage("");
      setPreferredDate("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send enquiry.");
    }
  };

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      navigate({ to: "/login", search: { next: `/b/${business.slug}` } });
      return;
    }
    try {
      await submitReview.mutateAsync({ rating: reviewRating, comment: reviewComment });
      toast.success("Customer review published");
      setReviewComment("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not publish review.");
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 pb-24 space-y-6">
      {/* Storefront Header */}
      <header className="surface-card rounded-3xl p-6 sm:p-8 border border-border/70 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-secondary px-3 py-0.5 text-xs font-semibold text-muted-foreground">
                {catLabel}
              </span>
              {business.verified_status === "verified" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary px-2.5 py-0.5 text-xs font-bold">
                  <CheckCircle2 className="size-3.5" /> Verified Business
                </span>
              )}
              {reputation.reviewCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 text-gold px-2.5 py-0.5 text-xs font-bold">
                  <Star className="size-3 fill-current" /> {reputation.averageRating} (
                  {reputation.reviewCount})
                </span>
              )}
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight">
              {business.name}
            </h1>
            {business.tagline && (
              <p className="text-sm font-medium text-foreground/90">{business.tagline}</p>
            )}
            {business.description && (
              <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
                {business.description}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isOwner ? (
              <Button asChild variant="hero" size="sm" className="rounded-full gap-1.5">
                <Link to="/business">
                  <Briefcase className="size-3.5" /> Manage Business Suite
                </Link>
              </Button>
            ) : (
              <Button
                type="button"
                variant="hero"
                size="sm"
                className="rounded-full gap-1.5"
                onClick={() => openEnquiryModal()}
              >
                <MessageSquare className="size-3.5" /> Send Enquiry
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full gap-1.5"
              onClick={() => setShareOpen(true)}
            >
              <Share2 className="size-3.5" /> Share
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-3 border-t border-border/60 text-xs text-muted-foreground">
          {(business.location || business.country) && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-3.5 text-primary" />
              {[business.location, business.country].filter(Boolean).join(", ")}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3.5 text-primary" /> {business.business_hours}
          </span>
          {business.website_url && /^https?:\/\//i.test(business.website_url) && (
            <a
              href={business.website_url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center gap-1.5 text-primary hover:underline"
            >
              <Globe className="size-3.5" /> Website
            </a>
          )}
          {business.contact_email && (
            <a
              href={`mailto:${business.contact_email}`}
              className="inline-flex items-center gap-1.5 hover:text-foreground"
            >
              <Mail className="size-3.5" /> {business.contact_email}
            </a>
          )}
        </div>

        {/* Transparent Merchant-of-Record Disclosure (Phase 4.2) */}
        <p className="flex items-start gap-2 rounded-2xl border border-border/70 bg-secondary/40 px-3.5 py-2.5 text-[11px] text-muted-foreground">
          <Info className="size-3.5 shrink-0 mt-0.5 text-primary" />
          <span>{business.merchant_disclosure}</span>
        </p>
      </header>

      {/* Products & Services Catalogue */}
      <section className="space-y-3">
        <h2 className="font-display text-xl font-bold">Products &amp; Services Catalogue</h2>
        {activeOfferings.length === 0 ? (
          <div className="surface-card rounded-3xl p-8 text-center text-xs text-muted-foreground border border-border/60">
            No products or services published yet. Use &quot;Send Enquiry&quot; to contact{" "}
            {business.name} directly.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {activeOfferings.map((off) => (
              <article
                key={off.id}
                className="surface-card rounded-3xl p-5 border border-border/70 flex flex-col justify-between gap-3"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-[10px] font-bold uppercase">
                      {off.kind}
                    </span>
                    <span className="font-display text-sm font-bold text-foreground">
                      {off.price_display}
                    </span>
                  </div>
                  <h3 className="mt-2 font-display text-base font-bold text-foreground">
                    {off.title}
                  </h3>
                  {off.description && (
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                      {off.description}
                    </p>
                  )}
                </div>
                {!isOwner && (
                  <Button
                    type="button"
                    size="sm"
                    variant={off.booking_enabled ? "hero" : "outline"}
                    className="rounded-full text-xs gap-1.5 self-start"
                    onClick={() => openEnquiryModal(off)}
                  >
                    {off.booking_enabled ? (
                      <>
                        <Calendar className="size-3.5" /> Request Booking
                      </>
                    ) : (
                      <>
                        <MessageSquare className="size-3.5" /> Enquire
                      </>
                    )}
                  </Button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Customer Reviews & Reputation */}
      <section className="space-y-4">
        <h2 className="font-display text-xl font-bold">
          Customer Reviews ({reputation.reviewCount})
        </h2>

        {!isOwner && user && (
          <form
            onSubmit={handleReviewSubmit}
            className="surface-card rounded-3xl p-5 border border-border/70 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold">Share your experience</span>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setReviewRating(n)}
                    aria-label={`Rate ${n} stars`}
                    className="p-0.5"
                  >
                    <Star
                      className={`size-4 ${n <= reviewRating ? "fill-gold text-gold" : "text-muted-foreground"}`}
                    />
                  </button>
                ))}
              </div>
            </div>
            <Textarea
              rows={2}
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
              placeholder="Write a helpful review about responsiveness, quality, or service…"
              className="rounded-xl text-xs"
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={submitReview.isPending}
              className="rounded-full text-xs"
            >
              {submitReview.isPending ? "Publishing…" : "Publish Review"}
            </Button>
          </form>
        )}

        {reviews.length === 0 ? (
          <p className="text-xs text-muted-foreground">No customer reviews yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {reviews.map((rev) => (
              <article
                key={rev.id}
                className="surface-card rounded-2xl p-4 border border-border/60 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold">
                    {rev.reviewer?.display_name || `@${rev.reviewer?.username || "Customer"}`}
                  </span>
                  <span className="inline-flex items-center gap-0.5 text-xs font-bold text-gold">
                    <Star className="size-3 fill-current" /> {rev.rating}/5
                  </span>
                </div>
                {rev.comment && (
                  <p className="text-xs text-muted-foreground leading-relaxed">{rev.comment}</p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Enquiry & Booking Dialog */}
      <Dialog open={enquiryOpen} onOpenChange={setEnquiryOpen}>
        <DialogContent className="sm:max-w-md rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="font-display text-lg">
              {selectedOffering?.booking_enabled
                ? `Request Booking · ${selectedOffering.title}`
                : `Contact ${business.name}`}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Delivered directly into {business.name}&apos;s team Business Inbox on Ping.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEnquirySubmit} className="space-y-3 mt-2">
            <div>
              <Label htmlFor="enq-type" className="text-xs">
                Enquiry type
              </Label>
              <select
                id="enq-type"
                value={enquiryType}
                onChange={(e) => setEnquiryType(e.target.value as EnquiryType)}
                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs"
              >
                <option value="general">General Enquiry</option>
                <option value="product_enquiry">Product / Service Pricing</option>
                <option value="appointment_booking">Appointment / Booking Request</option>
                <option value="partnership">Partnership / B2B Proposal</option>
                <option value="support">Customer Support</option>
              </select>
            </div>
            <div>
              <Label htmlFor="enq-subject" className="text-xs">
                Subject
              </Label>
              <Input
                id="enq-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
                minLength={2}
                placeholder="Quote request / Appointment availability"
                className="mt-1 rounded-xl"
              />
            </div>
            {enquiryType === "appointment_booking" && (
              <div>
                <Label htmlFor="enq-date" className="text-xs">
                  Preferred date &amp; time
                </Label>
                <Input
                  id="enq-date"
                  type="datetime-local"
                  value={preferredDate}
                  onChange={(e) => setPreferredDate(e.target.value)}
                  className="mt-1 rounded-xl"
                />
              </div>
            )}
            <div>
              <Label htmlFor="enq-msg" className="text-xs">
                Message
              </Label>
              <Textarea
                id="enq-msg"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                minLength={5}
                placeholder="Share your requirements, timeline, or questions…"
                className="mt-1 rounded-xl"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => setEnquiryOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="hero"
                className="rounded-full"
                disabled={submitEnquiry.isPending}
              >
                {submitEnquiry.isPending ? "Sending…" : "Send Enquiry"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <UniversalShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        payload={{
          targetType: "business",
          targetId: business.id,
          title: business.name,
          description: business.tagline || business.description || "Business Storefront on Ping",
          path: `/b/${business.slug}`,
        }}
      />
    </div>
  );
}
