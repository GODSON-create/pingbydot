import { z } from "zod";

export const CATEGORIES = [
  { value: "progress", label: "Building", emoji: "🛠️" },
  { value: "need", label: "Need", emoji: "🎯" },
  { value: "offer", label: "Offer", emoji: "⚡" },
  { value: "opportunity", label: "Opportunity", emoji: "🤝" },
  { value: "idea", label: "Idea", emoji: "💡" },
  { value: "question", label: "Question", emoji: "🙋" },
  { value: "collaboration", label: "Collaboration", emoji: "🔗" },
  { value: "update", label: "Update", emoji: "📈" },
  { value: "launch", label: "Launch", emoji: "🚀" },
  { value: "milestone", label: "Milestone", emoji: "🏁" },
] as const;

export type Category = (typeof CATEGORIES)[number]["value"];

/**
 * Primary 8 PING Intent Formats for the composer and feed filters.
 */
export const INTENT_FORMATS = [
  {
    value: "progress" as const,
    label: "Building",
    description: "Active product, venture, or project progress",
    dbCategory: "progress" as const,
  },
  {
    value: "need" as const,
    label: "Need",
    description: "Looking for specific people, skills, or resources",
    dbCategory: "opportunity" as const,
  },
  {
    value: "offer" as const,
    label: "Offer",
    description: "Sharing capabilities, mentorship, or resources",
    dbCategory: "opportunity" as const,
  },
  {
    value: "opportunity" as const,
    label: "Opportunity",
    description: "Open role, grant, cohort, or partnership",
    dbCategory: "opportunity" as const,
  },
  {
    value: "idea" as const,
    label: "Idea",
    description: "Validating a concept or thesis",
    dbCategory: "idea" as const,
  },
  {
    value: "question" as const,
    label: "Question",
    description: "Seeking domain advice or technical answers",
    dbCategory: "question" as const,
  },
  {
    value: "collaboration" as const,
    label: "Collaboration",
    description: "Co-building or partnering on an initiative",
    dbCategory: "opportunity" as const,
  },
  {
    value: "update" as const,
    label: "Update",
    description: "Milestone, release, or shipment update",
    dbCategory: "progress" as const,
  },
] as const;

export type IntentFormatValue = (typeof INTENT_FORMATS)[number]["value"] | "launch" | "milestone";

export const PING_MAX = 2000;

export const pingSchema = z
  .object({
    category: z.enum([
      "progress",
      "idea",
      "launch",
      "milestone",
      "question",
      "opportunity",
      "building",
      "need",
      "offer",
      "collaboration",
      "update",
    ]),
    content: z
      .string()
      .trim()
      .min(1, "Write something to share")
      .max(PING_MAX, `Keep it under ${PING_MAX} characters`),
    cta_url: z
      .string()
      .trim()
      .max(500)
      .refine(
        (v) => v === "" || /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(v),
        "Use a full link starting with https://",
      )
      .optional()
      .default(""),
    cta_label: z.string().trim().max(40, "Keep the button label short").optional().default(""),
  })
  .refine((v) => !(v.cta_label && !v.cta_url), {
    message: "Add a link for your button",
    path: ["cta_url"],
  });

export interface StructuredPingMeta {
  intentFormat: string;
  intentLabel: string;
  headline: string | null;
  body: string;
  needs: string[];
  offers: string[];
  skills: string[];
  desiredOutcome: string | null;
}

const INTENT_LABELS: Record<string, string> = {
  progress: "Building",
  building: "Building",
  need: "Need",
  offer: "Offer",
  opportunity: "Opportunity",
  idea: "Idea",
  question: "Question",
  collaboration: "Collaboration",
  update: "Update",
  launch: "Launch",
  milestone: "Milestone",
};

/**
 * Serializes optional structured intent fields (headline, needs, offers, outcome)
 * into clean human-readable content while remaining 100% compatible with plain-text Pings.
 */
