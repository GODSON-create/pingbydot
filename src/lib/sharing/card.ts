import { createElement as h } from "react";
import { CATEGORIES } from "@/lib/validation";
import { pingUrl, type Ping } from "@/lib/pings";

export type SharePing = Pick<Ping, "id" | "content" | "category" | "author" | "image_url" | "updated_at">;
export type CardPalette = { paper: string; ink: string; forest: string; lime: string; muted: string; border: string };

export function shareExcerpt(content: string, limit = 160) {
  const text = content.replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  const excerpt = text.slice(0, limit - 1);
  const boundary = excerpt.lastIndexOf(" ");
  return `${boundary > limit * 0.6 ? excerpt.slice(0, boundary) : excerpt}…`;
}

export function shareMessage(ping: SharePing) {
  return `${ping.author?.display_name || ping.author?.username || "A founder"} on Ping: ${shareExcerpt(ping.content)}\n${pingUrl(ping.id)}`;
}

export function socialImageUrl(ping: SharePing) {
  return `${new URL(pingUrl(ping.id)).origin}/api/public/ping-card/${encodeURIComponent(ping.id)}?v=${encodeURIComponent(ping.updated_at)}`;
}

// Artwork, not a DOM screenshot. Satori measures the full content and grows the card.
export function cardTree(ping: SharePing, colors: CardPalette, image?: { src: string; width: number; height: number }) {
  const category = CATEGORIES.find((c) => c.value === ping.category)?.label || "Ping";
  const name = ping.author?.display_name || ping.author?.username || "Founder";
  const handle = ping.author?.username ? `@${ping.author.username}` : "Building in public";
  const size = ping.content.length < 180 ? 62 : ping.content.length < 600 ? 48 : 36;
  const row = { display: "flex", alignItems: "center", justifyContent: "space-between" } as const;
  return h("div", { style: { display: "flex", flexDirection: "column", width: 1080, minHeight: 1080, padding: 64, background: colors.paper, color: colors.ink, fontFamily: "Hanken", border: `2px solid ${colors.border}`, borderRadius: 40 } },
    h("div", { style: row },
      h("div", { style: { display: "flex", alignItems: "center", gap: 14, color: colors.forest } },
        h("span", { style: { fontSize: 64, fontWeight: 700 } }, "Ping"),
        h("span", { style: { fontSize: 22, marginTop: 16 } }, "by DOT")),
      h("div", { style: { display: "flex", padding: "12px 24px", borderRadius: 32, background: colors.lime, color: colors.forest, fontSize: 24, fontWeight: 700 } }, category)),
    h("div", { style: { display: "flex", flexGrow: 1, flexDirection: "column", paddingTop: 60, paddingBottom: 60 } },
      h("div", { style: { fontSize: size, lineHeight: 1.35, whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "anywhere" } }, ping.content),
      image ? h("img", { src: image.src, width: 948, height: Math.min(700, Math.round(948 * image.height / image.width)), style: { objectFit: "contain", marginTop: 40, borderRadius: 20 } }) : null),
    h("div", { style: { ...row, borderTop: `2px solid ${colors.border}`, paddingTop: 32, gap: 24 } },
      h("div", { style: { display: "flex", flexDirection: "column", maxWidth: 570 } },
        h("span", { style: { fontSize: 30, fontWeight: 700, wordBreak: "break-word" } }, name),
        h("span", { style: { fontSize: 24, color: colors.muted, marginTop: 8 } }, handle)),
      h("span", { style: { fontSize: 22, color: colors.forest } }, "Build in public.")),
    h("div", { style: { display: "flex", color: colors.muted, fontSize: 18, marginTop: 30, wordBreak: "break-all" } }, pingUrl(ping.id).replace(/^https:\/\//, "")));
}