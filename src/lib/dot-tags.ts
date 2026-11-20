/**
 * PING DOT Tag System (Section 7)
 *
 * Native `.tag` content classification & discovery convention (.trending, .fyp,
 * .technology, .business, .education, .entertainment, .africa, .startups,
 * .opportunities, .music, etc.) with full backwards compatibility for existing
 * `#hashtag` content without destructively rewriting historical posts.
 */

import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { likeCount, replyCount, type Ping } from "@/lib/pings";

export interface DotTagRecord {
  slug: string;
  display_tag: string;
  category: string;
  status: "active" | "restricted" | "blocked";
  usage_count: number;
  follower_count: number;
  featured: boolean;
}

export const CURATED_DOT_TAGS: readonly DotTagRecord[] = [
  {
    slug: "trending",
    display_tag: ".trending",
    category: "discovery",
    status: "active",
    usage_count: 0,
    follower_count: 0,
    featured: true,
  },
  {
    slug: "fyp",
    display_tag: ".fyp",
    category: "discovery",
    status: "active",
    usage_count: 0,
    follower_count: 0,
    featured: true,
  },
  {
    slug: "technology",
    display_tag: ".technology",
    category: "tech",
    status: "active",
    usage_count: 0,
    follower_count: 0,
    featured: true,
  },
  {
    slug: "business",
    display_tag: ".business",
    category: "commerce",
    status: "active",
    usage_count: 0,
    follower_count: 0,
    featured: true,
  },
  {
    slug: "education",
    display_tag: ".education",
    category: "learning",
    status: "active",
    usage_count: 0,
    follower_count: 0,
    featured: true,
  },
  {
    slug: "entertainment",
    display_tag: ".entertainment",
    category: "culture",
    status: "active",
    usage_count: 0,
    follower_count: 0,
    featured: true,
  },
  {
    slug: "africa",
    display_tag: ".africa",
    category: "regional",
    status: "active",
    usage_count: 0,
    follower_count: 0,
    featured: true,
  },
  {
    slug: "startups",
    display_tag: ".startups",
    category: "builders",
    status: "active",
    usage_count: 0,
    follower_count: 0,
    featured: true,
  },
  {
    slug: "opportunities",
    display_tag: ".opportunities",
    category: "careers",
    status: "active",
    usage_count: 0,
    follower_count: 0,
    featured: true,
  },
  {
    slug: "music",
    display_tag: ".music",
    category: "culture",
    status: "active",
    usage_count: 0,
    follower_count: 0,
    featured: true,
  },
  {
    slug: "design",
    display_tag: ".design",
    category: "creative",
    status: "active",
    usage_count: 0,
    follower_count: 0,
    featured: true,
  },
  {
    slug: "builders",
    display_tag: ".builders",
    category: "builders",
    status: "active",
    usage_count: 0,
    follower_count: 0,
    featured: true,
  },
  {
    slug: "climate",
    display_tag: ".climate",
    category: "impact",
    status: "active",
    usage_count: 0,
    follower_count: 0,
    featured: false,
  },
  {
    slug: "ai",
    display_tag: ".ai",
    category: "tech",
    status: "active",
    usage_count: 0,
    follower_count: 0,
    featured: true,
  },
] as const;

const BLOCKED_DOT_TAGS = new Set([
  "admin",
  "official_ping",
  "ping_support",
  "verified_badge",
  "scam",
  "phishing",
  "malware",
  "csam",
  "hate",
  "terror",
  "doxx",
]);

const FILE_EXTENSION_ALLOWLIST = new Set([
  "com",
  "org",
  "net",
  "io",
  "co",
  "app",
  "dev",
  "gov",
  "edu",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "mp4",
  "webm",
  "mov",
  "pdf",
  "csv",
  "json",
  "html",
  "tsx",
  "ts",
  "js",
  "sql",
]);

