#!/usr/bin/env node
/**
 * Generates production PNG icons for the Ping by DOT Progressive Web App
 * from `public/brand/ping-icon.svg` using `@cf-wasm/resvg`.
 *
 * Outputs:
 *   - public/icons/icon-192.png (standard 192x192)
 *   - public/icons/icon-512.png (standard 512x512)
 *   - public/icons/icon-maskable-512.png (Android adaptive safe-zone 512x512)
 *   - public/icons/apple-touch-icon-180.png (iOS Home Screen 180x180)
 */
import fs from "node:fs";
import path from "node:path";
import { Resvg } from "@cf-wasm/resvg/node";

const ROOT = process.cwd();
const SRC_SVG = path.resolve(ROOT, "public/brand/ping-icon.svg");
const OUT_DIR = path.resolve(ROOT, "public/icons");

fs.mkdirSync(OUT_DIR, { recursive: true });

const rawSvg = fs.readFileSync(SRC_SVG, "utf8");
const inner = rawSvg
  .replace(/^<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "");

function buildFullBleedSvg(size, scale = 0.8) {
  const offset = ((1 - scale) * 120) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 120 120">
  <rect x="0" y="0" width="120" height="120" fill="#090B0A"/>
  <g transform="translate(${offset.toFixed(2)}, ${offset.toFixed(2)}) scale(${scale})">
    ${inner}
  </g>
</svg>`;
}

async function renderPng(svgString, width, outPath) {
  const resvg = await Resvg.async(svgString, {
    fitTo: { mode: "width", value: width },
  });
  const pngData = resvg.render().asPng();
  fs.writeFileSync(outPath, pngData);
  console.log(`Generated ${path.relative(ROOT, outPath)} (${pngData.length} bytes)`);
}

await renderPng(rawSvg, 192, path.join(OUT_DIR, "icon-192.png"));
await renderPng(rawSvg, 512, path.join(OUT_DIR, "icon-512.png"));
await renderPng(buildFullBleedSvg(512, 0.78), 512, path.join(OUT_DIR, "icon-maskable-512.png"));
await renderPng(buildFullBleedSvg(180, 0.88), 180, path.join(OUT_DIR, "apple-touch-icon-180.png"));
