import { createServerOnlyFn } from "@tanstack/react-start";
import { Resvg, initResvg } from "@cf-wasm/resvg/others";
import { RESVG_WASM_BASE64 } from "./resvg-data";
import { renderCardSvg } from "./render";
import type { CardPalette, SharePing } from "./card";
import css from "@/styles.css?raw";

function artworkPalette(): CardPalette {
  const token = (name: string) => {
    const value = css.match(new RegExp(`--share-${name}:\\s*(#[a-fA-F0-9]{6})`))?.[1];
    if (!value) throw new Error("Missing artwork token");
    return value;
  };
  return { paper: token("paper"), ink: token("ink"), forest: token("forest"), lime: token("lime"), muted: token("muted"), border: token("border") };
}

export const renderSocialPng = createServerOnlyFn(async (ping: SharePing) => {
  if (!initResvg.initialized) {
    await initResvg(Uint8Array.from(atob(RESVG_WASM_BASE64), (c) => c.charCodeAt(0)));
  } else await initResvg.ensure();
  const colors = artworkPalette();
  // No arbitrary server-side URL fetches: image downloads include media in the browser.
  const card = await renderCardSvg(ping, colors);
  const height = Number(card.match(/height="(\d+)"/)?.[1]);
  if (!height) throw new Error("Invalid artwork dimensions");
  const scale = Math.min(1120 / 1080, 582 / height);
  const x = (1200 - 1080 * scale) / 2;
  const framed = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="${colors.paper}"/><g transform="translate(${x} 24) scale(${scale})">${card}</g></svg>`;
  const renderer = new Resvg(framed);
  try { return renderer.render().asPng(); }
  finally { renderer.free(); }
});