// Matches `.tag` ONLY when preceded by start-of-string, whitespace, or '(' and NOT followed by `.` or `/`
const DOT_TAG_EXTRACT_RE = /(?:^|[\s(])\.([a-zA-Z][a-zA-Z0-9_]{1,31})(?=$|[\s),!?;:])/g;
const LEGACY_HASHTAG_EXTRACT_RE = /(?:^|[\s(])#([a-zA-Z0-9_]{2,40})(?=$|[\s),!?;:])/g;

export function normalizeDotTagSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[.#]+/, "");
}

export function formatDotTag(slug: string): string {
  const clean = normalizeDotTagSlug(slug);
  return clean ? `.${clean}` : "";
}

export function validateDotTag(raw: string): { valid: boolean; slug?: string; error?: string } {
  const slug = normalizeDotTagSlug(raw);
  if (!slug) return { valid: false, error: "DOT Tag cannot be empty." };
  if (slug.length < 2 || slug.length > 32) {
    return { valid: false, error: "DOT Tags must be between 2 and 32 characters." };
  }
  if (!/^[a-z][a-z0-9_]{1,31}$/.test(slug)) {
    return {
      valid: false,
      error: "DOT Tags must start with a letter and contain only letters, numbers, or underscores.",
    };
  }
  if (BLOCKED_DOT_TAGS.has(slug)) {
    return { valid: false, error: `The tag .${slug} is restricted by Ping moderation policy.` };
  }
  if (FILE_EXTENSION_ALLOWLIST.has(slug)) {
    return {
      valid: false,
      error: `.${slug} is reserved to avoid conflicts with web domains and file extensions.`,
    };
  }
  return { valid: true, slug };
}

/**
 * Extracts valid native DOT Tags (`.technology`, `.africa`, `.fyp`) from text.
 * Safely ignores URLs (`https://ping.com`), decimals (`2.5`), and file names (`deck.pdf`).
 */
export function extractDotTags(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  const re = new RegExp(DOT_TAG_EXTRACT_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const candidate = match[1]?.toLowerCase() ?? "";
    const check = validateDotTag(candidate);
    if (check.valid && check.slug) {
      found.add(check.slug);
    }
    if (found.size >= 12) break;
  }
  return Array.from(found);
}

/**
 * Extracts legacy `#hashtags` without modifying original text.
 */
export function extractLegacyHashtags(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  const re = new RegExp(LEGACY_HASHTAG_EXTRACT_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match[1]) found.add(match[1].toLowerCase());
    if (found.size >= 12) break;
  }
  return Array.from(found);
}

/**
 * Unified tag extractor combining native DOT Tags and legacy `#hashtags`
 * for search, feed ranking, and cross-compatible tag discovery feeds.
 */
export function extractAllDiscoveryTags(text: string): string[] {
  return Array.from(new Set([...extractDotTags(text), ...extractLegacyHashtags(text)])).slice(
    0,
    15,
  );
}

/**
 * Detects if the user is actively typing a `.tag` token at the cursor position
 * and returns the partial prefix + replacement range for inline autocomplete.
 */
