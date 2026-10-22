import { z } from "zod";

export const CATEGORIES = [
  { value: "progress", label: "Progress", emoji: "📈" },
  { value: "idea", label: "Idea", emoji: "💡" },
  { value: "launch", label: "Launch", emoji: "🚀" },
  { value: "milestone", label: "Milestone", emoji: "🏁" },
  { value: "question", label: "Question", emoji: "🙋" },
  { value: "opportunity", label: "Opportunity", emoji: "🤝" },
] as const;
export type Category = (typeof CATEGORIES)[number]["value"];

export const PING_MAX = 2000;

export const pingSchema = z
  .object({
    category: z.enum(["progress", "idea", "launch", "milestone", "question", "opportunity"]),
    content: z.string().trim().min(1, "Write something to share").max(PING_MAX, `Keep it under ${PING_MAX} characters`),
    cta_url: z
      .string()
      .trim()
      .max(500)
      .refine((v) => v === "" || /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(v), "Use a full link starting with https://")
      .optional()
      .default(""),
    cta_label: z.string().trim().max(40, "Keep the button label short").optional().default(""),
  })
  .refine((v) => !(v.cta_label && !v.cta_url), { message: "Add a link for your button", path: ["cta_url"] });

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
