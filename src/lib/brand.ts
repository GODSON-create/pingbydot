import { createElement as h } from "react";

export type BrandLogoAsset = {
  src: string;
  darkSrc?: string;
  artworkDataUrl: string;
  width: number;
  height: number;
};

const LOGO_ARTWORK = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"520\" height=\"128\" viewBox=\"0 0 520 128\"><rect x=\"8\" y=\"12\" width=\"104\" height=\"104\" rx=\"30\" fill=\"#173C32\"/><path d=\"M42 64a18 18 0 0 1 18-18M31 64a29 29 0 0 1 29-29M60 46a18 18 0 0 1 18 18M60 35a29 29 0 0 1 29 29\" fill=\"none\" stroke=\"#C8F36A\" stroke-width=\"7\" stroke-linecap=\"round\"/><circle cx=\"60\" cy=\"78\" r=\"7\" fill=\"#C8F36A\"/><text x=\"136\" y=\"86\" fill=\"#173C32\" font-family=\"Arial,Helvetica,sans-serif\" font-size=\"76\" font-weight=\"800\" letter-spacing=\"-4\">Ping</text><text x=\"354\" y=\"84\" fill=\"#5B756B\" font-family=\"Arial,Helvetica,sans-serif\" font-size=\"20\" font-weight=\"700\" letter-spacing=\"3\">BY DOT</text></svg>";

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
