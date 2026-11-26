import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Plus, Trash2, Globe, Lock, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ensureClientProfileRow } from "@/lib/ensure-profile";
import { slugify, hubSchema, HUB_CATEGORIES, type HubCategory, type HubResource } from "@/lib/hubs";
import { ImageUploadField } from "@/components/media/ImageUploadField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { pageHead, siteUrl } from "@/lib/site";
import { hubError } from "@/lib/hub-queries";

export const Route = createFileRoute("/hubs/create")({
  staticData: { sitemap: false },
  head: () =>
    pageHead({
      title: "Create a Hub — Ping by DOT",
      description: "Create a dedicated space for your organization, university, or collective.",
      path: "/hubs/create",
    }),
  component: CreateHub,
});

function CreateHub() {
  const { user, ready } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Protect route
  useEffect(() => {
    if (ready && !user) {
      navigate({ to: "/login", search: { next: "/hubs/create" } });
    }
  }, [ready, user, navigate]);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [manualSlug, setManualSlug] = useState(false);
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<HubCategory>("community");
  const [access, setAccess] = useState<"public" | "private">("public");
  const [rules, setRules] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [resources, setResources] = useState<HubResource[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const HUB_LEGACY_CATEGORY_MAP: Partial<Record<HubCategory, HubCategory>> = {
    university: "school",
    company: "organization",
    government: "organization",
    ngo: "organization",
    association: "organization",
    other: "community",
  };

  const focusFirstError = (fieldErrors: Record<string, string>) => {
    const order = ["name", "slug", "tagline", "category", "description", "rules", "resources"];
    const firstKey = order.find((k) => fieldErrors[k]) ?? Object.keys(fieldErrors)[0];
    if (firstKey && typeof document !== "undefined") {
      const el = document.getElementById(firstKey);
      el?.focus?.();
      el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    }
  };

  const onNameChange = (val: string) => {
    setName(val);
    if (!manualSlug) {
      setSlug(slugify(val));
    }
  };

  const addResource = () => {
    if (resources.length >= 10) return;
    setResources([...resources, { label: "", url: "" }]);
  };

  const updateResource = (idx: number, field: "label" | "url", val: string) => {
    setResources(resources.map((r, i) => (i === idx ? { ...r, [field]: val } : r)));
  };

  const removeResource = (idx: number) => {
    setResources(resources.filter((_, i) => i !== idx));
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Please log in first.");

      // Filter and trim resources
      const validResources = resources
        .map((r) => ({ label: r.label.trim(), url: r.url.trim() }))
        .filter((r) => r.label && r.url);

      const parsed = hubSchema.safeParse({
        name,
        slug,
        tagline: tagline.trim() || undefined,
        description: description.trim() || undefined,
        rules: rules.trim() || undefined,
        category,
        access,
        resources: validResources,
      });

      if (!parsed.success) {
        const fieldErrors: Record<string, string> = {};
        parsed.error.issues.forEach((issue) => {
          const key = String(issue.path[0] ?? "general");
          fieldErrors[key] = issue.message;
        });
        setErrors(fieldErrors);
        setFormError("Please fix the highlighted fields below before creating your Hub.");
        focusFirstError(fieldErrors);
        throw new Error("Validation failed. Please correct the highlighted fields.");
      }

      setErrors({});
      setFormError(null);

      // Ensure authenticated profile row exists even if migration 0022 is not applied yet
      await ensureClientProfileRow(user);

      // Check slug uniqueness
      const { data: existing, error: checkError } = await supabase
        .from("hubs")
        .select("id")
        .eq("slug", parsed.data.slug)
        .maybeSingle();

      if (checkError) {
        throw checkError;
      }
      if (existing) {
        const slugErr = { slug: "This URL handle is already taken. Please pick another." };
        setErrors(slugErr);
        setFormError(slugErr.slug);
        focusFirstError(slugErr);
        throw new Error("Slug taken.");
      }

      const invokeCreateHub = (cat: HubCategory) =>
        (supabase.rpc as any)("create_hub", {
          _name: parsed.data.name,
          _slug: parsed.data.slug,
          _tagline: parsed.data.tagline || "",
          _description: parsed.data.description || "",
          _rules: parsed.data.rules || "",
          _category: cat,
          _access: parsed.data.access,
          _resources: parsed.data.resources,
        });

      let mappedNotice: string | null = null;
      let { data: rpcHub, error: rpcError } = await invokeCreateHub(parsed.data.category);

      // If remote DB has legacy pre-0022 hubs_category_check, map cleanly to legacy parent category
      if (
        rpcError &&
        (rpcError.code === "23514" || /hubs_category_check/i.test(rpcError.message || "")) &&
        HUB_LEGACY_CATEGORY_MAP[parsed.data.category]
      ) {
        const fallbackCategory = HUB_LEGACY_CATEGORY_MAP[parsed.data.category]!;
        const retry = await invokeCreateHub(fallbackCategory);
        rpcHub = retry.data;
        rpcError = retry.error;
        if (!rpcError) {
          mappedNotice = `Created under '${fallbackCategory}' category (legacy database category schema).`;
        }
      }

      // Recover missing profile row on 23503 and retry RPC once
      if (rpcError && rpcError.code === "23503") {
        const recovered = await ensureClientProfileRow(user);
        if (recovered) {
          const retry = await invokeCreateHub(parsed.data.category);
          rpcHub = retry.data;
          rpcError = retry.error;
        }
      }

      let createdSlug: string | null =
        !rpcError && rpcHub && typeof rpcHub === "object" && "slug" in rpcHub
          ? String((rpcHub as { slug: string }).slug)
          : null;

      if (!createdSlug) {
        // Only fall back to direct insert if create_hub RPC is absent on this database
        const rpcErrMsg = (rpcError as { message?: string; code?: string } | null)?.message ?? "";
        const rpcErrCode = (rpcError as { code?: string } | null)?.code ?? "";
        const rpcMissing =
          rpcErrCode === "42883" ||
          rpcErrCode === "PGRST202" ||
          /could not find the function|function .* does not exist/i.test(rpcErrMsg);

        if (rpcError && !rpcMissing) {
          throw rpcError;
        }

        const insertPayload = (cat: HubCategory) => ({
          name: parsed.data.name,
          slug: parsed.data.slug,
          tagline: parsed.data.tagline,
          description: parsed.data.description,
          rules: parsed.data.rules,
          category: cat,
          access: parsed.data.access,
          resources: parsed.data.resources,
          owner_id: user.id,
        });

        let { data: newHub, error: insertError } = await supabase
          .from("hubs")
          .insert(insertPayload(parsed.data.category))
          .select("id, slug")
          .single();

        if (
          insertError &&
          (insertError.code === "23514" ||
            /hubs_category_check/i.test(insertError.message || "")) &&
          HUB_LEGACY_CATEGORY_MAP[parsed.data.category]
        ) {
          const fallbackCategory = HUB_LEGACY_CATEGORY_MAP[parsed.data.category]!;
          const retry = await supabase
            .from("hubs")
            .insert(insertPayload(fallbackCategory))
            .select("id, slug")
            .single();
          newHub = retry.data;
          insertError = retry.error;
        }

        if (insertError || !newHub) {
          throw insertError ?? new Error("Hub creation returned no record.");
        }

        createdSlug = newHub.slug;
      }

      if (avatarUrl.trim() && createdSlug) {
        const { error: avatarErr } = await supabase
          .from("hubs")
          .update({ avatar_url: avatarUrl.trim() } as any)
          .eq("slug", createdSlug);
        if (avatarErr && avatarErr.code !== "42703" && avatarErr.code !== "PGRST204") {
          console.warn("Hub created, but hub image metadata could not be saved yet:", avatarErr);
        }
      }

      return { slug: createdSlug, mappedNotice };
    },
    onSuccess: ({ slug: newSlug, mappedNotice }) => {
      qc.invalidateQueries({ queryKey: ["hubs"] });
      qc.invalidateQueries({ queryKey: ["my-hubs"] });
      if (mappedNotice) {
        toast.success(`Hub created! ${mappedNotice}`);
      } else {
        toast.success("Hub created successfully!");
      }
      navigate({ to: "/hubs/$slug", params: { slug: newSlug } });
    },
    onError: (err: any) => {
      if (
        err.message !== "Slug taken." &&
        err.message !== "Validation failed. Please correct the highlighted fields."
      ) {
        const msg = hubError(err, "Couldn't create hub. Please try again.");
        setFormError(msg);
        toast.error(msg);
      }
    },
  });

  if (!ready || !user) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <p className="text-muted-foreground">Redirecting to login…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <Link
        to="/hubs"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="size-4" /> Back to Hubs
      </Link>

      <span className="sticker -rotate-2 bg-lime text-lime-foreground">new hub</span>
      <h1 className="mt-4 font-display text-4xl font-extrabold sm:text-5xl">Create a Hub</h1>
      <p className="mt-2 text-muted-foreground">
        Set up a home for your university club, incubator cohort, or builder community.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="mt-8 space-y-6"
        noValidate
      >
        {/* Hub Name */}
        <div>
          <Label htmlFor="name" className="text-sm font-semibold">
            Hub Name *
          </Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="e.g. Stanford Founders or YC W26 Cohort"
            className="mt-1.5 h-12 rounded-2xl"
            maxLength={60}
          />
          {errors["name"] && <p className="mt-1 text-xs text-destructive">{errors["name"]}</p>}
        </div>

        {/* Slug */}
        <div>
          <Label htmlFor="slug" className="text-sm font-semibold">
            Hub URL Slug *
          </Label>
          <div className="mt-1.5 flex items-center rounded-2xl border border-input bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground shrink-0 select-none">
              {siteUrl("/hubs/").replace(/^https?:\/\//, "")}
            </span>
            <input
              id="slug"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                setManualSlug(true);
              }}
              className="min-w-0 flex-1 bg-transparent px-1 outline-none font-medium"
              placeholder="my-hub"
              maxLength={40}
            />
          </div>
          {errors["slug"] && <p className="mt-1 text-xs text-destructive">{errors["slug"]}</p>}
        </div>

        {/* Tagline */}
        <div>
          <Label htmlFor="tagline" className="text-sm font-semibold">
            Tagline <span className="text-muted-foreground font-normal">(under 120 chars)</span>
          </Label>
          <Input
            id="tagline"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="One-liner about who builds here"
            className="mt-1.5 h-12 rounded-2xl"
            maxLength={120}
          />
          {errors["tagline"] && (
            <p className="mt-1 text-xs text-destructive">{errors["tagline"]}</p>
          )}
        </div>

        {/* Category */}
        <fieldset>
          <legend className="text-sm font-semibold">Category *</legend>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {HUB_CATEGORIES.map((c) => (
              <button
                type="button"
                key={c.value}
                onClick={() => setCategory(c.value)}
                aria-pressed={category === c.value}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm font-medium transition-all active:scale-95",
                  category === c.value
                    ? "border-foreground bg-lime text-lime-foreground shadow-[2px_2px_0_var(--foreground)]"
                    : "border-border bg-card hover:bg-secondary",
                )}
              >
                <span>{c.emoji}</span> {c.label}
              </button>
            ))}
          </div>
          {errors["category"] && (
            <p className="mt-1 text-xs text-destructive">{errors["category"]}</p>
          )}
        </fieldset>

        {/* Access Type */}
        <fieldset>
          <legend className="text-sm font-semibold">Access Tier *</legend>
          <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
            <label
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-2xl border p-4 text-sm transition-colors",
                access === "public"
                  ? "border-primary bg-accent/60"
                  : "border-border hover:bg-secondary",
              )}
            >
              <input
                type="radio"
                name="access"
                value="public"
                checked={access === "public"}
                onChange={() => setAccess("public")}
                className="mt-0.5 accent-[var(--primary)]"
              />
              <div>
                <div className="flex items-center gap-1.5 font-semibold">
                  <Globe className="size-4" /> Public
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Anyone can discover, view, and join this hub instantly.
                </p>
              </div>
            </label>

            <label
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-2xl border p-4 text-sm transition-colors",
                access === "private"
                  ? "border-primary bg-accent/60"
                  : "border-border hover:bg-secondary",
              )}
            >
              <input
                type="radio"
                name="access"
                value="private"
                checked={access === "private"}
                onChange={() => setAccess("private")}
                className="mt-0.5 accent-[var(--primary)]"
              />
              <div>
                <div className="flex items-center gap-1.5 font-semibold">
                  <Lock className="size-4" /> Private
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Content is visible only to members. Requires invitation or request approval.
                </p>
              </div>
            </label>
          </div>
        </fieldset>

        {/* Description */}
        <div>
          <Label htmlFor="description" className="text-sm font-semibold">
            About the Hub
          </Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="Describe what kind of projects, goals, or discussions belong here…"
            className="mt-1.5 rounded-2xl resize-y"
            maxLength={2000}
          />
        </div>

        {/* Guidelines / Rules */}
        <div>
          <Label htmlFor="rules" className="text-sm font-semibold">
            Community Guidelines / Rules
          </Label>
          <Textarea
            id="rules"
            value={rules}
            onChange={(e) => setRules(e.target.value)}
            rows={3}
            placeholder="e.g. Share honest updates, celebrate peer launches, no spam."
            className="mt-1.5 rounded-2xl resize-y"
            maxLength={2000}
          />
        </div>

        {/* Resource Links Repeater */}
        <div>
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">
              Resource Links <span className="text-muted-foreground font-normal">(up to 10)</span>
            </Label>
            {resources.length < 10 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addResource}
                className="rounded-full h-8"
              >
                <Plus className="size-3.5" /> Add Link
              </Button>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Add links to Discord, GitHub, documentation, or portals for members. Must start with
            https://.
          </p>
          {errors["resources"] && (
            <p className="mt-1 text-xs text-destructive">{errors["resources"]}</p>
          )}

          <div className="mt-3 space-y-3">
            {resources.map((res, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  placeholder="Label (e.g. Discord)"
                  value={res.label}
                  onChange={(e) => updateResource(i, "label", e.target.value)}
                  className="w-1/3 rounded-xl"
                  maxLength={40}
                />
                <Input
                  type="url"
                  placeholder="https://discord.gg/..."
                  value={res.url}
                  onChange={(e) => updateResource(i, "url", e.target.value)}
                  className="flex-1 rounded-xl"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeResource(i)}
                  className="size-9 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label="Remove link"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* Hub Emblem / Image (optional) */}
        <ImageUploadField
          folder="hubs"
          userId={user.id}
          value={avatarUrl}
          onChange={setAvatarUrl}
          label="Hub Emblem / Image (optional)"
          placeholder="https://…/hub-logo.png"
          fallbackName={name || "Hub"}
          shape="rounded"
          inputId="hub-avatar"
          disabled={mutation.isPending}
        />

        {formError && (
          <div
            role="alert"
            className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs font-medium text-destructive"
          >
            {formError}
          </div>
        )}

        {/* Actions */}
        <div className="pt-4 flex items-center justify-end gap-3 border-t border-border">
          <Button asChild variant="outline" className="rounded-full">
            <Link to="/hubs">Cancel</Link>
          </Button>
          <Button
            type="submit"
            variant="hero"
            size="lg"
            disabled={mutation.isPending}
            className="rounded-full px-8 shadow-lift"
          >
            {mutation.isPending ? "Creating Hub…" : "Create Hub"}
          </Button>
        </div>
      </form>
    </div>
  );
}