export function detectActiveDotTagQuery(
  text: string,
  cursorPos: number,
): { query: string; startIndex: number; endIndex: number } | null {
  const before = text.slice(0, cursorPos);
  const match = before.match(/(?:^|[\s(])\.([a-zA-Z0-9_]{0,31})$/);
  if (!match) return null;
  const dotOffset = before.lastIndexOf(".");
  if (dotOffset < 0) return null;
  return {
    query: (match[1] ?? "").toLowerCase(),
    startIndex: dotOffset,
    endIndex: cursorPos,
  };
}

const CONTENT_TAG_HINTS: Array<{ pattern: RegExp; slug: string }> = [
  { pattern: /\b(ai|llm|machine learning|griot|agent|model)\b/i, slug: "ai" },
  { pattern: /\b(tech|software|code|api|dev|app|cloud|saas)\b/i, slug: "technology" },
  { pattern: /\b(business|sme|commerce|store|sales|revenue|client)\b/i, slug: "business" },
  { pattern: /\b(startup|founder|seed|mvp|launch|pitch|venture)\b/i, slug: "startups" },
  { pattern: /\b(africa|lagos|nairobi|accra|kigali|cape town|cairo)\b/i, slug: "africa" },
  {
    pattern: /\b(job|hiring|grant|fellowship|scholarship|bounty|opportunity)\b/i,
    slug: "opportunities",
  },
  { pattern: /\b(learn|course|school|university|study|education|mentor)\b/i, slug: "education" },
  { pattern: /\b(music|song|beat|audio|album|concert|track)\b/i, slug: "music" },
  { pattern: /\b(film|movie|comedy|show|entertainment|culture|event)\b/i, slug: "entertainment" },
  { pattern: /\b(design|ui|ux|brand|figma|art)\b/i, slug: "design" },
  { pattern: /\b(solar|climate|energy|clean|green)\b/i, slug: "climate" },
];

export function suggestDotTags(
  contentText: string,
  queryPrefix = "",
  availableTags: readonly DotTagRecord[] = CURATED_DOT_TAGS,
): DotTagRecord[] {
  const q = normalizeDotTagSlug(queryPrefix);
  const activeTags = availableTags.filter((t) => t.status === "active");

  if (q) {
    return activeTags
      .filter((t) => t.slug.startsWith(q) || t.slug.includes(q) || t.category.includes(q))
      .slice(0, 8);
  }

  // Recommend based on text keywords first, then featured tags
  const recommendedSlugs = new Set<string>();
  for (const hint of CONTENT_TAG_HINTS) {
    if (hint.pattern.test(contentText)) {
      recommendedSlugs.add(hint.slug);
    }
  }
  const bySlug = new Map(activeTags.map((t) => [t.slug, t]));
  const ordered: DotTagRecord[] = [];
  for (const slug of recommendedSlugs) {
    const found = bySlug.get(slug);
    if (found) ordered.push(found);
  }
  for (const tag of activeTags) {
    if (!recommendedSlugs.has(tag.slug)) ordered.push(tag);
  }
  return ordered.slice(0, 8);
}

export function computeDotTagAnalytics(tagSlug: string, pings: Ping[]) {
  const slug = normalizeDotTagSlug(tagSlug);
  const matching = pings.filter((p) => {
    const allTags = extractAllDiscoveryTags(p.content);
    const colTags = Array.isArray((p as Ping & { dot_tags?: string[] }).dot_tags)
      ? ((p as Ping & { dot_tags?: string[] }).dot_tags ?? [])
      : [];
    return (
      allTags.includes(slug) || colTags.includes(slug) || (p.category ?? "").toLowerCase() === slug
    );
  });

  const authors = new Set(matching.map((p) => p.user_id));
  const totalLikes = matching.reduce((sum, p) => sum + likeCount(p), 0);
  const totalReplies = matching.reduce((sum, p) => sum + replyCount(p), 0);

  // Co-occurring related DOT Tags
  const coCounts = new Map<string, number>();
  for (const p of matching) {
    for (const t of extractAllDiscoveryTags(p.content)) {
      if (t !== slug) coCounts.set(t, (coCounts.get(t) ?? 0) + 1);
    }
  }
  const relatedTags = Array.from(coCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([s]) => s);

  return {
    slug,
    displayTag: formatDotTag(slug),
    matchingPings: matching,
    postCount: matching.length,
    uniqueAuthors: authors.size,
    totalLikes,
    totalReplies,
    relatedTags,
  };
}

/* -------------------------------------------------------------------------- */
/*                     SUPABASE PERSISTENCE & FOLLOW QUERIES                  */
/* -------------------------------------------------------------------------- */

const LOCAL_DOT_TAGS_KEY = "ping:dot-tags-follows:v1";

function isMissingDotTagSchema(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? "").toLowerCase();
  const code = String((err as { code?: string })?.code ?? "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "42703" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

function readLocalFollows(userId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(`${LOCAL_DOT_TAGS_KEY}:${userId}`);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeLocalFollows(userId: string, tags: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${LOCAL_DOT_TAGS_KEY}:${userId}`, JSON.stringify(tags));
  } catch {
    // Ignore storage errors
  }
}

export function dotTagsDirectoryQuery() {
  return queryOptions({
    queryKey: ["dot-tags-directory"],
    staleTime: 60_000,
    queryFn: async (): Promise<DotTagRecord[]> => {
      const { data, error } = await (supabase as any)
        .from("dot_tags")
        .select("*")
        .eq("status", "active")
        .order("featured", { ascending: false })
        .order("usage_count", { ascending: false })
        .limit(60);

      if (error) {
        if (!isMissingDotTagSchema(error)) throw error;
        return [...CURATED_DOT_TAGS];
      }
      const rows = (data ?? []) as DotTagRecord[];
      return rows.length > 0 ? rows : [...CURATED_DOT_TAGS];
    },
  });
}

export function followedDotTagsQuery(userId?: string) {
  return queryOptions({
    queryKey: ["followed-dot-tags", userId],
    enabled: Boolean(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<string[]> => {
      if (!userId) return [];
      const { data, error } = await (supabase as any)
        .from("user_dot_tag_follows")
        .select("tag_slug")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) {
        if (!isMissingDotTagSchema(error)) throw error;
        return readLocalFollows(userId);
      }
      return ((data ?? []) as Array<{ tag_slug: string }>).map((r) => r.tag_slug);
    },
  });
}

export function useToggleFollowDotTag(userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      slug,
      currentlyFollowing,
    }: {
      slug: string;
      currentlyFollowing: boolean;
    }) => {
      if (!userId) throw new Error("Sign in to follow DOT Tags.");
      const check = validateDotTag(slug);
      if (!check.valid || !check.slug) {
        throw new Error(check.error ?? "Invalid DOT Tag");
      }
      const clean = check.slug;

      if (currentlyFollowing) {
        const { error } = await (supabase as any)
          .from("user_dot_tag_follows")
          .delete()
          .eq("user_id", userId)
          .eq("tag_slug", clean);
        if (error) {
          if (!isMissingDotTagSchema(error)) throw error;
          writeLocalFollows(
            userId,
            readLocalFollows(userId).filter((s) => s !== clean),
          );
        }
        return false;
      }

      // Ensure tag exists in registry before following
      await (supabase as any)
        .from("dot_tags")
        .upsert(
          { slug: clean, display_tag: `.${clean}`, category: "community", created_by: userId },
          { onConflict: "slug", ignoreDuplicates: true },
        );

      const { error } = await (supabase as any)
        .from("user_dot_tag_follows")
        .insert({ user_id: userId, tag_slug: clean });
      if (error && error.code !== "23505") {
        if (!isMissingDotTagSchema(error)) throw error;
        const curr = new Set(readLocalFollows(userId));
        curr.add(clean);
        writeLocalFollows(userId, Array.from(curr));
      }
      return true;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["followed-dot-tags", userId] });
      void qc.invalidateQueries({ queryKey: ["followed-topics", userId] });
    },
  });
}

export async function syncPingDotTags(
  pingId: string,
  tags: string[],
  userId: string,
): Promise<void> {
  const validSlugs = tags
    .map((t) => validateDotTag(t))
    .filter((r): r is { valid: true; slug: string } => r.valid && Boolean(r.slug))
    .map((r) => r.slug);
  if (validSlugs.length === 0) return;

  for (const slug of validSlugs) {
    const { error: tagErr } = await (supabase as any)
      .from("dot_tags")
      .upsert(
        { slug, display_tag: `.${slug}`, category: "community", created_by: userId },
        { onConflict: "slug", ignoreDuplicates: true },
      );
    if (tagErr && isMissingDotTagSchema(tagErr)) return;

    await (supabase as any)
      .from("ping_dot_tags")
      .upsert({ ping_id: pingId, tag_slug: slug }, { onConflict: "ping_id,tag_slug" });
  }
}