export function serializeStructuredPing(input: {
  intentFormat: string;
  headline?: string;
  description: string;
  needs?: string[];
  offers?: string[];
  desiredOutcome?: string;
}): string {
  const lines: string[] = [];
  const fmt = input.intentFormat.trim().toLowerCase();
  if (
    fmt &&
    fmt !== "progress" &&
    fmt !== "idea" &&
    fmt !== "question" &&
    fmt !== "launch" &&
    fmt !== "milestone"
  ) {
    lines.push(`[Intent: ${INTENT_LABELS[fmt] || fmt}]`);
  }
  if (input.headline && input.headline.trim()) {
    lines.push(`Headline: ${input.headline.trim()}`);
  }
  lines.push(input.description.trim());

  const cleanNeeds = (input.needs ?? []).map((s) => s.trim()).filter(Boolean);
  const cleanOffers = (input.offers ?? []).map((s) => s.trim()).filter(Boolean);

  if (cleanNeeds.length > 0) {
    lines.push(`Needs: ${cleanNeeds.join(" · ")}`);
  }
  if (cleanOffers.length > 0) {
    lines.push(`Offers: ${cleanOffers.join(" · ")}`);
  }
  if (input.desiredOutcome && input.desiredOutcome.trim()) {
    lines.push(`Outcome: ${input.desiredOutcome.trim()}`);
  }

  return lines.join("\n\n").slice(0, PING_MAX);
}

/**
 * Parses a Ping row into structured intent presentation fields.
 */
export function parseStructuredPing(ping: {
  category: string;
  content: string;
  headline?: string | null;
  needs?: string[] | null;
  offers?: string[] | null;
  skills?: string[] | null;
  desired_outcome?: string | null;
}): StructuredPingMeta {
  let raw = ping.content || "";
  let intentFormat = ping.category || "progress";
  let headline: string | null = ping.headline ?? null;
  const needs: string[] = [...(ping.needs ?? [])];
  const offers: string[] = [...(ping.offers ?? [])];
  const skills: string[] = [...(ping.skills ?? [])];
  let desiredOutcome: string | null = ping.desired_outcome ?? null;

  const intentMatch = raw.match(/^\[Intent:\s*([A-Za-z]+)\]\s*\n+/i);
  if (intentMatch && intentMatch[1]) {
    intentFormat = intentMatch[1].toLowerCase();
    raw = raw.slice(intentMatch[0].length);
  }

  const headlineMatch = raw.match(/^Headline:\s*(.+?)(?:\n+|$)/i);
  if (headlineMatch && headlineMatch[1]) {
    if (!headline) headline = headlineMatch[1].trim();
    raw = raw.slice(headlineMatch[0].length);
  }

  const bodyLines: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (/^Needs:\s*/i.test(trimmed)) {
      const items = trimmed
        .replace(/^Needs:\s*/i, "")
        .split(/[·,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const item of items) {
        if (!needs.includes(item)) needs.push(item);
      }
    } else if (/^Offers:\s*/i.test(trimmed)) {
      const items = trimmed
        .replace(/^Offers:\s*/i, "")
        .split(/[·,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const item of items) {
        if (!offers.includes(item)) offers.push(item);
      }
    } else if (/^Outcome:\s*/i.test(trimmed)) {
      desiredOutcome = trimmed.replace(/^Outcome:\s*/i, "").trim();
    } else {
      bodyLines.push(line);
    }
  }

  const body = bodyLines.join("\n").trim() || ping.content;
  const intentLabel = INTENT_LABELS[intentFormat] || INTENT_LABELS[ping.category] || "Building";

  return {
    intentFormat,
    intentLabel,
    headline,
    body,
    needs,
    offers,
    skills,
    desiredOutcome,
  };
}

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,24}$/, "3–24 characters: letters, numbers or underscores");

export const profileSchema = z.object({
  username: usernameSchema,
  display_name: z.string().trim().min(1, "Add your name").max(60),
  bio: z.string().trim().max(280, "Keep your bio under 280 characters"),
  avatar_url: z
    .string()
    .trim()
    .refine((v) => v === "" || /^https:\/\//i.test(v), "Use an https:// image link")
    .optional()
    .default(""),
});
