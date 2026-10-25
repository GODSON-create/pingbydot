import satori from "satori";
import { SHARE_FONT_BASE64 } from "./font";
import { EMOJI_FONT_BASE64 } from "./emoji-font";
import { cardTree, type CardPalette, type SharePing } from "./card";

export async function renderCardSvg(ping: SharePing, colors: CardPalette, image?: { src: string; width: number; height: number }) {
  const font = Uint8Array.from(atob(SHARE_FONT_BASE64), (c) => c.charCodeAt(0));
  const emoji = Uint8Array.from(atob(EMOJI_FONT_BASE64), (c) => c.charCodeAt(0));
  return satori(cardTree(ping, colors, image), {
    width: 1080,
    fonts: [{ name: "Hanken", data: font.buffer, weight: 400, style: "normal" }, { name: "Hanken", data: font.buffer, weight: 700, style: "normal" }, { name: "Emoji", data: emoji.buffer, weight: 400, style: "normal" }],
    embedFont: true,
  });
}