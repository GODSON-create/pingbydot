import { createElement as h } from "react";

export type BrandVariant = "lime" | "gold" | "silver";

export type BrandLogoAsset = {
  src: string;
  darkSrc?: string;
  artworkDataUrl: string;
  width: number;
  height: number;
};

export const BRAND_MARK_PNGS: Record<BrandVariant, string> = {
  lime: "/brand/ping-mark-lime.png",
  gold: "/brand/ping-mark-gold.png",
  silver: "/brand/ping-mark-silver.png",
};

export const BRAND_MARK_SVGS: Record<BrandVariant, string> = {
  lime: "/brand/ping-icon.svg",
  gold: "/brand/ping-icon-gold.svg",
  silver: "/brand/ping-icon-silver.svg",
};

const LOGO_ARTWORK =
  '<svg xmlns="http://www.w3.org/2000/svg" width="520" height="128" viewBox="0 0 520 128"><rect x="8" y="12" width="104" height="104" rx="26" fill="#0d1711"/><path d="M 31 38 Q 33.5 50.5 45 53 Q 33.5 55.5 31 68 Q 28.5 55.5 17 53 Q 28.5 50.5 31 38 Z" fill="#C7F36B"/><circle cx="52" cy="58" r="3.5" fill="#C7F36B"/><circle cx="62.5" cy="58" r="3.5" fill="#C7F36B"/><circle cx="73" cy="58" r="3.5" fill="#C7F36B"/><path d="M 41 28 H 73 A 29.5 29.5 0 0 1 73 87 H 64.5 Q 59 87 59 92.5 V 102 H 41.5 V 89 Q 41.5 68.5 62 68.5 H 73 A 11 11 0 0 0 73 46.5 H 56 Q 41 46.5 41 28 Z" fill="#C7F36B"/><text x="136" y="86" fill="#173C32" font-family="Arial,Helvetica,sans-serif" font-size="76" font-weight="800" letter-spacing="-4">Ping</text><text x="354" y="84" fill="#5B756B" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="700" letter-spacing="3">BY DOT</text></svg>';

/** One local, first-party logo asset shared by navigation and social artwork. */
export function getBrandLogo(): BrandLogoAsset {
  return {
    src: "/brand/ping-logo.svg",
    darkSrc: "/brand/ping-logo-light.svg",
    artworkDataUrl: `data:image/svg+xml,${encodeURIComponent(LOGO_ARTWORK)}`,
    width: 520,
    height: 128,
  };
}

export function brandArtwork(color: string) {
  const logo = getBrandLogo();
  if (logo) {
    const width = Math.min(320, (88 * logo.width) / logo.height);
    return h("img", {
      src: logo.artworkDataUrl,
      alt: "Ping by DOT",
      width,
      height: (width * logo.height) / logo.width,
      style: { objectFit: "contain" },
    });
  }
  return h(
    "div",
    { style: { display: "flex", alignItems: "center", gap: 14, color } },
    h("span", { style: { fontSize: 64, fontWeight: 700 } }, "Ping"),
    h("span", { style: { fontSize: 22, marginTop: 16 } }, "by DOT"),
  );
}
