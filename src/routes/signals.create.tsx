import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useId } from "react";
import { toast } from "sonner";
import { Radio, ArrowLeft, Building, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { pageHead } from "@/lib/site";
import type { SignalInstitutionType } from "@/lib/signals";

export const Route = createFileRoute("/signals/create")({
  staticData: { sitemap: false },
  head: () =>
    pageHead({
      title: "Register a Signal Channel — Ping",
      description: "Launch an official broadcast channel for your institution on Ping.",
      path: "/signals/create",
    }),
  component: CreateSignalPage,
});

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function CreateSignalPage() {
  const { user, ready } = useAuth();
  const navigate = useNavigate();

  const nameId = useId();
  const slugId = useId();
  const descId = useId();
  const websiteId = useId();
  const avatarId = useId();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugModified, setSlugModified] = useState(false);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<SignalInstitutionType>("university");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slugModified) {
      setSlug(slugify(val));
    }
  };

  const handleSlugChange = (val: string) => {
    setSlugModified(true);
    setSlug(slugify(val));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      toast.error("Please sign in to register a Signal channel.");
      return;
    }

    const errs: Record<string, string> = {};
    if (!name.trim()) errs["name"] = "Channel name is required";
    if (!slug.trim()) errs["slug"] = "Unique URL slug is required";
    if (slug.length < 3) errs["slug"] = "Slug must be at least 3 characters";

    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setIsSubmitting(true);
    try {
      let createdSlug: string | undefined;

      const { data, error } = await supabase.rpc("create_signal", {
        _name: name.trim(),
        _slug: slug.trim(),
        _institution_type: category,
        ...(description.trim() ? { _description: description.trim() } : {}),
        ...(websiteUrl.trim() ? { _website_url: websiteUrl.trim() } : {}),
      });

      if (!error && data) {
        createdSlug = slug.trim();
      } else {
        // Fallback direct insert
        const { data: directSignal, error: directErr } = await supabase
          .from("signals")
          .insert({
            name: name.trim(),
            slug: slug.trim(),
            institution_type: category,
            description: description.trim(),
            website_url: websiteUrl.trim() || null,
            avatar_url: avatarUrl.trim() || null,
            created_by: user.id,
            verified: false,
            verification_status: "unverified",
          })
          .select("id, slug")
          .single();

        if (directErr) {
          if (directErr.message.includes("unique") || directErr.code === "23505") {
            setErrors({ slug: "This channel slug is already claimed. Please choose another." });
            return;
          }
          throw directErr;
        }

        // Ensure creator is registered as admin publisher
        await supabase.from("signal_publishers").upsert(
          {
            signal_id: directSignal.id,
            user_id: user.id,
            role: "admin",
            assigned_by: user.id,
          },
          { onConflict: "signal_id,user_id" },
        );

        createdSlug = directSignal.slug;
      }

      toast.success("Signal channel successfully registered!");
      navigate({ to: "/signals/$slug", params: { slug: createdSlug || slug.trim() } });
    } catch (err: unknown) {
      console.error("Create signal error:", err);
      toast.error(err instanceof Error ? err.message : "Failed to create Signal channel.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!ready) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center text-muted-foreground">
        Checking authentication…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <Radio className="mx-auto size-12 text-muted-foreground/60" />
        <h1 className="mt-4 font-display text-2xl font-bold">Sign in required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You need an active Ping account to register an institutional broadcast channel.
        </p>
        <Button asChild variant="hero" className="mt-6 rounded-2xl">
          <Link to="/login" search={{ next: "/signals/create" }}>
            Sign In to Continue
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <Link
        to="/signals"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-3.5" />
        Back to Signals directory
      </Link>

      <div className="mt-4 flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Radio className="size-6" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-extrabold sm:text-3xl">
            Register Signal Channel
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Establish an official broadcast frequency for announcements, releases, and alerts.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="surface-card mt-8 rounded-3xl p-6 sm:p-8 space-y-6">
        <div>
          <Label htmlFor={nameId} className="text-sm font-semibold">
            Institution or Collective Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id={nameId}
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="e.g. Stanford AI Lab, Vercel Core, MIT Founders"
            className="mt-1.5 rounded-2xl h-11"
          />
          {errors["name"] && <p className="mt-1 text-xs text-destructive">{errors["name"]}</p>}
        </div>

        <div>
          <Label htmlFor={slugId} className="text-sm font-semibold">
            Signal URL Slug <span className="text-destructive">*</span>
          </Label>
          <div className="mt-1.5 flex items-center rounded-2xl border border-input bg-background/50 px-3 h-11 focus-within:ring-2 focus-within:ring-ring">
            <span className="text-xs text-muted-foreground select-none shrink-0">
              pingbydot.lovable.app/signals/
            </span>
            <input
              id={slugId}
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="stanford-ai"
              className="w-full bg-transparent text-sm focus:outline-none pl-1"
            />
          </div>
          {errors["slug"] && <p className="mt-1 text-xs text-destructive">{errors["slug"]}</p>}
        </div>

        <div>
          <Label className="text-sm font-semibold">Institution Category</Label>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {(
              [
                { value: "university", label: "University / College" },
                { value: "company", label: "Tech Company" },
                { value: "incubator", label: "Incubator / VC" },
                { value: "community", label: "Builder Collective" },
                { value: "government", label: "Public Agency" },
                { value: "other", label: "Other Organization" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setCategory(opt.value)}
                className={`rounded-xl border p-2.5 text-xs font-semibold text-left transition-all ${
                  category === opt.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:bg-muted/50 text-muted-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor={descId} className="text-sm font-semibold">
            Broadcast Tagline & Mission
          </Label>
          <Textarea
            id={descId}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Official updates, research grants, events, and releases from our organization."
            className="mt-1.5 rounded-2xl resize-none"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor={websiteId} className="text-sm font-semibold">
              Official Website
            </Label>
            <Input
              id={websiteId}
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://your-org.edu"
              className="mt-1.5 rounded-2xl h-11"
            />
          </div>
          <div>
            <Label htmlFor={avatarId} className="text-sm font-semibold">
              Avatar Image URL
            </Label>
            <Input
              id={avatarId}
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://…/logo.png"
              className="mt-1.5 rounded-2xl h-11"
            />
          </div>
        </div>

        <div className="rounded-2xl bg-secondary/50 p-4 border border-border/60 flex items-start gap-3">
          <Sparkles className="size-5 text-primary shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground">
            <strong className="text-foreground">Official Verification:</strong> Signal channels are
            designated for authorized institutional broadcasts. You will initially be granted the
            Publisher role to post immediate broadcasts.
          </div>
        </div>

        <div className="pt-2 flex items-center justify-end gap-3">
          <Button asChild variant="outline" className="rounded-xl">
            <Link to="/signals">Cancel</Link>
          </Button>
          <Button type="submit" variant="hero" disabled={isSubmitting} className="rounded-xl">
            {isSubmitting ? "Registering…" : "Register Signal Channel"}
          </Button>
        </div>
      </form>
    </div>
  );
}
