import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useId } from "react";
import { toast } from "sonner";
import { Radio, ArrowLeft, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ensureClientProfileRow } from "@/lib/ensure-profile";
import { SLUG_RE } from "@/lib/hubs";
import { ImageUploadField } from "@/components/media/ImageUploadField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { pageHead, siteUrl } from "@/lib/site";
import { sanitizeErrorMessage } from "@/lib/error-diagnostics";
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
  const [formError, setFormError] = useState<string | null>(null);

  const focusFirstError = (errs: Record<string, string>) => {
    const idMap: Record<string, string> = {
      name: nameId,
      slug: slugId,
      websiteUrl: websiteId,
      avatarUrl: avatarId,
      description: descId,
    };
    const firstKey = ["name", "slug", "description", "websiteUrl", "avatarUrl"].find(
      (k) => errs[k],
    );
    const elId = firstKey ? idMap[firstKey] : undefined;
    if (elId && typeof document !== "undefined") {
      const el = document.getElementById(elId);
      el?.focus?.();
      el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    }
  };

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slugModified) {
      setSlug(slugify(val).slice(0, 40).replace(/-+$/g, ""));
    }
  };

  const handleSlugChange = (val: string) => {
    setSlugModified(true);
    setSlug(slugify(val).slice(0, 40));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      toast.error("Please sign in to register a Signal channel.");
      return;
    }

    const trimmedName = name.trim();
    const cleanSlug = slug.trim().toLowerCase().replace(/-+$/g, "");
    const trimmedDesc = description.trim();
    const trimmedWebsite = websiteUrl.trim();
    const trimmedAvatar = avatarUrl.trim();

    const errs: Record<string, string> = {};
    if (trimmedName.length < 2 || trimmedName.length > 80) {
      errs["name"] = "Channel name must be between 2 and 80 characters.";
    }
    if (!SLUG_RE.test(cleanSlug)) {
      errs["slug"] = "Use 3–40 lowercase letters, numbers, or dashes (cannot start/end with -).";
    }
    if (trimmedDesc.length > 3000) {
      errs["description"] = "Description must be 3000 characters or fewer.";
    }
    if (trimmedWebsite && !/^https?:\/\/\S+/i.test(trimmedWebsite)) {
      errs["websiteUrl"] = "Enter a valid website link starting with https:// or http://.";
    }
    if (trimmedAvatar && !/^https?:\/\/\S+/i.test(trimmedAvatar)) {
      errs["avatarUrl"] = "Enter a valid image link starting with https:// or upload a logo.";
    }

    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      setFormError("Please fix the highlighted fields below before continuing.");
      focusFirstError(errs);
      return;
    }

    setErrors({});
    setFormError(null);
    setIsSubmitting(true);

    try {
      await ensureClientProfileRow(user);

      // Check slug availability upfront
      const { data: existingSignal, error: slugCheckErr } = await supabase
        .from("signals")
        .select("id")
        .eq("slug", cleanSlug)
        .maybeSingle();

      if (slugCheckErr) throw slugCheckErr;
      if (existingSignal) {
        const dupErr = { slug: "This channel slug is already claimed. Please choose another." };
        setErrors(dupErr);
        setFormError(dupErr.slug);
        focusFirstError(dupErr);
        return;
      }

      const rpcPayload = {
        _name: trimmedName,
        _slug: cleanSlug,
        _institution_type: category,
        ...(trimmedDesc ? { _description: trimmedDesc } : {}),
        ...(trimmedWebsite ? { _website_url: trimmedWebsite } : {}),
      };

      let createdId: string | undefined;
      let createdSlug: string | undefined;

      let { data, error } = await supabase.rpc("create_signal", rpcPayload);

      if (error && error.code === "23503") {
        const recovered = await ensureClientProfileRow(user);
        if (recovered) {
          const retry = await supabase.rpc("create_signal", rpcPayload);
          data = retry.data;
          error = retry.error;
        }
      }

      if (!error && data) {
        const record = data as { id?: string; slug?: string } | null;
        createdId = record?.id;
        createdSlug = record?.slug || cleanSlug;
      } else if (error) {
        const isMissingRpc =
          error.code === "PGRST202" ||
          error.code === "42883" ||
          error.message?.toLowerCase().includes("does not exist");

        if (error.code === "23505" || error.message?.toLowerCase().includes("unique")) {
          const dupErr = { slug: "This channel slug is already claimed. Please choose another." };
          setErrors(dupErr);
          setFormError(dupErr.slug);
          focusFirstError(dupErr);
          return;
        }

        if (!isMissingRpc) {
          throw error;
        }

        // Only fall back when create_signal RPC is completely unavailable
        const directInsert = {
          name: trimmedName,
          slug: cleanSlug,
          institution_type: category,
          description: trimmedDesc,
          website_url: trimmedWebsite || null,
          avatar_url: trimmedAvatar || null,
          created_by: user.id,
          verified: false,
          verification_status: "unverified",
        };

        let { data: directSignal, error: directErr } = await supabase
          .from("signals")
          .insert(directInsert)
          .select("id, slug")
          .single();

        if (directErr && directErr.code === "23503") {
          const recovered = await ensureClientProfileRow(user);
          if (recovered) {
            const retry = await supabase
              .from("signals")
              .insert(directInsert)
              .select("id, slug")
              .single();
            directSignal = retry.data;
            directErr = retry.error;
          }
        }

        if (directErr || !directSignal) {
          if (directErr?.message?.includes("unique") || directErr?.code === "23505") {
            const dupErr = { slug: "This channel slug is already claimed. Please choose another." };
            setErrors(dupErr);
            setFormError(dupErr.slug);
            focusFirstError(dupErr);
            return;
          }
          throw directErr ?? new Error("Failed to register Signal channel.");
        }

        createdId = directSignal.id;
        createdSlug = directSignal.slug;
      }

      // Persist avatar_url on newly created Signal (RPC doesn't accept _avatar_url)
      if (trimmedAvatar && (createdId || createdSlug)) {
        const updateQuery = supabase.from("signals").update({ avatar_url: trimmedAvatar });
        const { error: avErr } = createdId
          ? await updateQuery.eq("id", createdId)
          : await updateQuery.eq("slug", createdSlug!);
        if (avErr) {
          console.warn("Signal created, but logo URL could not be updated:", avErr);
        }
      }

      toast.success("Signal channel successfully registered!");
      navigate({ to: "/signals/$slug", params: { slug: createdSlug || cleanSlug } });
    } catch (err: unknown) {
      console.error("Create signal error:", err);
      const raw = err instanceof Error ? err.message : "Failed to create Signal channel.";
      const friendly = sanitizeErrorMessage(raw);
      setFormError(friendly);
      toast.error(friendly);
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

      <form
        onSubmit={handleSubmit}
        noValidate
        className="surface-card mt-8 rounded-3xl p-6 sm:p-8 space-y-6"
      >
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
              {siteUrl("/signals/").replace(/^https?:\/\//, "")}
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

        <div className="space-y-4">
          <div>
            <Label htmlFor={websiteId} className="text-sm font-semibold">
              Official Website
            </Label>
            <Input
              id={websiteId}
              type="url"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://your-org.edu"
              className="mt-1.5 rounded-2xl h-11"
            />
            {errors["websiteUrl"] && (
              <p className="mt-1 text-xs text-destructive">{errors["websiteUrl"]}</p>
            )}
          </div>

          <ImageUploadField
            folder="signals"
            userId={user.id}
            value={avatarUrl}
            onChange={setAvatarUrl}
            label="Channel Emblem / Logo (optional)"
            placeholder="https://…/logo.png"
            fallbackName={name || "Signal"}
            shape="rounded"
            inputId={avatarId}
            error={errors["avatarUrl"]}
            disabled={isSubmitting}
          />
        </div>

        <div className="rounded-2xl bg-secondary/50 p-4 border border-border/60 flex items-start gap-3">
          <Sparkles className="size-5 text-primary shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground">
            <strong className="text-foreground">Official Verification:</strong> Signal channels are
            designated for authorized institutional broadcasts. You will initially be granted the
            Publisher role to post immediate broadcasts.
          </div>
        </div>

        {formError && (
          <div
            role="alert"
            className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs font-medium text-destructive"
          >
            {formError}
          </div>
        )}

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
