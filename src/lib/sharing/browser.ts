import { renderCardSvg } from "./render";
import type { CardPalette, SharePing } from "./card";

function palette(): CardPalette {
  const css = getComputedStyle(document.documentElement);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image creation is unavailable in this browser.");
  const color = (token: string) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = css.getPropertyValue(token).trim();
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r},${g},${b})`;
  };
  return { paper: color("--share-paper"), ink: color("--share-ink"), forest: color("--share-forest"), lime: color("--share-lime"), muted: color("--share-muted"), border: color("--share-border") };
}

async function loadImage(src: string) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = src;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([img.decode(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Image timed out")), 8000); })]);
  } finally { clearTimeout(timer); }
  return img;
}

export async function createCardPng(ping: SharePing) {
  let image: { src: string; width: number; height: number } | undefined;
  let imageOmitted = false;
  if (ping.image_url) {
    try {
      if (!/^https:\/\//i.test(ping.image_url)) throw new Error("Unsupported image URL");
      const original = await loadImage(ping.image_url);
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1200 / Math.max(original.naturalWidth, original.naturalHeight));
      canvas.width = Math.max(1, Math.round(original.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(original.naturalHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.drawImage(original, 0, 0, canvas.width, canvas.height);
      image = { src: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
    } catch { imageOmitted = true; }
  }
  const svg = await renderCardSvg(ping, palette(), image);
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = await loadImage(svgUrl);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image creation is unavailable in this browser.");
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error("Couldn't create the image.")), "image/png"));
    return { blob, imageOmitted };
  } finally { URL.revokeObjectURL(svgUrl); }
}

export function downloadCard(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}