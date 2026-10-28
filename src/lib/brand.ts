import { createElement as h } from "react";

export type BrandLogoAsset = {
  src: string;
  darkSrc?: string;
  // Embed verified artwork for Satori: no remote server-side media requests.
  artworkDataUrl: string;
  width: number;
  height: number;
};

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