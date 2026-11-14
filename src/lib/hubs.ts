import { z } from "zod";
import { siteUrl } from "@/lib/site";

export const HUB_CATEGORIES = [
  { value: "organization", label: "Organization", emoji: "🏢" },
  { value: "school", label: "School", emoji: "🎓" },
  { value: "incubator", label: "Incubator", emoji: "🚀" },
  { value: "ecosystem", label: "Ecosystem", emoji: "🌍" },
  { value: "community", label: "Community", emoji: "🤝" },
] as const;
export type HubCategory = (typeof HUB_CATEGORIES)[number]["value"];

export const HUB_INTENTS = [
  { value: "ask", label: "Ask", emoji: "🙋" },
  { value: "offer", label: "Offer", emoji: "🎁" },
  { value: "launch", label: "Launch", emoji: "🚀" },
  { value: "collaborate", label: "Collaborate", emoji: "🤝" },
  { value: "intro", label: "Intro", emoji: "👋" },
] as const;
export type HubIntent = (typeof HUB_INTENTS)[number]["value"];
export const intentValues = HUB_INTENTS.map((i) => i.value) as [HubIntent, ...HubIntent[]];

export const HUB_MEMBER_LIMIT = 10000;
export const HUB_PAGE_SIZE = 24;

export type HubRole = "owner" | "admin" | "moderator" | "member";
export type HubResource = { label: string; url: string };
export type Hub = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  rules: string;
  category: HubCategory;
  access: "public" | "private";
  resources: HubResource[];
  verified: boolean;
  member_count: number;
  ping_count: number;
  member_limit: number;
  owner_id: string;
  created_at: string;
};

export const HUB_SELECT =
  "id,slug,name,tagline,description,rules,category,access,resources,verified,member_count,ping_count,member_limit,owner_id,created_at";

/** Turn a hub name into a URL-safe slug candidate. */
export function slugify(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const safeUrl = z
  .string()
  .trim()
  .url("Enter a full link starting with https://")
  .refine((u) => /^https:\/\//i.test(u), "Links must start with https://");

export const hubSchema = z.object({
  name: z.string().trim().min(2, "Give your hub a name").max(60),
  slug: z.string().regex(SLUG_RE, "Use 3–40 lowercase letters, numbers or dashes"),
  tagline: z.string().trim().max(120).default(""),
  description: z.string().trim().max(2000).default(""),
  rules: z.string().trim().max(2000).default(""),
  category: z.enum(["organization", "school", "incubator", "ecosystem", "community"]),
  access: z.enum(["public", "private"]),
  resources: z
    .array(z.object({ label: z.string().trim().min(1).max(40), url: safeUrl }))
    .max(10)
    .default([]),
});
export type HubDraft = z.infer<typeof hubSchema>;

/** Only https resource links survive, even if bad data reaches the database. */
export function safeResources(raw: unknown): HubResource[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const p = z.object({ label: z.string().min(1).max(40), url: safeUrl }).safeParse(r);
    return p.success ? [p.data] : [];
  });
}

export const hubUrl = (slug: string) => siteUrl(`/hubs/${encodeURIComponent(slug)}`);
export const inviteUrl = (slug: string, token: string) =>
  `${hubUrl(slug)}?invite=${encodeURIComponent(token)}`;

export const isHubStaff = (role: HubRole | null | undefined) =>
  role === "owner" || role === "admin" || role === "moderator";
export const canManageInvites = (role: HubRole | null | undefined) =>
  role === "owner" || role === "admin";

/** Whether a visitor may read a hub's feed and member directory. */
export const canSeeHubContent = (access: Hub["access"], role: HubRole | null | undefined) =>
  access === "public" || !!role;

/** Rank builders by Pings shared into the hub (feed-local leaderboard). */
export function topBuilders<T extends { author: { username: string } | null }>(items: T[], n = 5) {
  const counts = new Map<string, { author: NonNullable<T["author"]>; count: number }>();
  for (const it of items) {
    if (!it.author) continue;
    const c = counts.get(it.author.username);
    if (c) c.count++;
    else
      counts.set(it.author.username, { author: it.author as NonNullable<T["author"]>, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, n);
}
