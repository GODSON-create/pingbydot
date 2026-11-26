import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Briefcase,
  Building2,
  CheckCircle2,
  Globe,
  MapPin,
  Plus,
  Search,
  Store,
} from "lucide-react";
import { toast } from "sonner";
import { pageHead } from "@/lib/site";
import { useAuth } from "@/lib/auth";
import { BUSINESS_CATEGORIES, businessesQuery, useCreateBusinessProfile } from "@/lib/business";
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
import { QueryErrorCard } from "@/components/QueryErrorCard";
import { VerificationBadge } from "@/components/verification/VerificationBadge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/businesses")({
  staticData: { sitemap: true },
  head: () =>
    pageHead({
      title: "Businesses & Storefronts — Ping by DOT",
      description:
        "Discover businesses, organisations, products, services, and booking storefronts across Ping.",
      path: "/businesses",
    }),
  component: BusinessesDirectoryPage,
});

function BusinessesDirectoryPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);

  const [name, setName] = useState("");
  const [bizCategory, setBizCategory] = useState("services");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [country, setCountry] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  const {
    data: businesses = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery(businessesQuery(search, category));
  const createBiz = useCreateBusinessProfile(user?.id);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      navigate({ to: "/login", search: { next: "/businesses" } });
      return;
    }
    try {
      const created = await createBiz.mutateAsync({
        name,
        category: bizCategory,
        tagline,
        description,
        location,
        country,
        websiteUrl: websiteUrl || undefined,
        contactEmail: contactEmail || undefined,
      });
      toast.success(`Business storefront "${created.name}" created`);
      setCreateOpen(false);
      setName("");
      setTagline("");
      setDescription("");
      navigate({ to: "/b/$slug", params: { slug: created.slug } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create business profile");
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 pb-24 space-y-6">
      <header className="surface-card rounded-3xl p-6 sm:p-8 border border-border/70">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
              <Store className="size-3.5" /> Ping Business Network
            </span>
            <h1 className="mt-3 font-display text-3xl sm:text-4xl font-extrabold tracking-tight">
              Businesses &amp; Storefronts
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Explore verified organisations, studios, merchants, and service providers — send
              enquiries or request bookings directly without leaving Ping.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {user && (
              <Button asChild variant="outline" size="sm" className="rounded-full gap-1.5">
                <Link to="/business">
                  <Briefcase className="size-3.5" /> Business Suite
                </Link>
              </Button>
            )}
            <Button
              type="button"
              variant="hero"
              size="sm"
              className="rounded-full gap-1.5"
              onClick={() => {
                if (!user) {
                  navigate({ to: "/login", search: { next: "/businesses" } });
                  return;
                }
                setCreateOpen(true);
              }}
            >
              <Plus className="size-4" /> Create Business Page
            </Button>
          </div>
        </div>

        <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-3 pt-4 border-t border-border/60">
          <div className="relative flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search businesses, services, locations…"
              className="pl-9 h-9 rounded-full text-xs bg-secondary/50"
            />
          </div>
        </div>
      </header>

      <nav className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        <button
          type="button"
          onClick={() => setCategory("all")}
          className={cn(
            "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
            category === "all"
              ? "border-foreground bg-foreground text-background"
              : "border-border bg-card hover:bg-secondary",
          )}
        >
          All Categories
        </button>
        {BUSINESS_CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setCategory(c.value)}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
              category === c.value
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card hover:bg-secondary",
            )}
          >
            {c.label}
          </button>
        ))}
      </nav>

      {isError ? (
        <QueryErrorCard
          title="Couldn't load businesses"
          error={error}
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-3xl bg-secondary/50" />
          ))}
        </div>
      ) : businesses.length === 0 ? (
        <div className="surface-card rounded-3xl p-10 text-center border border-border/70">
          <Building2 className="mx-auto size-10 text-muted-foreground/45" />
          <h2 className="mt-3 font-display text-lg font-bold">No business pages listed yet</h2>
          <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
            Launch a dedicated Business Storefront to showcase products &amp; services, collaborate
            with team agents, and receive customer enquiries — while keeping your personal profile
            separate.
          </p>
          <Button
            type="button"
            variant="hero"
            size="sm"
            className="mt-4 rounded-full gap-1.5"
            onClick={() => {
              if (!user) {
                navigate({ to: "/login", search: { next: "/businesses" } });
                return;
              }
              setCreateOpen(true);
            }}
          >
            <Plus className="size-3.5" /> Create Business Page
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {businesses.map((biz) => {
            const catLabel =
              BUSINESS_CATEGORIES.find((c) => c.value === biz.category)?.label ?? biz.category;
            return (
              <Link
                key={biz.id}
                to="/b/$slug"
                params={{ slug: biz.slug }}
                className="surface-card lift rounded-3xl p-5 border border-border/70 flex flex-col justify-between gap-3"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                      {catLabel}
                    </span>
                    {biz.verified_status === "verified" && (
                      <VerificationBadge
                        businessVerified
                        businessName={biz.name}
                        showLabel
                        size="xs"
                      />
                    )}
                  </div>
                  <h2 className="mt-2.5 font-display text-lg font-bold text-foreground">
                    {biz.name}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                    {biz.tagline || biz.description || "Business storefront on Ping."}
                  </p>
                </div>
                <div className="pt-3 border-t border-border/50 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                  {(biz.location || biz.country) && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3 text-primary" />
                      {[biz.location, biz.country].filter(Boolean).join(", ")}
                    </span>
                  )}
                  {biz.website_url && (
                    <span className="inline-flex items-center gap-1">
                      <Globe className="size-3" /> Website
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* CREATE BUSINESS MODAL */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg rounded-3xl p-6 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Create Business Profile</DialogTitle>
            <DialogDescription className="text-xs">
              Your personal Ping profile remains completely separate. Invite team members later with
              role-based permissions instead of sharing passwords.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3 mt-2">
            <div>
              <Label htmlFor="biz-name" className="text-xs">
                Business / Organisation name
              </Label>
              <Input
                id="biz-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Kora Solar Engineering"
                required
                minLength={2}
                maxLength={120}
                className="mt-1 rounded-xl"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="biz-cat" className="text-xs">
                  Category
                </Label>
                <select
                  id="biz-cat"
                  value={bizCategory}
                  onChange={(e) => setBizCategory(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs"
                >
                  {BUSINESS_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="biz-loc" className="text-xs">
                  City / Location
                </Label>
                <Input
                  id="biz-loc"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Lagos / Remote"
                  className="mt-1 rounded-xl"
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="biz-country" className="text-xs">
                  Country
                </Label>
                <Input
                  id="biz-country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="Nigeria"
                  className="mt-1 rounded-xl"
                />
              </div>
              <div>
                <Label htmlFor="biz-web" className="text-xs">
                  Website (optional)
                </Label>
                <Input
                  id="biz-web"
                  type="url"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://…"
                  className="mt-1 rounded-xl"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="biz-email" className="text-xs">
                Public contact email (optional)
              </Label>
              <Input
                id="biz-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="hello@company.com"
                className="mt-1 rounded-xl"
              />
            </div>
            <div>
              <Label htmlFor="biz-tagline" className="text-xs">
                Tagline
              </Label>
              <Input
                id="biz-tagline"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="Reliable clean power installations for SMEs"
                maxLength={140}
                className="mt-1 rounded-xl"
              />
            </div>
            <div>
              <Label htmlFor="biz-desc" className="text-xs">
                About your business
              </Label>
              <Textarea
                id="biz-desc"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What products, services, or outcomes do you deliver?"
                className="mt-1 rounded-xl"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="hero"
                className="rounded-full"
                disabled={createBiz.isPending}
              >
                {createBiz.isPending ? "Creating…" : "Launch Storefront"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
