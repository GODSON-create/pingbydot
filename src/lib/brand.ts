import { createElement as h } from "react";

export type BrandLogoAsset = {
  src: string;
  darkSrc?: string;
  // Embed verified artwork for Satori: no remote server-side media requests.
  artworkDataUrl: string;
  width: number;
  height: number;
};

// PENDING OFFICIAL LOGO: return the approved asset here (src, optional darkSrc,
// embedded artworkDataUrl, intrinsic width/height) and set OFFICIAL_LOGO_URL in
// src/lib/site.ts; header, share cards, OG images and JSON-LD pick it up.
// No official Ping logo has been supplied. Do not substitute the template favicon
// or the decorative mark previously drawn in navigation.
export function getBrandLogo(): BrandLogoAsset | null {
  return null;
}

export function brandArtwork(color: string) {
  const logo = getBrandLogo();
  if (logo) {
    const width = Math.min(320, 88 * logo.width / logo.height);
    return h("img", { src: logo.artworkDataUrl, alt: "Ping by DOT", width, height: width * logo.height / logo.width, style: { objectFit: "contain" } });
  }
  return h("div", { style: { display: "flex", alignItems: "center", gap: 14, color } },
    h("span", { style: { fontSize: 64, fontWeight: 700 } }, "Ping"),
    h("span", { style: { fontSize: 22, marginTop: 16 } }, "by DOT"));
}